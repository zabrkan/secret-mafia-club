/* POST /.netlify/functions/submit
   Body: { accessCode, games:[{date, round, won, winners:[], losers:[], mafia:[], don, sheriff,
                               seating:[], votes:[]}], force?:bool }
   Appends one row per game to the Google Sheet the tracker reads. The site picks the rows up on
   the next page load — there is no redeploy.

   Two ways to authenticate the write, whichever the club got working:
     1. Service account  — GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY   (preferred)
     2. Apps Script webhook — APPS_SCRIPT_URL (+ optional APPS_SCRIPT_SECRET)
   No npm dependencies: the JWT is signed with node:crypto. */

const crypto = require('crypto');

const SHEET_ID = process.env.SHEET_ID || '17SGDPe7YyjIHxAdqnfQ2ogNh0F0ESk7fu3zK_p_ZD7s';
const SHEET_GID = parseInt(process.env.SHEET_GID || '0', 10);
const WRITE_EXTENDED = String(process.env.WRITE_EXTENDED_COLUMNS || 'true') !== 'false';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Service-account JWT -> OAuth access token, no SDK. */
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) return null;

  // Netlify env vars usually carry the newlines escaped.
  key = key.replace(/\\n/g, '\n').trim();
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(key)) {
    throw new Error('GOOGLE_PRIVATE_KEY does not look like a PEM private key. Paste the whole "-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----" block.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google rejected the service account: ' + (body.error_description || body.error || res.status));
  return body.access_token;
}

/* gid -> tab name, because the Sheets API writes by tab name. */
async function resolveTabName(token) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(sheetId,title)`,
    { headers: { authorization: 'Bearer ' + token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || res.status;
    if (res.status === 403) throw new Error(`The service account cannot open the sheet. Share the sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as an Editor. (${msg})`);
    throw new Error('Could not read the spreadsheet: ' + msg);
  }
  const sheets = body.sheets || [];
  const hit = sheets.find(s => s.properties && s.properties.sheetId === SHEET_GID);
  return (hit && hit.properties.title) || (sheets[0] && sheets[0].properties.title) || 'Sheet1';
}

/* Existing (date, round) pairs, so a double-submit does not double-count anybody. */
async function existingKeys(token, tab) {
  const range = encodeURIComponent(`${tab}!A:B`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: 'Bearer ' + token } });
  if (!res.ok) return new Set();
  const body = await res.json().catch(() => ({}));
  const keys = new Set();
  (body.values || []).forEach(r => {
    const d = String((r[0] || '')).trim();
    const n = String((r[1] || '')).trim();
    if (d && n) keys.add(normDate(d) + '#' + n);
  });
  return keys;
}

/* M/D/YY, so 01/05/2026 and 1/5/26 compare equal. */
function normDate(s) {
  const m = /^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/.exec(String(s).trim());
  if (!m) return String(s).trim();
  const yy = m[3].length === 4 ? m[3].slice(2) : m[3].padStart(2, '0');
  return `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}/${yy}`;
}

/* The append uses USER_ENTERED so the date lands as a real date, which also means a cell
   starting with = + - or @ would be evaluated as a formula. Names come from a vision model and
   a free-text review box, so neutralise those before they reach a sheet other people rely on. */
function safeCell(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
/* Names are cleaned individually, not as a joined blob: prefixing the whole cell with an
   apostrophe would neutralise the formula but glue the apostrophe onto the first player's
   name when the site reads the row back. No real name starts with a formula character, and
   validate() rejects those outright — this is the second line of defence. */
function cleanName(n) {
  return String(n == null ? '' : n).replace(/^[=+\-@]+/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}
function joinNames(list) {
  return (list || []).map(cleanName).filter(Boolean).join(',');
}

function rowFor(g) {
  const base = [
    g.date,
    g.round,
    g.won,                       // "Mafia" | "Citizens"
    joinNames(g.winners),
    '', '', '',                  // E-G are unused in this sheet
    joinNames(g.losers)
  ];
  if (!WRITE_EXTENDED) return base;
  return base.concat([
    joinNames(g.mafia),                                           // I  mafia roster
    safeCell(g.don || ''),                                        // J  don
    safeCell(g.sheriff || ''),                                    // K  sheriff
    safeCell((g.seating || [])                                    // L  seating order
      .map((n, i) => `${i + 1}:${String(n).replace(/\s+/g, ' ').trim()}`).join(' ')),
    safeCell((g.votes || []).map(v =>                             // M  vote log
      `V${v.vote_round}[` + (v.tallies || []).map(t => `${t.seat}:${t.count}`).join(' ') + ']').join(' ')),
    'portal',                                                     // N  provenance
    new Date().toISOString()                                      // O  submitted at
  ]);
}

async function appendViaServiceAccount(games, force) {
  const token = await getAccessToken();
  if (!token) return null;
  const tab = await resolveTabName(token);

  const seen = await existingKeys(token, tab);
  const dupes = games.filter(g => seen.has(normDate(g.date) + '#' + String(g.round)));
  if (dupes.length && !force) {
    return { duplicate: dupes.map(g => `${g.date} game ${g.round}`) };
  }

  const range = encodeURIComponent(`${tab}!A:${WRITE_EXTENDED ? 'O' : 'H'}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ values: games.map(rowFor) })
    });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || res.status;
    if (res.status === 403) throw new Error(`The service account can read but not write. Re-share the sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as an **Editor**. (${msg})`);
    throw new Error('Sheets API refused the write: ' + msg);
  }
  return { updates: (body.updates && body.updates.updatedRows) || games.length, via: 'service-account' };
}

