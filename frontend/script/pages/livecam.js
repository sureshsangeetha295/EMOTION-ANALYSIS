// ── Constants ──
const PROB_KEYS=['Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'];
const ENGAGEMENT_MAP={Happiness:0.90,Surprise:0.75,Neutral:0.60,Sadness:0.25,Fear:0.30,Anger:0.20,Disgust:0.10};
const SCORE_MAP={happy:90,surprised:75,neutral:60,fearful:30,sad:25,angry:20,disgusted:10};
const API_URL='/predict/';
const BACKEND_TO_DRAFT={happiness:'happy',neutral:'neutral',sadness:'sad',anger:'angry',fear:'fearful',disgust:'disgusted',surprise:'surprised'};
const EMOTION_COLORS={happy:'#f59e0b',neutral:'#6b7280',sad:'#3b82f6',angry:'#ef4444',fearful:'#a855f7',disgusted:'#10b981',surprised:'#ec4899'};
const EMOTION_LABELS={happy:'Happy',neutral:'Neutral',sad:'Sad',angry:'Angry',fearful:'Fear',disgusted:'Disgust',surprised:'Surprised'};
const EMOTION_EMOJIS={happy:'😊',neutral:'😐',sad:'😞',angry:'😠',fearful:'😨',disgusted:'🤢',surprised:'😲'};
const TREND_COLORS={Anger:'#ef4444',Disgust:'#10b981',Fear:'#a855f7',Happiness:'#f59e0b',Neutral:'#6b7280',Sadness:'#3b82f6',Surprise:'#ec4899'};
const PIE_COLORS={happy:'#f59e0b',neutral:'#6b7280',surprised:'#ec4899',sad:'#3b82f6',angry:'#ef4444',fearful:'#a855f7',disgusted:'#10b981'};

// ── BroadcastChannel: push live data to live-results page ──
const _liveChannel=(typeof BroadcastChannel!=='undefined')?new BroadcastChannel('emotionai_live'):null;
function _broadcast(msg){try{if(_liveChannel)_liveChannel.postMessage(msg);}catch(e){}}

// ── State ──
let isLive=false,liveInterval=null,abortCtrl=null,detectionInProgress=false;
let _sessionId=null,_frameCount=0,_engagementScores=[];
let sessionStart=null,sessionTimer=null,reactionCount=0;
let engagementScore=0,lastEmotion=null,totalDetected=0;
let emotionCounts={},peakConf=0;
let _sessionNum=Math.floor(Math.random()*20)+1;
const TREND_HISTORY=[];
const TREND_MAX=30;
let timelineEvents=[];
let lastEmotionKey=null,emotionChangeCooldown=0,_lastDetectStart=0;

// ── Spike state ──
let _spikeDetector=new SpikeDetector(10,1.8);
let _spikeCount=0;
let _spikeFrames=[];          // frame indices where spikes occurred (for chart markers)
let _lastSpikeSummary=null;   // filled on doStop(), passed to generate-insights

// ── Helpers ──
function fmtTime(ms){const s=Math.floor(ms/1000),m=Math.floor(s/60);return`${m}:${String(s%60).padStart(2,'0')}`;}
function sessionTime(){return sessionStart?fmtTime(Date.now()-sessionStart):'0:00';}
function pct(k){const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;return Math.round((emotionCounts[k]||0)/total*100);}

function tickTimer(){
  const d=document.getElementById('sumDuration');
  if(d)d.textContent=sessionTime();
  const sf=document.getElementById('sumFrames');
  if(sf)sf.textContent=_frameCount.toLocaleString();
  if(_engagementScores.length>0){
    const avg=Math.round(_engagementScores.reduce((a,b)=>a+b,0)/_engagementScores.length*100);
    const sa=document.getElementById('sumEngagAvg');
    if(sa)sa.textContent=avg;
  }
}

