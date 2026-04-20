/* ═══════════════════════════════════════════════════════════════
   network-alert.js  —  EmotionAI · Inline Network Banner
   Handles: weak connection (slow) + no connection (offline)
   Add to every HTML page <head>:
       <script src="script/network-alert.js" defer></script>
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────── */
  const HEALTH_URL        = '/health';
  const CHECK_INTERVAL_MS = 8000;   // re-check every 8s while offline
  const PING_TIMEOUT_MS   = 4000;   // abort health ping after 4s
  const SLOW_THRESHOLD_MS = 2500;   // slower than this = "weak" warning

  /* ── State ───────────────────────────────────────────────────── */
  let currentState    = 'online';   // 'online' | 'weak' | 'offline'
  let checkInterval   = null;
  let countdownTimer  = null;
  let retryCountdown  = 0;

  /* ── Inject CSS ──────────────────────────────────────────────── */
  const CSS = `
    #ea-net-banner {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 99999;
      display: flex;
      justify-content: center;
      padding: 12px 16px;
      pointer-events: none;
      transform: translateY(-120%);
      transition: transform 0.38s cubic-bezier(0.34, 1.3, 0.64, 1);
    }
    #ea-net-banner.ea-visible {
      transform: translateY(0);
      pointer-events: all;
    }

    .ea-net-card {
      background: #f5f4f0;
      border-radius: 10px;
      border-left: 3.5px solid #e8501a;
      padding: 14px 18px 14px 16px;
      max-width: 560px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow:
        0 2px 8px rgba(0,0,0,0.08),
        0 8px 24px rgba(0,0,0,0.06);
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .ea-net-card.ea-weak {
      border-left-color: #d97706;
    }

    /* Top row: title */
    .ea-net-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0;
      line-height: 1.3;
    }
    .ea-net-desc {
      font-size: 0.8rem;
      color: #6b7280;
      margin: 0;
      line-height: 1.55;
    }

    /* Bottom row: countdown + retry button */
    .ea-net-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    #ea-net-countdown {
      font-size: 0.78rem;
      color: #9ca3af;
      font-weight: 500;
    }

    /* Retry button — matches the image style */
    .ea-net-retry {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 16px;
      background: #ffffff;
      border: 1.5px solid #d1cfc9;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      color: #1a1a1a;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.12s;
      white-space: nowrap;
    }
    .ea-net-retry:hover:not(:disabled) {
      background: #f0ece6;
      border-color: #b0aca4;
      transform: translateY(-1px);
    }
    .ea-net-retry:active:not(:disabled) { transform: translateY(0); }
    .ea-net-retry:disabled { opacity: 0.55; cursor: not-allowed; }
    .ea-net-retry svg {
      width: 13px; height: 13px;
      stroke: #374151;
      transition: transform 0.5s ease;
    }
    .ea-net-retry.ea-spinning svg {
      animation: ea-spin 0.75s linear infinite;
    }
    @keyframes ea-spin { to { transform: rotate(360deg); } }

    /* "Connection restored" success flash on the banner itself */
    .ea-net-card.ea-restored {
      border-left-color: #22c55e;
      background: #f0fdf4;
    }
    .ea-net-card.ea-restored .ea-net-title { color: #15803d; }
    .ea-net-card.ea-restored .ea-net-desc  { color: #4ade80; }

    @media (max-width: 480px) {
      #ea-net-banner { padding: 8px; }
      .ea-net-card { padding: 12px 14px 12px 13px; gap: 8px; }
    }
  `;

  /* ── Build banner HTML ───────────────────────────────────────── */
  function buildBanner() {
    const banner = document.createElement('div');
    banner.id = 'ea-net-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    banner.innerHTML = `
      <div class="ea-net-card" id="ea-net-card">
        <div>
          <p class="ea-net-title" id="ea-net-title">Server unreachable</p>
          <p class="ea-net-desc"  id="ea-net-desc">
            Emotion Analysis requires a connection to function.
            Check your network and try again.
          </p>
        </div>
        <div class="ea-net-footer">
          <span id="ea-net-countdown">Retrying in 8s</span>
          <button class="ea-net-retry" id="ea-net-retry-btn" onclick="window.__eaRetryNow()">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Retry
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
  }

  /* ── Update banner content based on state ───────────────────── */
  function applyState(state) {
    const card       = document.getElementById('ea-net-card');
    const title      = document.getElementById('ea-net-title');
    const desc       = document.getElementById('ea-net-desc');
    const footer     = card?.querySelector('.ea-net-footer');
    if (!card || !title || !desc) return;

    card.classList.remove('ea-weak', 'ea-restored');

    if (state === 'offline') {
      title.textContent = 'Server unreachable';
      desc.textContent  = 'Emotion Analysis requires a connection to function. Check your network and try again.';
      if (footer) footer.style.display = 'flex';
    } else if (state === 'weak') {
      card.classList.add('ea-weak');
      title.textContent = 'Weak connection detected';
      desc.textContent  = 'Your connection seems slow. Emotion Analysis may respond slower than usual.';
      if (footer) footer.style.display = 'none'; // no retry needed for weak
    }
  }

  /* ── Show / hide ─────────────────────────────────────────────── */
  function showBanner(state) {
    currentState = state;
    applyState(state);
    document.getElementById('ea-net-banner')?.classList.add('ea-visible');
    if (state === 'offline') startCountdownLoop();
  }

  function hideBanner(restored = false) {
    const banner = document.getElementById('ea-net-banner');
    const card   = document.getElementById('ea-net-card');
    stopCountdownLoop();
    stopCheckInterval();

    if (restored && banner && card) {
      // Brief green flash before hiding
      card.classList.add('ea-restored');
      document.getElementById('ea-net-title').textContent = 'Connection restored';
      document.getElementById('ea-net-desc').textContent  = 'You\'re back online. Resuming normally.';
      const footer = card.querySelector('.ea-net-footer');
      if (footer) footer.style.display = 'none';
      setTimeout(() => {
        banner.classList.remove('ea-visible');
        setTimeout(() => card.classList.remove('ea-restored'), 400);
      }, 1800);
    } else {
      banner?.classList.remove('ea-visible');
    }

    currentState = 'online';
  }

  /* ── Countdown ───────────────────────────────────────────────── */
  function startCountdownLoop() {
    stopCountdownLoop();
    retryCountdown = Math.round(CHECK_INTERVAL_MS / 1000);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function stopCountdownLoop() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function tick() {
    retryCountdown = Math.max(0, retryCountdown - 1);
    const el = document.getElementById('ea-net-countdown');
    if (el) {
      el.textContent = retryCountdown <= 0
        ? 'Checking now…'
        : `Retrying in ${retryCountdown}s`;
    }
  }

  /* ── Health / speed ping ─────────────────────────────────────── */
  async function pingServer() {
    if (!navigator.onLine) return { ok: false, slow: false };

    const start = Date.now();
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET',
        cache:  'no-store',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      const elapsed = Date.now() - start;
      return { ok: res.ok, slow: elapsed >= SLOW_THRESHOLD_MS };
    } catch {
      return { ok: false, slow: false };
    }
  }

  /* ── Auto-check loop ─────────────────────────────────────────── */
  function startCheckInterval() {
    stopCheckInterval();
    checkInterval = setInterval(async () => {
      retryCountdown = Math.round(CHECK_INTERVAL_MS / 1000); // reset countdown display
      const { ok, slow } = await pingServer();
      if (ok && !slow) {
        hideBanner(true);
      } else if (ok && slow) {
        showBanner('weak');            // upgraded from offline to just weak
      }
      // else: still offline, keep banner up
    }, CHECK_INTERVAL_MS);
  }

  function stopCheckInterval() {
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  }

  /* ── Manual retry ────────────────────────────────────────────── */
  window.__eaRetryNow = async function () {
    const btn = document.getElementById('ea-net-retry-btn');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('ea-spinning');

    const { ok, slow } = await pingServer();

    btn.disabled = false;
    btn.classList.remove('ea-spinning');

    if (ok && !slow) {
      hideBanner(true);
    } else if (ok && slow) {
      showBanner('weak');
    } else {
      // Still down — shake the card
      startCountdownLoop();
      const card = document.getElementById('ea-net-card');
      if (card) {
        card.style.transition = 'transform 0.1s';
        card.style.transform  = 'translateX(-5px)';
        setTimeout(() => {
          card.style.transform = 'translateX(5px)';
          setTimeout(() => { card.style.transform = ''; }, 100);
        }, 100);
      }
    }
  };

  /* ── Browser online/offline events ──────────────────────────── */
  async function handleOffline() {
    showBanner('offline');
    startCheckInterval();
  }

  async function handleOnline() {
    const { ok, slow } = await pingServer();
    if (ok && !slow)   hideBanner(true);
    else if (ok && slow) showBanner('weak');
    // else: still can't reach server — keep banner
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const setup = async () => {
      buildBanner();
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online',  handleOnline);

      // Initial check on page load
      const { ok, slow } = await pingServer();
      if (!ok)       showBanner('offline');
      else if (slow) showBanner('weak');
    };

    if (document.body) setup();
    else document.addEventListener('DOMContentLoaded', setup);
  }

  init();
})();