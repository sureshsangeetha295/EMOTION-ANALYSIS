// ── multiuser.js ─────────────────────────────────────────────────────────────
// Multi-face live detection page.
// Architecture mirrors pages/livecam.js but sends frames to /predict-multi/
// and renders one card per detected face instead of a single engagement view.
//
// Backend contract  (/predict-multi/)
// ─────────────────────────────────────────────────────────────────────────────
// POST  multipart/form-data  { file: blob }
// Query params: fast=true | save=false | session_id=<str>
// Response:
//   {
//     session_id : str,
//     user_id    : int,
//     face_count : int,
//     faces: [{
//       face_index        : int,
//       bbox              : { x, y, w, h },
//       emotion           : str,          // "Happiness" | "Neutral" | …
//       confidence        : float,        // 0-1
//       all_probabilities : float[7],     // aligned with PROB_KEYS
//       engagement        : float,        // 0-1
//       timestamp         : str
//     }]
//   }
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const MU_PROB_KEYS    = ['Anger','Disgust','Fear','Happiness','Neutral','Sadness','Surprise'];
const MU_API_URL      = '/predict-multi/';
const MU_INTERVAL_MS  = 400;            // poll cadence (ms) — slightly relaxed vs single-user
const MU_MAX_FACES    = 12;             // hard cap on rendered cards

// Backend emotion labels → display labels / colours
const MU_BACKEND_TO_KEY = {
  happiness : 'happy',
  neutral   : 'neutral',
  sadness   : 'sad',
  anger     : 'angry',
  fear      : 'fearful',
  disgust   : 'disgusted',
  surprise  : 'surprised',
};

const MU_EMOTION_LABELS = {
  happy     : 'Happy',
  neutral   : 'Neutral',
  sad       : 'Sad',
  angry     : 'Angry',
  fearful   : 'Fear',
  disgusted : 'Disgust',
  surprised : 'Surprised',
};

const MU_EMOTION_EMOJIS = {
  happy     : '😊',
  neutral   : '😐',
  sad       : '😞',
  angry     : '😠',
  fearful   : '😨',
  disgusted : '🤢',
  surprised : '😲',
};

const MU_EMOTION_COLORS = {
  happy     : '#f59e0b',
  neutral   : '#6b7280',
  sad       : '#3b82f6',
  angry     : '#ef4444',
  fearful   : '#a855f7',
  disgusted : '#10b981',
  surprised : '#ec4899',
};

const MU_ENGAGEMENT_MAP = {
  Happiness : 0.90,
  Surprise  : 0.75,
  Neutral   : 0.60,
  Sadness   : 0.25,
  Fear      : 0.30,
  Anger     : 0.20,
  Disgust   : 0.10,
};

// ── Per-face EMA tracker ──────────────────────────────────────────────────────
// Mirrors the adaptive-alpha logic from livecam.js so engagement curves
// match what the single-user page produces for the same inputs.
class FaceEngagementTracker {
  constructor () {
    this.ema   = null;
    this.total = 0;
  }

  _alpha (conf, score) {
    const confNorm  = Math.min(1, Math.max(0, conf / 100));
    const intensity = Math.abs(score - 50) / 50;
    return Math.min(0.30, 0.08 + confNorm * 0.12 + intensity * 0.10);
  }

  /** conf: 0-100, score: 0-100 (engagement × 100) */
  update (conf, score) {
    if (this.total === 0) {
      this.ema = score;
    } else {
      const a  = this._alpha(conf, score);
      this.ema = this.ema + (score - this.ema) * a;
    }
    this.total++;
    return this.ema;
  }

  reset () { this.ema = null; this.total = 0; }
}

// ── BroadcastChannel — push live room data to any listening tab ───────────────
const _muChannel = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('emotionai_multiuser_live')
  : null;

function _muBroadcast (msg) {
  try { if (_muChannel) _muChannel.postMessage(msg); } catch (_) {}
}

// ── Module state ──────────────────────────────────────────────────────────────
let mu_isLive          = false;
let mu_liveTimeout     = null;
let mu_abortCtrl       = null;
let mu_detecting       = false;
let mu_sessionId       = null;
let mu_frameCount      = 0;
let mu_sessionStart    = null;
let mu_sessionTimer    = null;
let mu_sessionNum      = Math.floor(Math.random() * 20) + 1;

