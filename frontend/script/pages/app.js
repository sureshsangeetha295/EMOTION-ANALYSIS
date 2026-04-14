/* ── Dashboard-level additions that integrate with app.js ── */

// Typewriter for idle cam
const TW_LINES = [
  'Ready to detect your emotion…',
  'Place your face clearly in the frame…',
  'Click Detect for a single snapshot…',
  'Go Live for continuous monitoring…',
  'Session timeline builds automatically…',
];
let _twIdx=0,_twChar=0,_twDir=1;

function initGreeting(){
  const h=new Date().getHours();
  const g=document.getElementById('greetingLine');
  if(g)g.textContent=h<12?'Good Morning! 🌅':h<17?'Good Afternoon! 📚':'Good Evening! 🌙';
  runTW();
}
function runTW(){
  const el=document.getElementById('typewriterText');
  if(!el)return;
  const line=TW_LINES[_twIdx];
  if(_twDir===1){el.textContent=line.slice(0,++_twChar);if(_twChar>=line.length){_twDir=-1;setTimeout(runTW,1800);return;}}
  else{el.textContent=line.slice(0,--_twChar);if(_twChar<=0){_twDir=1;_twIdx=(_twIdx+1)%TW_LINES.length;}}
  setTimeout(runTW,_twDir===1?55:28);
}

// Launch dropdown
function toggleLaunchMenu(e){
  e.stopPropagation();
  document.getElementById('navLaunchWrap').classList.toggle('open');
}
document.addEventListener('click',()=>{
  const w=document.getElementById('navLaunchWrap');
  if(w)w.classList.remove('open');
});

// Speedometer
function setSpeedometer(score){
  const angle=(score/100)*180-90;
  const n=document.getElementById('speedoNeedle');
  if(n)n.style.transform=`rotate(${angle}deg)`;
  const cx=115,cy=112,r=95;
  const sR=Math.PI,eR=Math.PI-(score/100)*Math.PI;
  const x1=cx+r*Math.cos(sR),y1=cy+r*Math.sin(sR);
  const x2=cx+r*Math.cos(eR),y2=cy+r*Math.sin(eR);
  const largeArc=score>50?1:0;
  const col=score>=70?'#16a34a':score>=40?'#ca8a04':'#dc2626';
  const arc=document.getElementById('speedoArc');
  if(arc){arc.setAttribute('d',`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`);arc.setAttribute('stroke',col);}
  const sv=document.getElementById('speedoValue');
  const ss=document.getElementById('speedoStatus');
  if(sv){sv.textContent=score>0?Math.round(score):'—';sv.style.color=col;}
  if(ss)ss.textContent=score>=70?'🟢 Actively Listening':score>=40?'🟡 Partially Engaged':score>0?'🔴 Low Engagement':'Awaiting detection';
}

