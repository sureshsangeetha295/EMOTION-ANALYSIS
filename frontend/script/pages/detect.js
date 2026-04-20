// ══════════════════════════════════════════════════
//  detect.html — Real API (doc 3 logic, doc 6 UI)
// ══════════════════════════════════════════════════

const PROB_LABELS = ['Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'];
const PROB_COLORS = ['#ef4444','#10b981','#8b5cf6','#f59e0b','#6b7280','#3b82f6','#f97316'];
// Map backend labels → EMOTION_META keys
const LABEL_MAP   = {Anger:'Angry',Disgust:'Disgust',Fear:'Fear',Happiness:'Happy',Neutral:'Neutral',Sadness:'Sad',Surprise:'Surprise'};

const EMOTION_META = {
  Happy:   {emoji:'😊',color:'#f59e0b',desc:'Joy is a warm, uplifting feeling of pleasure and contentment — your brain is flooded with dopamine and everything feels possible.',insHead:'Riding the happy wave',insTip:'Channel this energy into your most creative or ambitious task — joy supercharges problem-solving and opens your mind to new ideas.'},
  Neutral: {emoji:'😐',color:'#6b7280',desc:'Neutral is a calm, balanced state — neither pulled toward highs nor lows. Your mind is clear, steady, and ready to process information with precision.',insHead:'Making the most of calm',insTip:'This steady state is your best asset for deep analytical thinking. Tackle something complex or make an important decision — your unbiased mind will serve you well.'},
  Surprise:{emoji:'😲',color:'#f97316',desc:'Surprise is a brief, sharp jolt of attention — your brain snaps to full alertness and curiosity instantly.',insHead:'Harness the attention spike',insTip:'Your brain is at peak receptivity right now. Use this heightened attention to absorb something new — explore the source of your surprise.'},
  Sad:     {emoji:'😢',color:'#3b82f6',desc:'Sadness is a deep emotional ache of loss or disappointment — a natural signal that something meaningful to you has been affected.',insHead:'Navigating through sadness',insTip:'Be gentle with yourself — sadness is valid, not weakness. Take a short break, breathe slowly, and reach out to someone you trust.'},
  Angry:   {emoji:'😠',color:'#ef4444',desc:'Anger is an intense surge of energy triggered by a perceived threat. It sharpens focus but can cloud judgment when left unchecked.',insHead:'Cooling and redirecting anger',insTip:'Step away for two minutes. Try box breathing: in 4 counts, hold 4, out 4, hold 4. Name the feeling — it reduces its power.'},
  Fear:    {emoji:'😨',color:'#8b5cf6',desc:'Fear is your mind\'s protective alarm — it detects uncertainty or threat and floods your body with alertness.',insHead:'Moving through fear',insTip:'Name the fear out loud or write it down — labelling it immediately reduces its intensity. Break your challenge into the smallest next step.'},
  Disgust: {emoji:'🤢',color:'#06b6d4',desc:'Disgust is a strong aversion response — a signal that something conflicts with your values or expectations.',insHead:'Reframing and re-engaging',insTip:'Step back and ask what specifically is triggering this reaction. Try reframing the task in terms of a goal you actually care about.'},
};

const API_URL = '/predict/';
let stream=null,detecting=false,countTimer=null;

