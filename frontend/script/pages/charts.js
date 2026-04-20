// ── Trend graph ──
function updateTrendGraph(probs, spikeAtFrame, spikeEmotion){
  const dominantKey=Object.entries(probs).reduce((a,b)=>b[1]>a[1]?b:a,['Neutral',0])[0];
  TREND_HISTORY.push({t:Date.now(),probs:{...probs},isSpike:!!spikeAtFrame,spikeEmotion:spikeEmotion||dominantKey});
  const canvas=document.getElementById('distTrendCanvas');
  if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const container=canvas.parentElement;
  const containerW=container.offsetWidth||400;

  // ── Axis layout — generous padding so labels are never clipped ──
  const Y_AXIS_W = 52;   // wide enough for "100%" with breathing room
  const X_AXIS_H = 32;   // tall enough for tick labels without crowding
  const TITLE_W  = 18;   // rotated Y-title strip
  const TOP_PAD  = 28;   // room for spike triangles above plot area
  const RIGHT_PAD = 16;

  // Total canvas height — fixed so it fills the card nicely
  const H = container.offsetHeight || 180;

  // ── Scroll: canvas grows after ~20 data points ──
  const PX_PER_POINT = Math.max(20, Math.floor(containerW / 20));
  const W = Math.max(containerW, TREND_HISTORY.length * PX_PER_POINT);

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if(TREND_HISTORY.length < 2) return;

  const pad = { l: TITLE_W + Y_AXIS_W, r: RIGHT_PAD, t: TOP_PAD, b: X_AXIS_H };
  const gW = W - pad.l - pad.r;
  const gH = H - pad.t - pad.b;
  const total = TREND_HISTORY.length;

  // ── Y-axis gridlines & labels ──
  const yTicks = [0, 25, 50, 75, 100];
  ctx.font = "11px 'Plus Jakarta Sans', sans-serif";

  yTicks.forEach(v => {
    const y = pad.t + gH - (v / 100) * gH;

    // Gridline
    ctx.beginPath();
    ctx.strokeStyle = v === 0 ? 'rgba(150,150,150,0.30)' : 'rgba(150,150,150,0.10)';
    ctx.lineWidth = 1;
    ctx.setLineDash(v === 0 ? [] : [4, 4]);
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + gW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tick mark on the axis line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(150,150,150,0.35)';
    ctx.lineWidth = 1;
    ctx.moveTo(pad.l - 5, y);
    ctx.lineTo(pad.l, y);
    ctx.stroke();

    // Label — right-aligned, vertically centered on tick
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(110,105,100,0.80)';
    ctx.fillText(v + '%', pad.l - 9, y);
  });

  // ── Left Y-axis spine ──
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(150,150,150,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + gH);
  ctx.stroke();

  // ── Rotated Y-axis title ──
  ctx.save();
  ctx.font = "bold 9px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = 'rgba(140,135,130,0.60)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(TITLE_W / 2, pad.t + gH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Probability (%)', 0, 0);
  ctx.restore();

  // ── X-axis baseline ──
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(150,150,150,0.25)';
  ctx.lineWidth = 1;
  ctx.moveTo(pad.l, pad.t + gH);
  ctx.lineTo(pad.l + gW, pad.t + gH);
  ctx.stroke();

  // ── X-axis time labels ──
  // Limit tick density: one label per ~80px minimum to avoid crowding
  const minTickSpacingPx = 80;
  const maxTicks = Math.max(2, Math.floor(gW / minTickSpacingPx));
  const xTickCount = Math.min(maxTicks, total);

  ctx.font = "10px 'Plus Jakarta Sans', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(110,105,100,0.75)';

  for(let t = 0; t < xTickCount; t++) {
    const frac = xTickCount === 1 ? 0 : t / (xTickCount - 1);
    const idx = Math.round(frac * (total - 1));
    const x = pad.l + (idx / (Math.max(total - 1, 1))) * gW;
    const elapsed = Math.floor((TREND_HISTORY[idx].t - TREND_HISTORY[0].t) / 1000);
    const label = elapsed < 60
      ? elapsed + 's'
      : Math.floor(elapsed / 60) + 'm' + (elapsed % 60 ? (elapsed % 60) + 's' : '');

    // Tick mark
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(150,150,150,0.35)';
    ctx.lineWidth = 1;
    ctx.moveTo(x, pad.t + gH);
    ctx.lineTo(x, pad.t + gH + 5);
    ctx.stroke();

    // Label with comfortable gap below tick
    ctx.fillText(label, x, pad.t + gH + 9);
  }

  // ── Draw emotion lines ──
  PROB_KEYS.forEach(key => {
    const col = TREND_COLORS[key] || '#999';
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    TREND_HISTORY.forEach((d, i) => {
      const x = pad.l + (i / (Math.max(total - 1, 1))) * gW;
      const y = pad.t + gH - (((d.probs[key] || 0) / 100) * gH);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // End dot
    const last = TREND_HISTORY[TREND_HISTORY.length - 1];
    const lx = pad.l + ((total - 1) / (Math.max(total - 1, 1))) * gW;
    const ly = pad.t + gH - (((last.probs[key] || 0) / 100) * gH);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  // ── Spike markers: colored ▼ triangles ──
  const SPIKE_COLOR_MAP = {
    Happiness: '#f59e0b', Neutral: '#6b7280', Sadness: '#3b82f6',
    Anger: '#ef4444', Fear: '#a855f7', Disgust: '#10b981', Surprise: '#ec4899',
    happy: '#f59e0b', neutral: '#6b7280', sad: '#3b82f6',
    angry: '#ef4444', fearful: '#a855f7', disgusted: '#10b981', surprised: '#ec4899'
  };
  TREND_HISTORY.forEach((d, i) => {
    if(!d.isSpike) return;
    const x = pad.l + (i / (Math.max(total - 1, 1))) * gW;
    const tip = pad.t - 4;
    const sz = 5;
    const col = SPIKE_COLOR_MAP[d.spikeEmotion] || 'rgba(220,38,38,0.85)';
    ctx.beginPath();
    ctx.moveTo(x,      tip + sz * 1.5);
    ctx.lineTo(x + sz, tip);
    ctx.lineTo(x - sz, tip);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  });

  canvas._trendW = W;
  canvas._trendH = H;
  canvas._pad = pad;
  canvas._total = total;

  // Auto-scroll to end when near end or at start
  const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 20;
  if(isAtEnd || container.scrollLeft === 0) container.scrollLeft = container.scrollWidth;
}

function initTrendHover(){
  const canvas = document.getElementById('distTrendCanvas');
  const tip = document.getElementById('distHoverTip');
  if(!canvas || !tip) return;
  const wrap = canvas.closest('.dist-graph-wrap');
  canvas.addEventListener('mousemove', e => {
    if(!TREND_HISTORY.length){ tip.classList.remove('show'); return; }
    const rect = canvas.getBoundingClientRect();
    const wrapRect = wrap ? wrap.getBoundingClientRect() : rect;
    const mx = e.clientX - rect.left;
    const pad = canvas._pad || { l: 70, r: 16, t: 28, b: 32 };
    const W = canvas._trendW || rect.width;
    const total = canvas._total || TREND_HISTORY.length;
    const idx = Math.round(((mx - pad.l) / (W - pad.l - pad.r)) * (total - 1));
    const cIdx = Math.max(0, Math.min(total - 1, idx));
    const d = TREND_HISTORY[cIdx];
    if(!d){ tip.classList.remove('show'); return; }
    const top = Object.entries(d.probs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if(!top){ tip.classList.remove('show'); return; }
    const col = TREND_COLORS[top[0]] || '#fff';
    tip.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:5px;vertical-align:middle"></span>${top[0]}: ${top[1]}%`;
    const tipW = tip.offsetWidth || 90;
    const wrapW = wrapRect.width;
    const tipX = e.clientX - wrapRect.left;
    tip.style.left = Math.max(tipW / 2 + 6, Math.min(wrapW - tipW / 2 - 6, tipX)) + 'px';
    tip.style.top = '8px';
    tip.classList.add('show');
  });
  canvas.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

function showDistGraph(){
  document.getElementById('distEmpty').style.display = 'none';
  const ga = document.getElementById('distGraphArea');
  ga.style.display = 'flex';
  ga.style.flexDirection = 'column';
  document.getElementById('distLegend').style.display = 'flex';

  // Inject "Time (elapsed)" DOM label below the scroll container (fixed, not scrollable)
  const wrap = document.querySelector('.dist-graph-canvas-wrap');
  if(wrap && !wrap.nextElementSibling?.classList.contains('dist-x-title')){
    const xTitle = document.createElement('div');
    xTitle.className = 'dist-x-title';
    xTitle.textContent = 'Time (elapsed)';
    xTitle.style.cssText =
      "text-align:center;font-size:9px;font-weight:700;letter-spacing:0.07em;" +
      "text-transform:uppercase;color:rgba(140,135,130,0.58);" +
      "padding:4px 0 2px;font-family:'Plus Jakarta Sans',sans-serif;";
    wrap.insertAdjacentElement('afterend', xTitle);
  }
}

// ── Engagement pie chart ──
function updateEngagePieChart(){
  const canvas = document.getElementById('engagePieCanvas');
  if(!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const size = 160;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);
  const total = Object.values(emotionCounts).reduce((a, b) => a + b, 0) || 1;
  const keys = ['happy', 'neutral', 'surprised', 'sad', 'angry', 'fearful', 'disgusted'];
  const data = keys.map(k => ({ key: k, val: (emotionCounts[k] || 0) / total, color: PIE_COLORS[k] }));
  const cx = size / 2, cy = size / 2, r = 68, inner = 44;
  let startAngle = -Math.PI / 2, dominantKey = null, dominantVal = 0;
  canvas._arcs = [];
  data.forEach(d => {
    if(d.val <= 0) return;
    const sweep = d.val * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.arc(cx, cy, inner, startAngle + sweep, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    canvas._arcs.push({ key: d.key, color: d.color, val: d.val, start: startAngle, end: startAngle + sweep });
    if(d.val > dominantVal){ dominantVal = d.val; dominantKey = d.key; }
    startAngle += sweep;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  ctx.fill();
  canvas._cx = cx; canvas._cy = cy; canvas._r = r; canvas._inner = inner; canvas._dpr = dpr;
  const dc = document.getElementById('engageDominantCenter');
  if(dc && dominantKey) dc.textContent = dominantKey.charAt(0).toUpperCase() + dominantKey.slice(1);
  const LEG_MAP = { happy: 'engLegHappy', neutral: 'engLegNeutral', surprised: 'engLegSurprised', sad: 'engLegSad', angry: 'engLegAngry', fearful: 'engLegFear', disgusted: 'engLegDisgust' };
  Object.values(LEG_MAP).forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('is-dominant'); });
  if(dominantKey && LEG_MAP[dominantKey]){ const el = document.getElementById(LEG_MAP[dominantKey]); if(el) el.classList.add('is-dominant'); }
  if(!canvas._hoverInited){
    canvas._hoverInited = true;
    const tip = document.getElementById('engagePieTip');
    canvas.addEventListener('mousemove', e => {
      if(!canvas._arcs || !canvas._arcs.length){ tip.classList.remove('show'); return; }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const dx = mx - canvas._cx, dy = my - canvas._cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if(dist < canvas._inner || dist > canvas._r){ tip.classList.remove('show'); return; }
      let angle = Math.atan2(dy, dx);
      if(angle < -Math.PI / 2) angle += 2 * Math.PI;
      const hit = canvas._arcs.find(a => angle >= a.start && angle < a.end);
      if(!hit){ tip.classList.remove('show'); return; }
      tip.textContent = `${EMOTION_LABELS[hit.key] || hit.key}: ${Math.round(hit.val * 100)}%`;
      tip.style.left = mx + 'px';
      tip.style.top = my + 'px';
      tip.classList.add('show');
    });
    canvas.addEventListener('mouseleave', () => { if(tip) tip.classList.remove('show'); });
  }
}

function updateEngageLegend(){ updateEngagePieChart(); }