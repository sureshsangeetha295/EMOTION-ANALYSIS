// ── Session timeline ──
const TIMELINE_ICONS={
  start:'<svg viewBox="0 0 24 24" stroke="#22c55e"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  end:'<svg viewBox="0 0 24 24" stroke="#dc2626"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  happy:'<svg viewBox="0 0 24 24" stroke="#e8440a"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  neutral:'<svg viewBox="0 0 24 24" stroke="#6b7280"><circle cx="12" cy="12" r="10"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  sad:'<svg viewBox="0 0 24 24" stroke="#3b82f6"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  angry:'<svg viewBox="0 0 24 24" stroke="#dc2626"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9l1 1M15 9l-1 1"/></svg>',
  surprised:'<svg viewBox="0 0 24 24" stroke="#f59e0b"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="14" r="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  fearful:'<svg viewBox="0 0 24 24" stroke="#f97316"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  disgusted:'<svg viewBox="0 0 24 24" stroke="#7c3aed"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h1M14 9h1"/></svg>',
  reaction:'<svg viewBox="0 0 24 24" stroke="#e8440a"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
};
const ICON_BG={start:'rgba(34,197,94,0.12)',end:'rgba(220,38,38,0.12)',happy:'rgba(232,68,10,0.1)',neutral:'rgba(107,114,128,0.1)',sad:'rgba(59,130,246,0.1)',angry:'rgba(220,38,38,0.1)',surprised:'rgba(245,158,11,0.1)',fearful:'rgba(249,115,22,0.1)',disgusted:'rgba(124,58,237,0.1)',reaction:'rgba(232,68,10,0.08)'};
const REACTION_WORDS=['thumb','hand','clap','confus','applaud'];

function addTimelineEvent(label,emoji,dotClass){
  timelineEvents.push({timeLabel:sessionTime(),label,emoji,dotClass});
  renderTimeline();
}

function renderTimeline(){
  const wrap=document.getElementById('timelineScrollWrap');
  const empty=document.getElementById('timelineEmpty');
  const track=document.getElementById('timelineTrack');
  const countLbl=document.getElementById('timelineCountLabel');
  if(!timelineEvents.length){
    wrap.style.display='none';empty.style.display='flex';
    if(countLbl)countLbl.textContent='0 events';
    return;
  }
  wrap.style.display='flex';empty.style.display='none';
  if(countLbl)countLbl.textContent=`${timelineEvents.length} event${timelineEvents.length===1?'':'s'}`;
  track.innerHTML='';
  timelineEvents.forEach((ev,i)=>{
    if(i>0){const conn=document.createElement('div');conn.className='timeline-connector';conn.innerHTML='<div class="timeline-connector-line"></div>';track.appendChild(conn);}
    const dc=ev.dotClass||'neutral';
    const isReaction=REACTION_WORDS.some(w=>ev.label.toLowerCase().includes(w));
    const key=isReaction?'reaction':(dc==='start'||dc==='end'?dc:dc)||'neutral';
    const iconSvg=TIMELINE_ICONS[key]||TIMELINE_ICONS['neutral'];
    const bgColor=ICON_BG[key]||ICON_BG['neutral'];
    const evEl=document.createElement('div');evEl.className='timeline-event';
    evEl.innerHTML=`<div class="timeline-event-inner"><div class="timeline-event-time">${ev.timeLabel}</div><div class="timeline-event-icon" style="background:${bgColor}">${iconSvg}</div><div class="timeline-event-label">${ev.label}</div></div><div class="timeline-event-dot ${ev.dotClass}"></div>`;
    track.appendChild(evEl);
  });
}