// ── Typewriter ──
const IDLE_MSGS=['Position your face in the frame…','Press Start when you\'re ready…','I\'ll capture your emotion in one shot.','Hold still for the countdown…','Your expression tells a story.'];
let twIndex=0,twChar=0,twTimeout=null,twDeleting=false,twRunning=false;
function typewriterTick(){
  const el=document.getElementById('typewriterText');if(!el||!twRunning)return;
  const msg=IDLE_MSGS[twIndex];
  if(!twDeleting){twChar++;el.textContent=msg.slice(0,twChar);if(twChar>=msg.length){twDeleting=true;twTimeout=setTimeout(typewriterTick,2600);}else twTimeout=setTimeout(typewriterTick,52);}
  else{twChar--;el.textContent=msg.slice(0,twChar);if(twChar<=0){twDeleting=false;twIndex=(twIndex+1)%IDLE_MSGS.length;twTimeout=setTimeout(typewriterTick,320);}else twTimeout=setTimeout(typewriterTick,26);}
}
function startTypewriter(){if(twRunning)return;twRunning=true;twChar=0;twDeleting=false;twIndex=0;typewriterTick();}
function stopTypewriter(){twRunning=false;if(twTimeout)clearTimeout(twTimeout);const el=document.getElementById('typewriterText');if(el)el.textContent='';}
function initGreeting(){
  const h=new Date().getHours();
  const gl=document.getElementById('greetingLine');
  if(gl)gl.textContent=h>=5&&h<12?'Good morning! Ready for a detection?':h>=12&&h<17?'Good afternoon! Let\'s read your emotion.':h>=17&&h<21?'Good evening! How are you feeling?':'Hey night owl! Let\'s see your emotion.';
  startTypewriter();
}

// ── Dropdown ──
function toggleLaunchMenu(e){e.stopPropagation();const wrap=document.getElementById('navLaunchWrap');const chev=document.getElementById('launchChevron');const open=wrap.classList.toggle('open');if(chev)chev.style.transform=open?'rotate(180deg)':'rotate(0deg)';}
document.addEventListener('click',function(e){const wrap=document.getElementById('navLaunchWrap');if(wrap&&!wrap.contains(e.target)){wrap.classList.remove('open');const chev=document.getElementById('launchChevron');if(chev)chev.style.transform='rotate(0deg)';}});

// ── Guide steps ──
function setStep(active){for(let i=1;i<=4;i++){const el=document.getElementById('step'+i);if(!el)continue;el.classList.remove('active','done');if(i<active)el.classList.add('done');else if(i===active)el.classList.add('active');}}
function setStatus(txt,state){const dot=document.getElementById('camStatusDot');const label=document.getElementById('camStatusTxt');dot.className='cam-status-dot'+(state?' '+state:'');label.textContent=txt;}

// ── Avatar morphs ──
function morphAvatar(idMouth,idBrowL,idBrowR,emotion){
  const morphs={
    Happy:   {mouth:'M 63 107 Q 75 118 87 107',browL:'M48 71 Q56 69 64 71',browR:'M86 71 Q94 69 102 71'},
    Sad:     {mouth:'M 63 113 Q 75 106 87 113',browL:'M48 74 Q56 71 64 73',browR:'M86 73 Q94 71 102 74'},
    Angry:   {mouth:'M 63 112 Q 75 107 87 112',browL:'M48 73 Q56 68 64 73',browR:'M86 73 Q94 68 102 73'},
    Surprise:{mouth:'M 67 108 Q 75 119 83 108',browL:'M48 69 Q56 65 64 69',browR:'M86 69 Q94 65 102 69'},
    Fear:    {mouth:'M 67 110 Q 75 116 83 110',browL:'M48 70 Q56 66 64 70',browR:'M86 70 Q94 66 102 70'},
    Disgust: {mouth:'M 63 111 Q 75 105 87 111',browL:'M48 74 Q56 69 64 74',browR:'M86 74 Q94 69 102 74'},
    Neutral: {mouth:'M 63 108 Q 75 112 87 108',browL:'M48 72 Q56 69 64 72',browR:'M86 72 Q94 69 102 72'},
  };
  const m=morphs[emotion]||morphs.Neutral;
  const mouth=document.getElementById(idMouth);const browL=document.getElementById(idBrowL);const browR=document.getElementById(idBrowR);
  if(mouth)mouth.setAttribute('d',m.mouth);if(browL)browL.setAttribute('d',m.browL);if(browR)browR.setAttribute('d',m.browR);
}

