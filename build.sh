#!/usr/bin/env bash
# Generate the deployable site into ./public
# Used both locally and by Netlify's build (see netlify.toml).
set -e
cd "$(dirname "$0")"
python3 build.py
rm -rf public && mkdir public
cp v1-facebook.html v2-smash.html v3-hybrid.html app.js sheet.js config.js data.js theme-*.css public/
cp v2-smash.html public/index.html
echo "Built public/ ($(ls public | wc -l | tr -d ' ') files)"
