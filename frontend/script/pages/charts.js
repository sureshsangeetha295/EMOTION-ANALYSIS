// ── Draft-key → PROB_KEYS mapping ──
// spikeEmotion is a draftKey: 'happy','neutral','sad','angry','fearful','disgusted','surprised'
// probs keys (PROB_KEYS):     'Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'
var DRAFT_TO_PROB = {
  happy:     'Happiness',
  neutral:   'Neutral',
  sad:       'Sadness',
  angry:     'Anger',
  fearful:   'Fear',
  disgusted: 'Disgust',
  surprised: 'Surprise'
};

function updateTrendGraph(probs, spikeAtFrame, spikeEmotion){
  var dominantKey = Object.entries(probs).reduce(function(a,b){ return b[1]>a[1]?b:a; }, ['Neutral',0])[0];
  TREND_HISTORY.push({
    t: Date.now(),
    probs: Object.assign({}, probs),
    isSpike: !!spikeAtFrame,
    spikeEmotion: spikeEmotion || dominantKey
  });

  var canvas = document.getElementById('distTrendCanvas');
  if(!canvas) return;

  var Y_AXIS_W  = 52, TITLE_W = 18, Y_TOTAL_W = TITLE_W + Y_AXIS_W;
  var X_AXIS_H  = 32, TOP_PAD = 28, RIGHT_PAD = 16;
  var dpr       = window.devicePixelRatio || 1;

  // scrollWrap = .dist-graph-canvas-wrap  (has overflow-x:auto in CSS)
  var scrollWrap = canvas.parentElement;
  var containerW = scrollWrap.offsetWidth  || 400;
  var H          = scrollWrap.offsetHeight || 220;

  // Read scroll state BEFORE resizing (resize invalidates scrollWidth)
  var wasAtEnd = scrollWrap.scrollLeft >= scrollWrap.scrollWidth - scrollWrap.clientWidth - 20;
  var isFirst  = TREND_HISTORY.length <= 2;

  var PX_PER_POINT = Math.max(20, Math.floor(containerW / 20));
  var W = Math.max(containerW, TREND_HISTORY.length * PX_PER_POINT);

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  // ── FIX: Double rAF ensures scrollWidth is recalculated after canvas resize ──
  // Without this, scrollWidth still reflects the OLD canvas width on the first rAF,
  // so scrollLeft never reaches the real end and the graph appears stuck.
  if(wasAtEnd || isFirst){
    var _sw = scrollWrap;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        _sw.scrollLeft = _sw.scrollWidth;
      });
    });
  }

  // Y-axis overlay (lives OUTSIDE scrollWrap in the HTML, position:absolute on .dist-graph-wrap)
  var yCanvas = document.getElementById('distYAxisCanvas');
  if(yCanvas){
    yCanvas.width  = Y_TOTAL_W * dpr;
    yCanvas.height = H * dpr;
    yCanvas.style.width  = Y_TOTAL_W + 'px';
    yCanvas.style.height = H + 'px';
    var yCtx = yCanvas.getContext('2d');
    yCtx.scale(dpr, dpr);
    yCtx.clearRect(0, 0, Y_TOTAL_W, H);
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    yCtx.fillStyle = bg; yCtx.fillRect(0, 0, Y_TOTAL_W, H);
    var gH_y = H - TOP_PAD - X_AXIS_H;
    // Rotated Y-axis title
    yCtx.save();
    yCtx.font="bold 9px 'Plus Jakarta Sans',sans-serif"; yCtx.fillStyle='rgba(140,135,130,0.60)';
    yCtx.textAlign='center'; yCtx.textBaseline='middle';
    yCtx.translate(TITLE_W/2, TOP_PAD+gH_y/2); yCtx.rotate(-Math.PI/2);
    yCtx.fillText('Probability (%)', 0, 0); yCtx.restore();
    // Tick labels
    yCtx.font="11px 'Plus Jakarta Sans',sans-serif";
    [0,25,50,75,100].forEach(function(v){
      var y = TOP_PAD + gH_y - (v/100)*gH_y;
      yCtx.beginPath(); yCtx.strokeStyle='rgba(150,150,150,0.35)'; yCtx.lineWidth=1;
      yCtx.moveTo(Y_TOTAL_W-5,y); yCtx.lineTo(Y_TOTAL_W,y); yCtx.stroke();
      yCtx.textAlign='right'; yCtx.textBaseline = v===0?'bottom':'middle';
      yCtx.fillStyle='rgba(110,105,100,0.80)';
      yCtx.fillText(v+'%', Y_TOTAL_W-9, y);
    });
    // Right spine
    yCtx.beginPath(); yCtx.strokeStyle='rgba(150,150,150,0.25)'; yCtx.lineWidth=1;
    yCtx.moveTo(Y_TOTAL_W,TOP_PAD); yCtx.lineTo(Y_TOTAL_W,TOP_PAD+gH_y); yCtx.stroke();
    // Cover x-axis area so labels don't bleed under y-axis
    yCtx.fillStyle=bg; yCtx.fillRect(0, TOP_PAD+gH_y, Y_TOTAL_W, X_AXIS_H);
  }

  if(TREND_HISTORY.length < 2) return;

  var pad={l:Y_TOTAL_W,r:RIGHT_PAD,t:TOP_PAD,b:X_AXIS_H};
  var gW=W-pad.l-pad.r, gH=H-pad.t-pad.b, total=TREND_HISTORY.length;
  var ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);

  // Gridlines
  [0,25,50,75,100].forEach(function(v){
    var y=pad.t+gH-(v/100)*gH;
    ctx.beginPath(); ctx.strokeStyle=v===0?'rgba(150,150,150,0.30)':'rgba(150,150,150,0.10)';
    ctx.lineWidth=1; ctx.setLineDash(v===0?[]:[4,4]);
    ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+gW,y); ctx.stroke(); ctx.setLineDash([]);
  });

  // Spines
  ctx.beginPath(); ctx.strokeStyle='rgba(150,150,150,0.25)'; ctx.lineWidth=1;
  ctx.moveTo(pad.l,pad.t); ctx.lineTo(pad.l,pad.t+gH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.l,pad.t+gH); ctx.lineTo(pad.l+gW,pad.t+gH); ctx.stroke();

  // X-axis tick labels
  var xTickCount=Math.min(Math.max(2,Math.floor(gW/80)), total);
  ctx.font="10px 'Plus Jakarta Sans',sans-serif"; ctx.textAlign='center';
  ctx.textBaseline='top'; ctx.fillStyle='rgba(110,105,100,0.75)';
  for(var ti=0;ti<xTickCount;ti++){
    var frac=xTickCount===1?0:ti/(xTickCount-1);
    var idx=Math.round(frac*(total-1));
    var x=pad.l+(idx/Math.max(total-1,1))*gW;
    var elapsed=Math.floor((TREND_HISTORY[idx].t-TREND_HISTORY[0].t)/1000);
    var lbl=elapsed<60?elapsed+'s':Math.floor(elapsed/60)+'m'+(elapsed%60?(elapsed%60)+'s':'');
    ctx.beginPath(); ctx.strokeStyle='rgba(150,150,150,0.35)'; ctx.lineWidth=1;
    ctx.moveTo(x,pad.t+gH); ctx.lineTo(x,pad.t+gH+5); ctx.stroke();
    ctx.fillText(lbl, x, pad.t+gH+9);
  }

  // Emotion lines + end-dot
  PROB_KEYS.forEach(function(key){
    var col=TREND_COLORS[key]||'#999';
    ctx.beginPath(); ctx.strokeStyle=col; ctx.lineWidth=1.8; ctx.lineJoin='round'; ctx.lineCap='round';
    TREND_HISTORY.forEach(function(d,i){
      var x=pad.l+(i/Math.max(total-1,1))*gW;
      var y=pad.t+gH-((d.probs[key]||0)/100)*gH;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
    // End dot
    var last=TREND_HISTORY[total-1];
    var lx=pad.l+((total-1)/Math.max(total-1,1))*gW;
    var ly=pad.t+gH-((last.probs[key]||0)/100)*gH;
    ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
  });

  // ── Spike markers ──
  // FIX: spikeEmotion is stored as a draftKey (e.g. 'happy').
  // PROB_KEYS use Title-case full names (e.g. 'Happiness').
  // We must map through DRAFT_TO_PROB before looking up d.probs[probKey].
  var SPIKE_TIP_Y=pad.t-4, SPIKE_SZ=5, spikeHits=[];
  TREND_HISTORY.forEach(function(d,i){
    if(!d.isSpike) return;
    var x=pad.l+(i/Math.max(total-1,1))*gW;

    // Draw red triangle marker above the plot area
    ctx.beginPath();
    ctx.moveTo(x, SPIKE_TIP_Y+SPIKE_SZ*1.5);
    ctx.lineTo(x+SPIKE_SZ, SPIKE_TIP_Y);
    ctx.lineTo(x-SPIKE_SZ, SPIKE_TIP_Y);
    ctx.closePath();
    ctx.fillStyle='rgba(220,38,38,0.85)';
    ctx.globalAlpha=0.9;
    ctx.fill();
    ctx.globalAlpha=1.0;

    // ── Key resolution (3-tier fallback) ──
    var draftRaw = (d.spikeEmotion||'').toLowerCase();

    // Tier 1: exact match via DRAFT_TO_PROB map
    var probKey = DRAFT_TO_PROB[draftRaw];

    // Tier 2: case-insensitive scan of probs keys (handles unexpected spellings)
    if(!probKey || d.probs[probKey] == null){
      var ks = Object.keys(d.probs);
      for(var ki=0; ki<ks.length; ki++){
        if(ks[ki].toLowerCase() === draftRaw){ probKey = ks[ki]; break; }
      }
    }

    // Tier 3: highest-probability key in this frame
    if(!probKey || d.probs[probKey] == null){
      var ks2 = Object.keys(d.probs);
      probKey = ks2.reduce(function(b,k){
        return (d.probs[k]||0) > (d.probs[b]||0) ? k : b;
      }, ks2[0] || 'Neutral');
    }

    var probVal  = d.probs[probKey] != null ? d.probs[probKey] : 0;
    var conf     = Math.round(probVal);
    var prevProb = 0;
    if(i > 0){
      var pd = TREND_HISTORY[i-1].probs;
      prevProb = pd[probKey] != null ? (pd[probKey]||0) : 0;
    }
    var direction = probVal >= prevProb ? 'rise' : 'drop';

    // Human-readable label: prefer EMOTION_LABELS[draftKey], else capitalise probKey
    var displayLabel = (typeof EMOTION_LABELS !== 'undefined' && EMOTION_LABELS[draftRaw])
      ? EMOTION_LABELS[draftRaw]
      : (probKey.charAt(0).toUpperCase() + probKey.slice(1).toLowerCase());

    spikeHits.push({
      x: x,
      y: SPIKE_TIP_Y + SPIKE_SZ * 0.75,
      emotion: displayLabel,
      confidence: conf,
      direction: direction
    });
  });

  // Stash for hover handler
  canvas._spikeHits = spikeHits;
  canvas._trendW    = W;
  canvas._trendH    = H;
  canvas._pad       = pad;
  canvas._total     = total;
}

// ── Hover tooltip for trend graph ──
function initTrendHover(){
  var canvas = document.getElementById('distTrendCanvas');
  var tip    = document.getElementById('distHoverTip');
  if(!canvas || !tip) return;
  var wrap = canvas.closest('.dist-graph-wrap');

  canvas.addEventListener('mousemove', function(e){
    if(!TREND_HISTORY.length){ tip.classList.remove('show'); return; }
    var rect    = canvas.getBoundingClientRect();
    var wrapRect= wrap ? wrap.getBoundingClientRect() : rect;
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var pad   = canvas._pad  || {l:70,r:16,t:28,b:32};
    var W     = canvas._trendW || rect.width;
    var total = canvas._total  || TREND_HISTORY.length;

    // Check spike hit first
    var spikes = canvas._spikeHits || [], HIT_R = 10, spikeHit = null;
    for(var si=0; si<spikes.length; si++){
      var s = spikes[si];
      if(Math.abs(mx-s.x) < HIT_R && Math.abs(my-s.y) < HIT_R){ spikeHit = s; break; }
    }
    if(spikeHit){
      var isRise    = spikeHit.direction === 'rise';
      var dirColor  = isRise ? '#10b981' : '#ef4444';
      tip.innerHTML =
        '<span style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid rgba(220,38,38,0.85);margin-right:6px;vertical-align:middle"></span>' +
        (spikeHit.emotion || 'Spike') + '&nbsp;&nbsp;' +
        '<span style="color:' + dirColor + ';font-weight:700">' + (isRise?'↑':'↓') + '&nbsp;' + (isRise?'Rise':'Drop') + '</span>' +
        '<span style="opacity:0.6">&nbsp;·&nbsp;' + spikeHit.confidence + '%</span>';
      _positionTip(tip, wrapRect, e.clientX);
      tip.classList.add('show');
      return;
    }

    // Dominant emotion at cursor position
    var idx  = Math.round(((mx - pad.l) / (W - pad.l - pad.r)) * (total-1));
    var cIdx = Math.max(0, Math.min(total-1, idx));
    var d    = TREND_HISTORY[cIdx];
    if(!d){ tip.classList.remove('show'); return; }

    var entries = [];
    Object.keys(d.probs).forEach(function(k){ if(d.probs[k]>0) entries.push([k, d.probs[k]]); });
    entries.sort(function(a,b){ return b[1]-a[1]; });
    var top = entries[0];
    if(!top){ tip.classList.remove('show'); return; }

    var col = TREND_COLORS[top[0]] || '#fff';
    tip.innerHTML =
      '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + col + ';margin-right:5px;vertical-align:middle"></span>' +
      top[0] + ': ' + top[1] + '%';
    _positionTip(tip, wrapRect, e.clientX);
    tip.classList.add('show');
  });

  canvas.addEventListener('mouseleave', function(){ tip.classList.remove('show'); });
}

function _positionTip(tip, wrapRect, clientX){
  var tipW = tip.offsetWidth || 110;
  var tipX = clientX - wrapRect.left;
  tip.style.left = Math.max(tipW/2+6, Math.min(wrapRect.width - tipW/2 - 6, tipX)) + 'px';
  tip.style.top  = '8px';
}

// ── Show/hide dist graph area ──
function showDistGraph(){
  document.getElementById('distEmpty').style.display = 'none';
  var ga = document.getElementById('distGraphArea');
  ga.style.display       = 'flex';
  ga.style.flexDirection = 'column';
  document.getElementById('distLegend').style.display = 'flex';
}

// ── Engagement pie chart ──
function updateEngagePieChart(){
  var canvas = document.getElementById('engagePieCanvas');
  if(!canvas) return;
  var dpr = window.devicePixelRatio || 1, size = 160;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  var total = Object.values(emotionCounts).reduce(function(a,b){return a+b;},0) || 1;
  var keys  = ['happy','neutral','surprised','sad','angry','fearful','disgusted'];
  var data  = keys.map(function(k){
    return { key:k, val:(emotionCounts[k]||0)/total, color:PIE_COLORS[k] };
  });

  var cx=size/2, cy=size/2, r=68, inner=44;
  var startAngle = -Math.PI/2;
  var dominantKey = null, dominantVal = 0;
  canvas._arcs = [];

  data.forEach(function(d){
    if(d.val <= 0) return;
    var sweep = d.val * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle+sweep);
    ctx.arc(cx, cy, inner, startAngle+sweep, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    canvas._arcs.push({key:d.key, color:d.color, val:d.val, start:startAngle, end:startAngle+sweep});
    if(d.val > dominantVal){ dominantVal = d.val; dominantKey = d.key; }
    startAngle += sweep;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI*2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  ctx.fill();

  canvas._cx = cx; canvas._cy = cy; canvas._r = r; canvas._inner = inner;

  // Update dominant label in center
  var dc = document.getElementById('engageDominantCenter');
  if(dc && dominantKey) dc.textContent = dominantKey.charAt(0).toUpperCase() + dominantKey.slice(1);

  // Legend dominant highlighting
  var LEG_MAP = {
    happy:'engLegHappy', neutral:'engLegNeutral', surprised:'engLegSurprised',
    sad:'engLegSad', angry:'engLegAngry', fearful:'engLegFear', disgusted:'engLegDisgust'
  };
  Object.values(LEG_MAP).forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.classList.remove('is-dominant');
  });
  if(dominantKey && LEG_MAP[dominantKey]){
    var el2 = document.getElementById(LEG_MAP[dominantKey]);
    if(el2) el2.classList.add('is-dominant');
  }

  // Hover tooltip (init once)
  if(!canvas._hoverInited){
    canvas._hoverInited = true;
    var tip = document.getElementById('engagePieTip');
    canvas.addEventListener('mousemove', function(e){
      if(!canvas._arcs || !canvas._arcs.length){ tip.classList.remove('show'); return; }
      var rect = canvas.getBoundingClientRect();
      var mx   = e.clientX - rect.left, my = e.clientY - rect.top;
      var dx   = mx - canvas._cx,       dy = my - canvas._cy;
      var dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < canvas._inner || dist > canvas._r){ tip.classList.remove('show'); return; }
      var angle = Math.atan2(dy, dx);
      if(angle < -Math.PI/2) angle += 2*Math.PI;
      var hit = null;
      for(var ai=0; ai<canvas._arcs.length; ai++){
        var a = canvas._arcs[ai];
        if(angle >= a.start && angle < a.end){ hit = a; break; }
      }
      if(!hit){ tip.classList.remove('show'); return; }
      tip.textContent = (EMOTION_LABELS[hit.key]||hit.key) + ': ' + Math.round(hit.val*100) + '%';
      tip.style.left = mx + 'px';
      tip.style.top  = my + 'px';
      tip.classList.add('show');
    });
    canvas.addEventListener('mouseleave', function(){ if(tip) tip.classList.remove('show'); });
  }
}

function updateEngageLegend(){ updateEngagePieChart(); }