// ── Donut chart ──
function renderDonut(probs){
  const svg=document.getElementById('pieSvg');if(!svg)return;

  // Ensure probs is valid; fall back to zeros
  const safeProbs=(probs&&typeof probs==='object')?probs:{};
  const vals=PROB_LABELS.map((l,i)=>({label:l,color:PROB_COLORS[i],val:Math.max(0,parseFloat(safeProbs[l])||0)}));
  let total=vals.reduce((s,v)=>s+v.val,0);

  // If all zero, show fallback message and bail
  if(total<=0){
    svg.innerHTML='';
    svg.setAttribute('viewBox','0 0 420 200');
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x','210');t.setAttribute('y','100');t.setAttribute('text-anchor','middle');
    t.setAttribute('dominant-baseline','middle');t.setAttribute('fill','#a8a29e');
    t.setAttribute('font-size','11');t.setAttribute('font-family','Plus Jakarta Sans,sans-serif');
    t.setAttribute('font-style','italic');t.textContent='No distribution data available';
    svg.appendChild(t);return;
  }

  // Normalise to 100
  vals.forEach(v=>v.val=v.val/total*100);
  total=100;

  const VW=420,VH=200;
  const cx=VW/2,cy=VH/2,R=60,INNER=28;
  // Margin reserved for labels on each side
  const SIDE_PAD=72;

  let startAngle=-Math.PI/2;
  const segments=[];
  vals.forEach(v=>{
    const sweep=(v.val/total)*2*Math.PI;
    if(sweep<0.005)return; // skip near-zero slices
    const midAngle=startAngle+sweep/2;
    segments.push({...v,startAngle,sweep,midAngle});
    startAngle+=sweep;
  });

  if(segments.length===0){
    svg.innerHTML='';svg.setAttribute('viewBox',`0 0 ${VW} ${VH}`);
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x',cx);t.setAttribute('y',cy);t.setAttribute('text-anchor','middle');
    t.setAttribute('dominant-baseline','middle');t.setAttribute('fill','#a8a29e');
    t.setAttribute('font-size','11');t.textContent='No data';svg.appendChild(t);return;
  }

  function polar(angle,r){return[cx+r*Math.cos(angle),cy+r*Math.sin(angle)];}

  function slicePath(s){
    const[x1,y1]=polar(s.startAngle,R);
    const[x2,y2]=polar(s.startAngle+s.sweep,R);
    const[ix1,iy1]=polar(s.startAngle,INNER);
    const[ix2,iy2]=polar(s.startAngle+s.sweep,INNER);
    const large=s.sweep>Math.PI?1:0;
    return`M${ix1.toFixed(2)},${iy1.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${INNER},${INNER} 0 ${large},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`;
  }

  svg.innerHTML='';
  svg.setAttribute('viewBox',`0 0 ${VW} ${VH}`);

  // Draw slices
  segments.forEach(s=>{
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',slicePath(s));p.setAttribute('fill',s.color);
    p.setAttribute('stroke','#faf9f7');p.setAttribute('stroke-width','2');
    svg.appendChild(p);
  });

  // Center dominant label
  const top=segments.reduce((a,b)=>a.val>b.val?a:b,segments[0]);
  const ct=document.createElementNS('http://www.w3.org/2000/svg','text');
  ct.setAttribute('x',cx);ct.setAttribute('y',cy-4);ct.setAttribute('text-anchor','middle');
  ct.setAttribute('font-size','9');ct.setAttribute('font-weight','700');
  ct.setAttribute('font-family','Plus Jakarta Sans,sans-serif');ct.setAttribute('fill',top.color);
  ct.textContent=top.label;svg.appendChild(ct);
  const cs=document.createElementNS('http://www.w3.org/2000/svg','text');
  cs.setAttribute('x',cx);cs.setAttribute('y',cy+7);cs.setAttribute('text-anchor','middle');
  cs.setAttribute('font-size','7');cs.setAttribute('font-family','Plus Jakarta Sans,sans-serif');
  cs.setAttribute('fill','#a8a29e');cs.textContent='dominant';svg.appendChild(cs);

  // Outer labels — only >= 5%, strictly contained within viewBox
  const LABEL_R=R+16;const LINE_R=R+5;
  const FONT_SIZE=8;const CHAR_W=5;const LINE_H=10;

  segments.forEach(s=>{
    const pct=Math.round(s.val);if(pct<5)return;
    const labelText=`${s.label} ${pct}%`;
    const approxW=labelText.length*CHAR_W+4;

    const[lx,ly]=polar(s.midAngle,LINE_R);
    const[ex,ey]=polar(s.midAngle,LABEL_R);

    const isRight=Math.cos(s.midAngle)>=0;
    const anchor=isRight?'start':'end';

    // Clamp x so text stays within [SIDE_PAD, VW-SIDE_PAD] area
    let tx=isRight?ex+4:ex-4;
    if(isRight){
      const maxTx=VW-approxW-2;
      if(tx>maxTx)tx=maxTx;
    }else{
      const minTx=approxW+2;
      if(tx<minTx)tx=minTx;
    }

    // Clamp y so text stays within viewBox top/bottom with margin
    const ty=Math.max(LINE_H,Math.min(VH-LINE_H,ey));

    // Leader line
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',lx.toFixed(2));line.setAttribute('y1',ly.toFixed(2));
    line.setAttribute('x2',ex.toFixed(2));line.setAttribute('y2',ty.toFixed(2));
    line.setAttribute('stroke',s.color);line.setAttribute('stroke-width','1');
    svg.appendChild(line);

    // End dot
    const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',ex.toFixed(2));dot.setAttribute('cy',ty.toFixed(2));
    dot.setAttribute('r','1.8');dot.setAttribute('fill',s.color);
    svg.appendChild(dot);

    // Label — use clipPath-safe attributes and constrained x
    const nameEl=document.createElementNS('http://www.w3.org/2000/svg','text');
    nameEl.setAttribute('x',tx.toFixed(2));nameEl.setAttribute('y',(ty+1).toFixed(2));
    nameEl.setAttribute('text-anchor',anchor);
    nameEl.setAttribute('font-size',FONT_SIZE);nameEl.setAttribute('font-weight','700');
    nameEl.setAttribute('font-family','Plus Jakarta Sans,sans-serif');
    nameEl.setAttribute('fill',s.color);
    // overflow:visible is SVG default but set clip explicitly to none
    nameEl.style.overflow='visible';
    nameEl.textContent=labelText;
    svg.appendChild(nameEl);
  });
}