// EMOTION META for detect/insight panels
const DETECT_META={
  happiness:{label:'Happy',        color:'#f59e0b',chip:'chip-green',chipTxt:'● Actively Engaged',
    desc:'Joy is a warm feeling of pleasure — your brain is flooded with dopamine.',
    head:'Riding the happy wave',
    tips:'Channel this energy into your most creative task. Joy supercharges problem-solving.',
    motivate:'',motivateCls:''},
  neutral:{label:'Neutral',        color:'#6b7280',chip:'chip-yellow',chipTxt:'◑ Partially Focused',
    desc:'A calm, balanced state — neither highs nor lows. Your mind is clear and steady.',
    head:'Making the most of calm',
    tips:'This steady state is ideal for deep analytical thinking and careful decision-making.',
    motivate:'💡 Try taking a quick note — writing helps lock in your attention!',motivateCls:'yellow'},
  sadness:{label:'Sad',            color:'#3b82f6',chip:'chip-red',chipTxt:'● Disengaged',
    desc:'A deep ache of loss or disappointment — a natural signal asking for reflection.',
    head:'Navigating through sadness',
    tips:'Be gentle with yourself. Take a short break and reach out to someone you trust.',
    motivate:'❤️ It\'s okay to feel this way. One step at a time!',motivateCls:'red'},
  anger:{label:'Frustrated',       color:'#ef4444',chip:'chip-red',chipTxt:'● Disengaged',
    desc:'Anger is intense energy triggered by a perceived threat — it sharpens focus but clouds judgment.',
    head:'Cooling and redirecting anger',
    tips:'Step away briefly and try box breathing: 4 counts in, hold 4, out 4, hold 4.',
    motivate:'🧘 Breathe. Frustration means you care — you\'re closer than you think!',motivateCls:'red'},
  fear:{label:'Anxious',           color:'#8b5cf6',chip:'chip-red',chipTxt:'● Stressed / Anxious',
    desc:'Fear is your mind\'s alarm — it detects uncertainty and floods your body with alertness.',
    head:'Moving through fear',
    tips:'Name the fear and break your challenge into the smallest next step.',
    motivate:'💙 Slow breath in, slow breath out. You\'ve got this! 🙌',motivateCls:'red'},
  disgust:{label:'Disengaged',     color:'#10b981',chip:'chip-red',chipTxt:'● Very Low Interest',
    desc:'Very low engagement detected — try switching the delivery or connecting to something interesting.',
    head:'Re-engaging your interest',
    tips:'Find just one surprising fact about this topic to spark curiosity.',
    motivate:'🔥 Even 2 focused minutes can reset the entire session. Go!',motivateCls:'red'},
  surprise:{label:'Surprised',     color:'#f97316',chip:'chip-yellow',chipTxt:'◑ Attention Spike',
    desc:'Surprise is a brief jolt — your brain snaps to full alertness and curiosity instantly.',
    head:'Harness the attention spike',
    tips:'Your brain is at peak receptivity right now. Use this to absorb something new.',
    motivate:'',motivateCls:''},
};

// Engagement score map (matches app.js ENGAGEMENT_MAP)
const ENG_SCORE={Happiness:0.9,Surprise:0.68,Neutral:0.52,Sadness:0.18,Fear:0.28,Anger:0.14,Disgust:0.10};

// Live engagement tracking for speedometer
let _engScoresLive=[];
let _attentiveTime=0,_partialTime=0,_disengagedTime=0;
let _currentEngScore=0;
let _reactionCount=0;
let _sessionTimerEl=null;

