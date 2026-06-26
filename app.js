/* Shared engine — themes are pure CSS over this DOM */
(function () {
  let M = window.MAFIA || {players:[],agg:{sessions:[]},sessions:[],games:[]};
  const PAL =['#e74c3c','#e67e22','#f1c40f','#16a085','#1abc9c','#2980b9','#8e44ad','#e84393','#fd79a8','#00b894','#6c5ce7','#0984e3','#d63031','#fd79a8','#0097e6','#44bd32'];
  let maxWins=1,maxGames=1,curSort='wins';
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
  function initials(n){return n.slice(0,2);}
  function color(n){return PAL[hash(n)%PAL.length];}
  function domRole(p){return p.asMafia>p.asCitizen?'maf':'cit';}
  function pluralRole(p){return domRole(p)==='maf'?'Mafia':'Citizen';}

  function tier(p){
    const wr=p.winRate;
    if(p.rounds>=3){return wr>=85?'S':wr>=66?'A':wr>=50?'B':wr>=33?'C':'D';}
    if(wr===100)return 'A';if(wr>=50)return 'B';if(wr===0)return 'D';return 'C';
  }
  function archetype(p){
    if(p.sessionCount>1) return {t:'The Veteran', b:'Only player to show up across every game night. The constant.'};
    if(p.rounds>=3&&p.winRate===100) return {t:'Undefeated', b:'Has never tasted defeat. A perfect record under pressure.'};
    if(p.asMafia>=2&&p.mafiaWinRate===0) return {t:'Most Wanted', b:'Pulled into the Mafia again and again — and caught every single time.'};
    if(p.asMafia>=2&&p.mafiaWinRate>=50) return {t:'Mastermind', b:'Cold operator. Survives the night when the knives come out.'};
    if(p.winRate===0) return {t:'The Underdog', b:'Still hunting that first win. The comeback is loading.'};
    if(domRole(p)==='maf') return {t:'The Shadow', b:'Spends more nights on the wrong side of the law than most.'};
    if(p.winRate>=66) return {t:'Town Pillar', b:'A reliable voice for the Citizens. Wins when it matters.'};
    return {t:'The Regular', b:'Steady hand at the table. Always in the mix.'};
  }

  function avatar(p, cls){
    return `<span class="avatar ${domRole(p)} ${cls||''}" style="--av:${color(p.name)}" data-tier="${tier(p)}">${esc(initials(p.name))}</span>`;
  }
  function tierTag(p){const t=tier(p);return `<span class="tier tier-${t}">${t}</span>`;}
  function roleBadges(p){
    let h='';
    if(p.asCitizen)h+=`<span class="role-badge cit">Citizen ${p.asCitizen}×</span>`;
    if(p.asMafia)h+=`<span class="role-badge maf">Mafia ${p.asMafia}×</span>`;
    return h;
  }

  /* ---------- DASHBOARD ---------- */
  function renderStats(){
    const a=M.agg;
    const cards=[
      {ic:'📅',l:'Game nights',v:a.sessionCount,s:a.sessions.join(' · ')},
      {ic:'🎭',l:'Rounds played',v:a.totalGames,s:'across all nights'},
      {ic:'👥',l:'Players',v:a.totalPlayers,s:`${a.appearances} total appearances`},
      {ic:'🛡️',l:'Citizens win rate',v:a.citizenWinPct+'%',s:`Town leads ${a.citizenWins}–${a.mafiaWins}`,accent:'cit'},
      {ic:'🏆',l:'Most wins',v:a.mostWins,s:`${a.mostWinsVal} victories`,accent:'gold'},
      {ic:'🔪',l:'Mafia wins',v:a.mafiaWins,s:`only ${a.citizenWinPct?100-a.citizenWinPct:0}% of nights`,accent:'maf'},
    ];
    $('#statCards').innerHTML=cards.map(c=>`
      <div class="stat-card ${c.accent?'ac-'+c.accent:''}">
        <span class="stat-ic">${c.ic}</span>
        <div class="stat-label">${c.l}</div>
        <div class="stat-value">${esc(String(c.v))}</div>
        <div class="stat-sub">${esc(c.s)}</div>
      </div>`).join('');
  }
  function renderFaction(){
    const a=M.agg, total=a.totalGames;
    const cw=Math.round(a.citizenWins/total*100), mw=100-cw;
    $('#factionRecord').innerHTML=`
      <div class="faction-head"><span class="fh-cit">Citizens</span><span class="fh-vs">vs</span><span class="fh-maf">Mafia</span></div>
      <div class="faction-bar">
        <div class="seg cit" style="width:${cw}%">${a.citizenWins}</div>
        <div class="seg maf" style="width:${mw}%">${a.mafiaWins}</div>
      </div>
      <div class="faction-legend"><span>Town wins ${a.citizenWins} of ${total} rounds</span><span>Mafia escapes ${a.mafiaWins}</span></div>`;
  }
  function streaks(log){
    let w=0,l=0,longW=0,longL=0;
    log.forEach(e=>{if(e.result==='W'){w++;l=0;if(w>longW)longW=w;}else{l++;w=0;if(l>longL)longL=l;}});
    let c=0;const last=log[log.length-1];
    if(last){for(let i=log.length-1;i>=0;i--){if(log[i].result===last.result)c++;else break;}}
    return {cur:last&&last.result==='W'?c:-c,longW,longL};
  }
  function computeDerived(){
    M.players.forEach(p=>{
      const s=streaks(p.log);
      p.curStreak=s.cur;p.longWin=s.longW;p.longLoss=s.longL;
      p.mafiaFreq=Math.round(p.asMafia/p.rounds*100);
    });
    maxWins=Math.max(...M.players.map(p=>p.wins));
    maxGames=Math.max(...M.players.map(p=>p.rounds));
  }
  function streakTxt(c){return c>0?'W'+c:c<0?'L'+(-c):'–';}

  const METRICS={
    winRate:{label:'Win %',cap:'Raw win rate across every round. Watch the small samples.',
      sort:p=>p.winRate,val:p=>p.winRate+'%',bar:p=>p.winRate},
    wins:{label:'Wins',cap:'Total victories — rewards showing up and grinding rounds.',
      sort:p=>p.wins,val:p=>p.wins,bar:p=>p.wins/maxWins*100},
    games:{label:'Games',cap:'Rounds played — the iron-man / attendance board.',
      sort:p=>p.rounds,val:p=>p.rounds,bar:p=>p.rounds/maxGames*100},
    mafiaWR:{label:'Getaway %',cap:'When dealt Mafia, how often you beat the town. Pure villain skill.',
      sort:p=>p.mafiaWinRate==null?-1:p.mafiaWinRate,val:p=>p.asMafia?p.mafiaWinRate+'%':'–',bar:p=>p.mafiaWinRate||0,
      sub:p=>p.asMafia?`${p.winsAsMafia}/${p.asMafia} as Mafia`:'never Mafia'},
    mafiaFreq:{label:'Rap sheet',cap:'Share of games the deck made you Mafia. Who it loves to corrupt.',
      sort:p=>p.mafiaFreq,val:p=>p.mafiaFreq+'%',bar:p=>p.mafiaFreq,sub:p=>`${p.asMafia}/${p.rounds} as Mafia`},
    citWR:{label:'Town read',cap:'Win rate as an innocent Citizen — reading the room and surviving.',
      sort:p=>p.citizenWinRate==null?-1:p.citizenWinRate,val:p=>p.asCitizen?p.citizenWinRate+'%':'–',bar:p=>p.citizenWinRate||0,
      sub:p=>p.asCitizen?`${p.winsAsCitizen}/${p.asCitizen} as town`:'never town'},
    streak:{label:'Streak',cap:'Current run of form — longest active win streak floats to the top.',
      sort:p=>p.curStreak,val:p=>streakTxt(p.curStreak),bar:p=>Math.min(Math.abs(p.curStreak)/maxGames*200,100),
      cls:p=>p.curStreak>=0?'pos':'neg',sub:p=>`longest ${p.longWin}W run`},
  };
  function renderLeaderboard(sortKey){
    curSort=sortKey||curSort;const m=METRICS[curSort];
    const list=[...M.players].sort((a,b)=>m.sort(b)-m.sort(a)||b.wins-a.wins||b.winRate-a.winRate).slice(0,12);
    const lbl=$('#sortLabel');if(lbl)lbl.textContent='by '+m.label.toLowerCase();
    const cap=$('#sortCaption');if(cap)cap.textContent=m.cap;
    $('#leaderboard').innerHTML=list.map((p,i)=>`
      <div class="lb-row" data-char="${esc(p.name)}">
        <span class="lb-rank">${i+1}</span>
        ${avatar(p)}
        <div class="lb-main">
          <div class="lb-name">${esc(p.name)} ${tierTag(p)}</div>
          <div class="lb-meta"><span class="lb-rec">${p.wins}–${p.losses}</span>${m.sub?`<span class="lb-sub">${m.sub(p)}</span>`:roleBadges(p)}</div>
        </div>
        <div class="lb-metric ${m.cls?m.cls(p):''}">
          <b class="metric-val">${m.val(p)}${m.suf?`<i class="suf">${m.suf}</i>`:''}</b>
          <div class="metric-bar"><i style="width:${Math.max(0,Math.min(100,Math.round(m.bar(p))))}%"></i></div>
        </div>
      </div>`).join('');
  }
  function renderSuperlatives(){
    const P=M.players;
    const vet=[...P].sort((a,b)=>b.sessionCount-a.sessionCount||b.rounds-a.rounds)[0];
    const wanted=[...P].sort((a,b)=>b.asMafia-a.asMafia||b.mafiaFreq-a.mafiaFreq)[0];
    const deadly=[...P].filter(p=>p.winsAsMafia>0).sort((a,b)=>b.winsAsMafia-a.winsAsMafia||b.asMafia-a.asMafia)[0];
    const undef=P.filter(p=>p.winRate===100&&p.rounds>=2);
    const undefLead=[...undef].sort((a,b)=>b.rounds-a.rounds||b.wins-a.wins)[0];
    const cards=[
      {ic:'🎖️',cls:'blue',label:'The veteran',name:vet.name,detail:`${vet.rounds} games · ${vet.sessionCount} nights`},
      {ic:'🥷',cls:'red',label:'Most wanted',name:wanted.name,detail:`Mafia ${wanted.asMafia}× (${wanted.mafiaFreq}%)`},
      {ic:'🔪',cls:'red',label:'Deadliest Mafia',name:deadly?deadly.name:'None',detail:deadly?`${deadly.winsAsMafia}/${deadly.asMafia} got away`:'town caught everyone'},
      {ic:'💯',cls:'green',label:'Still undefeated',name:undef.length+' players',detail:undefLead?`led by ${undefLead.name} (${undefLead.wins}-0)`:'—'},
    ];
    $('#superlatives').innerHTML=cards.map(c=>{
      const real=P.find(p=>p.name===c.name);
      return `<button class="award aw-${c.cls}" ${real?`data-char="${esc(c.name)}"`:'disabled'}>
        <span class="award-ic">${c.ic}</span>
        <span class="award-label">${c.label}</span>
        <span class="award-name">${esc(c.name)}</span>
        <span class="award-detail">${esc(c.detail)}</span>
      </button>`;}).join('');
  }
  function renderFeed(){
    const sessions=[...M.sessions].reverse();
    $('#feed').innerHTML=sessions.map((s,si)=>{
      const n=M.sessions.length-si;
      // mvp = most wins this night
      const tally={};
      s.rounds.forEach(g=>g.winners.forEach(w=>tally[w]=(tally[w]||0)+1));
      const mvp=Object.entries(tally).sort((a,b)=>b[1]-a[1])[0];
      const rounds=s.rounds.map(g=>`
        <div class="round-row">
          <span class="round-tag ${g.won==='Citizens'?'cit':'maf'}">${g.won==='Citizens'?'Town wins':'Mafia wins'}</span>
          <span class="round-no">Round ${g.round}</span>
          <span class="round-info">Mafia: ${esc(g.mafia.join(' & '))}</span>
        </div>`).join('');
      return `<div class="feed-card">
        <div class="feed-head">
          <span class="feed-badge">🎭</span>
          <div><div class="feed-title">Mafia Night #${n}</div><div class="feed-sub">${s.date} · ${s.rounds.length} rounds</div></div>
        </div>
        <div class="feed-body">${rounds}</div>
        <div class="feed-foot">
          <span class="foot-item mvp">⭐ Night MVP: <b>${esc(mvp[0])}</b> (${mvp[1]} wins)</span>
          <span class="foot-item">🛡️ ${s.rounds.filter(g=>g.won==='Citizens').length} town · 🔪 ${s.rounds.filter(g=>g.won==='Mafia').length} mafia</span>
        </div>
      </div>`;
    }).join('');
  }

  /* ---------- ROSTER ---------- */
  let filter='all', query='';
  function rosterList(){
    let list=[...M.players].sort((x,y)=>y.wins-x.wins||y.winRate-x.winRate);
    if(filter==='maf')list=list.filter(p=>p.asMafia>0);
    if(filter==='cit')list=list.filter(p=>p.asMafia===0);
    if(filter==='vet')list=list.filter(p=>p.sessionCount>1);
    if(query)list=list.filter(p=>p.name.toLowerCase().includes(query));
    return list;
  }
  function renderRoster(){
    const list=rosterList();
    $('#rosterCount').textContent=`${list.length} players`;
    $('#rosterGrid').innerHTML=list.map(p=>`
      <button class="roster-tile" data-char="${esc(p.name)}">
        ${tierTag(p)}
        ${avatar(p,'big')}
        <div class="tile-name">${esc(p.name)}</div>
        <div class="tile-record">${p.wins}W · ${p.losses}L</div>
        <div class="tile-bar"><i style="width:${p.winRate}%"></i></div>
        <div class="tile-role ${domRole(p)}">${pluralRole(p)}</div>
      </button>`).join('');
  }

  /* ---------- CHARACTER SHEET ---------- */
  function openChar(name){
    const p=M.players.find(x=>x.name===name);if(!p)return;
    const a=archetype(p), role=domRole(p);
    const bars=[
      {l:'Win rate',v:p.winRate},
      {l:'As Citizen',v:p.citizenWinRate==null?0:p.citizenWinRate,n:p.citizenWinRate==null?'never':p.winsAsCitizen+'/'+p.asCitizen},
      {l:'As Mafia',v:p.mafiaWinRate==null?0:p.mafiaWinRate,n:p.mafiaWinRate==null?'never':p.winsAsMafia+'/'+p.asMafia},
    ];
    const form=p.log.map(e=>`<span class="form-chip ${e.result==='W'?'w':'l'} ${e.role==='Mafia'?'fm':'fc'}" title="${e.date} R${e.round} · ${e.role}">${e.result}</span>`).join('');
    $('#charModalBody').innerHTML=`
      <div class="modal-cover ${role}"></div>
      <div class="modal-id">
        ${avatar(p,'xl')}
        <div class="modal-namewrap">
          <div class="modal-name">${esc(p.name)} ${tierTag(p)}</div>
          <div class="modal-title">${a.t}</div>
        </div>
        <div class="modal-rec"><b>${p.wins}–${p.losses}</b><span>record</span></div>
      </div>
      <p class="modal-blurb">${a.b}</p>
      <div class="stat-grid">
        <div class="ms"><div class="ms-v">${p.rounds}</div><div class="ms-l">Rounds</div></div>
        <div class="ms"><div class="ms-v">${p.winRate}%</div><div class="ms-l">Win rate</div></div>
        <div class="ms"><div class="ms-v">${p.asCitizen}</div><div class="ms-l">As Citizen</div></div>
        <div class="ms"><div class="ms-v">${p.asMafia}</div><div class="ms-l">As Mafia</div></div>
      </div>
      <div class="bars">
        ${bars.map(b=>`<div class="barrow"><span class="barlbl">${b.l}</span><div class="bar"><i style="width:${b.v}%"></i></div><span class="barval">${b.n!==undefined?b.n:b.v+'%'}</span></div>`).join('')}
      </div>
      <div class="sheet-section"><h4>Form guide</h4><div class="form">${form}</div><div class="form-key">Newest last · <span class="k w">W</span> win <span class="k l">L</span> loss · red ring = was Mafia</div></div>
      <div class="sheet-section"><h4>Appearances</h4><div class="sess">${p.sessions.map(d=>`<span class="sess-chip">${d}</span>`).join('')}</div></div>`;
    $('#charModal').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  function closeModal(){$('#charModal').classList.add('hidden');document.body.style.overflow='';}

  /* ---------- WIRING ---------- */
  function nav(view){
    $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    $$('.view').forEach(v=>v.classList.toggle('hidden',v.id!=='view-'+view));
    window.scrollTo(0,0);
  }
  document.addEventListener('click',e=>{
    const so=e.target.closest('[data-sort]'); if(so){renderLeaderboard(so.dataset.sort);$$('[data-sort]').forEach(b=>b.classList.toggle('active',b===so));return;}
    const v=e.target.closest('[data-view]'); if(v){nav(v.dataset.view);return;}
    const c=e.target.closest('[data-char]'); if(c){openChar(c.dataset.char);return;}
    const f=e.target.closest('[data-filter]'); if(f){filter=f.dataset.filter;$$('[data-filter]').forEach(b=>b.classList.toggle('active',b===f));renderRoster();return;}
    if(e.target.closest('[data-close]')||e.target.id==='charModal'){closeModal();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

  function renderAll(){
    if(!M||!M.players||!M.players.length)return;
    computeDerived();
    renderStats();renderFaction();renderSuperlatives();renderLeaderboard(curSort);renderFeed();renderRoster();
  }
  let hashApplied=false;
  function applyHash(){
    if(hashApplied)return; hashApplied=true;
    const h=decodeURIComponent(location.hash.slice(1));
    if(h.startsWith('char=')){nav('roster');openChar(h.slice(5));}
    else if(h==='roster'){nav('roster');}
    else if(h.startsWith('sort=')){const k=h.slice(5);if(METRICS[k]){curSort=k;renderLeaderboard(k);$$('[data-sort]').forEach(b=>b.classList.toggle('active',b.dataset.sort===k));}}
  }
  function setSync(txt,cls){const el=$('#syncStatus');if(!el)return;el.textContent=(cls==='ok'?'● ':'')+txt;el.style.color={ok:'#22d36b',err:'#ff5a6a',wait:'#f5b301'}[cls]||'';}

  function boot(){
    const s=$('#rosterSearch');
    if(s)s.addEventListener('input',()=>{query=s.value.trim().toLowerCase();renderRoster();});
    if(M&&M.players&&M.players.length){renderAll();applyHash();}
    const cfg=window.MAFIA_SHEET;
    if(cfg&&cfg.id&&window.loadMafiaLive){
      setSync('syncing…','wait');
      window.loadMafiaLive(cfg.id,cfg.gid,function(data){
        if(data&&data.players&&data.players.length){M=data;renderAll();}
        applyHash();
        setSync('live · '+M.agg.totalGames+' rounds · '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),'ok');
      },function(err){
        console.warn('live sync failed',err);
        applyHash();
        setSync(M&&M.players&&M.players.length?'showing saved snapshot':'sync failed','err');
      });
    } else {
      applyHash();
      if(!(M&&M.players&&M.players.length))setSync('no data','err');
    }
  }
  document.addEventListener('DOMContentLoaded',boot);
})();
