// landing.js — landing page interactivity

document.addEventListener("DOMContentLoaded", () => {

  // ── Smooth scroll for anchor links ────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener("click", e => {
      const target = document.querySelector(a.getAttribute("href"));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth" }); }
    });
  });

  // ── Nav: highlight active section on scroll ───────────────────────────────
  const sections = document.querySelectorAll("section[id]");
  const navLinks = document.querySelectorAll(".nav-links a");
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(a =>
          a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id)
        );
      }
    });
  }, { threshold: 0.4 });
  sections.forEach(s => observer.observe(s));

  // ── Hero mockup: cycle emotions ───────────────────────────────────────────
  const emotions = [
    { name: "Happiness", pct: 87, color: "#f59e0b", probs: [0.02, 0.01, 0.01, 0.87, 0.05, 0.03, 0.01] },
    { name: "Sadness",   pct: 65, color: "#3b82f6", probs: [0.05, 0.02, 0.08, 0.03, 0.12, 0.65, 0.05] },
    { name: "Surprise",  pct: 74, color: "#f97316", probs: [0.03, 0.01, 0.06, 0.10, 0.04, 0.02, 0.74] },
    { name: "Anger",     pct: 72, color: "#ef4444", probs: [0.72, 0.05, 0.04, 0.03, 0.08, 0.06, 0.02] },
    { name: "Neutral",   pct: 76, color: "#6b7280", probs: [0.04, 0.02, 0.03, 0.08, 0.76, 0.05, 0.02] },
  ];
  let ei = 0;

  function cycleMockup() {
    const e = emotions[ei++ % emotions.length];
    const nameEl = document.querySelector(".res-name");
    const confEl = document.querySelector(".res-conf");
    const iconEl = document.querySelector(".res-icon svg");
    if (nameEl) nameEl.textContent = e.name;
    if (confEl) confEl.textContent = e.pct + "% confidence";
    if (iconEl) iconEl.setAttribute("stroke", e.color);
    document.querySelectorAll(".bar-fill").forEach((bar, i) => {
      bar.style.width = Math.round(e.probs[i] * 100) + "%";
    });
  }

  setInterval(cycleMockup, 2800);

  // ── FAQ accordion on landing ──────────────────────────────────────────────
  document.querySelectorAll(".faq-item").forEach(item => {
    item.addEventListener("click", () => item.classList.toggle("open"));
  });


  // ══════════════════════════════════════════════════════════════════════════
  // ── Time-aware floating typewriter greeting ───────────────────────────────
  //
  //  How username is resolved (first match wins):
  //    1. #navGreeting[data-username]  — set by auth.js after /auth/me
  //    2. window.__username            — optional global set by auth.js
  //    3. Falls back to "" → shows "Hi there! <emoji>"
  //
  //  Greeting changes by hour:
  //    05–11  Good morning   ☀️
  //    12–16  Good afternoon 🌤️
  //    17–20  Good evening   🌇
  //    21–04  Good night     🌙
  //
  //  Auto-refreshes at the top of every hour — no page reload needed.
  // ══════════════════════════════════════════════════════════════════════════

  function getTimedPhrase() {
    const h = new Date().getHours();
    if (h >= 5  && h < 12) return { word: "Good morning",   emoji: "☀️"  };
    if (h >= 12 && h < 17) return { word: "Good afternoon", emoji: "🌤️" };
    if (h >= 17 && h < 21) return { word: "Good evening",   emoji: "🌇"  };
    return                         { word: "Good night",     emoji: "🌙"  };
  }

  function buildGreetingText(username) {
    const { word, emoji } = getTimedPhrase();
    const name = (username || "").trim();
    if (name && name !== "there") {
      const display = name.charAt(0).toUpperCase() + name.slice(1);
      return `${word}, ${display} ${emoji}`;
    }
    return `Hi there! ${emoji}`;
  }

  /**
   * Types `text` character-by-character into `el`.
   * A .nav-cursor blink trails the caret; removed when done.
   * Variable speed: comma → 230 ms pause, space → 55 ms, normal → 72 ms.
   */
  function typewrite(el, text, delay = 0) {
    el.textContent = "";
    el.classList.remove("nav-greeting--done");

    let i = 0;
    function step() {
      const typed  = text.slice(0, i);
      const isDone = i >= text.length;

      if (isDone) {
        el.textContent = typed;
        el.classList.add("nav-greeting--done");
        return;
      }

      el.innerHTML = typed + '<span class="nav-cursor" aria-hidden="true"></span>';
      i++;

      const last = text[i - 2] || "";
      const wait = last === "," ? 230 : last === " " ? 55 : 72;
      setTimeout(step, wait);
    }

    setTimeout(step, delay);
  }

  function startGreeting() {
    const el = document.getElementById("navGreeting");
    if (!el) return;

    // auth.js should call:  document.getElementById('navGreeting').dataset.username = username;
    // after a successful /auth/me fetch — that's all the wiring needed.
    const raw  = el.dataset.username || window.__username || "";
    const text = buildGreetingText(raw);
    typewrite(el, text, 700);
  }

  // Refresh at the top of the next hour so the phrase updates without reload
  function scheduleHourlyRefresh() {
    const now = new Date();
    const msToNextHour =
      (60 - now.getMinutes()) * 60_000
      - now.getSeconds()       *  1_000
      - now.getMilliseconds();

    setTimeout(() => {
      startGreeting();
      setInterval(startGreeting, 60 * 60 * 1_000);
    }, msToNextHour);
  }

  startGreeting();
  scheduleHourlyRefresh();

  // Re-run greeting text on orientation change (landscape ↔ portrait)
  window.addEventListener("orientationchange", () => {
    setTimeout(startGreeting, 350);
  });

  // Expose for auth.js to call after username is known
  window.__startGreeting = startGreeting;

}); // end DOMContentLoaded