// Hook into app.js updateUI to also drive new panels
function _patchedUpdateUI(probs, top, conf, engagement){
  // Update detected panel
  const emoLower=(top||'').toLowerCase();
  const meta=DETECT_META[emoLower];
  const color=meta?meta.color:'#6b7280';

  // Detected emotion panel
  const dn=document.getElementById('detName');
  const da=document.getElementById('detAwaitTxt');
  const dc=document.getElementById('detConf');
  const dcv=document.getElementById('detConfVal');
  const dd=document.getElementById('detDesc');
  if(dn){dn.textContent=meta?meta.label:(top||'Awaiting');dn.style.color=color;}
  if(da)da.style.display='none';
  if(dc)dc.classList.remove('hidden');
  if(dcv)dcv.textContent=`${conf}% confidence`;
  if(dd)dd.textContent=meta?meta.desc:'';

  // Detected avatar mouth
  const mouths={happiness:'M 63 115 Q 75 125 87 115',neutral:'M 63 110 Q 75 112 87 110',
    sadness:'M 63 115 Q 75 105 87 115',anger:'M 63 113 Q 75 105 87 113',
    fear:'M 65 112 Q 75 118 85 112',disgust:'M 60 112 Q 68 118 76 112 Q 84 106 90 112',
    surprise:'M 67 110 Q 75 122 83 110'};
  const dm=document.getElementById('detMouth');
  if(dm)dm.setAttribute('d',mouths[emoLower]||mouths.neutral);

  // Insight panel
  const chip=document.getElementById('insightChip');
  const itxt=document.getElementById('insightText');
  const mbox=document.getElementById('motivateBox');
  if(chip&&meta){chip.className=`insight-chip visible ${meta.chip}`;chip.textContent=meta.chipTxt;}
  if(itxt&&meta){
    itxt.innerHTML=`<div class="insight-head">${meta.head}</div><span>${meta.tips}</span>`;
  }
  if(mbox&&meta){
    if(meta.motivate){mbox.textContent=meta.motivate;mbox.className=`motivate-box show ${meta.motivateCls}`;}
    else{mbox.className='motivate-box';}
  }

  // Speedometer via engagement
  const engVal=engagement!=null?engagement:(ENG_SCORE[top]||0.5);
  _currentEngScore+=((engVal*100-_currentEngScore)*0.4);
  setSpeedometer(_currentEngScore);

  // Track attentive/partial/disengaged
  const score=_currentEngScore;
  if(score>=70)_attentiveTime++;else if(score>=40)_partialTime++;else _disengagedTime++;
  const total=_attentiveTime+_partialTime+_disengagedTime;
  if(total>0){
    const sa=document.getElementById('statAttentive');
    const sp=document.getElementById('statPartial');
    const sd=document.getElementById('statDisengaged');
    if(sa)sa.textContent=Math.round((_attentiveTime/total)*100)+'%';
    if(sp)sp.textContent=Math.round((_partialTime/total)*100)+'%';
    if(sd)sd.textContent=Math.round((_disengagedTime/total)*100)+'%';
  }

  // Guide steps
  const s2=document.getElementById('step2'),s3=document.getElementById('step3'),s4=document.getElementById('step4');
  if(s2)s2.classList.add('done');
  if(s3)s3.classList.add('done');
  if(s4)s4.classList.add('active');

  // Cam idle → hide once detection starts
  const idle=document.getElementById('camIdle');
  if(idle)idle.style.display='none';

  // Cam status
  const dot=document.getElementById('camStatusDot');
  const txt=document.getElementById('camStatusTxt');
  if(dot){dot.className='cam-status-dot ready';}
  if(txt)txt.textContent='DETECTED';

  // Add to live timeline scroll
  _addTLItem(meta?meta.label:(top||'—'),color,score>=70?'😊':score>=40?'😐':'😞');
}

