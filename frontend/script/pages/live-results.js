// ── EmotionAI Live Results — BroadcastChannel receiver ──
const EMOTION_LABELS={happy:'Happy',neutral:'Neutral',sad:'Sad',angry:'Angry',fearful:'Fear',disgusted:'Disgust',surprised:'Surprised'};
const EMOTION_EMOJIS={happy:'😊',neutral:'😐',sad:'😞',angry:'😠',fearful:'😨',disgusted:'🤢',surprised:'😲'};
const EMOTION_COLORS={happy:'#f59e0b',neutral:'#6b7280',sad:'#3b82f6',angry:'#ef4444',fearful:'#a855f7',disgusted:'#10b981',surprised:'#ec4899'};
const PROB_KEY_ORDER=['Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'];
const PROB_COLORS={Anger:'#ef4444',Disgust:'#10b981',Fear:'#a855f7',Happiness:'#f59e0b',Neutral:'#6b7280',Sadness:'#3b82f6',Surprise:'#ec4899'};

let _sessionActive=false;
let _detectionCount=0;
let _latencyTotal=0;
let _sessionTimerInterval=null;
let _sessionStartTs=null;
let _emotionHistory=[];        // [{emotion, conf, ts}]
let _topCounts={};             // emotion key → count

// ── DOM helpers ──
const $=id=>document.getElementById(id);
function setText(id,v){const el=$(id);if(el)el.textContent=v;}
function sessionElapsed(){
  if(!_sessionStartTs)return'0:00';
  const s=Math.floor((Date.now()-_sessionStartTs)/1000),m=Math.floor(s/60);
  return`${m}:${String(s%60).padStart(2,'0')}`;
}

// ── Indicator helpers ──
function setLiveOn(){
  const ind=$('live-indicator');
  if(ind){ind.classList.remove('off');ind.classList.add('on');}
  setText('live-indicator-text','Live');
  const banner=$('no-live-banner');
  if(banner)banner.style.display='none';
}
function setLiveOff(){
  const ind=$('live-indicator');
  if(ind){ind.classList.add('off');ind.classList.remove('on');}
  setText('live-indicator-text','Session ended');
}

// ── Session start ──
function onSessionStart(){
  _sessionActive=true;
  _detectionCount=0;
  _latencyTotal=0;
  _emotionHistory=[];
  _topCounts={};
  _sessionStartTs=Date.now();
  setLiveOn();
  setText('hero-emotion','Detecting…');
  setText('hero-conf','');
  setText('hero-ms','');
  setText('stat-count','0');
  setText('stat-ms','—');
  setText('stat-top','—');
  setText('stat-time','0:00');
  const hl=$('history-list');
  if(hl)hl.innerHTML='<div class="history-empty" id="history-empty">No detections yet</div>';
  const pb=$('prob-bars-live');
  if(pb)pb.innerHTML='';
  const sr=$('spark-row');
  if(sr)sr.innerHTML='';
  if(_sessionTimerInterval)clearInterval(_sessionTimerInterval);
  _sessionTimerInterval=setInterval(()=>setText('stat-time',sessionElapsed()),1000);
}

// ── Session stop ──
function onSessionStop(){
  _sessionActive=false;
  setLiveOff();
  if(_sessionTimerInterval){clearInterval(_sessionTimerInterval);_sessionTimerInterval=null;}
}

// ── Render a detection ──
function onDetection(msg){
  if(!_sessionActive)return;
  const{emotion,conf,probs,emotionCounts,totalDetected,sessionTime,latencyMs}=msg;
  _detectionCount++;
  if(latencyMs>0)_latencyTotal+=latencyMs;
  _topCounts=emotionCounts||{};

  // Hero card
  const heroEl=$('hero-emotion');
  if(heroEl){
    heroEl.className='';
    heroEl.textContent=(EMOTION_LABELS[emotion]||emotion)+' '+(EMOTION_EMOJIS[emotion]||'');
    heroEl.style.color=EMOTION_COLORS[emotion]||'var(--text)';
  }
  const iconWrap=$('hero-icon');
  if(iconWrap){
    iconWrap.innerHTML=`<span style="font-size:38px">${EMOTION_EMOJIS[emotion]||'🔍'}</span>`;
  }
  setText('hero-conf',`${Math.round(conf)}% confidence`);
  if(latencyMs>0)setText('hero-ms',`${latencyMs}ms`);

  // Stats
  setText('stat-count',_detectionCount.toLocaleString());
  const avgMs=_detectionCount>0?Math.round(_latencyTotal/_detectionCount):0;
  setText('stat-ms',avgMs>0?`${avgMs}ms`:'—');

  // Top emotion
  if(_topCounts&&Object.keys(_topCounts).length){
    const top=Object.entries(_topCounts).sort((a,b)=>b[1]-a[1])[0];
    const totalAll=Object.values(_topCounts).reduce((a,b)=>a+b,0)||1;
    setText('stat-top',`${EMOTION_LABELS[top[0]]||top[0]} (${Math.round(top[1]/totalAll*100)}%)`);
  }

  // History list
  _emotionHistory.unshift({emotion,conf,ts:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})});
  if(_emotionHistory.length>50)_emotionHistory.pop();
  renderHistory();

  // Probability bars
  if(probs)renderProbBars(probs);

  // Sparkline
  renderSparkline(emotion);
}