// ── Typewriter result helper ──
function typeText(elementId,text,delay){const el=document.getElementById(elementId);if(!el)return;let i=0;function tick(){el.textContent=text.slice(0,i++);if(i<=text.length)setTimeout(tick,delay||22);}setTimeout(tick,100);}

// ── Show results ──
function showResults(backendEmotion,conf,probs,elapsed){
  // Map backend label to meta key
  const metaKey=LABEL_MAP[backendEmotion]||backendEmotion;
  const meta=EMOTION_META[metaKey]||EMOTION_META['Neutral'];

  morphAvatar('avatarMouth','browL','browR',metaKey);

  // Detected panel
  const detName=document.getElementById('detName');detName.textContent=metaKey;detName.style.color=meta.color;
  document.getElementById('detAwaitTxt').style.display='none';
  const badge=document.getElementById('detConf');badge.classList.remove('hidden');badge.style.background=meta.color+'18';badge.style.borderColor=meta.color+'44';badge.style.color=meta.color;
  document.getElementById('detConfVal').textContent=`${conf}% confidence · ${elapsed}ms`;
  morphAvatar('detMouth','detBrowL','detBrowR',metaKey);
  const descEl=document.getElementById('detDesc');descEl.innerHTML='<span id="detDescTW"></span>';
  typeText('detDescTW',meta.desc,20);

  // Donut
  renderDonut(probs);

  // Insight
  const insightContent=document.getElementById('insightTextContent');
  if(insightContent){insightContent.innerHTML=`<div class="insight-head" style="color:${meta.color}">${meta.insHead}</div><div><span id="insightTW"></span></div>`;typeText('insightTW',meta.insTip,20);}

  // Pulse
  const camBox=document.getElementById('camBox');camBox.classList.add('pulsing');setTimeout(()=>camBox.classList.remove('pulsing'),1000);
}