async function appendViaAppsScript(games) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({ secret: process.env.APPS_SCRIPT_SECRET || '', rows: games.map(rowFor) })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apps Script webhook returned ${res.status}: ${text.slice(0, 300)}`);
  return { updates: games.length, via: 'apps-script', response: text.slice(0, 200) };
}

/* ---- validation (server side; the browser validates too, but never trust the browser) ---- */
const NAME_OK = /^[\p{L}\p{M}0-9 .'’-]{1,40}$/u;

function validate(g, i) {
  const where = `Game ${i + 1}`;
  const errs = [];
  if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(g.date || '').trim())) errs.push(`${where}: date must look like M/D/YY.`);
  if (!Number.isInteger(g.round) || g.round < 1 || g.round > 99) errs.push(`${where}: round must be a whole number from 1 to 99.`);
  if (g.won !== 'Mafia' && g.won !== 'Citizens') errs.push(`${where}: winner must be "Mafia" or "Citizens".`);

  const winners = (g.winners || []).map(s => String(s).trim()).filter(Boolean);
  const losers = (g.losers || []).map(s => String(s).trim()).filter(Boolean);
  if (winners.length < 1) errs.push(`${where}: no winners listed.`);
  if (losers.length < 1) errs.push(`${where}: no losers listed.`);

  const all = winners.concat(losers);
  const lower = all.map(n => n.toLowerCase());
  const dupe = lower.find((n, idx) => lower.indexOf(n) !== idx);
  if (dupe) errs.push(`${where}: "${dupe}" appears twice — a player can only be on one side.`);
  /* Allowlist rather than blocklist. These names are rendered into the public leaderboard's
     HTML, so anything outside letters/digits/space/.'- never reaches the sheet. */
  const bad = all.find(n => !NAME_OK.test(n));
  if (bad) errs.push(`${where}: "${bad.slice(0, 40)}" is not a usable player name — letters, digits, spaces, . ' and - only, up to 40 characters.`);
  if (all.length < 4 || all.length > 20) errs.push(`${where}: ${all.length} players is outside the plausible range of 4-20.`);

  const mafiaCount = (g.won === 'Mafia' ? winners : losers).length;
  if (mafiaCount < 1) errs.push(`${where}: the mafia side is empty.`);
  return errs;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { Allow: 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { ok: false, error: 'Body was not valid JSON.' }); }

  /* Fail CLOSED. An unset PORTAL_ACCESS_CODE used to leave this endpoint writing to the club's
     shared sheet for anyone on the internet — and that is the default state of a fresh deploy,
     with a "+ Log a game" link sitting on the public homepage. */
  const expected = process.env.PORTAL_ACCESS_CODE || '';
  if (!expected) {
    return json(503, { ok: false, error: 'The portal is not configured yet. Set PORTAL_ACCESS_CODE in Netlify → Environment variables, then redeploy.' });
  }
  if (String(payload.accessCode || '') !== expected) {
    return json(401, { ok: false, error: 'Wrong access code.' });
  }

  const games = Array.isArray(payload.games) ? payload.games : [];
  if (!games.length) return json(400, { ok: false, error: 'No games to submit.' });
  if (games.length > 20) return json(400, { ok: false, error: 'That is more than 20 games in one submission — split it up.' });

  const errs = games.flatMap(validate);
  if (errs.length) return json(400, { ok: false, error: errs.join(' ') });

  try {
    let result = await appendViaServiceAccount(games, payload.force === true);
    if (result && result.duplicate) {
      return json(409, {
        ok: false,
        duplicate: result.duplicate,
        error: `Already recorded: ${result.duplicate.join(', ')}. Submit again with "add anyway" if this really is a separate game.`
      });
    }
    if (!result) result = await appendViaAppsScript(games);
    if (!result) {
      return json(500, {
        ok: false,
        error: 'The server has no way to write to the sheet yet. Set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (or APPS_SCRIPT_URL) in Netlify → Environment variables.'
      });
    }
    return json(200, { ok: true, added: games.length, ...result });
  } catch (e) {
    return json(502, { ok: false, error: e && e.message ? e.message : String(e) });
  }
};
