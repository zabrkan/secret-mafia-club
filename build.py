#!/usr/bin/env python3
THEMES = {
 "v1-facebook": dict(
   css="theme-facebook.css", body="theme-fb",
   fonts='<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
   title="mafiabook",
   brand='<span class="logo-mark">m</span><span class="logo-word">mafiabook</span>',
   nav1="Home", nav2="Roster",
   right='<div class="fakesearch">🔍 Search players</div>',
   dashtitle="", rostertitle="Players",
 ),
 "v2-smash": dict(
   css="theme-smash.css", body="theme-smash",
   fonts='<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&display=swap" rel="stylesheet">',
   title="Secret Mafia Club",
   brand='<span class="logo-bolt">⚔</span><span class="logo-word">SECRET MAFIA <em>CLUB</em></span>',
   nav1="Battle Records", nav2="Character Select",
   right='<div class="coin">© SEASON 1</div>',
   dashtitle="Battle Records", rostertitle="Choose your player",
 ),
 "v3-hybrid": dict(
   css="theme-hybrid.css", body="theme-hybrid",
   fonts='<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
   title="FightBook",
   brand='<span class="logo-mark">⚔</span><span class="logo-word">Fight<em>Book</em></span>',
   nav1="Home", nav2="Roster",
   right='<div class="fakesearch">🔍 Search the roster</div>',
   dashtitle="Season overview", rostertitle="The Roster",
 ),
 "v4-club": dict(
   css="theme-club.css", body="theme-club",
   fonts='<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">',
   title="Secret Mafia Club",
   brand='<a class="brand-link" href="https://secretmafiaclub.com" target="_blank" rel="noopener noreferrer" aria-label="Secret Mafia Club"><img class="brand-logo" src="logo.png" alt="Secret Mafia Club" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span class="logo-word" style="display:none">Secret Mafia <em>Club</em></span></a>',
   nav1="Overview", nav2="Players",
   right='<div class="coin">Season 1</div>',
   dashtitle="Overview", rostertitle="Players",
 ),
}

BODY = '''<header class="topbar">
  <div class="brand">{brand}</div>
  <nav class="mainnav">
    <button data-view="dashboard" class="active">{nav1}</button>
    <button data-view="roster">{nav2}</button>
  </nav>
  <div class="topbar-right"><span id="syncStatus" class="sync" style="font-size:11px;letter-spacing:.3px;margin-right:12px;white-space:nowrap"></span><a class="coin portal-link" href="submit.html" style="text-decoration:none">+ Log a game</a>{right}</div>
</header>
<main class="app">
  <section id="view-dashboard" class="view">
    {dashhead}
    <div id="statCards" class="stat-cards"></div>
    <div id="factionRecord" class="faction"></div>
    <div class="awards-head"><h3>Hall of fame</h3><span class="panel-tag">auto-awarded · click to open</span></div>
    <div id="superlatives" class="awards"></div>
    <div class="dash-cols">
      <section class="panel panel-lb">
        <div class="panel-head"><h3>Leaderboard</h3><span class="panel-tag" id="sortLabel">by win %</span></div>
        <div class="sortbar" id="sortbar">
          <button data-sort="winRate" class="active">Win %</button>
          <button data-sort="wins">Wins</button>
          <button data-sort="games">Games</button>
          <button data-sort="mafiaWR">Getaway %</button>
          <button data-sort="mafiaFreq">Rap sheet</button>
          <button data-sort="citWR">Town read</button>
          <button data-sort="streak">Streak</button>
        </div>
        <div class="sort-caption" id="sortCaption"></div>
        <div id="leaderboard"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Recent game nights</h3><span class="panel-tag">latest first</span></div>
        <div id="feed"></div>
      </section>
    </div>
  </section>
  <section id="view-roster" class="view hidden">
    <div class="roster-head">
      <h2 class="roster-title">{rostertitle}</h2>
      <input id="rosterSearch" placeholder="Search by name…" autocomplete="off">
      <div class="filters">
        <button data-filter="all" class="active">All</button>
        <button data-filter="cit">Pure Citizens</button>
        <button data-filter="maf">Ran Mafia</button>
      </div>
      <span id="rosterCount" class="roster-count"></span>
    </div>
    <div id="rosterGrid" class="roster-grid"></div>
  </section>
</main>
<div id="charModal" class="modal hidden">
  <div class="modal-card">
    <button data-close class="modal-x" aria-label="Close">✕</button>
    <div id="charModalBody"></div>
  </div>
</div>'''

TPL = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — tracker</title>
{fonts}
<link rel="stylesheet" href="{css}">
</head>
<body class="{body}">
{bodyhtml}
<script src="config.js"></script>
<script src="sheet.js"></script>
<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>'''

for fname, t in THEMES.items():
    dashhead = f'<h1 class="dash-title">{t["dashtitle"]}</h1>' if t["dashtitle"] else ''
    bodyhtml = BODY.format(brand=t["brand"], nav1=t["nav1"], nav2=t["nav2"], right=t["right"],
                           dashhead=dashhead, rostertitle=t["rostertitle"])
    html = TPL.format(title=t["title"], fonts=t["fonts"], css=t["css"], body=t["body"], bodyhtml=bodyhtml)
    open(f"{fname}.html","w").write(html)
    print("wrote", fname+".html")
