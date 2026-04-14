}


// ════════════════════════════════════════════
//  ERROR DISPLAY
// ════════════════════════════════════════════

function showError(msg) {
  const bar = document.getElementById('detectionBar');
  if (!bar) return;
  bar.textContent = `⚠ ${msg}`;
  bar.classList.add('visible');
  setTimeout(() => bar.classList.remove('visible'), 3000);
}


// ════════════════════════════════════════════
//  MASTER updateUI
// ════════════════════════════════════════════

function updateUI(probs, top, conf, engagement) {
  const topLower = top?.toLowerCase();
  const engPct   = (engagement != null) ? Math.round(engagement * 100) : null;
  const emoData  = EMOTIONS.find(e => e.label.toLowerCase() === topLower);

  // Ghost overlay elements (safe null-guarded)
  const rdot = document.getElementById('resultDot');
  const remo = document.getElementById('resultEmotion');
  const rcon = document.getElementById('resultConf');
  if (rdot) rdot.style.background = emoData?.color || '#94a3b8';
  if (remo) remo.textContent = top ? (top.charAt(0).toUpperCase() + top.slice(1)) : '—';
  if (rcon) rcon.textContent = top
    ? (engPct != null ? `${conf}% conf · Eng ${engPct}%` : `${conf}% confidence`) : 'No detection yet';

  // Probability bars
  PROB_KEYS.forEach(k => {
    const v        = probs[k] || 0;
    const isActive = k.toLowerCase() === topLower;
    const bar      = document.getElementById(`bar-${k}`);
    const pct      = document.getElementById(`pct-${k}`);
    if (bar) { bar.style.width = v + '%'; bar.className = 'prob-bar-fill' + (isActive ? ' active' : ''); }
    if (pct) { pct.textContent = v + '%'; pct.className = 'prob-pct' + (isActive ? ' active' : ''); }
  });

  // Dominant card
  if (top) {
    const conf2 = probs[emoData ? emoData.label : ''] || conf;
    animateBreakdownCard(top, emoData, conf2);
  }

  // Detection bar flash
  if (top) {
    const bar = document.getElementById('detectionBar');
    if (bar) {
      bar.textContent = engPct != null
        ? `Detected: ${top.charAt(0).toUpperCase() + top.slice(1)} · ${conf}% conf · Engagement ${engPct}%`
        : `Detected: ${top.charAt(0).toUpperCase() + top.slice(1)} · ${conf}% confidence`;
      bar.classList.add('visible');
      clearTimeout(bar._hideTimer);
      bar._hideTimer = setTimeout(() => bar.classList.remove('visible'), 2500);
    }
    const lastEl = document.getElementById('lastDetected');
    if (lastEl) lastEl.textContent = `Last: ${top.charAt(0).toUpperCase() + top.slice(1)}`;
  }

  // ── Dashboard panels (detected emotion, insight, speedometer) ──
  if (top) _updateDashboardPanels(top, conf, engagement);

  // ── Guide steps ──
  const s1 = document.getElementById('step1');
  const s2 = document.getElementById('step2');
  const s3 = document.getElementById('step3');
  const s4 = document.getElementById('step4');
  if (s1) s1.classList.add('done');
  if (s2) s2.classList.add('done');
  if (s3) s3.classList.add('done');
  if (s4) s4.classList.add('active');

  // ── Cam status ──
  const dot = document.getElementById('camStatusDot');
  const txt = document.getElementById('camStatusTxt');
  if (!isLive) {
    if (dot) dot.className = 'cam-status-dot ready';
    if (txt) txt.textContent = 'DETECTED';
  }

  // ── Add to scroll timeline ──
  if (top) {
    const meta  = DETECT_META[top.toLowerCase()];
    const color = meta ? meta.color : '#6b7280';
    const score = _currentEngScore;
    const icon  = score >= 70 ? '😊' : score >= 40 ? '😐' : '😞';
    _addTLScrollItem(meta ? meta.label : top, color, icon);
  }

  // ── Timeline stats ──
  if (top) _updateTimelineStats(conf);
}


