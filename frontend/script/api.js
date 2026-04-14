// api.js — all backend communication

const API = (() => {

  async function checkHealth() {
    try {
      const res = await fetch(CONFIG.HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  }

  async function predict(blob) {
    const formData = new FormData();
    formData.append("file", blob, "frame.jpg");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

    try {
      const res = await Auth.apiFetch(CONFIG.PREDICT_URL, {
        method: "POST",
        body:   formData,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data.message || data.error || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.code  = data.error;
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ── Analyze a single frame — returns emotion + engagement + timestamp ──
  async function analyzeFrame(blob) {
    const formData = new FormData();
    formData.append("file", blob, "frame.jpg");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

    try {
      const res = await Auth.apiFetch("/analyze-frame", {
        method: "POST",
        body:   formData,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data.message || data.error || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.code  = data.error;
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ── Analyze an uploaded video file — returns timeline + average engagement ──
  async function analyzeVideo(file, onProgress) {
    const formData = new FormData();
    formData.append("file", file, file.name);

    try {
      const res = await Auth.apiFetch("/analyze-video", {
        method: "POST",
        body:   formData,
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data.message || data.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  // ── Fetch aggregated engagement report for a completed session ──
  async function getSessionReport(sessionId) {
    try {
      const res = await Auth.apiFetch(`/session-report/${sessionId}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        const msg = data.message || data.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  return { checkHealth, predict, analyzeFrame, analyzeVideo, getSessionReport };
})();