// ── Emotion bars & mini-rows ──
function updateEmotionBars(){
  const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const p=k=>Math.round((emotionCounts[k]||0)/total*100);
  const posTotal=p('happy')+p('surprised');
  const negTotal=p('angry')+p('sad')+p('fearful')+p('disgusted');
  const neuTotal=p('neutral');
  const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  setText('emoPosTotal',posTotal+'%');setText('emoNegTotal',negTotal+'%');setText('emoNeutralTotal',neuTotal+'%');
  // Main chips (big cards, left half)
  setText('tagHappySubPct',p('happy')+'%');
  setText('tagSurprisedSubPct',p('surprised')+'%');
  setText('tagAngrySubPct',p('angry')+'%');
  setText('tagSadSubPct',p('sad')+'%');
  setText('tagFearSubPct',p('fearful')+'%');
  setText('tagDisgustSubPct',p('disgusted')+'%');
  setText('tagNeutralSubPct',p('neutral')+'%');
  // Tag list (right half)
  setText('tagHappyPct',p('happy')+'%');
  setText('tagSurprisedPct',p('surprised')+'%');
  setText('tagAngryPct',p('angry')+'%');
  setText('tagSadPct',p('sad')+'%');
  setText('tagFearPct',p('fearful')+'%');
  setText('tagDisgustPct',p('disgusted')+'%');
  setText('tagNeutralPct',p('neutral')+'%');
}

function updateDominantChips(){
  const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const container=document.getElementById('dominantChips');
  if(!container)return;
  if(!sorted.length){container.innerHTML='<span style="font-size:11px;color:var(--text3);font-style:italic">No data yet</span>';return;}
  container.innerHTML=sorted.map(([k,v])=>`<span class="dom-chip ${k}">${EMOTION_LABELS[k]||k} ${Math.round(v/total*100)}%</span>`).join('');
}

// ── Adaptive EMA alpha ──────────────────────────────────────────────────
// Alpha adapts based on two signals:
//   1. Confidence: high-confidence detections react faster (higher alpha)
//   2. Emotion intensity: strong emotions (very positive/negative) react faster
//      neutral/low-intensity emotions smooth more (lower alpha)
// Result: noisy/uncertain frames barely move the score;
//         clear strong emotions update it meaningfully.
function adaptiveAlpha(conf, score){
  // conf is 0–100, normalise to 0–1
  const confNorm = Math.min(1, Math.max(0, conf / 100));
  // intensity = how far score is from the neutral midpoint (60)
  // scores range ~10 (disgust) to 90 (happy); midpoint ~50
  const intensity = Math.abs(score - 50) / 50;  // 0 = pure neutral, 1 = extreme
  // base alpha range: 0.08 (low conf/neutral) → 0.30 (high conf/strong emotion)
  const alpha = 0.08 + (confNorm * 0.12) + (intensity * 0.10);
  return Math.min(0.30, alpha);
}