// ── Capture frame ──
function captureFrameBlob(){
  const v=document.getElementById('videoEl');
  const canvas=document.getElementById('captureCanvas');
  canvas.width=v.videoWidth||640;canvas.height=v.videoHeight||480;
  canvas.getContext('2d').drawImage(v,0,0);
  const dataURL=canvas.toDataURL('image/jpeg',0.92);
  const arr=dataURL.split(','),mime=arr[0].match(/:(.*?);/)[1],b64=atob(arr[1]);
  const buf=new Uint8Array(b64.length);for(let i=0;i<b64.length;i++)buf[i]=b64.charCodeAt(i);
  return new Blob([buf],{type:mime});
}

// ── Call API (real) ──
async function callPredict(blob){
  const PROB_KEYS=['Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'];
  const t0=performance.now();
  const form=new FormData();form.append('file',blob,'frame.jpg');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  const fetchFn=(typeof Auth!=='undefined'&&Auth.apiFetch)?Auth.apiFetch.bind(Auth):fetch;
  const res=await fetchFn(API_URL,{method:'POST',body:form,signal:controller.signal});
  clearTimeout(timer);
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.message||`HTTP ${res.status}`);}
  const data=await res.json();
  const elapsed=Math.round(performance.now()-t0);
  // Build probs from all_probabilities array
  const probs={};
  PROB_KEYS.forEach((k,i)=>{const raw=data.all_probabilities?.[i]??0;probs[k]=Math.round((raw>1?raw:raw*100));});
  const total=Object.values(probs).reduce((a,b)=>a+b,0);
  if(total>0)PROB_KEYS.forEach(k=>probs[k]=Math.round(probs[k]/total*100));
  const emotion=data.emotion;
  const conf=Math.round(data.confidence>1?data.confidence:data.confidence*100);
  return{emotion,conf,probs,elapsed};
}

// ── Countdown ──
function runCountdown(seconds){
  return new Promise(resolve=>{
    const overlay=document.getElementById('countdownOverlay');const numEl=document.getElementById('countdownNum');
    let n=seconds;overlay.classList.add('show');numEl.textContent=n;
    function tick(){n--;if(n<=0){overlay.classList.remove('show');resolve();return;}numEl.textContent=n;numEl.style.animation='none';void numEl.offsetHeight;numEl.style.animation='';countTimer=setTimeout(tick,1000);}
    countTimer=setTimeout(tick,1000);
  });
}

// ── START ──
async function doStart(){
  if(detecting)return;detecting=true;stopTypewriter();
  const btnStart=document.getElementById('btnStart');btnStart.disabled=true;
  setStep(1);
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'}});
    const v=document.getElementById('videoEl');v.srcObject=stream;await v.play();v.style.display='block';
    document.getElementById('camIdle').style.display='none';
    setStatus('LIVE','ready');setStep(2);
    await runCountdown(3);setStep(3);
    const blob=captureFrameBlob();
    stream.getTracks().forEach(t=>t.stop());stream=null;v.style.display='none';
    const imgEl=document.getElementById('captureImg');imgEl.src=URL.createObjectURL(blob);imgEl.style.display='block';
    document.getElementById('camScan').classList.add('active');
    document.getElementById('processOverlay').classList.add('show');
    setStatus('ANALYZING','processing');
    const{emotion,conf,probs,elapsed}=await callPredict(blob);
    await new Promise(r=>setTimeout(r,400));
    document.getElementById('processOverlay').classList.remove('show');
    document.getElementById('camScan').classList.remove('active');
    showResults(emotion,conf,probs,elapsed);
    setStep(4);setStatus('DONE','ready');
  }catch(err){
    document.getElementById('processOverlay').classList.remove('show');
    if(err.name==='NotAllowedError'){alert('Camera access denied. Please allow camera permission and try again.');}
    setStatus('ERROR','');
  }finally{detecting=false;}
}

