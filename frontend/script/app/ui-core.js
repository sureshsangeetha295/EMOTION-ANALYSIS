
// ════════════════════════════════════════════
//  BUILD PROBABILITY LIST
// ════════════════════════════════════════════

function buildProbList() {
  const el = document.getElementById('probList');
  if (!el) return;
  el.innerHTML = '';
  PROB_KEYS.forEach(k => {
    const emo = EMOTIONS.find(e => e.label === k);
    const row = document.createElement('div');
    row.className = 'prob-row';
    row.innerHTML = `
      <span class="prob-label">
        <span class="p-icon">${emo ? emo.icon : ''}</span>${k}
      </span>
      <div class="prob-bar-bg"><div class="prob-bar-fill" id="bar-${k}" style="width:0%"></div></div>
      <span class="prob-pct" id="pct-${k}">0%</span>`;
    el.appendChild(row);
  });
}


// ════════════════════════════════════════════
//  SPEEDOMETER
// ════════════════════════════════════════════

function setSpeedometer(score) {
  const angle = (score / 100) * 180 - 90;
  const n = document.getElementById('speedoNeedle');
  if (n) n.style.transform = `rotate(${angle}deg)`;

  const cx = 115, cy = 112, r = 95;
  const sR = Math.PI, eR = Math.PI - (score / 100) * Math.PI;
  const x1 = cx + r * Math.cos(sR), y1 = cy + r * Math.sin(sR);
  const x2 = cx + r * Math.cos(eR), y2 = cy + r * Math.sin(eR);
  const largeArc = score > 50 ? 1 : 0;
  const col = score >= 70 ? '#16a34a' : score >= 40 ? '#ca8a04' : '#dc2626';

  const arc = document.getElementById('speedoArc');
  if (arc) {
    arc.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`);
    arc.setAttribute('stroke', col);
  }

  const sv = document.getElementById('speedoValue');
  const ss = document.getElementById('speedoStatus');
  if (sv) { sv.textContent = score > 0 ? Math.round(score) : '—'; sv.style.color = col; }
  if (ss) ss.textContent = score >= 70 ? '🟢 Actively Listening'
                          : score >= 40 ? '🟡 Partially Engaged'
                          : score > 0   ? '🔴 Low Engagement'
                          : 'Awaiting detection';
}


// ════════════════════════════════════════════
//  DASHBOARD PANELS (detected emotion + insight)
// ════════════════════════════════════════════

function _updateDashboardPanels(top, conf, engagement) {
  const emoLower = (top || '').toLowerCase();
  const meta     = DETECT_META[emoLower];
  const color    = meta ? meta.color : '#6b7280';

  // ── Detected emotion panel ──
  const dn  = document.getElementById('detName');
  const da  = document.getElementById('detAwaitTxt');
  const dc  = document.getElementById('detConf');
  const dcv = document.getElementById('detConfVal');
  const dd  = document.getElementById('detDesc');
  if (dn)  { dn.textContent = meta ? meta.label : (top || 'Awaiting'); dn.style.color = color; }
  if (da)  da.style.display = 'none';
  if (dc)  dc.classList.remove('hidden');
  if (dcv) dcv.textContent = `${conf}% confidence`;
  if (dd)  dd.textContent  = meta ? meta.desc : '';

  // ── Detected avatar mouth ──
  const mouths = {
    happiness: 'M 63 115 Q 75 125 87 115',
    neutral:   'M 63 110 Q 75 112 87 110',
    sadness:   'M 63 115 Q 75 105 87 115',
    anger:     'M 63 113 Q 75 105 87 113',
    fear:      'M 65 112 Q 75 118 85 112',
    disgust:   'M 60 112 Q 68 118 76 112 Q 84 106 90 112',
    surprise:  'M 67 110 Q 75 122 83 110',
  };
  const dm = document.getElementById('detMouth');
  if (dm) dm.setAttribute('d', mouths[emoLower] || mouths.neutral);

  // ── Insight panel ──
  const chip = document.getElementById('insightChip');
  const itxt = document.getElementById('insightText');
  const mbox = document.getElementById('motivateBox');
  if (chip && meta) {
    chip.className   = `insight-chip visible ${meta.chip}`;
    chip.textContent = meta.chipTxt;
  }
  if (itxt && meta) {
    itxt.innerHTML = `<div class="insight-head">${meta.head}</div><span>${meta.tips}</span>`;
  }
  if (mbox && meta) {
    if (meta.motivate) {
      mbox.textContent = meta.motivate;
      mbox.className   = `motivate-box show ${meta.motivateCls}`;
    } else {
      mbox.className = 'motivate-box';
    }
  }

  // ── Speedometer (smooth) ──
  const engVal = engagement != null ? engagement : (ENGAGEMENT_MAP[top] || 0.5);
  _currentEngScore += ((engVal * 100 - _currentEngScore) * 0.4);
  setSpeedometer(_currentEngScore);

  // ── Track attentive / partial / disengaged ──
  const score = _currentEngScore;
  if (score >= 70) _attentiveTime++;
  else if (score >= 40) _partialTime++;
  else _disengagedTime++;

  const totalT = _attentiveTime + _partialTime + _disengagedTime;
  if (totalT > 0) {
    const sa = document.getElementById('statAttentive');
    const sp = document.getElementById('statPartial');
    const sd = document.getElementById('statDisengaged');
    if (sa) sa.textContent = Math.round((_attentiveTime / totalT) * 100) + '%';
    if (sp) sp.textContent = Math.round((_partialTime   / totalT) * 100) + '%';
    if (sd) sd.textContent = Math.round((_disengagedTime/ totalT) * 100) + '%';
  }

  // ── Hide cam idle overlay ──
  const idle = document.getElementById('camIdle');
  if (idle) idle.style.display = 'none';
}


// ════════════════════════════════════════════
//  TIMELINE (new scroll list)
// ════════════════════════════════════════════

function _addTLScrollItem(label, color, icon) {
  const empty = document.getElementById('tlEmpty');
  if (empty) empty.remove();
  const sc = document.getElementById('timelineScroll');
  if (!sc) return;
  const el  = document.createElement('div');
  el.className = 'tl-item';
  const elapsed = _sessionStart ? Date.now() - _sessionStart : 0;
  const s = Math.floor(elapsed / 1000), m = Math.floor(s / 60);
  const ts = `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  el.innerHTML = `<div class="tl-dot" style="background:${color}"></div>
    <div class="tl-time">${ts}</div>
    <div class="tl-msg">${label} detected</div>
    <div class="tl-icon">${icon}</div>`;
  sc.appendChild(el);
  sc.scrollTop = sc.scrollHeight;
}


// ════════════════════════════════════════════
//  TIMELINE CHIPS (original dot row)
// ════════════════════════════════════════════

function addTimelineDot(emotion, engagement) {
  timeline.push({ emotion, engagement: engagement ?? null });

  const container = document.getElementById('timelineDots');
  const tagEl     = document.getElementById('timelineTag');
  if (!container) return;

  const colorMap = {};
  EMOTIONS.forEach(e => { colorMap[e.key] = e.color; });

  container.innerHTML = timeline.map((entry, i) => {
    const e      = entry.emotion;
    const c      = colorMap[e] || '#6b7280';
    const isLast = i === timeline.length - 1;
    const label  = e.charAt(0).toUpperCase() + e.slice(1);
    const engTxt = (entry.engagement != null)
      ? ` · Eng ${Math.round(entry.engagement * 100)}%` : '';
    const connector = i < timeline.length - 1 ? `<div class="tl-connector"></div>` : '';

    if (isLast) {
      return `<div class="tl-chip tl-chip--active"
                   style="border-color:${c};background:${c}22;"
                   title="${label}${engTxt}">
                <div class="tl-chip-dot" style="background:${c};"></div>
                <span class="tl-chip-label" style="color:${c};">${label}</span>
              </div>${connector}`;
    }
    return `<div class="tl-chip tl-chip--done" title="${label}${engTxt}">
              <div class="tl-chip-dot" style="background:${c};opacity:0.7;"></div>
              <span class="tl-chip-label">${e}</span>
            </div>${connector}`;
  }).join('');

  container.scrollLeft = container.scrollWidth;

  if (tagEl) {
    const countMap = {};
    timeline.forEach(entry => { countMap[entry.emotion] = (countMap[entry.emotion] || 0) + 1; });
    const top3 = Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    tagEl.innerHTML = top3.map(([e, n]) => {
      const c = colorMap[e] || '#6b7280';
      return `<span class="tl-summary-chip"
                    style="background:${c}18;border-color:${c}44;color:${c};">
                ${e.charAt(0).toUpperCase() + e.slice(1)} <b>${n}</b>
              </span>`;
    }).join('');
  }
}


// ════════════════════════════════════════════
//  SESSION TIMER
// ════════════════════════════════════════════

function _sessionTime() {
  if (!_sessionStart) return '00:00';
  const s = Math.floor((Date.now() - _sessionStart) / 1000);
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

function _ensureTimer() {
  if (_durationTimer) return;
  _sessionStart = Date.now();
  _durationTimer = setInterval(() => {
    const el = document.getElementById('tlDuration');
    if (el) el.textContent = _sessionTime();
  }, 1000);
}


// ════════════════════════════════════════════
//  TIMELINE STATS
// ════════════════════════════════════════════

function _updateTimelineStats(conf) {
  _detCount++;
  _lastConf = conf;
  _ensureTimer();

  const cEl = document.getElementById('tlDetCount');
  if (cEl) cEl.textContent = _detCount;

  if (_engagementScores.length) {
    const avg    = Math.round(_engagementScores.reduce((a,b)=>a+b,0) / _engagementScores.length * 100);
    const engBar = document.getElementById('tlEngBar');
    const engVal = document.getElementById('tlEngVal');
    const avgEl  = document.getElementById('avgEngDisplay');
    if (engBar) engBar.style.width  = avg + '%';
    if (engVal) engVal.textContent  = avg + '%';
    if (avgEl)  avgEl.textContent   = avg + '%';
    const avgStatEl = document.getElementById('tlAvgEng');
    if (avgStatEl) avgStatEl.textContent = avg + '%';
  }

  const cBar = document.getElementById('tlConfBar');
  const cVal = document.getElementById('tlConfVal');
  if (cBar) cBar.style.width = conf + '%';
  if (cVal) cVal.textContent = conf + '%';

  if (timeline.length) {
    const counts = {};
    timeline.forEach(t => counts[t.emotion] = (counts[t.emotion]||0) + 1);
    const topKey = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const emo    = EMOTIONS.find(e => e.key === topKey);
    const topEl  = document.getElementById('tlTopEmo');
    if (topEl && emo) topEl.textContent = emo.icon + ' ' + emo.label;
  }
}