function applyDetectionResult(backendEmotion,conf,engagement,probs,emaFromServer){
  const draftKey=BACKEND_TO_DRAFT[backendEmotion.toLowerCase()]||'neutral';
  const score=engagement!=null?engagement*100:(SCORE_MAP[draftKey]||50);
  if(totalDetected===0){
    engagementScore=score;
  }else{
    const alpha=adaptiveAlpha(conf, score);
    engagementScore+=(score-engagementScore)*alpha;
  }
  _engagementScores.push(engagementScore/100);
  totalDetected++;
  emotionCounts[draftKey]=(emotionCounts[draftKey]||0)+1;
  if(conf>peakConf)peakConf=conf;
  emotionChangeCooldown--;
  if(draftKey!==lastEmotionKey&&emotionChangeCooldown<=0){
    addTimelineEvent(`${EMOTION_LABELS[draftKey]||draftKey} detected`,EMOTION_EMOJIS[draftKey]||'🔍',draftKey);
    lastEmotionKey=draftKey;emotionChangeCooldown=5;
  }

  // ── Client-side spike detection ────────────────────────────────────────
  const emaForSpike = emaFromServer != null ? emaFromServer : engagementScore/100;
  const spike = _spikeDetector.update(emaForSpike);
  if(spike){
    _spikeCount++;
    _spikeFrames.push(_frameCount);  // record which render frame this was
    updateSpikeCounter();
    if(spike.direction==='drop'){
      addTimelineEvent('Engagement drop detected','⚡','angry');
    }
  }

  const pill=document.getElementById('camEmotionPill');
  const name=document.getElementById('camEmotionName');
  const scoreEl=document.getElementById('camEmotionScore');
  if(pill)pill.classList.add('show');
  if(name)name.textContent=EMOTION_LABELS[draftKey]||draftKey;
  if(scoreEl)scoreEl.textContent=`· ${Math.round(conf)}%`;
  const esn=document.getElementById('engageScoreNum');
  if(esn)esn.textContent=Math.round(engagementScore);
  const tier=engagementScore>=70?{label:'Active',color:'#16a34a'}:engagementScore>=40?{label:'Moderate',color:'#ca8a04'}:{label:'Inactive',color:'#dc2626'};
  const tierEl=document.getElementById('engageTierLabel');
  if(tierEl){tierEl.textContent=tier.label;tierEl.style.color=tier.color;}
  updateEngageLegend();
  if(probs){showDistGraph();updateTrendGraph(probs,spike?_frameCount:null,spike?draftKey:null);}
  updateEmotionBars();updateDominantChips();
  _broadcast({type:'detection',emotion:draftKey,conf,engagement:engagementScore,probs,
    emotionCounts:{...emotionCounts},totalDetected,sessionTime:sessionTime(),
    latencyMs:Date.now()-(_lastDetectStart||Date.now())});
  const pe=document.getElementById('sumPeakEmotion');
  const pc=document.getElementById('sumPeakConf');
  const totalAll=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const dominantEntry=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])[0];
  if(pe&&dominantEntry)pe.textContent=EMOTION_LABELS[dominantEntry[0]]||dominantEntry[0];
  if(pc&&dominantEntry)pc.textContent=`${Math.round(dominantEntry[1]/totalAll*100)}% of session · highest share`;
}

function updateSpikeCounter(){
  const el=document.getElementById('spikeCounterBadge');
  if(!el)return;
  if(_spikeCount===0){el.style.display='none';return;}
  el.style.display='flex';
  el.textContent=`⚡ ${_spikeCount} spike${_spikeCount!==1?'s':''}`;
}

// ── Camera capture & predict ──
function captureFrame(quality=0.75){
  return new Promise((resolve,reject)=>{
    const video=document.getElementById('videoEl');
    if(!video||!video.srcObject)return reject(new Error('No stream'));
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
    canvas.getContext('2d').drawImage(video,0,0,320,240);
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('toBlob failed')),'image/jpeg',quality);
  });
}

async function callPredict(signal){
  const blob=await captureFrame(0.75);
  const form=new FormData();form.append('file',blob,'frame.jpg');
  const sidParam=_sessionId?'&session_id='+encodeURIComponent(_sessionId):'';
  const res=await Auth.apiFetch(`${API_URL}?fast=true&save=false${sidParam}`,{method:'POST',body:form,signal});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.message||`HTTP ${res.status}`);}
  const data=await res.json();
  const probs={};
  PROB_KEYS.forEach((k,i)=>{const raw=data.all_probabilities?.[i]??0;probs[k]=Math.round((raw>1?raw:raw*100));});
  const total=Object.values(probs).reduce((a,b)=>a+b,0);
  if(total>0)PROB_KEYS.forEach(k=>probs[k]=Math.round(probs[k]/total*100));
  const emotion=data.emotion;
  const conf=Math.round(data.confidence>1?data.confidence:data.confidence*100);
  const engagement=data.engagement!=null?data.engagement:(ENGAGEMENT_MAP[emotion]??0.5);
  const ema=data.ema!=null?data.ema:null;
  return{emotion,conf,engagement,probs,ema};
}