// ════════════════════════════════════════════
//  CORE DETECTION RUNNER
// ════════════════════════════════════════════

async function runDetection(fast = true) {
  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();

  try {
    const { probs, emotion, conf, elapsed, engagement } = await callPredict(
      currentAbortController.signal, fast
    );

    if (fast && !isLive) return;

    topEmotion   = emotion;
    currentProbs = probs;
    _frameCount++;

    _engagementScores.push(engagement);
    _sessionTimeline.push({ emotion, engagement, time: Date.now() });

    updateUI(probs, emotion.toLowerCase(), conf, engagement);
    addTimelineDot(emotion.toLowerCase(), engagement);

    // ms badge (ghost element)
    const badge = document.getElementById('msBadge');
    if (badge) { badge.style.display = 'block'; badge.textContent = elapsed + ' ms'; }

  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[EmotionAI] Detection error:', err);
    showError(err.message || 'Detection failed');
  } finally {
    detectionInProgress = false;
  }
}


// ════════════════════════════════════════════
//  SINGLE DETECT BUTTON
// ════════════════════════════════════════════

function doDetect() {
  if (detectionInProgress) return;
  detectionInProgress = true;

  // Scan animation
  const scan = document.getElementById('camScan');
  if (scan) { scan.className = 'cam-scan'; void scan.offsetWidth; scan.className = 'cam-scan active'; }

  // Status
  const dot = document.getElementById('camStatusDot');
  const txt = document.getElementById('camStatusTxt');
  if (dot) dot.className = 'cam-status-dot processing';
  if (txt) txt.textContent = 'SCANNING…';

  runDetection(false);
}


// ════════════════════════════════════════════
//  LIVE MODE
// ════════════════════════════════════════════

function scheduleLiveDetection() {
  liveInterval = setTimeout(async () => {
    if (!isLive) return;
    if (!detectionInProgress) {
      detectionInProgress = true;
      await runDetection(true);
    }
    scheduleLiveDetection();
  }, 300);
}

async function startLive() {
  if (isLive) return;
  isLive = true;
  detectionInProgress  = false;
  _frameCount          = 0;
  _engagementScores    = [];
  _sessionTimeline     = [];
  _currentEngScore     = 0;
  _attentiveTime       = 0;
  _partialTime         = 0;
  _disengagedTime      = 0;
  _detCount            = 0;
  _sessionStart        = Date.now();

  // Reset duration timer
  if (_durationTimer) { clearInterval(_durationTimer); _durationTimer = null; }
  _ensureTimer();

  // UI changes
  document.getElementById('liveTag')?.classList.add('visible');
  document.getElementById('liveBadge')?.classList.add('active');
  document.getElementById('btnGoLive').style.display = 'none';
  document.getElementById('btnStop').style.display   = 'flex';
  document.getElementById('btnDetect').disabled      = true;
  document.getElementById('camBox')?.classList.add('live-active');

  // Status
  const dot = document.getElementById('camStatusDot');
  const txt = document.getElementById('camStatusTxt');
  if (dot) dot.className = 'cam-status-dot live';
  if (txt) txt.textContent = 'LIVE';

  // Scan line
  const scan = document.getElementById('camScan');
  if (scan) scan.classList.add('live');

  // Reaction box
  document.getElementById('reactionBox')?.classList.add('show');

  // Clear and reset session summary
  document.getElementById('endNoteRow')?.classList.remove('show');
  const statA = document.getElementById('statAttentive');
  const statP = document.getElementById('statPartial');
  const statD = document.getElementById('statDisengaged');
  if (statA) statA.textContent = '—';
  if (statP) statP.textContent = '—';
  if (statD) statD.textContent = '—';

  // Clear timeline scroll for new session
  const sc = document.getElementById('timelineScroll');
  if (sc) {
    sc.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'tl-empty'; e.id = 'tlEmpty';
    e.textContent = 'Session started. Monitoring…';
    sc.appendChild(e);
  }
  _addTLScrollItem('Session started', '#16a34a', '🎬');

  // Guide steps
  document.getElementById('step1')?.classList.add('done');
  document.getElementById('step2')?.classList.add('done');
  document.getElementById('step3')?.classList.add('active');

  // Start backend session
  try {
    const res  = await Auth.apiFetch('/sessions/start/', { method: 'POST' });
    const data = await res.json();
    _sessionId = data.session_id;
  } catch (e) {
    console.warn('[EmotionAI] Could not start session:', e);
  }

  scheduleLiveDetection();
}

