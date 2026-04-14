async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API not supported. Please use a modern browser over HTTPS.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const vid = document.getElementById('videoEl') || document.getElementById('videoFeed');
    if (!vid) throw new Error('Video element not found in page.');
    vid.srcObject = stream;
    vid.style.display = 'block';
    // Hide idle overlay once camera is ready
    vid.onloadedmetadata = () => {
      const idle = document.getElementById('camIdle');
      if (idle) idle.style.opacity = '0';
    };
  } catch (e) {
    console.warn('[EmotionAI] Camera unavailable:', e);
  }
}


// ════════════════════════════════════════════
//  CAPTURE + API
// ════════════════════════════════════════════

function captureFrame(quality = 0.75) {
  return new Promise((resolve, reject) => {
    const video = document.getElementById('videoEl') || document.getElementById('videoFeed');
    if (!video || !video.srcObject) return reject(new Error('No camera stream'));
    const canvas = document.createElement('canvas');
    canvas.width  = 320;
    canvas.height = 240;
    canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob failed'));
    }, 'image/jpeg', quality);
  });
}

async function callPredict(signal, fast = true) {
  const t0   = performance.now();
  const blob = await captureFrame(fast ? 0.75 : 0.90);
  const form = new FormData();
  form.append('file', blob, 'frame.jpg');

  const saveParam = fast ? 'false' : 'true';
  const sidParam  = (typeof _sessionId === 'string' && _sessionId)
    ? '&session_id=' + encodeURIComponent(_sessionId) : '';
  const url = `${API_URL}?fast=${fast}&save=${saveParam}${sidParam}`;

  const res = await Auth.apiFetch(url, { method: 'POST', body: form, signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  const data    = await res.json();
  const elapsed = Math.round(performance.now() - t0);

  const probs = {};
  PROB_KEYS.forEach((k, i) => {
    const raw = data.all_probabilities?.[i] ?? 0;
    probs[k]  = Math.round((raw > 1 ? raw : raw * 100));
  });
  const total = Object.values(probs).reduce((a, b) => a + b, 0);
  if (total > 0) PROB_KEYS.forEach(k => probs[k] = Math.round(probs[k] / total * 100));

  const emotion    = data.emotion;
  const conf       = Math.round(data.confidence > 1 ? data.confidence : data.confidence * 100);
  const engagement = (data.engagement != null) ? data.engagement : (ENGAGEMENT_MAP[emotion] ?? 0.5);

  return { probs, emotion, conf, elapsed, engagement };
}