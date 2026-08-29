# Secret Mafia Club — tracker site (Claude Code guide)

A character/stats tracker for our **Mafia** game nights. Live, zero-backend: the browser pulls the
game log straight from a Google Sheet on every page load and recomputes everything client-side.

- **Live site:** https://secret-mafia-club.netlify.app
- **Deploys:** push to `main` → Netlify auto-builds (`build.sh`) and publishes. No manual step.
- **Data updates:** two ways in. Either edit the Google Sheet by hand, or use the **score-sheet
  portal** at `/submit.html` — photograph the paper, check the auto-read on screen, submit. Both
  land in the same sheet; neither needs a redeploy.

## The one rule that makes the data work
The **`WHO WON` column decides which side is the Mafia** — winners if it says Mafia, losers if it
says Citizens. That is how every player's role + result per round is derived. The sheet columns:
`DATE | ROUND # | WHO WON | WHO WERE THE WINNERS | (3 blank) | WHO WERE THE LOSERS`
(`WHO WON` = "Citizens" or "Mafia"; winners/losers are comma-separated names.)

**Mafia team size is NOT fixed.** The club has played both 2-mafia and 3-mafia nights (see
7/26/26), so never infer the faction from the size of a side — read the `WHO WON` column. Older
notes here claimed "the 2-person side is the Mafia"; that was only ever true of the first two
sessions and is wrong as a rule.

## Architecture (one engine, three skins)
- `sheet.js` — fetches the sheet via **gviz JSONP** (no CORS, no "publish to web" needed) and builds
  the full data model (`buildFromGviz`). This is the source of truth for stats. Mirrors nothing else —
  edit stat *definitions* here if they come from the raw log.
- `app.js` — the UI engine. Renders dashboard + roster + character sheets into a shared DOM. Holds
  `computeDerived()` (power/GSP, streaks, mafia frequency), the `METRICS` map (leaderboard sorts),
  tier logic, and `renderSuperlatives()` (Hall of Fame). Data is `let M` (live data replaces the snapshot).
- `theme-club.css` + the three older `theme-*.css` — visual skins over the same DOM.
  **Club (`v4-club`) is canonical** — it is the homepage, and it is what `submit.html` is styled to
  match. `v1-facebook`, `v2-smash` and `v3-hybrid` are legacy experiments, still built and reachable
  by direct URL but no longer the shipped look. Delete them if they stop earning their keep.
- `build.py` — stamps the three HTML shells from one template (brand/nav/theme differ per skin).
- `config.js` — which sheet to read (`id`, `gid`). Point at a different sheet here.
- `data.js` — a baked snapshot, used ONLY as offline fallback if the live fetch fails. Regenerate rarely.
  (It is stale — 8 games vs the 12 now live. Harmless, since it is only the fallback.)

## The score-sheet portal (`/submit.html`)
The only part of the site with a server. Full setup — env vars, Google credentials, costs — is in
`PORTAL_SETUP.md`; read that before touching it.
- `submit.html` + `portal.css` + `portal.js` — the 3-step page: photos → review → submit. `portal.js`
  reuses `config.js`/`sheet.js` to pull the live roster so it can flag misspelled and unknown names.
- `netlify/functions/scan.js` — one photo per request → Anthropic Messages API with a forced
  `tool_choice` schema → structured game JSON. Never writes anything; always safe to retry.
- `netlify/functions/submit.js` — appends reviewed rows via the Sheets API. Service-account JWT is
  signed with `node:crypto`, so the functions have **zero npm dependencies** — keep it that way.
- Writes columns A–H exactly as the parser expects, plus optional rich data in I–O (roles, seating,
  votes) that `sheet.js` ignores. Never put anything in E, F or G.
- Guardrails worth preserving: duplicate `(date, round)` detection with an explicit override, names
  sanitised against spreadsheet formula injection, and a deliberately conservative name-suggestion
  matcher (first letter must match) — a wrongly accepted suggestion merges two real players forever.

## Common changes
- **Add a leaderboard stat:** add an entry to `METRICS` in `app.js`, then add a matching
  `<button data-sort="...">` to the sortbar in `build.py`. Re-run `bash build.sh`.
- **Tweak a skin's look:** edit the relevant `theme-*.css`. No rebuild needed for CSS-only changes
  (the HTML links the CSS), but running `build.sh` never hurts.
- **Change the homepage skin:** edit `build.sh` (the `cp ... public/index.html` line).
- **Point at a new sheet/tab:** edit `config.js`. The tab must be shared "Anyone with the link can view."
- **New players / new game nights:** nothing to do here — they appear automatically from the sheet.

## Run & verify locally
- Preview: `python3 -m http.server 8000` then open http://localhost:8000/v2-smash.html
  (opening the file directly also works — the live fetch still runs).
- Rebuild deployable output: `bash build.sh` → writes `./public`.
- Mobile check (optional): `npm i puppeteer-core && node mobshot.js` renders true 390px screenshots and
  asserts `scrollWidth == clientWidth` (no horizontal overflow).

## Conventions
- Keep it **dependency-free at runtime** — plain HTML/CSS/JS, no framework, no build tooling required to view.
- `build.py` uses only the Python stdlib. Don't add packages to the deploy path.
- Don't commit `public/`, `node_modules/`, `shots/`, or `.netlify/` (see `.gitignore`).
- Round every number shown to users; the parser already does. Verify game logic against the
  "2-person side = Mafia" rule before trusting a stat.