// ── RESET ──
function doRefresh(){
  detecting=false;if(countTimer)clearTimeout(countTimer);
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  document.getElementById('videoEl').style.display='none';document.getElementById('videoEl').srcObject=null;
  document.getElementById('captureImg').style.display='none';document.getElementById('captureImg').src='';
  document.getElementById('camIdle').style.display='flex';
  document.getElementById('countdownOverlay').classList.remove('show');
  document.getElementById('processOverlay').classList.remove('show');
  document.getElementById('camScan').classList.remove('active');
  document.getElementById('camBox').classList.remove('pulsing');
  // Reset avatar
  ['avatarMouth','browL','browR'].forEach((id,i)=>{const el=document.getElementById(id);if(el){const defaults=['M 63 108 Q 75 115 87 108','M48 72 Q56 69 64 72','M86 72 Q94 69 102 72'];el.setAttribute('d',defaults[i]);}});
  setStatus('READY','');
  // Reset detected panel
  document.getElementById('detName').textContent='Awaiting';document.getElementById('detName').style.color='';
  document.getElementById('detAwaitTxt').style.display='';document.getElementById('detConf').classList.add('hidden');document.getElementById('detDesc').textContent='';
  ['detMouth','detBrowL','detBrowR'].forEach((id,i)=>{const el=document.getElementById(id);if(el){const defaults=['M 63 108 Q 75 115 87 108','M48 72 Q56 69 64 72','M86 72 Q94 69 102 72'];el.setAttribute('d',defaults[i]);}});
  // Reset donut
  const pieSvg=document.getElementById('pieSvg');if(pieSvg){pieSvg.setAttribute('viewBox','0 0 420 200');pieSvg.innerHTML='<text x="210" y="100" text-anchor="middle" dominant-baseline="middle" fill="#a8a29e" font-size="11" font-family="Plus Jakarta Sans,sans-serif" font-style="italic">Run detection to see distribution</text>';}
  // Reset insight
  const itc=document.getElementById('insightTextContent');if(itc)itc.innerHTML='<span class="insight-awaiting">Awaiting detection…</span>';
  setStep(1);btnStart.disabled=false;initGreeting();
}
// Fix doRefresh btnStart ref
const btnStart=document.getElementById('btnStart');

// ── Keyboard shortcuts ──
document.addEventListener('keydown',function(e){if(e.code==='Space'&&!e.target.matches('input,textarea,button')){e.preventDefault();if(!detecting)doStart();}if(e.code==='KeyR'&&!e.target.matches('input,textarea'))doRefresh();});

// ── Auth & Init ──
if(typeof Auth!=='undefined'){if(!Auth.requireAuth())throw new Error('Not authenticated');const _user=Auth.getUser();const _userEl=document.getElementById('topbarUser');if(_userEl&&_user)_userEl.textContent=_user.username||_user.email||'';}
window.addEventListener('load',initGreeting);

(function(){
  var btn=document.getElementById('hamburgerBtn');
  var closeBtn=document.getElementById('drawerCloseBtn');
  var drawer=document.getElementById('mobileDrawer');
  var overlay=document.getElementById('mobileOverlay');
  if(!btn)return;
  function openD(){btn.classList.add('open');if(drawer){drawer.classList.add('open');}if(overlay)overlay.classList.add('open');btn.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
  function closeD(){btn.classList.remove('open');if(drawer){drawer.classList.remove('open');}if(overlay)overlay.classList.remove('open');btn.setAttribute('aria-expanded','false');document.body.style.overflow='';}
  window.closeDrawer=closeD;
  btn.addEventListener('click',function(){btn.classList.contains('open')?closeD():openD();});
  if(closeBtn)closeBtn.addEventListener('click',closeD);
  if(overlay)overlay.addEventListener('click',closeD);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeD();});
  if(drawer)drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeD);});
})();