// Per-face state keyed by face_index (integer)
// Each entry: { tracker: FaceEngagementTracker, counts: {}, ema: 0, totalFrames: 0 }
const mu_faceState = new Map();

// Room-level aggregates (recalculated each render pass)
let mu_roomEngagement  = 0;   // average EMA across all active faces
let mu_roomFaceCount   = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function mu_fmtTime (ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function mu_sessionTime () {
  return mu_sessionStart ? mu_fmtTime(Date.now() - mu_sessionStart) : '0:00';
}

function mu_setText (id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function mu_engageTier (score) {
  if (score >= 70) return { label: 'Active',   color: '#16a34a' };
  if (score >= 40) return { label: 'Moderate', color: '#ca8a04' };
  return                  { label: 'Inactive', color: '#dc2626' };
}

// ── Camera capture ────────────────────────────────────────────────────────────
function mu_captureFrame (quality = 0.75) {
  return new Promise((resolve, reject) => {
    const video = document.getElementById('mu_videoEl');
    if (!video || !video.srcObject) return reject(new Error('No stream'));
    const canvas = document.createElement('canvas');
    canvas.width  = 640;   // wider canvas to capture more faces
    canvas.height = 480;
    canvas.getContext('2d').drawImage(video, 0, 0, 640, 480);
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      'image/jpeg',
      quality
    );
  });
}

// ── API call ──────────────────────────────────────────────────────────────────
async function mu_callPredictMulti (signal) {
  const blob   = await mu_captureFrame(0.75);
  const form   = new FormData();
  form.append('file', blob, 'frame.jpg');

  const sidParam = mu_sessionId ? `&session_id=${encodeURIComponent(mu_sessionId)}` : '';
  const url      = `${MU_API_URL}?fast=true&save=false${sidParam}`;

  const res = await Auth.apiFetch(url, { method: 'POST', body: form, signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  const data = await res.json();

  // Normalise probabilities 0-100 per face
  const faces = (data.faces || []).slice(0, MU_MAX_FACES).map(face => {
    const rawProbs = face.all_probabilities || [];
    const probs    = {};
    MU_PROB_KEYS.forEach((k, i) => {
      const raw = rawProbs[i] ?? 0;
      probs[k]  = Math.round((raw > 1 ? raw : raw * 100));
    });
    const total = Object.values(probs).reduce((a, b) => a + b, 0);
    if (total > 0) MU_PROB_KEYS.forEach(k => probs[k] = Math.round(probs[k] / total * 100));

    const conf       = Math.round(face.confidence > 1 ? face.confidence : face.confidence * 100);
    const backendKey = (face.emotion || 'Neutral').toLowerCase();
    const draftKey   = MU_BACKEND_TO_KEY[backendKey] || 'neutral';
    const engagement = face.engagement != null
      ? face.engagement
      : (MU_ENGAGEMENT_MAP[face.emotion] ?? 0.5);

    return {
      face_index : face.face_index,
      bbox       : face.bbox,
      draftKey,
      emotion    : face.emotion,
      conf,
      engagement,   // 0-1 from backend
      probs,
    };
  });

  return { faces, session_id: data.session_id, face_count: data.face_count };
}

// ── Apply one detection round ─────────────────────────────────────────────────
function mu_applyDetection (faces) {
  mu_frameCount++;

  // Retire faces that disappeared this frame
  const activeFaceIndexes = new Set(faces.map(f => f.face_index));
  for (const [idx] of mu_faceState) {
    if (!activeFaceIndexes.has(idx)) {
      // Face left the frame — keep state for up to 10 frames then evict
      const fs = mu_faceState.get(idx);
      fs.missingFrames = (fs.missingFrames || 0) + 1;
      if (fs.missingFrames > 10) mu_faceState.delete(idx);
    }
  }

  // Update per-face state
  for (const face of faces) {
    const idx       = face.face_index;
    const score     = face.engagement * 100;    // 0-100

    if (!mu_faceState.has(idx)) {
      mu_faceState.set(idx, {
        tracker      : new FaceEngagementTracker(),
        counts       : {},
        ema          : 0,
        totalFrames  : 0,
        missingFrames: 0,
        lastDraftKey : null,
      });
    }

    const fs         = mu_faceState.get(idx);
    fs.missingFrames = 0;
    fs.ema           = fs.tracker.update(face.conf, score);
    fs.totalFrames++;
    fs.counts[face.draftKey] = (fs.counts[face.draftKey] || 0) + 1;
    fs.lastDraftKey          = face.draftKey;
    fs.lastConf              = face.conf;
    fs.lastBbox              = face.bbox;
    fs.lastProbs             = face.probs;
  }

  // Room-level aggregates
  const activeFaces  = faces.length;
  mu_roomFaceCount   = activeFaces;

  const emasAll = [...mu_faceState.values()]
    .filter(fs => fs.missingFrames === 0)
    .map(fs => fs.ema);
  mu_roomEngagement  = emasAll.length
    ? emasAll.reduce((a, b) => a + b, 0) / emasAll.length
    : 0;

  // Render
  mu_renderGrid(faces);
  mu_updateRoomStats();
  mu_updateRoomEngagementBar();

  // Broadcast to any listening tab
  _muBroadcast({
    type          : 'mu_detection',
    faceCount     : activeFaces,
    roomEngagement: mu_roomEngagement,
    sessionTime   : mu_sessionTime(),
    frameCount    : mu_frameCount,
    faces         : faces.map(f => ({
      face_index : f.face_index,
      draftKey   : f.draftKey,
      conf       : f.conf,
      ema        : mu_faceState.get(f.face_index)?.ema ?? 0,
    })),
  });
}

// ── Grid renderer ─────────────────────────────────────────────────────────────
// Renders one card per active face into #mu_faceGrid.
// Cards are keyed by face_index so they update in-place without flicker.
function mu_renderGrid (faces) {
  const grid = document.getElementById('mu_faceGrid');
  if (!grid) return;

  // Remove cards for faces that have fully left
  const activeSet = new Set(faces.map(f => f.face_index));
  grid.querySelectorAll('.mu-face-card').forEach(card => {
    const fi = parseInt(card.dataset.faceIndex, 10);
    if (!activeSet.has(fi)) card.remove();
  });

  if (faces.length === 0) {
    // Show empty state if no faces
    if (!grid.querySelector('.mu-empty-state')) {
      grid.innerHTML = '<div class="mu-empty-state">👁️ No faces detected — make sure participants have their cameras on.</div>';
    }
    return;
  }

  // Remove empty state if present
  const emptyEl = grid.querySelector('.mu-empty-state');
  if (emptyEl) emptyEl.remove();

  for (const face of faces) {
    const fi       = face.face_index;
    const fs       = mu_faceState.get(fi);
    const ema      = Math.round(fs?.ema ?? 0);
    const tier     = mu_engageTier(ema);
    const color    = MU_EMOTION_COLORS[face.draftKey] || '#6b7280';
    const label    = MU_EMOTION_LABELS[face.draftKey] || face.draftKey;
    const emoji    = MU_EMOTION_EMOJIS[face.draftKey] || '🔍';
    const dominant = mu_dominantEmotion(fs?.counts || {});

    let card = grid.querySelector(`.mu-face-card[data-face-index="${fi}"]`);

    if (!card) {
      // Create new card
      card = document.createElement('div');
      card.className          = 'mu-face-card';
      card.dataset.faceIndex  = fi;
      card.innerHTML          = mu_cardTemplate(fi);
      grid.appendChild(card);
    }

    // Update card fields
    const set = (sel, val) => {
      const el = card.querySelector(sel);
      if (el) el.textContent = val;
    };
    const setStyle = (sel, prop, val) => {
      const el = card.querySelector(sel);
      if (el) el.style[prop] = val;
    };

    set('.mu-card-face-label',    `Face ${fi + 1}`);
    set('.mu-card-emotion-name',  `${emoji} ${label}`);
    set('.mu-card-conf',          `${face.conf}%`);
    set('.mu-card-ema',           ema);
    set('.mu-card-tier',          tier.label);
    set('.mu-card-dominant',      dominant.label ? `${dominant.emoji} ${dominant.label}` : '—');
    set('.mu-card-frames',        fs?.totalFrames ?? 0);

    setStyle('.mu-card-emotion-name',  'color', color);
    setStyle('.mu-card-tier',          'color', tier.color);
    setStyle('.mu-card-ema-fill',      'width', `${Math.min(100, ema)}%`);
    setStyle('.mu-card-ema-fill',      'background', tier.color);
    setStyle('.mu-card-accent-bar',    'background', color);

    // Mini probability bars
    mu_updateMiniProbs(card, face.probs);
  }
}

function mu_cardTemplate (fi) {
  return `
    <div class="mu-card-accent-bar"></div>
    <div class="mu-card-header">
      <span class="mu-card-face-label">Face ${fi + 1}</span>
      <span class="mu-card-frames-label">Frames: <span class="mu-card-frames">0</span></span>
    </div>
    <div class="mu-card-emotion-row">
      <span class="mu-card-emotion-name">—</span>
      <span class="mu-card-conf-badge"><span class="mu-card-conf">—</span> conf</span>
    </div>
    <div class="mu-card-engage-row">
      <span class="mu-card-engage-label">Engagement</span>
      <span class="mu-card-ema-num"><span class="mu-card-ema">—</span></span>
    </div>
    <div class="mu-card-ema-track">
      <div class="mu-card-ema-fill" style="width:0%;transition:width 0.3s ease"></div>
    </div>
    <div class="mu-card-tier-row">
      <span class="mu-card-tier">—</span>
    </div>
    <div class="mu-card-dominant-row">
      <span class="mu-card-dominant-label">Top emotion:</span>
      <span class="mu-card-dominant">—</span>
    </div>
    <div class="mu-card-probs"></div>
  `;
}

function mu_updateMiniProbs (card, probs) {
  if (!probs) return;
  const container = card.querySelector('.mu-card-probs');
  if (!container) return;

  // Render only top-3 for compactness
  const sorted = MU_PROB_KEYS
    .map(k => ({ k, v: probs[k] || 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);

  container.innerHTML = sorted.map(({ k, v }) => {
    const draftKey = MU_BACKEND_TO_KEY[k.toLowerCase()] || 'neutral';
    const col      = MU_EMOTION_COLORS[draftKey] || '#6b7280';
    return `
      <div class="mu-prob-row">
        <span class="mu-prob-label">${k}</span>
        <div class="mu-prob-track">
          <div class="mu-prob-fill" style="width:${v}%;background:${col}"></div>
        </div>
        <span class="mu-prob-pct">${v}%</span>
      </div>`;
  }).join('');
}

function mu_dominantEmotion (counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return { label: null, emoji: null };
  const top    = entries.sort((a, b) => b[1] - a[1])[0][0];
  return { label: MU_EMOTION_LABELS[top] || top, emoji: MU_EMOTION_EMOJIS[top] || '🔍' };
}

// ── Room stats panel ──────────────────────────────────────────────────────────
function mu_updateRoomStats () {
  mu_setText('mu_statFaceCount',  mu_roomFaceCount);
  mu_setText('mu_statFrameCount', mu_frameCount.toLocaleString());
  mu_setText('mu_statDuration',   mu_sessionTime());

  const tier = mu_engageTier(mu_roomEngagement);
  const engEl = document.getElementById('mu_statEngagement');
  if (engEl) {
    engEl.textContent = Math.round(mu_roomEngagement);
    engEl.style.color = tier.color;
  }
  const tierEl = document.getElementById('mu_statTier');
  if (tierEl) { tierEl.textContent = tier.label; tierEl.style.color = tier.color; }

  // Dominant room emotion (union of all face counts)
  const roomCounts = {};
  for (const fs of mu_faceState.values()) {
    for (const [k, v] of Object.entries(fs.counts)) {
      roomCounts[k] = (roomCounts[k] || 0) + v;
    }
  }
  const dom = mu_dominantEmotion(roomCounts);
  mu_setText('mu_statDominant', dom.label ? `${dom.emoji} ${dom.label}` : '—');
}

function mu_updateRoomEngagementBar () {
  const fill = document.getElementById('mu_roomEngFill');
  const num  = document.getElementById('mu_roomEngNum');
  const pct  = Math.min(100, Math.max(0, Math.round(mu_roomEngagement)));
  if (fill) { fill.style.width = `${pct}%`; fill.style.background = mu_engageTier(pct).color; }
  if (num)  num.textContent = pct;
}

// ── Detect loop ───────────────────────────────────────────────────────────────
function mu_scheduleLive () {
  if (!mu_isLive) return;
  mu_liveTimeout = setTimeout(async () => {
    if (!mu_isLive) return;
    if (!mu_detecting) {
      mu_detecting = true;
      try {
        if (mu_abortCtrl) mu_abortCtrl.abort();
        mu_abortCtrl = new AbortController();
        const { faces, session_id } = await mu_callPredictMulti(mu_abortCtrl.signal);
        if (session_id && !mu_sessionId) mu_sessionId = session_id;
        mu_applyDetection(faces);
        document.getElementById('mu_signalBar')?.classList.remove('show');
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('[EmotionAI:multi]', err);
          document.getElementById('mu_signalBar')?.classList.add('show');
        }
      } finally {
        mu_detecting = false;
      }
    }
    mu_scheduleLive();
  }, MU_INTERVAL_MS);
}

// ── Timer tick ────────────────────────────────────────────────────────────────
function mu_tickTimer () {
  mu_setText('mu_statDuration', mu_sessionTime());
  mu_setText('mu_statFrameCount', mu_frameCount.toLocaleString());
}

// ── Session start ─────────────────────────────────────────────────────────────
async function mu_doStart () {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const video  = document.getElementById('mu_videoEl');
    video.srcObject    = stream;
    video.style.display = 'block';

    document.getElementById('mu_camIdle')?.style && (document.getElementById('mu_camIdle').style.display = 'none');
    document.getElementById('mu_camRing')?.classList.add('active');
    document.getElementById('mu_camScan')?.classList.add('active');
    mu_setText('mu_camStatusTxt', 'LIVE');
    const dot = document.getElementById('mu_camStatusDot');
    if (dot) dot.className = 'cam-status-dot live';
    document.getElementById('mu_liveFeedChip')?.style && (document.getElementById('mu_liveFeedChip').style.display = 'flex');
    document.getElementById('mu_navLiveBadge')?.style && (document.getElementById('mu_navLiveBadge').style.display = 'flex');
    document.getElementById('mu_signalBar')?.classList.remove('show');

    // Reset all state
    mu_isLive      = true;
    mu_detecting   = false;
    mu_frameCount  = 0;
    mu_sessionId   = null;
    mu_roomEngagement = 0;
    mu_roomFaceCount  = 0;
    mu_faceState.clear();
    mu_sessionNum++;

    // Reset UI
    mu_setText('mu_sessionChipLabel', `Session #${mu_sessionNum}`);
    mu_setText('mu_statFaceCount',    '0');
    mu_setText('mu_statFrameCount',   '0');
    mu_setText('mu_statDuration',     '0:00');
    mu_setText('mu_statEngagement',   '—');
    mu_setText('mu_statTier',         '—');
    mu_setText('mu_statDominant',     '—');
    mu_setText('mu_roomEngNum',       '—');

    const fill = document.getElementById('mu_roomEngFill');
    if (fill) fill.style.width = '0%';

    const grid = document.getElementById('mu_faceGrid');
    if (grid) grid.innerHTML = '<div class="mu-empty-state">👁️ Starting detection…</div>';

    document.getElementById('mu_btnStart').disabled = true;
    document.getElementById('mu_btnStop').disabled  = false;

    // Register session with backend
    try {
      const res = await Auth.apiFetch('/sessions/start/', { method: 'POST' });
      const d   = await res.json();
      mu_sessionId = d.session_id;
    } catch (e) {
      console.warn('[EmotionAI:multi] Session start:', e);
    }

    _muBroadcast({ type: 'mu_session_start' });

    mu_sessionStart = Date.now();
    mu_sessionTimer = setInterval(mu_tickTimer, 1000);
    mu_scheduleLive();

  } catch (e) {
    console.error('[EmotionAI:multi] Camera error:', e);
    document.getElementById('mu_btnStart').disabled = false;
    document.getElementById('mu_btnStop').disabled  = true;
    mu_handleCameraError(e);
  }
}

// ── Session stop ──────────────────────────────────────────────────────────────
async function mu_doStop () {
  if (!mu_isLive) return;
  mu_isLive  = false;
  mu_detecting = false;

  document.getElementById('mu_btnStop').disabled  = true;
  document.getElementById('mu_btnStart').disabled = false;

  if (mu_liveTimeout)  { clearTimeout(mu_liveTimeout);   mu_liveTimeout  = null; }
  if (mu_sessionTimer) { clearInterval(mu_sessionTimer);  mu_sessionTimer = null; }
  if (mu_abortCtrl)    { mu_abortCtrl.abort();            mu_abortCtrl    = null; }

  // Stop camera stream
  const video = document.getElementById('mu_videoEl');
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject   = null;
    video.style.display = 'none';
  }

  document.getElementById('mu_camIdle')?.style && (document.getElementById('mu_camIdle').style.display = 'flex');
  document.getElementById('mu_camRing')?.classList.remove('active');
  document.getElementById('mu_camScan')?.classList.remove('active');
  mu_setText('mu_camStatusTxt', 'STOPPED');
  const dot = document.getElementById('mu_camStatusDot');
  if (dot) dot.className = 'cam-status-dot ready';
  document.getElementById('mu_liveFeedChip')?.style && (document.getElementById('mu_liveFeedChip').style.display = 'none');
  document.getElementById('mu_navLiveBadge')?.style && (document.getElementById('mu_navLiveBadge').style.display = 'none');

  // End session on backend
  if (mu_sessionId) {
    try {
      await Auth.apiFetch('/sessions/end/', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ session_id: mu_sessionId, total_frames: mu_frameCount }),
      });
    } catch (e) {
      console.warn('[EmotionAI:multi] Session end:', e);
    }
    mu_sessionId = null;
  }

  _muBroadcast({ type: 'mu_session_stop', frameCount: mu_frameCount });
}

