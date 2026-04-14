// renderer.js — all UI update logic after detection

const EMOTION_DATA = {
  Happiness: {
    color: "#f59e0b", dark: "#b45309", bg: "rgba(245,158,11,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    msg: "You're radiating positive energy! Happiness boosts creativity, strengthens social bonds, and is one of the most contagious emotions around.",
    tip: "Note what made you feel this way — revisiting those triggers helps reinforce positive emotional patterns over time."
  },
  Sadness: {
    color: "#3b82f6", dark: "#1d4ed8", bg: "rgba(59,130,246,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    msg: "Sadness detected. It's a natural and healthy emotion — often a sign of deep care or attachment to something meaningful in your life.",
    tip: "A short walk, your favourite music, or a conversation with someone you trust can gently ease the weight of sadness."
  },
  Anger: {
    color: "#ef4444", dark: "#b91c1c", bg: "rgba(239,68,68,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M7.5 8 10 9.5"/><path d="M16.5 8 14 9.5"/></svg>',
    msg: "Anger is showing. This emotion signals something important to you feels threatened, unfair, or out of control right now.",
    tip: "Try 4-7-8 breathing: inhale 4s, hold 7s, exhale 8s. It directly activates your parasympathetic nervous system."
  },
  Surprise: {
    color: "#f97316", dark: "#c2410c", bg: "rgba(249,115,22,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
    msg: "You look surprised! Surprise is one of the shortest-lived but most intense emotions — your brain is rapidly processing something unexpected.",
    tip: "Notice whether this surprise felt positive or negative. That second reaction reveals a lot about your underlying mood."
  },
  Fear: {
    color: "#8b5cf6", dark: "#6d28d9", bg: "rgba(139,92,246,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    msg: "Fear or anxiety is showing. Your brain is trying to protect you by flagging a potential threat — this is completely natural.",
    tip: "Ground yourself: name 5 things you see, 4 you can touch, 3 you hear. This pulls focus back to the present moment."
  },
  Disgust: {
    color: "#06b6d4", dark: "#0e7490", bg: "rgba(6,182,212,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    msg: "Disgust detected. This emotion often arises when something conflicts with your personal values or crosses an important boundary.",
    tip: "Disgust is a strong signal — ask yourself whether this reaction is worth your continued attention and energy."
  },
  Neutral: {
    color: "#6b7280", dark: "#374151", bg: "rgba(107,114,128,0.08)",
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    msg: "You appear calm and neutral — no dominant emotion right now. This relaxed baseline is ideal for focused thinking.",
    tip: "Neutral is a great state for deep work or important decisions. Make the most of this clarity while it lasts."
  }
};

const COLORS = {
  Happiness: "#f59e0b", Sadness: "#3b82f6", Anger: "#ef4444",
  Surprise: "#f97316", Fear: "#8b5cf6", Disgust: "#06b6d4", Neutral: "#6b7280"
};

function normConf(c) { return c > 1 ? c / 100 : c; }

function showEmotionMessage(emotion) {
  const d = EMOTION_DATA[emotion];
  if (!d) return;
  const box = document.getElementById("emotion-msg");
  if (!box) return;
  document.getElementById("msg-icon").innerHTML       = d.icon;
  document.getElementById("msg-icon").style.background = d.bg;
  document.getElementById("msg-label").textContent    = emotion;
  document.getElementById("msg-label").style.color    = d.dark;
  document.getElementById("msg-text").textContent     = d.msg;
  document.getElementById("msg-tip").textContent      = d.tip;
  box.style.borderColor = d.color + "40";
  box.style.background  = d.bg;
  box.style.display     = "block";
  box.style.animation   = "none";
  box.offsetHeight;
  box.style.animation   = "";
  const sub = document.getElementById("bottom-subtitle");
  if (sub) sub.textContent = "Last detected: " + emotion;
}

const Renderer = (() => {

  function showResult(data) {
    const { emotion, confidence, all_probabilities, ms } = data;
    const conf = normConf(confidence);
    const pct  = Math.round(conf * 100);
    const col  = COLORS[emotion] || "#6b7280";

    const badge = document.getElementById("result-badge");
    if (badge) badge.innerHTML = `
      <div class="res-dot" style="background:${col}"></div>
      <div>
        <div class="res-emotion" style="color:${col}">${emotion}</div>
        <div class="res-conf">${pct}% confidence</div>
      </div>`;

    const barsEl = document.getElementById("prob-bars");
    if (barsEl && all_probabilities) {
      barsEl.innerHTML = CONFIG.EMOTION_LABELS.map((label, i) => {
        const p = Math.round(normConf(all_probabilities[i]) * 100);
        const c = COLORS[label];
        return `<div class="bar-row">
          <span class="bar-label">${label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${c}"></div></div>
          <span class="bar-pct" style="color:${c}">${p}%</span>
        </div>`;
      }).join("");
    }

    if (all_probabilities) {
      CONFIG.EMOTION_LABELS.forEach((label, i) => {
        const p    = Math.round(normConf(all_probabilities[i]) * 100);
        const c    = COLORS[label];
        const bar  = document.getElementById("eb-" + label);
        const pctE = document.getElementById("ep-" + label);
        const card = document.getElementById("ec-" + label);
        if (bar)  bar.style.width    = p + "%";
        if (pctE) pctE.textContent   = p + "%";
        if (card) {
          const active = label === emotion;
          card.classList.toggle("active", active);
          card.style.borderColor = active ? c : "";
          card.style.background  = active ? c + "0d" : "";
          card.style.boxShadow   = active ? `0 4px 16px ${c}22` : "";
        }
      });
    }

    setStatus("success", `Detected: <strong>${emotion}</strong> &nbsp;${pct}% confidence`);

    const msEl = document.getElementById("ms-badge");
    if (msEl && ms) { msEl.textContent = ms + " ms"; msEl.style.display = "block"; }

    showEmotionMessage(emotion);
  }

  function showSpinner(active, cameraReady = true) {
    const sp  = document.getElementById("detect-spinner");
    const ico = document.getElementById("detect-icon");
    const btn = document.getElementById("btn-detect");
    if (sp)  sp.style.display  = active ? "inline-block" : "none";
    if (ico) ico.style.display = active ? "none" : "inline";
    if (btn) btn.disabled      = active || !cameraReady;
  }

  function setStatus(type, msg) {
    const el = document.getElementById("status-bar");
    if (!el) return;
    el.className     = type ? "status-" + type : "";
    el.innerHTML     = msg;
    el.style.display = msg ? "block" : "none";
  }

  function setBackendStatus(online) {
    const dot  = document.getElementById("backend-status");
    const pill = document.getElementById("backend-pill");
    const lbl  = document.getElementById("backend-label");

    if (dot) dot.className = "backend-dot" + (online ? " online" : "");

    if (lbl) lbl.textContent = online ? "Live" : "Offline";

    if (pill) {
      pill.style.borderColor  = online ? "rgba(34,197,94,0.3)"  : "rgba(239,68,68,0.3)";
      pill.style.background   = online ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)";
      pill.style.color        = online ? "#16a34a"              : "#dc2626";
    }
  }

  function showError(msg) { setStatus("error", msg); }

  return { showResult, showError, showSpinner, setStatus, setBackendStatus };
})();