#!/usr/bin/env bash
# Manual deploy from the command line (fallback — normally Netlify auto-deploys on push).
# You do NOT need this when you only change the spreadsheet; the site reads it live.
set -e
cd "$(dirname "$0")"
bash build.sh
npx -y netlify-cli deploy --prod --dir public --site 2313bf48-2b76-449e-849e-216b7f46efa2