function scheduleLive(){
  if(!isLive)return;
  liveInterval=setTimeout(async()=>{
    if(!isLive)return;
    if(!detectionInProgress){
      detectionInProgress=true;
      _lastDetectStart=Date.now();
      try{
        if(abortCtrl)abortCtrl.abort();
        abortCtrl=new AbortController();
        const{emotion,conf,engagement,probs,ema}=await callPredict(abortCtrl.signal);
        _frameCount++;
        applyDetectionResult(emotion,conf,engagement,probs,ema);
        document.getElementById('signalBar')?.classList.remove('show');
      }catch(err){
        if(err.name!=='AbortError'){console.error('[EmotionAI]',err);document.getElementById('signalBar')?.classList.add('show');}
      }finally{detectionInProgress=false;}
    }
    scheduleLive();
  },300);
}

// ── Reactions ──
function sendReaction(type,btn){
  btn.classList.add('active');setTimeout(()=>btn.classList.remove('active'),600);
  reactionCount++;
  const labels={thumbsup:'👍',thumbsdown:'👎',handraise:'✋',confused:'😕',clap:'👏'};
  const rLabels={thumbsup:'Thumbs up sent',thumbsdown:'Thumbs down sent',handraise:'Hand raised',confused:'Confusion flagged',clap:'Applauded'};
  const camBox=document.getElementById('camBox');
  const emoji=labels[type];
  for(let i=0;i<3;i++){setTimeout(()=>{const el=document.createElement('div');el.className='float-emoji';el.textContent=emoji;el.style.cssText=`left:${20+Math.random()*45}%;bottom:60px`;camBox.appendChild(el);setTimeout(()=>el.remove(),1600);},i*180);}
  addTimelineEvent(rLabels[type]||'Reaction',emoji,'neutral');
}