function _addTLItem(label,color,icon){
  const empty=document.getElementById('tlEmpty');
  if(empty)empty.remove();
  const sc=document.getElementById('timelineScroll');
  if(!sc)return;
  const el=document.createElement('div');
  el.className='tl-item';
  const elapsed=typeof _sessionStart!=='undefined'&&_sessionStart?Date.now()-_sessionStart:0;
  const s=Math.floor(elapsed/1000),m=Math.floor(s/60);
  const ts=`${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  el.innerHTML=`<div class="tl-dot" style="background:${color}"></div><div class="tl-time">${ts}</div><div class="tl-msg">${label} detected</div><div class="tl-icon">${icon}</div>`;
  sc.appendChild(el);sc.scrollTop=sc.scrollHeight;
}

// Reactions (shown during live)
function sendReaction(type,btn){
  btn.classList.add('active');setTimeout(()=>btn.classList.remove('active'),600);
  _reactionCount++;
  const labels={thumbsup:'👍 Liked content',thumbsdown:'👎 Unclear',handraise:'✋ Doubt raised',confused:'😕 Confused',clap:'👏 Appreciated'};
  const colors={thumbsup:'#16a34a',thumbsdown:'#dc2626',handraise:'#e8440a',confused:'#ca8a04',clap:'#3b82f6'};
  const icons={thumbsup:'👍',thumbsdown:'👎',handraise:'✋',confused:'😕',clap:'👏'};
  _addTLItem(labels[type],colors[type]||'#6b7280',icons[type]||'⭐');
  // Float up animation
  const camBox=document.getElementById('camBox');
  for(let i=0;i<3;i++){
    setTimeout(()=>{
      const el=document.createElement('div');
      el.className='float-reaction';el.textContent=icons[type];
      el.style.cssText=`left:${15+Math.random()*50}%;bottom:70px;position:absolute;font-size:22px;pointer-events:none;z-index:20;animation:floatUp 1.6s ease-out forwards`;
      camBox.appendChild(el);setTimeout(()=>el.remove(),1800);
    },i*200);
  }
}

// Patch updateUI once app.js loads
window.addEventListener('load',()=>{
  // Patch original updateUI from app.js
  if(typeof updateUI==='function'){
    const _orig=updateUI;
    window.updateUI=function(probs,top,conf,engagement){
      _orig(probs,top,conf,engagement);
      _patchedUpdateUI(probs,top,conf,engagement);
    };
  }
  // Also patch startLive / stopLive to update our UI
  _patchLive();
  initGreeting();
  setSpeedometer(0);
});

function _patchLive(){
  // Patch startLive
  if(typeof startLive==='function'){
    const _origStart=startLive;
    window.startLive=async function(){
      await _origStart();
      _currentEngScore=0;_attentiveTime=0;_partialTime=0;_disengagedTime=0;_reactionCount=0;
      document.getElementById('camStatusDot').className='cam-status-dot live';
      document.getElementById('camStatusTxt').textContent='LIVE';
      document.getElementById('reactionBox').classList.add('show');
      document.getElementById('camScan').classList.add('live');
      document.getElementById('endNoteRow').classList.remove('show');
      // Clear timeline scroll for new session
      const sc=document.getElementById('timelineScroll');
      if(sc){sc.innerHTML='';const e=document.createElement('div');e.className='tl-empty';e.id='tlEmpty';e.textContent='Session started. Monitoring...';sc.appendChild(e);}
      _addTLItem('Session started','#16a34a','🎬');
    };
  }
  // Patch stopLive
  if(typeof stopLive==='function'){
    const _origStop=stopLive;
    window.stopLive=async function(){
      await _origStop();
      document.getElementById('camStatusDot').className='cam-status-dot ready';
      document.getElementById('camStatusTxt').textContent='STOPPED';
      document.getElementById('reactionBox').classList.remove('show');
      document.getElementById('camScan').classList.remove('live');
      // End note
      const total=_attentiveTime+_partialTime+_disengagedTime||1;
      const attPct=Math.round((_attentiveTime/total)*100);
      const note=attPct>=60?'Outstanding session! 🌟':attPct>=40?'Good effort — keep it up! 💪':'Keep pushing — every session counts! 🔥';
      const elapsed=typeof _sessionStart!=='undefined'&&_sessionStart?Date.now()-_sessionStart:0;
      const s=Math.floor(elapsed/1000),m=Math.floor(s/60);
      const ts=`${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      const enr=document.getElementById('endNoteRow');
      const ebt=document.getElementById('endBadgeTime');
      const ebn=document.getElementById('endBadgeNote');
      if(ebt)ebt.textContent=ts;if(ebn)ebn.textContent=note;if(enr)enr.classList.add('show');
      _addTLItem('Session ended','#6b7280','🏁');
    };
  }
}

// Guide step helper (called from app.js indirectly)
function setStep(n){
  [1,2,3,4].forEach(i=>{
    const s=document.getElementById('step'+i);
    if(!s)return;
    s.classList.remove('active','done');
    if(i<n)s.classList.add('done');
    else if(i===n)s.classList.add('active');
  });
}

// @keyframes penWrite needed inline
const _ks=document.createElement('style');
_ks.textContent='@keyframes penWrite{0%,100%{transform:rotate(-5deg) translateY(0px)}30%{transform:rotate(-3deg) translateY(-1.5px)}60%{transform:rotate(-6deg) translateY(1px)}}';
document.head.appendChild(_ks);

(function(){
  var btn=document.getElementById('hamburgerBtn');
  var closeBtn=document.getElementById('drawerCloseBtn');
  var drawer=document.getElementById('mobileDrawer');
  var overlay=document.getElementById('mobileOverlay');
  if(!btn)return;
  function open(){btn.classList.add('open');drawer.classList.add('open');overlay.classList.add('open');document.body.style.overflow='hidden';}
  function close(){btn.classList.remove('open');drawer.classList.remove('open');overlay.classList.remove('open');document.body.style.overflow='';}
  btn.addEventListener('click',function(){btn.classList.contains('open')?close():open();});
  if(closeBtn)closeBtn.addEventListener('click',close);
  overlay.addEventListener('click',close);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
  drawer.querySelectorAll('a').forEach(function(el){el.addEventListener('click',close);});
})();