async function stopLive() {
  if (!isLive) return;
  isLive = false;

  clearTimeout(liveInterval);
  liveInterval = null;
  if (currentAbortController) { currentAbortController.abort(); currentAbortController = null; }
  detectionInProgress = false;

  // UI changes
  document.getElementById('liveTag')?.classList.remove('visible');
  document.getElementById('liveBadge')?.classList.remove('active');
  document.getElementById('btnGoLive').style.display = '';
  document.getElementById('btnStop').style.display   = 'none';
  document.getElementById('btnDetect').disabled      = false;
  document.getElementById('detectionBar')?.classList.remove('visible');
  document.getElementById('camBox')?.classList.remove('live-active');
  document.getElementById('reactionBox')?.classList.remove('show');

  const scan = document.getElementById('camScan');
  if (scan) scan.classList.remove('live');

  // Status
  const dot = document.getElementById('camStatusDot');
  const txt = document.getElementById('camStatusTxt');
  if (dot) dot.className = 'cam-status-dot ready';
  if (txt) txt.textContent = 'STOPPED';

  // Guide
  document.getElementById('step4')?.classList.add('active');

  // Stop timer
  if (_durationTimer) { clearInterval(_durationTimer); _durationTimer = null; }

  // Avg engagement display
  if (_engagementScores.length > 0) {
    const avg = Math.round((_engagementScores.reduce((a,b)=>a+b,0) / _engagementScores.length) * 100);
    const avgEl  = document.getElementById('avgEngDisplay');
    const lastEl = document.getElementById('lastDetected');
    const avgSt  = document.getElementById('tlAvgEng');
    if (avgEl)  avgEl.textContent  = avg + '%';
    if (lastEl) lastEl.textContent = `Avg: ${avg}%`;
    if (avgSt)  avgSt.textContent  = avg + '%';

    // Ghost elements (safe)
    const engFloat  = document.getElementById('engFloat');
    const engNumEl  = document.getElementById('engNum');
    const engPctSuf = document.getElementById('engPctSuffix');
    if (engFloat)  engFloat.classList.add('show');
    if (engPctSuf) engPctSuf.textContent = '%';
    if (engNumEl)  engNumEl.textContent  = avg;
  }

  // End note row
  const total   = _attentiveTime + _partialTime + _disengagedTime || 1;
  const attPct  = Math.round((_attentiveTime / total) * 100);
  const note    = attPct >= 60 ? 'Outstanding session! 🌟'
                : attPct >= 40 ? 'Good effort — keep it up! 💪'
                : 'Keep pushing — every session counts! 🔥';
  const enr = document.getElementById('endNoteRow');
  const ebt = document.getElementById('endBadgeTime');
  const ebn = document.getElementById('endBadgeNote');
  if (ebt) ebt.textContent = _sessionTime();
  if (ebn) ebn.textContent = note;
  if (enr) enr.classList.add('show');

  _addTLScrollItem('Session ended', '#6b7280', '🏁');

  // End backend session
  if (_sessionId) {
    try {
      await Auth.apiFetch('/sessions/end/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: _sessionId, total_frames: _frameCount }),
      });
      const report = await API.getSessionReport(_sessionId);
      console.info('[EmotionAI] Session report:', report);
    } catch (e) {
      console.warn('[EmotionAI] Could not end session / fetch report:', e);
    }
    _sessionId = null;
    _frameCount = 0;
    _engagementScores = [];
    _sessionTimeline  = [];
  }
}