// ── Session start ──
async function doStart(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    const v=document.getElementById('videoEl');v.srcObject=stream;v.style.display='block';
    document.getElementById('camIdle').style.display='none';
    document.getElementById('camFps').style.display='block';
    document.getElementById('camFaceBox').classList.add('show');
    document.getElementById('camRing').classList.add('active');
    document.getElementById('camScan').classList.add('active');
    document.getElementById('camStatusDot').className='cam-status-dot live';
    document.getElementById('camStatusTxt').textContent='LIVE';
    document.getElementById('reactionBar').classList.add('show');
    document.getElementById('liveFeedChip').style.display='flex';
    document.getElementById('navLiveBadge').style.display='flex';
    isLive=true;detectionInProgress=false;_frameCount=0;_engagementScores=[];_sessionId=null;
    engagementScore=0;lastEmotion=null;totalDetected=0;emotionCounts={};reactionCount=0;
    peakConf=0;lastEmotionKey=null;emotionChangeCooldown=0;
    TREND_HISTORY.length=0;timelineEvents=[];
    // Reset spike state
    _spikeDetector.reset();_spikeCount=0;_spikeFrames=[];_lastSpikeSummary=null;
    updateSpikeCounter();
    _broadcast({type:'session_start'});
    _sessionNum++;
    // Reset UI
    const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setText('sumDuration','0:00');setText('sumFrames','0');setText('sumEngagAvg','—');
    setText('sumPeakEmotion','—');setText('sumPeakConf','');setText('engageScoreNum','—');
    setText('sessionChipLabel',`Session #${_sessionNum}`);
    const dc=document.getElementById('engageDominantCenter');if(dc)dc.textContent='';
    document.getElementById('dominantChips').innerHTML='<span style="font-size:11px;color:var(--text3);font-style:italic">No data yet</span>';
    document.getElementById('analysisBody').innerHTML='<span class="analysis-empty">Stop the session and click "Generate Analysis" for an AI-powered summary.</span>';
    const tipsReset=document.getElementById('tipsBody');
    if(tipsReset)tipsReset.innerHTML='<span style="font-size:10.5px;color:var(--text3);font-style:italic">Generate analysis to get personalized tips.</span>';
    const innerReset=document.getElementById('analysisInner');if(innerReset)innerReset.classList.remove('revealed');
    ['emoPosTotal','emoNegTotal','emoNeutralTotal'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—%';});
    ['tagHappySubPct','tagSurprisedSubPct','tagAngrySubPct','tagSadSubPct','tagFearSubPct','tagDisgustSubPct','tagNeutralSubPct','tagHappyPct','tagSurprisedPct','tagAngryPct','tagSadPct','tagFearPct','tagDisgustPct','tagNeutralPct'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—%';});
    document.getElementById('engScoreChip').style.display='none';
    document.getElementById('distEmpty').style.display='flex';
    document.getElementById('distGraphArea').style.display='none';
    document.getElementById('distLegend').style.display='none';
    renderTimeline();
    const ec=document.getElementById('engagePieCanvas');
    if(ec){const ctx=ec.getContext('2d');ctx.clearRect(0,0,ec.width,ec.height);ec._arcs=[];ec._hoverInited=false;}
    initTrendHover();
    sessionStart=Date.now();
    sessionTimer=setInterval(tickTimer,1000);
    document.getElementById('btnStart').disabled=true;
    document.getElementById('btnStop').disabled=false;
    addTimelineEvent('Session started','🎬','start');
    try{const res=await Auth.apiFetch('/sessions/start/',{method:'POST'});const d=await res.json();_sessionId=d.session_id;}
    catch(e){console.warn('[EmotionAI] Session start:',e);}
    scheduleLive();
  }catch(e){
    console.error('[EmotionAI] Camera error:', e);
    document.getElementById('btnStart').disabled=false;
    document.getElementById('btnStop').disabled=true;
    let title='Camera Access Denied';
    let msg='';
    if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError'){
      title='Camera Permission Denied';
      msg='Your browser has blocked camera access.\n\nTo fix this:\n1. Click the camera/lock icon in your browser address bar\n2. Set Camera to "Allow"\n3. Reload the page and try again\n\nIf on Chrome: Settings → Privacy & Security → Site Settings → Camera → Allow this site.';
    }else if(e.name==='NotFoundError'||e.name==='DevicesNotFoundError'){
      title='No Camera Found';
      msg='No camera was detected on your device.\n\nPlease connect a webcam and try again.';
    }else if(e.name==='NotReadableError'||e.name==='TrackStartError'){
      title='Camera In Use';
      msg='Your camera is already being used by another application.\n\nClose other apps using the camera (e.g. Zoom, Teams, other browser tabs) and try again.';
    }else if(location.protocol==='http:'&&location.hostname!=='localhost'){
      title='HTTPS Required';
      msg='Camera access requires a secure (HTTPS) connection.\n\nPlease access this page via HTTPS.';
    }else{
      msg='Could not start the camera: '+e.message+'\n\nPlease check your camera connection and browser permissions, then try again.';
    }
    alert(title+'\n\n'+msg);
  }
}

