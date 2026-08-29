/* Score-sheet portal: photo -> scan -> review -> append to the Google Sheet.
   Zero dependencies, same as the rest of the site. Nothing is written until the human
   presses submit on step 3. */
(function () {
  'use strict';

  var SCAN_URL = '/.netlify/functions/scan';
  var SUBMIT_URL = '/.netlify/functions/submit';
  var MAX_DIM = 1800;          // px on the long edge — plenty for handwriting, small enough to POST
  var JPEG_Q = 0.82;
  var CONCURRENCY = 3;
  var MAFIA_ROLES = { Mafia: 1, Don: 1 };

  var state = { accessCode: '', files: [], games: [], known: [], existing: {}, nextId: 1 };

  var $ = function (id) { return document.getElementById(id); };
  function show(id) {
    ['s-gate', 's-upload', 's-scanning', 's-review', 's-done'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
    $('stepper').classList.toggle('hidden', id === 's-gate' || id === 's-done');
    var n = { 's-upload': 1, 's-scanning': 2, 's-review': 2, 's-done': 3 }[id] || 1;
    [].forEach.call(document.querySelectorAll('.step'), function (el) {
      var i = +el.dataset.step;
      el.classList.toggle('on', i === n);
      el.classList.toggle('done', i < n);
    });
    window.scrollTo(0, 0);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- known roster, so the review can flag names nobody has ever played under ---------- */
  function loadRoster() {
    if (!window.loadMafiaLive || !window.MAFIA_SHEET) return;
    window.loadMafiaLive(window.MAFIA_SHEET.id, window.MAFIA_SHEET.gid, function (data) {
      state.known = (data.players || []).map(function (p) { return p.name; }).sort();
      (data.games || []).forEach(function (g) { state.existing[normDate(g.date) + '#' + g.round] = true; });
      var dl = $('rosterNames');
      if (dl) dl.innerHTML = state.known.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
      renderReview();
    }, function () { /* offline is survivable — you just lose the new-name flags */ });
  }
  function normDate(s) {
    var m = /^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/.exec(String(s || '').trim());
    if (!m) return String(s || '').trim();
    var yy = m[3].length === 4 ? m[3].slice(2) : ('0' + m[3]).slice(-2);
    return (+m[1]) + '/' + (+m[2]) + '/' + yy;
  }
  function lev(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return 0;
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  /* Suggest an existing player only when the difference really looks like a typo.
     Deliberately conservative: a wrong suggestion that gets accepted merges two different
     people forever, which is worse than missing one. Hence the first letter must agree
     (Jonny/Penny are distance 2 apart but are obviously not the same person), short names
     get no slack at all, and anyone else already at this table is excluded outright. */
  function closestKnown(name, atTable) {
    var n = String(name || '').trim();
    if (n.length < 3 || !state.known.length) return null;
    var lim = n.length >= 6 ? 2 : 1;
    var best = null, bd = 99;
    state.known.forEach(function (k) {
      if (!k || k[0].toLowerCase() !== n[0].toLowerCase()) return;
      if (k.toLowerCase() === n.toLowerCase()) return;
      if (atTable && atTable[k.toLowerCase()]) return;
      var d = lev(n, k);
      if (d < bd) { bd = d; best = k; }
    });
    return bd <= lim ? best : null;
  }
  function isKnown(name) {
    var l = String(name || '').toLowerCase();
    return state.known.some(function (k) { return k.toLowerCase() === l; });
  }

  /* ---------- step 1: photos ---------- */
  async function shrink(file) {
    var bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      bmp = await new Promise(function (res, rej) {
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () { URL.revokeObjectURL(url); res(img); };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('unreadable')); };
        img.src = url;
      });
    }
    var w = bmp.width, h = bmp.height;
    if (!w || !h) throw new Error('unreadable');
    var scale = Math.min(1, MAX_DIM / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, cw, ch);
    if (bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', JPEG_Q);
  }

  async function addFiles(list) {
    var arr = [].slice.call(list).filter(function (f) { return /^image\//.test(f.type) || /\.hei[cf]$/i.test(f.name); });
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i];
      var rec = { id: state.nextId++, name: f.name || ('photo-' + state.nextId), dataUrl: null, err: null };
      state.files.push(rec);
      renderThumbs();
      try {
        rec.dataUrl = await shrink(f);
      } catch (e) {
        rec.err = 'Could not open this image. On iPhone, set Camera → Formats → Most Compatible, or take a screenshot of the photo and upload that.';
      }
      renderThumbs();
    }
  }

  function renderThumbs() {
    var el = $('thumbs');
    el.innerHTML = state.files.map(function (f) {
      var cls = f.err ? 'thumb err' : (f.dataUrl ? 'thumb ok' : 'thumb');
      var st = f.err ? 'Failed' : (f.dataUrl ? 'Ready' : 'Loading…');
      var img = f.dataUrl ? '<img src="' + f.dataUrl + '" alt="">' : '';
      return '<div class="' + cls + '">' + img +
        '<button class="thumb-x" data-rm="' + f.id + '" aria-label="Remove">✕</button>' +
        '<div class="thumb-state">' + st + '</div></div>';
    }).join('');
    var ready = state.files.filter(function (f) { return f.dataUrl; }).length;
    $('scanGo').disabled = ready === 0;
    $('scanGo').textContent = ready ? ('Scan ' + ready + ' sheet' + (ready > 1 ? 's' : '')) : 'Scan sheets';
    $('clearAll').hidden = state.files.length === 0;
    var bad = state.files.filter(function (f) { return f.err; });
    if (bad.length) {
      var n = $('reviewNotice');
      if (n) n.innerHTML = '';
    }
  }

  /* ---------- step 2: scan ---------- */
  async function scanAll() {
    var todo = state.files.filter(function (f) { return f.dataUrl; });
    if (!todo.length) return;
    show('s-scanning');
    $('scanList').innerHTML = todo.map(function (f) {
      return '<div class="scanrow" id="sr-' + f.id + '"><div class="spin"></div>' +
        '<div class="nm">' + esc(f.name) + '</div><div class="st">Queued</div></div>';
    }).join('');

    state.games = [];
    var idx = 0, failures = [];
    async function worker() {
      while (idx < todo.length) {
        var f = todo[idx++];
        var row = $('sr-' + f.id);
        row.className = 'scanrow busy';
        row.querySelector('.st').textContent = 'Reading…';
        try {
          var g = await scanOne(f);
          g.__id = f.id; g.__src = f.name;
          state.games.push(g);
          row.className = 'scanrow ok';
          row.querySelector('.spin').style.visibility = 'hidden';
          row.querySelector('.st').textContent = 'Done';
        } catch (e) {
          failures.push({ name: f.name, msg: e.message });
          row.className = 'scanrow err';
          row.querySelector('.spin').style.visibility = 'hidden';
          row.querySelector('.st').textContent = 'Failed';
          row.querySelector('.nm').textContent = f.name + ' — ' + e.message;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    state.games.sort(function (a, b) { return a.__id - b.__id; });
    if (!state.games.length) {
      $('scanList').insertAdjacentHTML('beforeend',
        '<div class="notice err" style="margin-top:18px">Nothing could be read. ' +
        esc(failures.length ? failures[0].msg : '') +
        '</div><div class="actions"><button class="btn ghost" onclick="location.reload()">Try again</button></div>');
      return;
    }
    if (failures.length) {
      state.__failNote = failures.length + ' photo' + (failures.length > 1 ? 's' : '') +
        ' could not be read (' + failures.map(function (f) { return esc(f.name); }).join(', ') +
        '). You can still submit the rest and re-upload those separately.';
    }
    renderReview();
    show('s-review');
  }

  async function scanOne(f) {
    var res, body;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(SCAN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessCode: state.accessCode, image: f.dataUrl, knownNames: state.known })
        });
      } catch (e) {
        if (attempt) throw new Error('Network error. Check your connection.');
        continue;
      }
      body = await res.json().catch(function () { return {}; });
      if (res.ok && body.ok) return body.game;
      if (res.status === 401 || res.status === 503) {
        resetGate(body.error || 'Access code rejected.');
        throw new Error(body.error || 'Access code rejected.');
      }
      if (attempt) throw new Error(body.error || ('Scan failed (' + res.status + ').'));
    }
    throw new Error('Scan failed.');
  }

  /* ---------- manual entry ----------
     The review card is already a complete, validated entry form, so a blank one is a
     perfectly good way in when there is no photo — or when a photo will not scan. */
  function todayMDY() {
    var d = new Date();
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
  }
  function blankGame(seats) {
    var players = [];
    for (var i = 1; i <= (seats || 10); i++) {
      players.push({ seat: i, name: '', name_confidence: 'high', role: 'Citizen', eliminated: false });
    }
    var lastDate = state.games.length ? state.games[state.games.length - 1].date : todayMDY();
    return {
      __src: 'entered by hand', date: lastDate, date_raw: '', date_confidence: 'high',
      round: state.games.length + 1, round_confidence: 'high',
      won: 'Citizens', won_confidence: 'high', winners_line_raw: '',
      players: players, votes: [], unreadable: [], notes: ''
    };
  }
  function addManual() {
    state.games.push(blankGame(10));
    renderReview();
    show('s-review');
  }

  /* ---------- derived ---------- */
  function sides(g) {
    var maf = [], cit = [];
    (g.players || []).forEach(function (p) {
      var n = String(p.name || '').trim();
      if (!n) return;
      (MAFIA_ROLES[p.role] ? maf : cit).push(n);
    });
    return { maf: maf, cit: cit };
  }
  function problems(g) {
    var s = sides(g), errs = [], warns = [];
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(g.date || '').trim()))
      errs.push('The date needs to look like 12/27/26.');
    else if (g.date_confidence === 'low')
      warns.push('The date was hard to read' + (g.date_raw ? ' — the paper says “' + esc(g.date_raw) + '”' : '') + '. Double-check the year.');

    if (!(g.round >= 1)) errs.push('Game number must be 1 or higher.');
    if (g.won !== 'Mafia' && g.won !== 'Citizens') errs.push('Pick which side won.');
    else if (g.won_confidence === 'low') warns.push('The scan was unsure which side won. Confirm against the Winners line on the paper.');

    var names = s.maf.concat(s.cit);
    if (!s.maf.length) errs.push('Nobody is marked as Mafia or Don.');
    if (!s.cit.length) errs.push('There are no citizens.');
    var seen = {}, dupes = [];
    names.forEach(function (n) { var k = n.toLowerCase(); if (seen[k]) dupes.push(n); seen[k] = 1; });
    if (dupes.length) errs.push('“' + esc(dupes[0]) + '” is listed twice.');
    if ((g.players || []).some(function (p) { return !String(p.name || '').trim(); }))
      errs.push('One of the seats has no name — fill it in or remove the row.');
    if (names.some(function (n) { return n.indexOf(',') >= 0; }))
      errs.push('A name contains a comma, which would split it into two players.');

    if (s.maf.length !== 2 && s.maf.length !== 3)
      warns.push('This has ' + s.maf.length + ' on the mafia side. The club normally plays 2 or 3 — check the role column.');
    if (names.length !== 10)
      warns.push(names.length + ' players at the table (usually 10).');

    var atTable = {};
    names.forEach(function (n) { atTable[n.toLowerCase()] = 1; });
    (g.players || []).forEach(function (p) {
      var n = String(p.name || '').trim();
      if (!n) return;
      var low = p.name_confidence === 'low';
      var unknown = state.known.length && !isKnown(n);
      if (!low && !unknown) return;
      var near = unknown ? closestKnown(n, atTable) : null;
      var who = '“' + esc(n) + '” (seat ' + esc(p.seat) + ')';
      if (near) warns.push(who + ' is new to the league — did you mean <strong>' + esc(near) + '</strong>?');
      else if (low && unknown) warns.push(who + ' was hard to read and has never played before. Check it against the paper.');
      else if (low) warns.push(who + ' was hard to read.');
      else warns.push(who + ' has never played before. Fine if they are new, otherwise fix the spelling.');
    });

    if (state.existing[normDate(g.date) + '#' + g.round])
      warns.push('A game already exists for ' + esc(g.date) + ' game ' + g.round + '. Submitting will add a second one.');

    (g.unreadable || []).forEach(function (u) { warns.push('Scan note: ' + esc(u)); });
    return { errs: errs, warns: warns, s: s };
  }

  /* ---------- step 3: review ---------- */
  function renderReview() {
    if ($('s-review').classList.contains('hidden') && !state.games.length) return;

    /* "Check the reading" only makes sense when something was actually read. */
    var anyScanned = state.games.some(function (g) { return g.__src !== 'entered by hand'; });
    $('reviewTitle').textContent = anyScanned ? 'Check the reading' : 'Enter the game';
    $('reviewLede').innerHTML = anyScanned
      ? 'Nothing is saved yet. Fix anything that was misread — names flagged in <span style="color:#c9b45a">yellow</span> are new to the league, and fields outlined in <span style="color:var(--red)">red</span> are ones the scan was unsure about.'
      : 'Nothing is saved yet. Fill in the seats, mark who was Mafia, Don and Sheriff, and pick the winning side. Names flagged in <span style="color:#c9b45a">yellow</span> have never played before.';

    var notice = '';
    if (state.__failNote) notice += '<div class="notice err">' + state.__failNote + '</div>';
    if (!state.known.length) notice += '<div class="notice">Could not load the existing roster, so new-player warnings are off. Check the spelling of every name carefully.</div>';
    $('reviewNotice').innerHTML = notice;

    $('games').innerHTML =
      '<datalist id="rosterNames">' + state.known.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      state.games.map(cardHtml).join('');
    state.games.forEach(function (_, i) { refreshCard(i); });
  }

  function cardHtml(g, i) {
    var rows = (g.players || []).map(function (p, pi) {
      return '<div class="prow">' +
        '<div class="seat">' + esc(p.seat || (pi + 1)) + '</div>' +
        '<input type="text" list="rosterNames" value="' + esc(p.name) + '" data-g="' + i + '" data-p="' + pi + '" data-f="name" placeholder="Name">' +
        '<select data-g="' + i + '" data-p="' + pi + '" data-f="role">' +
          ['Citizen', 'Sheriff', 'Mafia', 'Don'].map(function (r) {
            return '<option value="' + r + '"' + (p.role === r ? ' selected' : '') + '>' + r + '</option>';
          }).join('') +
        '</select>' +
        '<button class="rm" data-rmp="' + i + ':' + pi + '" aria-label="Remove player">✕</button>' +
      '</div>';
    }).join('');

    return '<div class="game-card" id="gc-' + i + '">' +
      '<div class="gc-head"><h3>Game ' + esc(g.round) + '</h3>' +
        '<span class="gc-src">' + esc(g.__src || '') + '</span>' +
        '<button class="btn danger" data-rmg="' + i + '" style="padding:7px 13px">Discard</button></div>' +
      '<div class="gc-body">' +
        '<div class="grid3">' +
          '<div class="field' + (g.date_confidence === 'low' ? ' flag' : '') + '"><label>Date</label>' +
            '<input type="text" value="' + esc(g.date) + '" data-g="' + i + '" data-f="date" placeholder="M/D/YY" inputmode="numeric">' +
            (g.date_raw && g.date_confidence !== 'high' ? '<div class="hint warn">Paper reads “' + esc(g.date_raw) + '”</div>' : '') +
          '</div>' +
          '<div class="field"><label>Game #</label>' +
            '<input type="text" value="' + esc(g.round) + '" data-g="' + i + '" data-f="round" inputmode="numeric"></div>' +
        '</div>' +
        '<div class="field" style="margin-bottom:16px"><label>Winning side</label>' +
          '<div class="side-toggle">' +
            '<button type="button" data-side="Citizens" data-g="' + i + '"' + (g.won === 'Citizens' ? ' class="on"' : '') + '>Citizens</button>' +
            '<button type="button" data-side="Mafia" data-g="' + i + '"' + (g.won === 'Mafia' ? ' class="on"' : '') + '>Mafia</button>' +
          '</div>' +
          (g.winners_line_raw ? '<div class="hint">Winners line on the paper: “' + esc(g.winners_line_raw) + '”</div>' : '') +
        '</div>' +
        '<div class="plist-head"><span>Seat</span><span>Player</span><span>Role</span><span></span></div>' +
        '<div class="plist">' + rows + '</div>' +
        '<div class="actions" style="margin-top:12px"><button class="btn ghost" data-addp="' + i + '" style="padding:9px 15px">+ Add player</button></div>' +
        '<div class="sides" id="sides-' + i + '"></div>' +
        '<ul class="warns" id="warns-' + i + '"></ul>' +
      '</div></div>';
  }

  function refreshCard(i) {
    var g = state.games[i];
    if (!g) return;
    var p = problems(g);
    var winners = g.won === 'Mafia' ? p.s.maf : p.s.cit;
    var losers = g.won === 'Mafia' ? p.s.cit : p.s.maf;

    var sidesEl = $('sides-' + i);
    if (sidesEl) sidesEl.innerHTML =
      '<div class="sidebox maf"><div class="lbl2">Mafia · ' + p.s.maf.length + '</div>' +
        '<div class="nms">' + (p.s.maf.map(esc).join(', ') || '—') + '</div>' +
        '<span class="tag">' + (g.won === 'Mafia' ? 'Winners' : 'Losers') + '</span></div>' +
      '<div class="sidebox cit"><div class="lbl2">Citizens · ' + p.s.cit.length + '</div>' +
        '<div class="nms">' + (p.s.cit.map(esc).join(', ') || '—') + '</div>' +
        '<span class="tag">' + (g.won === 'Citizens' ? 'Winners' : 'Losers') + '</span></div>';

    var warnEl = $('warns-' + i);
    if (warnEl) warnEl.innerHTML =
      p.errs.map(function (e) { return '<li class="e">' + e + '</li>'; }).join('') +
      p.warns.map(function (w) { return '<li class="w">' + w + '</li>'; }).join('');

    var card = $('gc-' + i);
    if (card) card.classList.toggle('bad', p.errs.length > 0);

    // colour-code the role selects
    [].forEach.call(document.querySelectorAll('#gc-' + i + ' select[data-f=role]'), function (sel) {
      sel.classList.toggle('maf', MAFIA_ROLES[sel.value] === 1);
      sel.classList.toggle('sher', sel.value === 'Sheriff');
    });
    [].forEach.call(document.querySelectorAll('#gc-' + i + ' input[data-f=name]'), function (inp) {
      var pl = g.players[+inp.dataset.p] || {};
      var n = inp.value.trim();
      inp.classList.toggle('lowconf', pl.name_confidence === 'low');
      inp.classList.toggle('unknown', !!(n && state.known.length && !isKnown(n) && pl.name_confidence !== 'low'));
    });

    var anyErr = state.games.some(function (_, j) { return problems(state.games[j]).errs.length > 0; });
    $('submitGo').disabled = anyErr || !state.games.length;
    $('submitGo').textContent = anyErr ? 'Fix the errors above' :
      ('Add ' + state.games.length + ' game' + (state.games.length > 1 ? 's' : '') + ' to leaderboard');
    void winners; void losers;
  }

  /* ---------- submit ---------- */
  async function submitAll(force) {
    var btn = $('submitGo');
    btn.disabled = true; btn.textContent = 'Saving…';
    var payload = {
      accessCode: state.accessCode,
      force: !!force,
      games: state.games.map(function (g) {
        var s = sides(g);
        var don = (g.players.find(function (p) { return p.role === 'Don'; }) || {}).name || '';
        var sher = (g.players.find(function (p) { return p.role === 'Sheriff'; }) || {}).name || '';
        return {
          date: String(g.date).trim(),
          round: parseInt(g.round, 10),
          won: g.won,
          winners: g.won === 'Mafia' ? s.maf : s.cit,
          losers: g.won === 'Mafia' ? s.cit : s.maf,
          mafia: s.maf, don: don, sheriff: sher,
          seating: (g.players || []).map(function (p) { return String(p.name || '').trim(); }),
          votes: g.votes || []
        };
      })
    };
    var res, body;
    try {
      res = await fetch(SUBMIT_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      body = await res.json().catch(function () { return {}; });
    } catch (e) {
      $('reviewNotice').innerHTML = '<div class="notice err">Network error — nothing was saved. Try again.</div>';
      window.scrollTo(0, 0); refreshCard(0); return;
    }
    if (res.status === 401 || res.status === 503) { resetGate(body.error); return; }
    if (res.status === 409 && body.duplicate) {
      $('reviewNotice').innerHTML = '<div class="notice err"><strong>Already on the leaderboard:</strong> ' +
        esc(body.duplicate.join(', ')) + '. Nothing was saved. ' +
        '<button class="btn danger" id="forceGo" style="margin-top:10px;padding:8px 14px">Add anyway</button></div>';
      $('forceGo').onclick = function () { submitAll(true); };
      window.scrollTo(0, 0); refreshCard(0); return;
    }
    if (!res.ok || !body.ok) {
      $('reviewNotice').innerHTML = '<div class="notice err"><strong>Not saved.</strong> ' + esc(body.error || ('Error ' + res.status)) + '</div>';
      window.scrollTo(0, 0); refreshCard(0); return;
    }
    var nights = {};
    state.games.forEach(function (g) { nights[g.date] = 1; });
    $('doneTitle').textContent = body.added + ' game' + (body.added > 1 ? 's' : '') + ' saved';
    $('doneMsg').textContent = 'Added to ' + Object.keys(nights).join(' and ') +
      '. The leaderboard recalculates itself the next time anyone opens it.';
    show('s-done');
  }

  /* ---------- events ---------- */
  document.addEventListener('input', function (e) {
    var t = e.target, gi = t.dataset && t.dataset.g;
    if (gi == null) return;
    var g = state.games[+gi]; if (!g) return;
    var f = t.dataset.f;
    if (t.dataset.p != null) {
      var p = g.players[+t.dataset.p]; if (!p) return;
      if (f === 'name') { p.name = t.value; p.name_confidence = 'high'; }
      if (f === 'role') p.role = t.value;
    } else if (f === 'date') { g.date = t.value; g.date_confidence = 'high'; }
    else if (f === 'round') { g.round = t.value.replace(/\D/g, ''); }
    refreshCard(+gi);
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-rm],[data-rmg],[data-rmp],[data-addp],[data-side]') : null;
    if (!t) return;

    if (t.dataset.rm) {                                  // remove a photo
      state.files = state.files.filter(function (f) { return f.id !== +t.dataset.rm; });
      renderThumbs(); return;
    }
    if (t.dataset.side) {                                // flip winning side
      var gi = +t.dataset.g;
      state.games[gi].won = t.dataset.side;
      state.games[gi].won_confidence = 'high';
      [].forEach.call(t.parentNode.children, function (b) { b.classList.toggle('on', b === t); });
      refreshCard(gi); return;
    }
    if (t.dataset.rmg) {                                 // discard a whole game
      state.games.splice(+t.dataset.rmg, 1);
      if (!state.games.length) { show('s-upload'); return; }
      renderReview(); return;
    }
    if (t.dataset.rmp) {                                 // remove a player row
      var parts = t.dataset.rmp.split(':');
      state.games[+parts[0]].players.splice(+parts[1], 1);
      renderReview(); return;
    }
    if (t.dataset.addp) {                                // add a player row
      var g2 = state.games[+t.dataset.addp];
      var maxSeat = g2.players.reduce(function (m, p) { return Math.max(m, p.seat || 0); }, 0);
      g2.players.push({ seat: maxSeat + 1, name: '', name_confidence: 'high', role: 'Citizen', eliminated: false });
      renderReview(); return;
    }
  });

  var dz = $('dz');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hot'); });
  });
  dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  $('fileInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  $('scanGo').addEventListener('click', function () { scanAll(); });
  $('manualGo').addEventListener('click', function () { state.games = []; addManual(); });
  $('addAnother').addEventListener('click', function () {
    addManual();
    var cards = document.querySelectorAll('.game-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('clearAll').addEventListener('click', function () { state.files = []; renderThumbs(); });
  $('backToUpload').addEventListener('click', function () { state.games = []; state.__failNote = ''; show('s-upload'); });
  $('submitGo').addEventListener('click', function () { submitAll(false); });
  $('againGo').addEventListener('click', function () {
    state.files = []; state.games = []; state.__failNote = '';
    renderThumbs(); loadRoster(); show('s-upload');
  });

  /* ---------- gate ---------- */
  function enter(code) {
    state.accessCode = code || '';
    try { sessionStorage.setItem('smc_code', state.accessCode); } catch (e) {}
    $('gateErr').textContent = '';
    show('s-upload');
    loadRoster();
  }
  /* A rejected code has to be recoverable without the user knowing to clear site data. */
  function resetGate(msg) {
    try { sessionStorage.removeItem('smc_code'); } catch (e) {}
    state.accessCode = '';
    $('gateErr').textContent = msg || 'Access code rejected.';
    $('gateCode').value = '';
    show('s-gate');
  }
  $('gateGo').addEventListener('click', function () { enter($('gateCode').value.trim()); });
  $('gateCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('gateGo').click(); });

  var saved = null;
  try { saved = sessionStorage.getItem('smc_code'); } catch (e) {}
  if (saved !== null) enter(saved); else show('s-gate');
})();
