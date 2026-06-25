# Mafia Rumble — tracker site (Claude Code guide)

A character/stats tracker for our **Mafia** game nights. Live, zero-backend: the browser pulls the
game log straight from a Google Sheet on every page load and recomputes everything client-side.

- **Live site:** https://mafia-rumble.netlify.app
- **Deploys:** push to `main` → Netlify auto-builds (`build.sh`) and publishes. No manual step.
- **Data updates:** just edit the Google Sheet and refresh the site. No code change, no redeploy.

## The one rule that makes the data work
Each round, the **2-person side is the Mafia**; the ~8-person side is the Citizens. That's how we
derive every player's role + result per round. The sheet columns are:
`DATE | ROUND # | WHO WON | WHO WERE THE WINNERS | (3 blank) | WHO WERE THE LOSERS`
(`WHO WON` = "Citizens" or "Mafia"; winners/losers are comma-separated names.)

## Architecture (one engine, three skins)
- `sheet.js` — fetches the sheet via **gviz JSONP** (no CORS, no "publish to web" needed) and builds
  the full data model (`buildFromGviz`). This is the source of truth for stats. Mirrors nothing else —
  edit stat *definitions* here if they come from the raw log.
- `app.js` — the UI engine. Renders dashboard + roster + character sheets into a shared DOM. Holds
  `computeDerived()` (power/GSP, streaks, mafia frequency), the `METRICS` map (leaderboard sorts),
  tier logic, and `renderSuperlatives()` (Hall of Fame). Data is `let M` (live data replaces the snapshot).
- `theme-facebook.css`, `theme-smash.css`, `theme-hybrid.css` — the three visual skins over the same DOM.
  **Smash is the one we shipped** (homepage). The others are kept reachable.
- `build.py` — stamps the three HTML shells from one template (brand/nav/theme differ per skin).
- `config.js` — which sheet to read (`id`, `gid`). Point at a different sheet here.
- `data.js` — a baked snapshot, used ONLY as offline fallback if the live fetch fails. Regenerate rarely.

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