// ── Session stop ──
async function doStop(){
  if(!isLive)return;
  isLive=false;
  document.getElementById('btnStop').disabled=true;
  document.getElementById('btnStart').disabled=false;
  if(liveInterval){clearTimeout(liveInterval);liveInterval=null;}
  if(sessionTimer){clearInterval(sessionTimer);sessionTimer=null;}
  if(abortCtrl){abortCtrl.abort();abortCtrl=null;}
  detectionInProgress=false;
  const v=document.getElementById('videoEl');
  if(v&&v.srcObject){v.srcObject.getTracks().forEach(t=>t.stop());v.srcObject=null;v.style.display='none';}
  document.getElementById('camIdle').style.display='flex';
  document.getElementById('camFps').style.display='none';
  document.getElementById('camFaceBox').classList.remove('show');
  document.getElementById('camRing').classList.remove('active');
  document.getElementById('camScan').classList.remove('active');
  document.getElementById('camStatusDot').className='cam-status-dot ready';
  document.getElementById('camStatusTxt').textContent='STOPPED';
  document.getElementById('reactionBar').classList.remove('show');
  document.getElementById('navLiveBadge').style.display='none';
  document.getElementById('liveFeedChip').style.display='none';
  document.getElementById('camEmotionPill').classList.remove('show');
  document.getElementById('signalBar')?.classList.remove('show');
  const dur=sessionTime();
  addTimelineEvent(`Session ended — ${dur} total`,'🏁','end');
  // Capture spike summary before clearing
  _lastSpikeSummary=_spikeDetector.summary();
  if(_sessionId){
    try{await Auth.apiFetch('/sessions/end/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:_sessionId,total_frames:_frameCount})});}
    catch(e){console.warn('[EmotionAI] Session end:',e);}
    _sessionId=null;_frameCount=0;_engagementScores=[];
  }
  _broadcast({type:'session_stop'});
}


// ── Session resume (after network restore) ──
async function doResume(){
  try{
    const snap=window.__eaSnapshot;
    const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    const v=document.getElementById('videoEl');v.srcObject=stream;v.style.display='block';
    document.getElementById('camIdle').style.display='none';
    document.getElementById('camFps').style.display='block';
    document.getElementById('camFaceBox').classList.add('show');
    document.getElementById('camRing').classList.add('active');
    document.getElementById('camScan').classList.add('active');
    document.getElementById('camStatusDot').className='cam-status-dot live';
    document.getElementById('camStatusTxt').textContent='LIVE';
    document.getElementById('reactionBar').classList.add('show');
    document.getElementById('liveFeedChip').style.display='flex';
    document.getElementById('navLiveBadge').style.display='flex';

    // Restore all state from snapshot
    if(snap){
      _frameCount=snap._frameCount;
      _engagementScores=snap._engagementScores;
      _sessionId=snap._sessionId;
      engagementScore=snap.engagementScore;
      lastEmotion=snap.lastEmotion;
      totalDetected=snap.totalDetected;
      emotionCounts={...snap.emotionCounts};
      reactionCount=snap.reactionCount;
      peakConf=snap.peakConf;
      lastEmotionKey=snap.lastEmotionKey;
      emotionChangeCooldown=snap.emotionChangeCooldown;
      TREND_HISTORY.length=0;
      snap.TREND_HISTORY.forEach(x=>TREND_HISTORY.push(x));
      timelineEvents=[...snap.timelineEvents];
      _spikeCount=snap._spikeCount;
      _spikeFrames=[...snap._spikeFrames];
      // Restore session timer offset so duration continues from where it left off
      sessionStart=Date.now()-(snap.elapsedMs||0);
    }

    isLive=true;detectionInProgress=false;

    // Restore UI to reflect saved state
    updateEmotionBars();
    updateDominantChips();
    updateSpikeCounter();
    renderTimeline();
    addTimelineEvent('Session resumed — connection restored','🔄','start');

    sessionTimer=setInterval(tickTimer,1000);
    document.getElementById('btnStart').disabled=true;
    document.getElementById('btnStop').disabled=false;

    window.__eaSnapshot=null;
    window.__eaDetectionWasLive=false;
    scheduleLive();
  }catch(e){
    console.error('[EmotionAI] Resume error:',e);
    // Fall back to fresh start if resume fails
    doStart();
  }
}

// ── Init ──
if(typeof Auth!=='undefined'&&!Auth.requireAuth())throw new Error('Not authenticated');
window.addEventListener('load',()=>{
  initTrendHover();
  document.getElementById('sessionChipLabel').textContent=`Session #${_sessionNum}`;
});