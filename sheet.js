/* Live Google Sheets connector — fetches via gviz JSONP (no CORS, no publish-to-web needed)
   and recomputes the full Mafia stat model client-side. Mirrors parse_mafia.py. */
(function () {
  const ALIAS = { chynnah:'Chynna', chynna:'Chynna', skky:'Skyy', skyy:'Skyy' };
  function norm(n){ n=String(n||'').trim(); const k=n.toLowerCase(); return ALIAS[k]||n; }
  function splitPeople(cell){
    return String(cell||'').trim().replace(/ and /gi, ',')
      .split(',').map(s=>s.trim()).filter(Boolean).map(norm);
  }
  function cellVal(c){ return c==null ? '' : (c.v!=null ? c.v : ''); }

  function buildFromGviz(table){
    const rows=[];
    (table.rows||[]).forEach(r=>{
      const c=r.c||[];
      const dateF = c[0] ? (c[0].f || c[0].v || '') : '';
      if(!dateF) return;
      let ts=0; const m=/Date\((\d+),(\d+),(\d+)/.exec(String(c[0]&&c[0].v||''));
      if(m) ts=new Date(+m[1],+m[2],+m[3]).getTime();
      const rnd = c[1] ? parseInt(c[1].f||c[1].v,10)||0 : 0;
      let won = String(cellVal(c[2])).trim();
      if(!won) return;
      won = /^maf/i.test(won) ? 'Mafia' : 'Citizens';
      const winners=splitPeople(cellVal(c[3]));
      const losers=splitPeople(cellVal(c[7]));
      if(!winners.length && !losers.length) return;
      rows.push({date:String(dateF), ts, round:rnd, won, winners, losers});
    });

    rows.forEach(g=>{
      if(g.won==='Mafia'){ g.mafia=g.winners; g.citizens=g.losers; }
      else { g.mafia=g.losers; g.citizens=g.winners; }
    });

    const P={};
    const ensure=n=>P[n]||(P[n]={name:n,rounds:0,wins:0,losses:0,asMafia:0,asCitizen:0,
      winsAsMafia:0,winsAsCitizen:0,sessions:{},log:[]});
    rows.forEach(g=>{
      g.winners.forEach(n=>{ const role=g.mafia.indexOf(n)>=0?'Mafia':'Citizen'; const d=ensure(n);
        d.rounds++; d.wins++; d.sessions[g.date]=1;
        if(role==='Mafia'){d.asMafia++;d.winsAsMafia++;} else {d.asCitizen++;d.winsAsCitizen++;}
        d.log.push({date:g.date,ts:g.ts,round:g.round,role,result:'W',won:g.won}); });
      g.losers.forEach(n=>{ const role=g.mafia.indexOf(n)>=0?'Mafia':'Citizen'; const d=ensure(n);
        d.rounds++; d.losses++; d.sessions[g.date]=1;
        if(role==='Mafia'){d.asMafia++;} else {d.asCitizen++;}
        d.log.push({date:g.date,ts:g.ts,round:g.round,role,result:'L',won:g.won}); });
    });

    const players=Object.keys(P).map(k=>{
      const d=P[k];
      d.log.sort((a,b)=>a.ts-b.ts||a.round-b.round);
      const sessions=Object.keys(d.sessions);
      return {name:d.name,rounds:d.rounds,wins:d.wins,losses:d.losses,
        winRate:Math.round(d.wins/d.rounds*100),
        asMafia:d.asMafia,asCitizen:d.asCitizen,winsAsMafia:d.winsAsMafia,winsAsCitizen:d.winsAsCitizen,
        mafiaWinRate:d.asMafia?Math.round(d.winsAsMafia/d.asMafia*100):null,
        citizenWinRate:d.asCitizen?Math.round(d.winsAsCitizen/d.asCitizen*100):null,
        sessions:sessions, sessionCount:sessions.length, log:d.log};
    });
    players.sort((a,b)=>b.wins-a.wins||b.winRate-a.winRate||b.rounds-a.rounds);

    const order=[]; const seen={};
    rows.slice().sort((a,b)=>a.ts-b.ts).forEach(g=>{ if(!seen[g.date]){seen[g.date]=1;order.push(g.date);} });
    const sessions=order.map(dt=>({date:dt, rounds:rows.filter(g=>g.date===dt).sort((a,b)=>a.round-b.round)}));

    const totalGames=rows.length;
    const cit=rows.filter(g=>g.won==='Citizens').length, maf=totalGames-cit;
    const appearances=players.reduce((s,p)=>s+p.rounds,0);
    const byGames=[...players].sort((a,b)=>b.rounds-a.rounds);
    const agg={ sessions:order, sessionCount:order.length, totalGames, totalPlayers:players.length,
      citizenWins:cit, mafiaWins:maf, citizenWinPct: totalGames?Math.round(cit/totalGames*100):0,
      appearances, mostWins:players[0]?players[0].name:'—', mostWinsVal:players[0]?players[0].wins:0,
      mostGames:byGames[0]?byGames[0].name:'—', mostGamesVal:byGames[0]?byGames[0].rounds:0 };

    return {agg, players, sessions, games:rows};
  }

  /* JSONP loader — injects a <script> so CORS never applies */
  function loadMafiaLive(id, gid, cb, errcb){
    const name='__mafiaCb_'+Math.random().toString(36).slice(2);
    let done=false;
    window[name]=function(resp){ done=true;
      try{
        if(!resp||!resp.table) throw new Error('bad response');
        cb(buildFromGviz(resp.table));
      }catch(e){ errcb&&errcb(e); }
      finally{ try{delete window[name];}catch(_){} }
    };
    const s=document.createElement('script');
    const gidPart=(gid!=null&&gid!=='')?('&gid='+encodeURIComponent(gid)):'';
    s.src='https://docs.google.com/spreadsheets/d/'+id+'/gviz/tq?tqx=responseHandler:'+name+
          ';out:json&headers=1'+gidPart+'&_cb='+Date.now();
    s.onerror=function(){ if(!done){ errcb&&errcb(new Error('script load error')); } };
    document.head.appendChild(s);
    setTimeout(()=>{ if(!done){ errcb&&errcb(new Error('timeout')); } }, 9000);
  }

  window.buildMafiaFromGviz=buildFromGviz;
  window.loadMafiaLive=loadMafiaLive;
})();
