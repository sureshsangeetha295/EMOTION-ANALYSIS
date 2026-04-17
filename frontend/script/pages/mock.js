// =============================================================================
//  mock.js  —  MockCoach page logic
//  Handles: camera, MediaRecorder (audio+video), live emotion polling,
//           waveform visualiser, API submission, results rendering
// =============================================================================

/* global CONFIG, Auth */  // CONFIG.API_BASE and Auth.getAccessToken() from config.js / auth.js

(function () {
  "use strict";

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const setupPanel     = document.getElementById("setup-panel");
  const recordingPanel = document.getElementById("recording-panel");
  const analysingPanel = document.getElementById("analysing-panel");
  const resultsPanel   = document.getElementById("results-panel");
  const sessionBadge   = document.getElementById("session-badge");

  const cameraPreview  = document.getElementById("camera-preview");
  const cameraCanvas   = document.getElementById("camera-canvas");
  const cameraStatus   = document.getElementById("camera-status");
  const liveEmotion    = document.getElementById("live-emotion");
  const camToggle      = document.getElementById("cam-toggle");

  const startBtn       = document.getElementById("start-btn");
  const stopBtn        = document.getElementById("stop-btn");
  const retryBtn       = document.getElementById("retry-btn");
  const downloadBtn    = document.getElementById("download-report-btn");
  const topicInput     = document.getElementById("topic-input");

  const recModeLabel   = document.getElementById("rec-mode-label");
  const recTopicLabel  = document.getElementById("rec-topic-label");
  const recTimer       = document.getElementById("rec-timer");
  const lmEmotion      = document.getElementById("lm-emotion");
  const lmEngagement   = document.getElementById("lm-engagement");
  const waveformEl     = document.getElementById("waveform");
  const analysingStep  = document.getElementById("analysing-step");

  // Results refs
  const scoreNumber    = document.getElementById("score-number");
  const scoreArc       = document.getElementById("score-arc");
  const scoreVerdict   = document.getElementById("score-verdict");
  const scoreModeTag   = document.getElementById("score-mode-tag");
  const coachSummary   = document.getElementById("coach-summary-text");
  const dimensionBars  = document.getElementById("dimension-bars");
  const voiceMetrics   = document.getElementById("voice-metrics-grid");
  const emotionGrid    = document.getElementById("emotion-grid");
  const tipsList       = document.getElementById("tips-list");
  const transcriptBox  = document.getElementById("transcript-box");
  const reportIframe   = document.getElementById("report-iframe");

  // ── State ────────────────────────────────────────────────────────────────────
  let currentMode      = "presentation";
  let mediaStream      = null;
  let audioRecorder    = null;
  let videoRecorder    = null;
  let audioChunks      = [];
  let videoChunks      = [];
  let timerInterval    = null;
  let emotionInterval  = null;
  let waveformInterval = null;
  let elapsedSecs      = 0;
  let reportHTML       = "";
  let lastEngPct       = 0;
  let sessionId        = null;
  let audioCtx         = null;
  let analyserNode     = null;

  const MODE_LABELS = {
    presentation: "Presentation",
    interview:    "Job Interview",
    speech:       "Public Speech",
    meeting:      "Business Meeting",
  };

  // ── Mode card selection ──────────────────────────────────────────────────────
  document.querySelectorAll(".mode-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".mode-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      currentMode = card.dataset.mode;
    });
  });

  // ── Camera init ──────────────────────────────────────────────────────────────
  async function initCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      cameraPreview.srcObject = mediaStream;
      cameraStatus.classList.add("hidden");
    } catch (err) {
      cameraStatus.innerHTML = `<span>⚠️ Camera unavailable: ${err.message}</span>`;
      console.warn("[MockCoach] Camera error:", err);
      // Try audio only
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) {
        cameraStatus.innerHTML = `<span>⚠️ Microphone unavailable. Check browser permissions.</span>`;
      }
    }
  }

  // ── Waveform visualiser ──────────────────────────────────────────────────────
  function buildWaveformBars() {
    waveformEl.innerHTML = "";
    for (let i = 0; i < 60; i++) {
      const bar = document.createElement("div");
      bar.className = "waveform-bar-item";
      bar.style.height = "8px";
      waveformEl.appendChild(bar);
    }
  }

  function startWaveform() {
    if (!mediaStream) return;
    try {
      audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
      const src   = audioCtx.createMediaStreamSource(mediaStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 128;
      src.connect(analyserNode);
      const data = new Uint8Array(analyserNode.frequencyBinCount);
      const bars = waveformEl.querySelectorAll(".waveform-bar-item");
      waveformInterval = setInterval(() => {
        analyserNode.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          const val = data[Math.floor(i * data.length / bars.length)] || 0;
          const h   = Math.max(4, Math.min(44, (val / 255) * 44));
          bar.style.height = h + "px";
        });
      }, 60);
    } catch (e) {
      console.warn("[MockCoach] Waveform error:", e);
    }
  }

  function stopWaveform() {
    clearInterval(waveformInterval);
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }

  // ── Live emotion polling ─────────────────────────────────────────────────────
  async function pollEmotion() {
    if (!camToggle.checked || !mediaStream) return;
    const video = cameraPreview;
    if (!video.videoWidth) return;

    const ctx = cameraCanvas.getContext("2d");
    cameraCanvas.width  = video.videoWidth;
    cameraCanvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    cameraCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const fd = new FormData();
      fd.append("file", blob, "frame.jpg");
      fd.append("save", "false");

      try {
        const token = Auth.getAccessToken();
        const res   = await fetch(`${CONFIG.API_BASE}/predict/?fast=true&save=false`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body:   fd,
        });
        if (!res.ok) return;
        const data = res.headers.get("content-type")?.includes("json")
          ? await res.json() : null;
        if (!data || !data.emotion) return;

        const emoji = emotionEmoji(data.emotion);
        const label = `${emoji} ${data.emotion}`;
        liveEmotion.textContent = label;
        lmEmotion.textContent   = label;

        if (data.engagement !== undefined) {
          lastEngPct = Math.round((data.engagement || 0) * 100);
          lmEngagement.textContent = `Engagement: ${lastEngPct}%`;
        }
      } catch (_) {}
    }, "image/jpeg", 0.7);
  }

  function emotionEmoji(e) {
    const map = { Happiness:"😄", Surprise:"😲", Neutral:"😐",
                  Fear:"😨", Sadness:"😢", Anger:"😠", Disgust:"🤢" };
    return map[e] || "😐";
  }

  // ── Timer ────────────────────────────────────────────────────────────────────
  function startTimer() {
    elapsedSecs = 0;
    timerInterval = setInterval(() => {
      elapsedSecs++;
      const m = String(Math.floor(elapsedSecs / 60)).padStart(2, "0");
      const s = String(elapsedSecs % 60).padStart(2, "0");
      recTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  // ── Start recording ──────────────────────────────────────────────────────────
  startBtn.addEventListener("click", async () => {
    if (!mediaStream) {
      alert("Please allow camera/microphone access first.");
      return;
    }

    sessionId   = crypto.randomUUID();
    audioChunks = [];
    videoChunks = [];

    // Audio recorder (always)
    const audioTrack = mediaStream.getAudioTracks()[0];
    const audioStream = new MediaStream([audioTrack]);
    audioRecorder = new MediaRecorder(audioStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm",
    });
    audioRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    audioRecorder.start(500);

    // Video recorder (if cam enabled)
    if (camToggle.checked && mediaStream.getVideoTracks().length) {
      const mimeV = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus" : "video/webm";
      videoRecorder = new MediaRecorder(mediaStream, { mimeType: mimeV });
      videoRecorder.ondataavailable = e => { if (e.data.size) videoChunks.push(e.data); };
      videoRecorder.start(500);
    }

    // UI transition
    setupPanel.classList.add("hidden");
    recordingPanel.classList.remove("hidden");
    setBadge("recording", "Recording…");
    recModeLabel.textContent = MODE_LABELS[currentMode] || currentMode;
    recTopicLabel.textContent = topicInput.value.trim() || "General Practice";
    buildWaveformBars();
    startWaveform();
    startTimer();

    // Emotion poll every 2 s
    emotionInterval = setInterval(pollEmotion, 2000);
  });

  // ── Stop recording ────────────────────────────────────────────────────────────
  stopBtn.addEventListener("click", async () => {
    clearInterval(timerInterval);
    clearInterval(emotionInterval);
    stopWaveform();

    recordingPanel.classList.add("hidden");
    analysingPanel.classList.remove("hidden");
    setBadge("analysing", "Analysing…");
    setAnalysingStep("Transcribing audio with Whisper…");

    // Stop recorders and collect blobs
    const audioBlob = await stopRecorder(audioRecorder, audioChunks);
    const videoBlob = videoRecorder
      ? await stopRecorder(videoRecorder, videoChunks)
      : null;

    await submitSession(audioBlob, videoBlob);
  });

  async function stopRecorder(recorder, chunks) {
    return new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.stop();
    });
  }

  // ── Submit to backend ─────────────────────────────────────────────────────────
  async function submitSession(audioBlob, videoBlob) {
    try {
      const fd = new FormData();
      fd.append("audio", audioBlob, "recording.webm");
      if (videoBlob) fd.append("video", videoBlob, "recording.webm");

      const token = Auth.getAccessToken();
      const url   = `${CONFIG.API_BASE}/mock/analyse?mode=${currentMode}`
        + `&topic=${encodeURIComponent(topicInput.value.trim())}`
        + `&session_id=${sessionId}`;

      setAnalysingStep("Running voice modulation analysis with Librosa…");

      const res  = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:   fd,
      });

      setAnalysingStep("Generating AI coaching with LLM…");

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Server error ${res.status}`);
      }

      const data = await res.json();
      renderResults(data);
    } catch (err) {
      console.error("[MockCoach] Submit error:", err);
      analysingPanel.classList.add("hidden");
      setupPanel.classList.remove("hidden");
      setBadge("idle", "Ready");
      alert(`Analysis failed: ${err.message}\n\nMake sure the backend is running and GROQ_API_KEY is set.`);
    }
  }

  // ── Render results ────────────────────────────────────────────────────────────
  function renderResults(data) {
    analysingPanel.classList.add("hidden");
    resultsPanel.classList.remove("hidden");
    setBadge("done", "Complete");
    reportHTML = data.report_html || "";

    // Score circle
    const score = data.overall_score || 0;
    animateScore(score);

    // Verdict + mode tag
    scoreVerdict.textContent   = data.overall_verdict || "—";
    scoreModeTag.textContent   = MODE_LABELS[data.mode] || data.mode;
    coachSummary.textContent   = data.coach_summary    || "";

    // Dimension bars
    renderDimBars(data.scores || {}, data.feedback || {});

    // Voice metrics
    renderVoiceMetrics(data.voice_metrics || {}, data.voice_scores || {});

    // Emotion grid
    renderEmotionGrid(data.emotion_summary || {}, data.engagement_pct || 0);

    // Tips
    renderTips(data.tips || []);

    // Transcript
    transcriptBox.textContent = data.transcript || "(No transcript)";

    // Report iframe
    if (reportHTML) {
      const blob = new Blob([reportHTML], { type: "text/html" });
      reportIframe.src = URL.createObjectURL(blob);
    }

    // Scroll to results
    resultsPanel.scrollIntoView({ behavior: "smooth" });
  }

  function animateScore(score) {
    const circumference = 326.7; // 2π × 52
    const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
    scoreArc.style.stroke = color;
    let current = 0;
    const step  = score / 60;
    const interval = setInterval(() => {
      current = Math.min(current + step, score);
      scoreNumber.textContent  = Math.round(current);
      const offset = circumference - (current / 100) * circumference;
      scoreArc.style.strokeDashoffset = offset;
      if (current >= score) clearInterval(interval);
    }, 16);
  }

  function renderDimBars(scores, feedback) {
    dimensionBars.innerHTML = "";
    Object.entries(scores).forEach(([dim, val]) => {
      const color = val >= 75 ? "#22c55e" : val >= 50 ? "#f59e0b" : "#ef4444";
      const fb    = feedback[dim] || "";
      dimensionBars.innerHTML += `
        <div class="dim-row">
          <div class="dim-label">${dim}</div>
          <div class="dim-bar-wrap">
            <div class="dim-bar-fill" style="width:0%;background:${color}" data-target="${val}"></div>
          </div>
          <div class="dim-score-num" style="color:${color}">${val}</div>
          ${fb ? `<div class="dim-feedback">${fb}</div>` : ""}
        </div>`;
    });
    // Animate bars after paint
    setTimeout(() => {
      dimensionBars.querySelectorAll(".dim-bar-fill[data-target]").forEach(el => {
        el.style.width = el.dataset.target + "%";
      });
    }, 100);
  }

  function renderVoiceMetrics(vm, vs) {
    const cells = [
      { label: "WPM",         value: vm.speaking_rate_wpm  || 0 },
      { label: "Pitch Var.",  value: (vm.pitch_std_hz || 0).toFixed(0) + " Hz" },
      { label: "Silence",     value: Math.round((vm.silence_ratio || 0) * 100) + "%" },
      { label: "Pauses",      value: vm.pause_count || 0 },
      { label: "Avg Pause",   value: (vm.avg_pause_duration_s || 0).toFixed(1) + "s" },
      { label: "Duration",    value: Math.round(vm.duration_s || 0) + "s" },
    ];
    voiceMetrics.innerHTML = `<div class="vm-grid">
      ${cells.map(c => `<div class="vm-cell"><div class="vm-value">${c.value}</div><div class="vm-label">${c.label}</div></div>`).join("")}
    </div>
    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
      ${["pace","pitch","volume","pauses","clarity"].map(k =>
        `<div class="vm-cell" style="flex:1;min-width:80px">
          <div class="vm-value" style="color:${scoreColor(vs[k]||0)}">${vs[k]||0}</div>
          <div class="vm-label">${k.charAt(0).toUpperCase()+k.slice(1)}</div>
        </div>`).join("")}
    </div>`;
  }

  function renderEmotionGrid(es, engPct) {
    const rows = [
      { label: "😄 Positive",  val: es.positive || 0,  color: "#22c55e" },
      { label: "😐 Neutral",   val: es.neutral  || 0,  color: "#6b7280" },
      { label: "😟 Negative",  val: es.negative || 0,  color: "#ef4444" },
    ];
    emotionGrid.innerHTML = `
      <div class="vm-cell" style="text-align:center;margin-bottom:14px">
        <div class="vm-value" style="font-size:30px;color:#6366f1">${engPct}%</div>
        <div class="vm-label">EMA Engagement</div>
      </div>
      ${rows.map(r => `
        <div class="em-row">
          <div class="em-label">${r.label}</div>
          <div class="em-bar-wrap"><div class="em-bar-fill" style="width:${r.val}%;background:${r.color}"></div></div>
          <div class="em-pct">${r.val}%</div>
        </div>`).join("")}`;
  }

  function renderTips(tips) {
    if (!tips.length) { tipsList.innerHTML = "<p>No tips available.</p>"; return; }
    tipsList.innerHTML = tips.map(t => `
      <div class="tip-item ${t.priority || "medium"}">
        <div class="tip-priority">${t.priority || "tip"}</div>
        <div class="tip-text">${t.tip || ""}</div>
      </div>`).join("");
  }

  function scoreColor(v) {
    return v >= 75 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444";
  }

  // ── Download report ───────────────────────────────────────────────────────────
  downloadBtn.addEventListener("click", () => {
    if (!reportHTML) return;
    const blob = new Blob([reportHTML], { type: "text/html" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `MockCoach_${currentMode}_${new Date().toISOString().slice(0,10)}.html`;
    a.click();
  });

  // ── Retry ─────────────────────────────────────────────────────────────────────
  retryBtn.addEventListener("click", () => {
    resultsPanel.classList.add("hidden");
    setupPanel.classList.remove("hidden");
    setBadge("idle", "Ready");
    topicInput.value = "";
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function setBadge(state, text) {
    sessionBadge.className = `status-badge status-${state}`;
    sessionBadge.textContent = text;
  }
  function setAnalysingStep(text) {
    if (analysingStep) analysingStep.textContent = text;
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  initCamera();

})();