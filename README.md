# Secret Mafia Club 🔪

A live stats tracker for our **Mafia** game nights — dashboard, sortable leaderboard, a Smash-style
fighter roster, and a character sheet for every player. Reads our Google Sheet directly in the browser,
so it's always current.

**Live:** https://secret-mafia-club.netlify.app

## How it works (no backend)
The site fetches the game log from a Google Sheet on every load and computes all stats client-side.
**Add a row to the sheet → refresh the page → it's updated.** No deploy needed for data.

## Working on it with Claude Code
1. Clone the repo and open the folder in Claude Code.
2. Claude Code reads `CLAUDE.md` automatically and will know the project conventions, the data model,
   and how deploys work.
3. Make changes, then commit and push to `main`.
4. **Netlify auto-deploys every push** — your change is live in ~30s. Check it at the URL above.

You only need: a GitHub account (ask the owner to invite you), `git`, `python3` (for `build.sh`),
and Claude Code. You do **not** need a Netlify account.

## Preview locally
```bash
python3 -m http.server 8000
# open http://localhost:8000/v2-smash.html   (this is the homepage skin)
```
Opening the HTML file directly works too — the live data fetch still runs.

## Project layout
| File | Purpose |
|------|---------|
| `sheet.js` | Pulls the Google Sheet (gviz JSONP) and builds the stat model |
| `app.js` | UI engine: dashboard, leaderboard sorts, roster, character sheets |
| `theme-*.css` | Three visual skins (Facebook / Smash / Hybrid). Smash = homepage |
| `build.py` / `build.sh` | Generate the HTML pages into `public/` for deploy |
| `config.js` | Which sheet to read |
| `data.js` | Offline fallback snapshot |
| `deploy.sh` | Manual CLI deploy (rarely needed — pushes auto-deploy) |

See **CLAUDE.md** for the data rules and how to add stats or skins.