// ── History list ──
function renderHistory(){
  const hl=$('history-list');
  if(!hl)return;
  const empty=$('history-empty');
  if(empty)empty.remove();
  // Insert newest at top — keep max 20 visible
  const existing=hl.querySelectorAll('.history-item');
  if(existing.length>=20)existing[existing.length-1].remove();
  const d=_emotionHistory[0];
  const item=document.createElement('div');
  item.className='history-item';
  item.innerHTML=`
    <span class="history-emoji">${EMOTION_EMOJIS[d.emotion]||'🔍'}</span>
    <span class="history-label" style="color:${EMOTION_COLORS[d.emotion]||'inherit'}">${EMOTION_LABELS[d.emotion]||d.emotion}</span>
    <span class="history-conf">${Math.round(d.conf)}%</span>
    <span class="history-ts">${d.ts}</span>`;
  hl.insertBefore(item,hl.firstChild);
}

// ── Probability bars ──
function renderProbBars(probs){
  const container=$('prob-bars-live');
  if(!container)return;
  container.innerHTML='';
  PROB_KEY_ORDER.forEach(key=>{
    const val=probs[key]||0;
    const color=PROB_COLORS[key]||'#999';
    const row=document.createElement('div');
    row.className='prob-bar-row';
    row.innerHTML=`
      <div class="prob-bar-label">${key}</div>
      <div class="prob-bar-track">
        <div class="prob-bar-fill" style="width:${val}%;background:${color}"></div>
      </div>
      <div class="prob-bar-pct">${val}%</div>`;
    container.appendChild(row);
  });
}

// ── Sparkline (emoji timeline) ──
const SPARK_MAX=30;
const _sparkData=[];
function renderSparkline(emotion){
  _sparkData.push(emotion);
  if(_sparkData.length>SPARK_MAX)_sparkData.shift();
  const row=$('spark-row');
  if(!row)return;
  row.innerHTML=_sparkData.map((e,i)=>{
    const opacity=0.3+0.7*(i/_sparkData.length);
    return`<span class="spark-dot" title="${EMOTION_LABELS[e]||e}" style="opacity:${opacity};font-size:${i===_sparkData.length-1?'22px':'16px'};transition:font-size 0.2s">${EMOTION_EMOJIS[e]||'🔍'}</span>`;
  }).join('');
  row.scrollLeft=row.scrollWidth;
}

// ── BroadcastChannel receiver ──
if(typeof BroadcastChannel!=='undefined'){
  const ch=new BroadcastChannel('emotionai_live');
  ch.onmessage=e=>{
    const msg=e.data;
    if(!msg||!msg.type)return;
    if(msg.type==='session_start')onSessionStart();
    else if(msg.type==='session_stop')onSessionStop();
    else if(msg.type==='detection')onDetection(msg);
  };
}else{
  // Fallback: BroadcastChannel not supported
  const banner=$('no-live-banner');
  if(banner)banner.innerHTML='⚠ Your browser does not support cross-tab communication. Please use Chrome or Firefox.';
}

// ── Inline styles for new elements ──
(function injectStyles(){
  const s=document.createElement('style');
  s.textContent=`
    .live-indicator.on .live-pip{animation:livePip 0.8s ease-in-out infinite;}
    .live-indicator.on{background:rgba(220,38,38,0.1);border-color:rgba(220,38,38,0.25);color:#dc2626;}
    @keyframes livePip{0%,100%{opacity:1}50%{opacity:0.15}}
    .history-item{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.06);font-size:12px;}
    .history-emoji{font-size:16px;flex-shrink:0;}
    .history-label{font-weight:700;flex:1;}
    .history-conf{color:#6b6560;font-weight:600;min-width:38px;text-align:right;}
    .history-ts{color:#a8a29e;font-size:10px;min-width:64px;text-align:right;}
    .prob-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:11px;}
    .prob-bar-label{width:68px;font-weight:600;color:#6b6560;flex-shrink:0;}
    .prob-bar-track{flex:1;height:8px;border-radius:99px;background:rgba(0,0,0,0.07);overflow:hidden;}
    .prob-bar-fill{height:100%;border-radius:99px;transition:width 0.3s ease;}
    .prob-bar-pct{width:32px;text-align:right;font-weight:700;color:#1a1612;}
    .spark-row{display:flex;align-items:flex-end;gap:3px;overflow-x:auto;padding:4px 0;scrollbar-width:none;min-height:32px;}
    .spark-row::-webkit-scrollbar{display:none;}
    .spark-dot{display:inline-block;cursor:default;}
  `;
  document.head.appendChild(s);
})();