// ── Camera error handler ──────────────────────────────────────────────────────
function mu_handleCameraError (e) {
  let title = 'Camera Error';
  let msg   = `Could not start camera: ${e.message}`;

  if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
    title = 'Camera Permission Denied';
    msg   = 'Allow camera access in your browser and reload the page.';
  } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
    title = 'No Camera Found';
    msg   = 'No camera detected. Connect a webcam and try again.';
  } else if (e.name === 'NotReadableError') {
    title = 'Camera In Use';
    msg   = 'Camera is being used by another app. Close it and try again.';
  } else if (location.protocol === 'http:' && location.hostname !== 'localhost') {
    title = 'HTTPS Required';
    msg   = 'Camera access requires a secure HTTPS connection.';
  }
  alert(`${title}\n\n${msg}`);
}

// ── BroadcastChannel: receive snapshot requests from other tabs ───────────────
if (_muChannel) {
  _muChannel.addEventListener('message', ev => {
    if (ev.data?.type === 'mu_request_snapshot' && mu_isLive) {
      // Send current room state snapshot to requesting tab
      const faceSnapshots = [];
      for (const [idx, fs] of mu_faceState) {
        if (fs.missingFrames === 0) {
          faceSnapshots.push({
            face_index : idx,
            ema        : Math.round(fs.ema),
            lastKey    : fs.lastDraftKey,
            totalFrames: fs.totalFrames,
          });
        }
      }
      _muBroadcast({
        type          : 'mu_snapshot',
        isLive        : mu_isLive,
        faceCount     : mu_roomFaceCount,
        roomEngagement: Math.round(mu_roomEngagement),
        sessionTime   : mu_sessionTime(),
        frameCount    : mu_frameCount,
        faces         : faceSnapshots,
      });
    }
  });
}

// ── Auth guard + init ─────────────────────────────────────────────────────────
if (typeof Auth !== 'undefined' && !Auth.requireAuth()) {
  throw new Error('Not authenticated');
}

window.addEventListener('load', () => {
  mu_setText('mu_sessionChipLabel', `Session #${mu_sessionNum}`);

  // Wire up buttons if they exist in the page
  const btnStart = document.getElementById('mu_btnStart');
  const btnStop  = document.getElementById('mu_btnStop');
  if (btnStart) btnStart.addEventListener('click', mu_doStart);
  if (btnStop)  btnStop.addEventListener('click',  mu_doStop);
});

// ── Public API (for HTML inline handlers / other scripts) ─────────────────────
window.MU = {
  start      : mu_doStart,
  stop       : mu_doStop,
  getState   : () => ({
    isLive        : mu_isLive,
    faceCount     : mu_roomFaceCount,
    roomEngagement: mu_roomEngagement,
    frameCount    : mu_frameCount,
    sessionTime   : mu_sessionTime(),
    faceState     : mu_faceState,
  }),
};