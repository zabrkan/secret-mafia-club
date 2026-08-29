/* POST /.netlify/functions/scan
   Body: { accessCode, image: "data:image/jpeg;base64,...", knownNames: ["Ricky", ...] }
   Returns: { ok:true, game:{...} }  — one scanned game sheet, unvalidated, for human review.

   Reads ONE photo per request on purpose: vision extraction of handwriting takes 10-25s and
   Netlify's synchronous function budget is tight. The client loops over photos and shows
   per-photo progress. Nothing here writes anywhere — scanning is always safe to retry. */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // decoded; client downscales well below this

/* The extraction contract. Forced via tool_choice so the model cannot answer in prose. */
const GAME_SCHEMA = {
  type: 'object',
  properties: {
    date_raw:   { type: 'string', description: 'The date EXACTLY as written on the paper, verbatim, including any ambiguous digits. Empty string if absent.' },
    date:       { type: 'string', description: 'Your best reading of the date as M/D/YY. If the year is ambiguous or implausible, still give your best guess here and lower date_confidence.' },
    date_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    round:      { type: 'integer', description: 'The game/round number from the "Game:" field. 1 if it cannot be read.' },
    round_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    won:        { type: 'string', enum: ['Mafia', 'Citizens'], description: 'Which side won. The header has "Mafia / Citizen Win" with the winning side circled or underlined. Cross-check against the Winners line at the bottom.' },
    won_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    winners_line_raw: { type: 'string', description: 'The handwritten names on the "Winners:" line at the bottom, verbatim. Empty string if absent.' },
    players: {
      type: 'array',
      description: 'Every seat listed in the P1..P10 roster, in seat order. Include every seat even if the name is unclear.',
      items: {
        type: 'object',
        properties: {
          seat: { type: 'integer', description: 'Seat number, e.g. 3 for P3.' },
          name: { type: 'string', description: 'The player name as written. Normalize obvious capitalisation (PENNY -> Penny) but do NOT invent or "correct" a name into a different name.' },
          name_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          role: { type: 'string', enum: ['Citizen', 'Mafia', 'Don', 'Sheriff'], description: 'From the role annotations written beside the roster (e.g. "Mafia", "Don", "Sheriff") and/or the D/M/S letters beside the seating diagram. Default to Citizen when unannotated.' },
          eliminated: { type: 'boolean', description: 'True if this seat is crossed out / X-ed in the seating diagram at the bottom, meaning they died during the game.' }
        },
        required: ['seat', 'name', 'name_confidence', 'role', 'eliminated']
      }
    },
    votes: {
      type: 'array',
      description: 'Each vote round recorded on the sheet, in order. Under each "Vote N" heading the seat numbers are written on top and their tally marks underneath.',
      items: {
        type: 'object',
        properties: {
          vote_round: { type: 'integer' },
          tallies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                seat:  { type: 'integer', description: 'Seat number that received votes.' },
                count: { type: 'integer', description: 'Number of tally marks. A five-bar gate (four strokes crossed) is 5.' }
              },
              required: ['seat', 'count']
            }
          }
        },
        required: ['vote_round', 'tallies']
      }
    },
    unreadable: {
      type: 'array',
      description: 'Anything you genuinely could not read, so a human can check it. Be specific, e.g. "P7 surname illegible" or "Vote 3 tally for seat 9 smudged".',
      items: { type: 'string' }
    },
    notes: { type: 'string', description: 'Brief note on anything unusual about this sheet. Empty string if nothing stands out.' }
  },
  required: ['date_raw', 'date', 'date_confidence', 'round', 'round_confidence', 'won', 'won_confidence',
             'winners_line_raw', 'players', 'votes', 'unreadable', 'notes']
};

