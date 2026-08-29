# Score-sheet portal — setup

The portal lives at **`/submit.html`** on the deployed site. Someone photographs each paper score
sheet, the photo is read automatically, they check and correct the reading on screen, and pressing
submit appends a row to the same Google Sheet the leaderboard already reads. No redeploy, no
manual typing.

**The photo scan is optional.** The portal also has an "enter a game by hand" path that skips
scanning entirely — same review form, same validation, same write. That path needs **no
`ANTHROPIC_API_KEY` and no vision API at all**, only the Google credentials in section 2. It is
also the fallback when a photo is too blurry to read.

Two Netlify Functions do the work:

| Function | What it does | Secrets it needs |
|---|---|---|
| `scan.js` | photo → structured game data | `ANTHROPIC_API_KEY` |
| `submit.js` | reviewed rows → Google Sheet | Google credentials (below) |

Nothing is written to the sheet until a human presses **Add to leaderboard** on the review screen.

---

## 1. Environment variables

Netlify → your site → **Site configuration → Environment variables**. Add these, then redeploy.

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | From console.anthropic.com. Server-side only — it never reaches the browser. |
| `PORTAL_ACCESS_CODE` | **yes** | A shared word the club types once per session. Both functions **refuse every request** until this is set — they fail closed, so an unconfigured deploy is never an open endpoint. The leaderboard links to the portal publicly, so this is the only thing standing between the internet and your API credit. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5`. Set to `claude-opus-5` for harder handwriting, at more cost and a slower scan. |
| `SHEET_ID` | no | Defaults to the club's current sheet. |
| `SHEET_GID` | no | Tab id, defaults to `0`. |
| `WRITE_EXTENDED_COLUMNS` | no | `true` by default — also writes roles, seating and votes into columns I–O. Set `false` to write only A–H. |

## 2. Letting the server write to the sheet

Pick **one** of these. The service account is more robust; the Apps Script route needs no Google
Cloud account at all.

### Option A — service account (recommended)

1. Go to <https://console.cloud.google.com/>, create a project (any name).
2. **APIs & Services → Library → Google Sheets API → Enable.**
3. **APIs & Services → Credentials → Create credentials → Service account.** Name it
   `mafia-portal`, then Create and Done.
4. Open the new service account → **Keys → Add key → Create new key → JSON.** A file downloads.
5. From that JSON copy two values into Netlify env vars:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` ← the `client_email` field
     (looks like `mafia-portal@your-project.iam.gserviceaccount.com`)
   - `GOOGLE_PRIVATE_KEY` ← the `private_key` field, **the whole thing** including
     `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`.
     Paste it exactly as it appears in the JSON; the escaped `\n` sequences are handled.
6. **Share the Google Sheet with that `client_email` address as an Editor**, exactly like sharing
   with a person. This step is the one everybody forgets — without it you get a 403.

### Option B — Apps Script webhook

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace the contents with:

   ```javascript
   const SECRET = 'pick-a-long-random-string';

   function doPost(e) {
     const body = JSON.parse(e.postData.contents);
     if (body.secret !== SECRET) {
       return ContentService.createTextOutput('forbidden');
     }
     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
     body.rows.forEach(r => sheet.appendRow(r));
     return ContentService.createTextOutput('ok:' + body.rows.length);
   }
   ```

3. **Deploy → New deployment → Web app.** Execute as *Me*, access *Anyone*. Copy the `/exec` URL.
4. In Netlify set `APPS_SCRIPT_URL` to that URL and `APPS_SCRIPT_SECRET` to the same string you
   put in `SECRET`.

## 3. Optional — label the extra columns

With `WRITE_EXTENDED_COLUMNS` on, the portal also fills columns I–O. The leaderboard ignores them
(`sheet.js` only reads A, B, C, D and H), but labelling the header row once keeps the sheet
readable. In row 1:

| I | J | K | L | M | N | O |
|---|---|---|---|---|---|---|
| MAFIA | DON | SHERIFF | SEATING | VOTES | SOURCE | SUBMITTED |

Do **not** put anything in E, F or G — the leaderboard expects losers in column H.

## 4. Check it works

1. Open `https://<your-site>/submit.html`.
2. Enter the access code, upload one photo of a sheet, and watch it scan.
3. On the review screen, confirm the names, roles and winning side.
4. Submit, then open the leaderboard — the new game should be there on load.

If something fails, the portal shows the real reason on screen. The usual causes:

| Message | Cause |
|---|---|
| "Server is missing ANTHROPIC_API_KEY" | env var not set, or the site was not redeployed after setting it |
| "The service account cannot open the sheet" | step A6 — share the sheet with the service account email |
| "can read but not write" | shared as Viewer instead of **Editor** |
| "The portal is not configured yet" | `PORTAL_ACCESS_CODE` is unset — both functions fail closed until you set it |
| "Wrong access code" | Mismatch; the portal sends you back to the code screen automatically |
| Scan times out | switch `ANTHROPIC_MODEL` to `claude-sonnet-5`, or raise the function timeout in Netlify |

## 5. What it costs

One scan is one photo, roughly a cent or two on Sonnet. A ten-game night is well under a quarter.
The access code is what keeps that bill predictable.

## 6. Design notes worth knowing

- **The mafia side comes from the role column, not from team size.** The club has played both
  2-mafia and 3-mafia games, so nothing assumes a fixed size. The review screen warns when the
  count is neither 2 nor 3 but never blocks it.
- **Duplicate protection** is on `(date, game number)`. Submitting the same night twice is
  refused with an explicit "Add anyway" override, so nobody's win count silently doubles.
- **New-name flagging** compares every scanned name against the live roster. Suggestions are
  deliberately conservative — the first letter must match and short names get no slack — because a
  wrongly accepted suggestion merges two real players permanently. `Chynnah → Chynna` is caught;
  `Jonny → Penny` is not offered.
- **Names are prefixed with `'` when written** if they start with `=`, `+`, `-` or `@`, so a
  stray character can never become a live formula in the shared sheet.
