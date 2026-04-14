// ── Trend graph ──
function updateTrendGraph(probs){
  TREND_HISTORY.push({t:Date.now(),probs:{...probs}});
  const canvas=document.getElementById('distTrendCanvas');
  if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const container=canvas.parentElement;
  const containerW=container.offsetWidth||400;
  const H=container.offsetHeight||160;
  const PX_PER_POINT=Math.max(8,Math.floor(containerW/TREND_MAX));
  const W=Math.max(containerW,TREND_HISTORY.length*PX_PER_POINT);
  canvas.width=W*dpr;canvas.height=H*dpr;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);ctx.clearRect(0,0,W,H);
  if(TREND_HISTORY.length<2)return;
  const pad={l:6,r:6,t:6,b:6};
  const gW=W-pad.l-pad.r,gH=H-pad.t-pad.b;
  const total=TREND_HISTORY.length;
  PROB_KEYS.forEach(key=>{
    const col=TREND_COLORS[key]||'#999';
    ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.lineCap='round';
    TREND_HISTORY.forEach((d,i)=>{
      const x=pad.l+(i/(Math.max(total-1,1)))*gW;
      const y=pad.t+gH-(((d.probs[key]||0)/100)*gH);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
    const last=TREND_HISTORY[TREND_HISTORY.length-1];
    const lx=pad.l+((total-1)/(Math.max(total-1,1)))*gW;
    const ly=pad.t+gH-(((last.probs[key]||0)/100)*gH);
    ctx.beginPath();ctx.arc(lx,ly,2.5,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();
  });
  canvas._trendW=W;canvas._trendH=H;canvas._pad=pad;canvas._total=total;
  const isAtEnd=container.scrollLeft>=container.scrollWidth-container.clientWidth-20;
  if(isAtEnd||container.scrollLeft===0)container.scrollLeft=container.scrollWidth;
}

function initTrendHover(){
  const canvas=document.getElementById('distTrendCanvas');
  const tip=document.getElementById('distHoverTip');
  if(!canvas||!tip)return;
  const wrap=canvas.closest('.dist-graph-wrap');
  canvas.addEventListener('mousemove',e=>{
    if(!TREND_HISTORY.length){tip.classList.remove('show');return;}
    const rect=canvas.getBoundingClientRect();
    const wrapRect=wrap?wrap.getBoundingClientRect():rect;
    const mx=e.clientX-rect.left;
    const pad=canvas._pad||{l:6,r:6,t:6,b:6};
    const W=canvas._trendW||rect.width;
    const total=canvas._total||TREND_HISTORY.length;
    const idx=Math.round(((mx-pad.l)/(W-pad.l-pad.r))*(total-1));
    const cIdx=Math.max(0,Math.min(total-1,idx));
    const d=TREND_HISTORY[cIdx];
    if(!d){tip.classList.remove('show');return;}
    const top=Object.entries(d.probs).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1])[0];
    if(!top){tip.classList.remove('show');return;}
    const col=TREND_COLORS[top[0]]||'#fff';
    tip.innerHTML=`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:5px;vertical-align:middle"></span>${top[0]}: ${top[1]}%`;
    const tipW=tip.offsetWidth||90;
    const wrapW=wrapRect.width;
    const tipX=e.clientX-wrapRect.left;
    tip.style.left=Math.max(tipW/2+6,Math.min(wrapW-tipW/2-6,tipX))+'px';
    tip.style.top='8px';
    tip.classList.add('show');
  });
  canvas.addEventListener('mouseleave',()=>tip.classList.remove('show'));
}

function showDistGraph(){
  document.getElementById('distEmpty').style.display='none';
  const ga=document.getElementById('distGraphArea');
  ga.style.display='flex';ga.style.flexDirection='column';
  document.getElementById('distLegend').style.display='flex';
}

// ── Engagement pie chart ──
function updateEngagePieChart(){
  const canvas=document.getElementById('engagePieCanvas');
  if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const size=160;
  canvas.width=size*dpr;canvas.height=size*dpr;
  canvas.style.width=size+'px';canvas.style.height=size+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);ctx.clearRect(0,0,size,size);
  const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const keys=['happy','neutral','surprised','sad','angry','fearful','disgusted'];
  const data=keys.map(k=>({key:k,val:(emotionCounts[k]||0)/total,color:PIE_COLORS[k]}));
  const cx=size/2,cy=size/2,r=68,inner=44;
  let startAngle=-Math.PI/2,dominantKey=null,dominantVal=0;
  canvas._arcs=[];
  data.forEach(d=>{
    if(d.val<=0)return;
    const sweep=d.val*2*Math.PI;
    ctx.beginPath();ctx.arc(cx,cy,r,startAngle,startAngle+sweep);
    ctx.arc(cx,cy,inner,startAngle+sweep,startAngle,true);
    ctx.closePath();ctx.fillStyle=d.color;ctx.fill();
    canvas._arcs.push({key:d.key,color:d.color,val:d.val,start:startAngle,end:startAngle+sweep});
    if(d.val>dominantVal){dominantVal=d.val;dominantKey=d.key;}
    startAngle+=sweep;
  });
  ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);
  ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()||'#fff';
  ctx.fill();
  canvas._cx=cx;canvas._cy=cy;canvas._r=r;canvas._inner=inner;canvas._dpr=dpr;
  const dc=document.getElementById('engageDominantCenter');
  if(dc&&dominantKey)dc.textContent=dominantKey.charAt(0).toUpperCase()+dominantKey.slice(1);
  const LEG_MAP={happy:'engLegHappy',neutral:'engLegNeutral',surprised:'engLegSurprised',sad:'engLegSad',angry:'engLegAngry',fearful:'engLegFear',disgusted:'engLegDisgust'};
  Object.values(LEG_MAP).forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('is-dominant');});
  if(dominantKey&&LEG_MAP[dominantKey]){const el=document.getElementById(LEG_MAP[dominantKey]);if(el)el.classList.add('is-dominant');}
  if(!canvas._hoverInited){
    canvas._hoverInited=true;
    const tip=document.getElementById('engagePieTip');
    canvas.addEventListener('mousemove',e=>{
      if(!canvas._arcs||!canvas._arcs.length){tip.classList.remove('show');return;}
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left,my=e.clientY-rect.top;
      const dx=mx-canvas._cx,dy=my-canvas._cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<canvas._inner||dist>canvas._r){tip.classList.remove('show');return;}
      let angle=Math.atan2(dy,dx);
      if(angle<-Math.PI/2)angle+=2*Math.PI;
      const hit=canvas._arcs.find(a=>angle>=a.start&&angle<a.end);
      if(!hit){tip.classList.remove('show');return;}
      tip.textContent=`${EMOTION_LABELS[hit.key]||hit.key}: ${Math.round(hit.val*100)}%`;
      tip.style.left=mx+'px';tip.style.top=my+'px';
      tip.classList.add('show');
    });
    canvas.addEventListener('mouseleave',()=>{if(tip)tip.classList.remove('show');});
  }
}

function updateEngageLegend(){updateEngagePieChart();}