function buildPrompt(knownNames) {
  const roster = (knownNames && knownNames.length)
    ? `\n## Known players from previous game nights\nThese names already exist in the league. Handwriting is ambiguous, so when a scrawled name plausibly matches one of these, prefer the existing spelling EXACTLY as given here:\n${knownNames.join(', ')}\n\nBut do not force a match. A genuinely new player is normal — write what you actually see and mark name_confidence accordingly.\n`
    : '';

  return `You are reading a photograph of a handwritten score sheet from a live Mafia (the social deduction party game) night. Extract it into structured data.

## How these sheets are laid out
- Top left: a **Date** field.
- Top centre: "**Mafia / Citizen Win**" — the winning side is circled or underlined.
- Top right: a "**Game:**" number, which is the round number within that night.
- Right side: the **roster**, listed P1 through P10, one player name per seat. Special roles are hand-annotated to the LEFT of the seat label — typically "Mafia", "Don", and "Sheriff". The Don is a member of the mafia; the Sheriff is a citizen.
- Left / middle: **Vote 1, Vote 2, ...** blocks. In each block, seat numbers are written across the top with tally marks beneath each one. Tally marks are usually vertical strokes; a group of five is drawn as four strokes with a diagonal through them.
- Bottom: a **seating diagram** — circled seat numbers arranged around a rectangular table. A seat with an **X through it was eliminated** (voted out or killed at night). Letters beside circles echo roles: D = Don, M = Mafia, S = Sheriff.

## Counting tally marks — slow down here
Miscounting is the most common error on these sheets, so treat each group deliberately:
- Count ONLY the marks belonging to that seat's column. Do not include the horizontal rule the
  seat number is written on, the seat number itself, or marks from the neighbouring column.
- A five-bar gate — four vertical strokes with one diagonal slashed through them — is exactly **5**,
  not 6. Four plain strokes are **4**.
- Count each group twice and only report a number you got both times. If the two counts disagree,
  report your best count AND add an entry to \`unreadable\` naming that vote round and seat.
- Sanity check: the votes in one round cannot exceed the number of players still alive, and usually
  equal it or fall just short. If your totals imply more voters than there are seats, recount.

## Reading the seating diagram
Match each X to the **number written inside that circle**, not to the circle's position on the page.
Work through the circles one at a time, read the digit inside, then decide whether that specific
circle is struck through. Seats that are drawn but clean are still alive.
- Bottom right: a "**Winners:**" line with the winning players' names.

## Rules
1. Transcribe what is actually on the paper. Never invent a player, a vote, or a seat that is not there.
2. The mafia side is made up of the seats annotated Mafia or Don. This league plays with either 2 or 3 mafia. If you read a different number, still report exactly what you see and say so in \`unreadable\` or \`notes\` — do not silently adjust to make it fit.
3. Cross-check the circled Mafia/Citizen header against the Winners line. If they disagree, trust the Winners line, set \`won\` from it, lower \`won_confidence\`, and explain in \`notes\`.
4. Names are often written in a mix of caps and cursive. Normalise casing to Title Case (PENNY becomes Penny), but never change one name into a different name.
5. Distinct names that look similar are usually genuinely different people (for example Jon and Jonny may both be at the same table). Keep them distinct.
6. Handwritten years are frequently misread. Put the literal characters in \`date_raw\` and your best interpretation in \`date\`. If the year looks implausible, keep your reading but set \`date_confidence\` to low.
7. Be honest with confidence values. A human reviews every field before anything is saved, and a flagged low-confidence field is far more useful than a confident guess.
${roster}
Call \`record_game\` with everything you can read.`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Allow': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { ok: false, error: 'Server is missing ANTHROPIC_API_KEY. Set it in Netlify → Site settings → Environment variables.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body was not valid JSON.' }); }

  /* Fail CLOSED — an unset code would otherwise make this an open proxy onto the owner's
     Anthropic key, reachable from the "+ Log a game" link on the public homepage. */
  const expected = process.env.PORTAL_ACCESS_CODE || '';
  if (!expected) {
    return json(503, { ok: false, error: 'The portal is not configured yet. Set PORTAL_ACCESS_CODE in Netlify → Environment variables, then redeploy.' });
  }
  if (String(payload.accessCode || '') !== expected) {
    return json(401, { ok: false, error: 'Wrong access code.' });
  }

  const dataUrl = String(payload.image || '');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return json(400, { ok: false, error: 'Expected a JPEG, PNG or WebP data URL in "image".' });

  const mediaType = m[1];
  const b64 = m[2];
  if (Buffer.from(b64, 'base64').length > MAX_IMAGE_BYTES) {
    return json(413, { ok: false, error: 'That photo is too large even after resizing. Try a tighter crop of just the sheet.' });
  }

  const knownNames = Array.isArray(payload.knownNames)
    ? payload.knownNames.filter(n => typeof n === 'string' && n.trim()).slice(0, 300)
    : [];

  /* Identity-linked keys (the kind the console now issues by default) must name the workspace
     the request acts in. Workspace-scoped keys carry it implicitly and ignore the header. */
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    headers['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID;
  }

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        tools: [{
          name: 'record_game',
          description: 'Record every field read off the handwritten Mafia score sheet.',
          input_schema: GAME_SCHEMA
        }],
        tool_choice: { type: 'tool', name: 'record_game' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: buildPrompt(knownNames) }
          ]
        }]
      })
    });
  } catch (e) {
    return json(502, { ok: false, error: 'Could not reach the vision API: ' + (e && e.message ? e.message : String(e)) });
  }

  const raw = await resp.text();
  if (!resp.ok) {
    let detail = raw.slice(0, 400);
    try { const j = JSON.parse(raw); if (j.error && j.error.message) detail = j.error.message; } catch {}
    if (/anthropic-workspace-id/i.test(detail)) {
      detail = 'This Anthropic key is identity-linked, so it needs a workspace id. Set ANTHROPIC_WORKSPACE_ID in Netlify (find it in the console URL at Settings → Workspaces), or issue a workspace-scoped key instead.';
    }
    return json(resp.status === 401 ? 500 : 502, {
      ok: false,
      error: resp.status === 401
        ? 'The vision API rejected the key. Check ANTHROPIC_API_KEY in Netlify.'
        : `Vision API error (${resp.status}): ${detail}`
    });
  }

  let game = null;
  try {
    const body = JSON.parse(raw);
    const block = (body.content || []).find(c => c.type === 'tool_use' && c.name === 'record_game');
    if (block) game = block.input;
  } catch (e) {
    return json(502, { ok: false, error: 'Could not parse the vision API response.' });
  }
  if (!game) return json(502, { ok: false, error: 'The model did not return a structured reading. Try re-taking the photo with the whole sheet in frame.' });

  game.players = Array.isArray(game.players) ? game.players : [];
  game.votes = Array.isArray(game.votes) ? game.votes : [];
  game.unreadable = Array.isArray(game.unreadable) ? game.unreadable : [];
  game.players.sort((a, b) => (a.seat || 0) - (b.seat || 0));

  return json(200, { ok: true, model: MODEL, game });
};
