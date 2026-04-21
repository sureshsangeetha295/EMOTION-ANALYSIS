/* ═══════════════════════════════════════════════════════════════════════════
   network-alert.js  —  EmotionAI · Full-Page Offline Overlay
   ───────────────────────────────────────────────────────────────────────────
   HOW IT WORKS:
   • On every page that includes this script, listens for offline/online events
     + pings /health every 8s while offline.
   • PRE-LOGIN pages  (login.html, index.html):  shows a top banner only —
     no need to block the full UI since the user can't do anything anyway.
   • POST-LOGIN pages (app, detect, livecam, faq, feedback, admin):
     shows a full-page overlay that completely blocks interaction until
     the connection is restored.
   • Auto-detects which mode to use based on Auth.isLoggedIn().
   • When connection returns → green "Restored" flash → overlay/banner hides.

   DROP-IN: Already included in every HTML via:
       <script src="script/network-alert.js" defer></script>
   (This file lives at script/network-alert.js — same path your HTML expects)
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const HEALTH_URL        = '/health';
  const CHECK_INTERVAL_MS = 8000;
  const PING_TIMEOUT_MS   = 4000;
  const SLOW_THRESHOLD_MS = 2500;

  /* ── State ──────────────────────────────────────────────────────────────── */
  let currentState   = 'online';
  let checkInterval  = null;
  let countdownTimer = null;
  let retryCountdown = 0;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function isPostLogin() {
    /* True if the user is authenticated — i.e. we should show full overlay */
    try {
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn) return Auth.isLoggedIn();
    } catch (_) {}
    /* Fallback: check localStorage directly for the token key */
    return !!localStorage.getItem('ea_access_token');
  }

  /* ── CSS ────────────────────────────────────────────────────────────────── */
  const CSS = `
    /* ── Shared animation ── */
    @keyframes ea-spin    { to { transform: rotate(360deg); } }
    @keyframes ea-pulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
    @keyframes ea-fadein  { from{opacity:0} to{opacity:1} }
    @keyframes ea-float   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
    @keyframes ea-scan    { from{top:0} to{top:100%} }
    @keyframes ea-ring    { 0%{opacity:.8;transform:translate(-50%,-50%) scale(.5)} 100%{opacity:0;transform:translate(-50%,-50%) scale(1)} }
    @keyframes ea-orbit   { from{transform:rotate(0deg) translateX(54px)} to{transform:rotate(360deg) translateX(54px)} }
    @keyframes ea-sdot    { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
    @keyframes ea-shake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
    @keyframes ea-banner-in { from{transform:translateY(-110%)} to{transform:translateY(0)} }
    @keyframes ea-badge-blink { from{opacity:1} to{opacity:.4} }
    @keyframes ea-static  { from{top:-4px} to{top:170px} }

    /* ══════════════════════════════════════════════════════════════════
       FULL-PAGE OVERLAY  (post-login)
    ══════════════════════════════════════════════════════════════════ */
    #ea-offline-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: #f5f4f0;
      flex-direction: column;
      animation: ea-fadein .25s ease;
      overflow: hidden;
    }
    #ea-offline-overlay.ea-show { display: flex; }

    /* Topbar clone */
    .ea-ov-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 50px;
      background: #ffffff;
      border-bottom: 1px solid #e2e0da;
      flex-shrink: 0;
    }
    .ea-ov-logo {
      display: flex; align-items: center; gap: 10px;
      font-weight: 700; font-size: 1rem; color: #1a1a1a;
    }
    .ea-ov-logo-icon {
      width: 30px; height: 30px; border-radius: 8px;
      background: #e8501a; display: grid; place-items: center;
    }
    .ea-ov-logo-icon svg { width:16px; height:16px; }
    .ea-ov-navlinks {
      display: flex; align-items: center; gap: 22px;
    }
    .ea-ov-navlink {
      font-size: 13px; color: #888; text-decoration: none;
    }
    .ea-ov-logout-btn {
      font-size: 12px; color: #555;
      border: 1px solid #ccc; border-radius: 20px;
      padding: 5px 14px; cursor: pointer;
      background: transparent; font-family: inherit;
      display: flex; align-items: center; gap: 5px;
    }

    /* Body */
    .ea-ov-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 56px;
      padding: 32px 48px;
    }

    /* Left text side */
    .ea-ov-left { max-width: 360px; flex-shrink: 0; }

    .ea-ov-badge {
      display: inline-flex; align-items: center; gap: 7px;
      background: #fde8e0; border: 1px solid #f0c4b0;
      border-radius: 99px; padding: 5px 14px;
      font-size: 11px; color: #c04010; margin-bottom: 20px;
    }
    .ea-ov-badge-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #e8501a;
      animation: ea-pulse 1.4s ease-in-out infinite;
    }

    .ea-ov-h1 {
      font-size: 46px; font-weight: 700; color: #1a1a1a;
      line-height: 1.05; letter-spacing: -1.5px;
      margin-bottom: 4px;
    }
    .ea-ov-h1-orange {
      display: block;
      font-size: 46px; font-weight: 700; font-style: italic;
      color: #e8501a; line-height: 1.05; letter-spacing: -1.5px;
      margin-bottom: 18px;
    }

    .ea-ov-desc {
      font-size: 13.5px; color: #666; line-height: 1.65;
      margin-bottom: 20px; max-width: 310px;
    }

    .ea-ov-checks { display: flex; flex-direction: column; gap: 8px; margin-bottom: 28px; }
    .ea-ov-check-row { display: flex; align-items: center; gap: 7px; font-size: 13px; }
    .ea-ov-check-ok   { color: #15803d; }
    .ea-ov-check-fail { color: #A32D2D; }
    .ea-ov-check-row span { color: #555; }
    .ea-ov-check-row.fail span { color: #A32D2D; }

    .ea-ov-btns { display: flex; align-items: center; gap: 12px; }
    .ea-ov-retry {
      display: inline-flex; align-items: center; gap: 8px;
      background: #e8501a; color: #fff;
      border: none; border-radius: 99px;
      padding: 11px 22px; font-size: 13.5px; font-weight: 600;
      cursor: pointer; font-family: inherit;
      transition: background .2s, transform .12s;
    }
    .ea-ov-retry:hover:not(:disabled) { background: #cc3d08; }
    .ea-ov-retry:active:not(:disabled) { transform: scale(.97); }
    .ea-ov-retry:disabled { opacity: .55; cursor: not-allowed; }
    .ea-ov-retry svg { width:14px; height:14px; }
    .ea-ov-retry.ea-spinning svg { animation: ea-spin .75s linear infinite; }

    .ea-ov-howbtn {
      background: transparent; color: #1a1a1a;
      border: 1.5px solid #ccc; border-radius: 99px;
      padding: 11px 20px; font-size: 13.5px;
      cursor: pointer; font-family: inherit;
      transition: border-color .2s;
    }
    .ea-ov-howbtn:hover { border-color: #999; }

    /* Right cam card */
    .ea-ov-right { width: 300px; flex-shrink: 0; }

    .ea-ov-camcard {
      background: #fff;
      border: 1px solid #e0dbd4;
      border-radius: 14px;
      overflow: hidden;
    }

    .ea-ov-titlebar {
      display: flex; align-items: center;
      justify-content: space-between;
      padding: 9px 13px;
      background: #fafaf8;
      border-bottom: 1px solid #eee;
    }
    .ea-ov-dots { display: flex; gap: 5px; }
    .ea-ov-dot { width: 10px; height: 10px; border-radius: 50%; }
    .ea-ov-dot-r { background: #ff5f57; }
    .ea-ov-dot-y { background: #febc2e; }
    .ea-ov-dot-g { background: #28c840; }
    .ea-ov-tb-title { font-size: 11px; color: #999; }
    .ea-ov-live { font-size: 11px; color: #3a8c48; font-weight: 600;
      display: flex; align-items: center; gap: 4px; }
    .ea-ov-live-dot { width:6px; height:6px; border-radius:50%; background:#28c840; }

    .ea-ov-feed {
      background: #111; height: 154px;
      position: relative; display: flex;
      align-items: center; justify-content: center;
      overflow: hidden;
    }

    /* Scan box */
    .ea-ov-scanbox {
      position: absolute;
      width: 76px; height: 76px;
      border: 2px solid #e8501a;
      border-radius: 4px; z-index: 3;
      animation: ea-badge-blink 1.8s ease-in-out infinite alternate;
    }
    .ea-ov-scan-line {
      position: absolute; width: 100%; height: 1.5px;
      background: rgba(232,80,26,.65);
      animation: ea-scan 2.2s linear infinite;
    }
    .ea-ov-sc { position: absolute; width: 9px; height: 9px; }
    .ea-ov-sc-tl { top:-2px; left:-2px; border-top:2.5px solid #e8501a; border-left:2.5px solid #e8501a; }
    .ea-ov-sc-tr { top:-2px; right:-2px; border-top:2.5px solid #e8501a; border-right:2.5px solid #e8501a; }
    .ea-ov-sc-bl { bottom:-2px; left:-2px; border-bottom:2.5px solid #e8501a; border-left:2.5px solid #e8501a; }
    .ea-ov-sc-br { bottom:-2px; right:-2px; border-bottom:2.5px solid #e8501a; border-right:2.5px solid #e8501a; }

    /* Rings */
    .ea-ov-ring {
      position: absolute; border-radius: 50%;
      border: 1.5px solid rgba(232,80,26,.65);
      left: 50%; top: 50%;
      animation: ea-ring 2s ease-out infinite;
    }
    .ea-ov-ring1 { width:88px;  height:88px;  animation-delay:0s;   }
    .ea-ov-ring2 { width:116px; height:116px; animation-delay:.55s; }
    .ea-ov-ring3 { width:144px; height:144px; animation-delay:1.1s; }

    /* Face */
    .ea-ov-face {
      position: relative; z-index: 2;
      animation: ea-float 3s ease-in-out infinite alternate;
    }
    .ea-ov-face-circle {
      width:60px; height:60px; border-radius:50%;
      background:#c8955a; overflow:hidden; position:relative;
    }
    .ea-ov-hair {
      position:absolute; top:0; left:0; right:0;
      height:24px; background:#2a1a0a;
      border-radius:50% 50% 0 0;
    }
    .ea-ov-eye {
      position:absolute; width:7px; height:9px;
      background:#fff; border-radius:50%; top:24px;
    }
    .ea-ov-eye-l { left:12px; } .ea-ov-eye-r { right:12px; }
    .ea-ov-pupil {
      position:absolute; width:3px; height:3px;
      background:#111; border-radius:50%; top:3px; left:2px;
    }
    .ea-ov-mouth {
      position:absolute; width:20px; height:9px;
      border:2.5px solid #7a4a20; border-top:none;
      border-radius:0 0 18px 18px;
      bottom:10px; left:50%; transform:translateX(-50%);
    }

    /* Overlay on feed */
    .ea-ov-feed-overlay {
      position:absolute; inset:0; z-index:10;
      background:rgba(10,10,10,.6);
      display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:6px;
    }
    .ea-ov-feed-icon {
      width:30px; height:30px; border-radius:50%;
      border:2px solid #e8501a;
      display:flex; align-items:center; justify-content:center;
    }
    .ea-ov-feed-icon svg { width:14px; height:14px; }
    .ea-ov-feed-label { font-size:10px; color:#fff; font-weight:600; letter-spacing:.6px; }
    .ea-ov-feed-dots { display:flex; gap:3px; align-items:center; }
    .ea-ov-fd { width:4px; height:4px; border-radius:50%; background:#e8501a; animation:ea-sdot 1.2s ease-in-out infinite; }
    .ea-ov-fd:nth-child(2){animation-delay:.2s} .ea-ov-fd:nth-child(3){animation-delay:.4s}

    .ea-ov-nosig {
      position:absolute; top:9px; left:9px; z-index:11;
      background:rgba(232,80,26,.88); color:#fff;
      font-size:9px; font-weight:700; padding:3px 8px;
      border-radius:4px; letter-spacing:.5px;
      animation: ea-badge-blink 1.2s ease-in-out infinite alternate;
    }
    .ea-ov-fps {
      position:absolute; top:9px; right:9px; z-index:11;
      background:rgba(20,20,20,.8); color:#e8501a;
      font-size:9px; font-weight:600; padding:3px 7px; border-radius:4px;
    }
    .ea-ov-static { position:absolute; inset:0; z-index:1; pointer-events:none; }
    .ea-ov-sl {
      position:absolute; height:2px;
      background:rgba(255,255,255,.055);
      animation: ea-static var(--d) linear infinite;
      animation-delay: var(--dl);
    }

    /* Bottom panel */
    .ea-ov-bottom { padding: 11px 13px; }
    .ea-ov-emo-row {
      display:flex; align-items:center;
      justify-content:space-between; margin-bottom:9px;
    }
    .ea-ov-emo-name { font-size:13px; font-weight:600; color:#e8501a; }
    .ea-ov-emo-conf { font-size:10px; color:#aaa; }
    .ea-ov-emo-ms {
      font-size:10px; background:#fde8e0; color:#c04010;
      padding:3px 8px; border-radius:5px;
    }
    .ea-ov-bar { display:flex; align-items:center; gap:5px; margin-bottom:3px; }
    .ea-ov-bar-dot { width:7px; height:7px; border-radius:50%; border:1.5px solid #ddd; flex-shrink:0; }
    .ea-ov-bar-dot.active { border-color:#e8501a; }
    .ea-ov-bar-track { flex:1; height:3px; background:#eee; border-radius:2px; overflow:hidden; }
    .ea-ov-bar-fill { height:100%; border-radius:2px; background:#eee; }
    .ea-ov-bar-pct { font-size:10px; color:#ccc; min-width:22px; text-align:right; }

    /* RESTORED state */
    #ea-offline-overlay.ea-restored .ea-ov-h1 { color: #15803d; }
    #ea-offline-overlay.ea-restored .ea-ov-h1-orange { color: #22c55e; font-style:normal; }
    #ea-offline-overlay.ea-restored { background: #f0fdf4; }
    #ea-offline-overlay.ea-restored .ea-ov-badge { background:#dcfce7; border-color:#bbf7d0; color:#15803d; }
    #ea-offline-overlay.ea-restored .ea-ov-badge-dot { background:#22c55e; }

    /* ══════════════════════════════════════════════════════════════════
       TOP BANNER  (pre-login pages only — index, login)
    ══════════════════════════════════════════════════════════════════ */
    #ea-net-banner {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 99999;
      display: flex;
      justify-content: center;
      padding: 10px 16px;
      pointer-events: none;
      transform: translateY(-120%);
      transition: transform 0.35s cubic-bezier(0.34,1.3,0.64,1);
    }
    #ea-net-banner.ea-visible {
      transform: translateY(0);
      pointer-events: all;
    }
    .ea-net-card {
      background: #f5f4f0;
      border-radius: 10px;
      border-left: 3.5px solid #e8501a;
      padding: 13px 18px 13px 15px;
      max-width: 540px; width: 100%;
      display: flex; flex-direction: column; gap: 9px;
      box-shadow: 0 2px 8px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .ea-net-card.ea-weak  { border-left-color: #d97706; }
    .ea-net-card.ea-restored { border-left-color: #22c55e; background: #f0fdf4; }
    .ea-net-title { font-size:.88rem; font-weight:700; color:#1a1a1a; margin:0; }
    .ea-net-desc  { font-size:.79rem; color:#6b7280; margin:0; line-height:1.55; }
    .ea-net-card.ea-restored .ea-net-title { color:#15803d; }
    .ea-net-card.ea-restored .ea-net-desc  { color:#4ade80; }
    .ea-net-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    #ea-net-countdown { font-size:.77rem; color:#9ca3af; font-weight:500; }
    .ea-net-retry {
      display:inline-flex; align-items:center; gap:6px;
      padding:7px 16px; background:#fff;
      border:1.5px solid #d1cfc9; border-radius:8px;
      font-size:.81rem; font-weight:600; color:#1a1a1a;
      cursor:pointer; transition:background .15s,border-color .15s,transform .12s;
      white-space:nowrap; font-family:inherit;
    }
    .ea-net-retry:hover:not(:disabled) { background:#f0ece6; border-color:#b0aca4; transform:translateY(-1px); }
    .ea-net-retry:active:not(:disabled) { transform:translateY(0); }
    .ea-net-retry:disabled { opacity:.55; cursor:not-allowed; }
    .ea-net-retry svg { width:13px; height:13px; stroke:#374151; }
    .ea-net-retry.ea-spinning svg { animation:ea-spin .75s linear infinite; }

    @media(max-width:560px) {
      .ea-ov-body { flex-direction:column; gap:24px; padding:24px 20px; }
      .ea-ov-right { width:100%; }
      .ea-ov-left { max-width:100%; }
      .ea-ov-h1, .ea-ov-h1-orange { font-size:34px; }
      .ea-ov-navlinks { display:none; }
    }
  `;

  /* ── Build full-page overlay ────────────────────────────────────────────── */
  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'ea-offline-overlay';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'No internet connection');

    el.innerHTML = `
      <div class="ea-ov-topbar">
        <div class="ea-ov-logo">
          <div class="ea-ov-logo-icon">
            <svg viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" stroke="#fff" stroke-width="1.5"/>
              <path d="M6 9.5c.5 1 1.5 1.5 3 1.5s2.5-.5 3-1.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="6.5" cy="7.5" r="1" fill="#fff"/>
              <circle cx="11.5" cy="7.5" r="1" fill="#fff"/>
            </svg>
          </div>
          Emotion Analysis
        </div>
        <div class="ea-ov-navlinks">
          <a class="ea-ov-navlink" href="index.html">Home</a>
          <a class="ea-ov-navlink" href="detect.html">Detect</a>
          <a class="ea-ov-navlink" href="faq.html">FAQ</a>
          <a class="ea-ov-navlink" href="feedback.html">Feedback</a>
          <button class="ea-ov-logout-btn" onclick="window.__eaOvLogout()">↩ Logout</button>
        </div>
      </div>

      <div class="ea-ov-body">
        <div class="ea-ov-left">
          <div class="ea-ov-badge">
            <div class="ea-ov-badge-dot"></div>
            <span id="ea-ov-badge-text">No connection · Detection paused · Offline</span>
          </div>
          <div class="ea-ov-h1">No Internet</div>
          <span class="ea-ov-h1-orange" id="ea-ov-subtitle">Connection.</span>
          <p class="ea-ov-desc" id="ea-ov-desc">
            EmotionAI couldn't reach the server. Live facial analysis requires an active connection. Check your network and retry.
          </p>
          <div class="ea-ov-checks">
            <div class="ea-ov-check-row">
              <span class="ea-ov-check-ok">✓</span>
              <span>Device is online</span>
            </div>
            <div class="ea-ov-check-row fail">
              <span class="ea-ov-check-fail">✕</span>
              <span>No internet access detected</span>
            </div>
            <div class="ea-ov-check-row fail">
              <span class="ea-ov-check-fail">✕</span>
              <span>Server unreachable</span>
            </div>
          </div>
          <div class="ea-ov-btns">
            <button class="ea-ov-retry" id="ea-ov-retry-btn" onclick="window.__eaOvRetry()">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              <span id="ea-ov-retry-label">Retry Connection</span>
            </button>
            <button class="ea-ov-howbtn" onclick="window.__eaOvHow()">How it works</button>
          </div>
        </div>

        <div class="ea-ov-right">
          <div class="ea-ov-camcard">
            <div class="ea-ov-titlebar">
              <div class="ea-ov-dots">
                <div class="ea-ov-dot ea-ov-dot-r"></div>
                <div class="ea-ov-dot ea-ov-dot-y"></div>
                <div class="ea-ov-dot ea-ov-dot-g"></div>
              </div>
              <span class="ea-ov-tb-title">Emotion Analysis — Live Detection</span>
              <span class="ea-ov-live"><div class="ea-ov-live-dot"></div>LIVE</span>
            </div>
            <div class="ea-ov-feed" id="ea-ov-feed">
              <div class="ea-ov-static" id="ea-ov-static"></div>
              <div class="ea-ov-ring ea-ov-ring1"></div>
              <div class="ea-ov-ring ea-ov-ring2"></div>
              <div class="ea-ov-ring ea-ov-ring3"></div>
              <div class="ea-ov-face">
                <div class="ea-ov-face-circle">
                  <div class="ea-ov-hair"></div>
                  <div class="ea-ov-eye ea-ov-eye-l"><div class="ea-ov-pupil"></div></div>
                  <div class="ea-ov-eye ea-ov-eye-r"><div class="ea-ov-pupil"></div></div>
                  <div class="ea-ov-mouth"></div>
                </div>
              </div>
              <div class="ea-ov-scanbox">
                <div class="ea-ov-sc ea-ov-sc-tl"></div>
                <div class="ea-ov-sc ea-ov-sc-tr"></div>
                <div class="ea-ov-sc ea-ov-sc-bl"></div>
                <div class="ea-ov-sc ea-ov-sc-br"></div>
                <div class="ea-ov-scan-line"></div>
              </div>
              <div class="ea-ov-feed-overlay">
                <div class="ea-ov-feed-icon">
                  <svg viewBox="0 0 16 16" fill="none" stroke="#e8501a" stroke-width="1.8" stroke-linecap="round">
                    <path d="M2 2l12 12"/><path d="M8 12h.01"/>
                  </svg>
                </div>
                <span class="ea-ov-feed-label" id="ea-ov-feed-label">CONNECTION LOST</span>
                <div class="ea-ov-feed-dots">
                  <div class="ea-ov-fd"></div>
                  <div class="ea-ov-fd"></div>
                  <div class="ea-ov-fd"></div>
                </div>
              </div>
              <div class="ea-ov-nosig" id="ea-ov-nosig">NO SIGNAL</div>
              <div class="ea-ov-fps">-- fps</div>
            </div>
            <div class="ea-ov-bottom">
              <div class="ea-ov-emo-row">
                <div>
                  <div class="ea-ov-emo-name">Offline</div>
                  <div class="ea-ov-emo-conf">-- % confidence</div>
                </div>
                <div class="ea-ov-emo-ms">-- ms</div>
              </div>
              ${['','','','active','','',''].map(cls => `
                <div class="ea-ov-bar">
                  <div class="ea-ov-bar-dot ${cls}"></div>
                  <div class="ea-ov-bar-track"><div class="ea-ov-bar-fill"></div></div>
                  <span class="ea-ov-bar-pct">--</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(el);

    /* Inject static scan lines */
    const staticEl = document.getElementById('ea-ov-static');
    if (staticEl) {
      for (let i = 0; i < 10; i++) {
        const l = document.createElement('div');
        l.className = 'ea-ov-sl';
        l.style.cssText = `width:${55+Math.random()*45}%;left:${Math.random()*40}%;--d:${(1.8+Math.random()*2).toFixed(1)}s;--dl:${(Math.random()*2).toFixed(1)}s`;
        staticEl.appendChild(l);
      }
    }

    /* Cycle "NO SIGNAL" badge text */
    const msgs = ['NO SIGNAL','RECONNECTING...','NO SIGNAL','TIMEOUT'];
    let mi = 0;
    setInterval(() => {
      mi = (mi + 1) % msgs.length;
      const nsb = document.getElementById('ea-ov-nosig');
      if (nsb) nsb.textContent = msgs[mi];
    }, 1900);
  }

  /* ── Build top banner (pre-login) ───────────────────────────────────────── */
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
            Emotion Analysis requires a connection. Check your network and try again.
          </p>
        </div>
        <div class="ea-net-footer">
          <span id="ea-net-countdown">Retrying in 8s</span>
          <button class="ea-net-retry" id="ea-net-retry-btn" onclick="window.__eaBannerRetry()">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Retry
          </button>
        </div>
      </div>`;
    document.body.appendChild(banner);
  }

  /* ── Ping ───────────────────────────────────────────────────────────────── */
  async function pingServer() {
    if (!navigator.onLine) return { ok: false, slow: false };
    const start = Date.now();
    try {
      const res = await fetch(HEALTH_URL, {
        method: 'GET', cache: 'no-store',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      const elapsed = Date.now() - start;
      return { ok: res.ok, slow: elapsed >= SLOW_THRESHOLD_MS };
    } catch { return { ok: false, slow: false }; }
  }

  /* ── Overlay show/hide ──────────────────────────────────────────────────── */
  function showOverlay() {
    currentState = 'offline';
    document.getElementById('ea-offline-overlay')?.classList.add('ea-show');
    startCheckInterval();
    startCountdownLoop();
  }

  function hideOverlay(restored = false) {
    const ov = document.getElementById('ea-offline-overlay');
    if (!ov) return;
    stopCheckInterval(); stopCountdownLoop();

    if (restored) {
      ov.classList.add('ea-restored');

      /* Badge */
      const badge = document.getElementById('ea-ov-badge-text');
      if (badge) badge.textContent = 'Connection restored · Resuming detection';

      /* Heading */
      const h1 = ov.querySelector('.ea-ov-h1');
      const sub = document.getElementById('ea-ov-subtitle');
      if (h1)  h1.textContent  = 'Back Online';
      if (sub) { sub.textContent = 'Restored!'; sub.style.fontStyle = 'normal'; }

      /* Description */
      const desc = document.getElementById('ea-ov-desc');
      if (desc) desc.textContent = 'You\'re back online. Resuming Emotion Analysis normally.';

      /* Flip all ✕ checks to ✓ */
      ov.querySelectorAll('.ea-ov-check-row').forEach(row => {
        row.classList.remove('fail');
        const icon = row.querySelector('.ea-ov-check-fail');
        if (icon) {
          icon.textContent = '✓';
          icon.className = 'ea-ov-check-ok';
        }
        const span = row.querySelector('span:last-child');
        if (span) {
          if (span.textContent.includes('No internet')) span.textContent = 'Internet access restored';
          if (span.textContent.includes('Server'))      span.textContent = 'Server reachable';
        }
      });

      /* Cam card — update bottom panel */
      const emoName = ov.querySelector('.ea-ov-emo-name');
      const feedLabel = document.getElementById('ea-ov-feed-label');
      if (emoName)    emoName.textContent = 'Reconnected';
      if (feedLabel)  feedLabel.textContent = 'RECONNECTED';

      /* Retry button — hide it */
      const retryBtn = document.getElementById('ea-ov-retry-btn');
      if (retryBtn) retryBtn.style.display = 'none';

      setTimeout(() => {
        ov.classList.remove('ea-show', 'ea-restored');
        /* Reset everything back for next time */
        if (h1)  h1.textContent  = 'No Internet';
        if (sub) { sub.textContent = 'Connection.'; sub.style.fontStyle = ''; }
        if (desc) desc.textContent = 'EmotionAI couldn\'t reach the server. Live facial analysis requires an active connection. Check your network and retry.';
        if (badge) badge.textContent = 'No connection · Detection paused · Offline';
        if (emoName) emoName.textContent = 'Offline';
        if (retryBtn) retryBtn.style.display = '';
        ov.querySelectorAll('.ea-ov-check-row').forEach((row, i) => {
          if (i === 0) return; /* Keep device row as ✓ */
          row.classList.add('fail');
          const icon = row.querySelector('.ea-ov-check-ok');
          if (icon) { icon.textContent = '✕'; icon.className = 'ea-ov-check-fail'; }
          const span = row.querySelector('span:last-child');
          if (span) {
            if (i === 1) span.textContent = 'No internet access detected';
            if (i === 2) span.textContent = 'Server unreachable';
          }
        });
      }, 1800);
    } else {
      ov.classList.remove('ea-show');
    }
    currentState = 'online';
  }

  /* ── Banner show/hide ───────────────────────────────────────────────────── */
  function showBanner(state) {
    currentState = state;
    const card  = document.getElementById('ea-net-card');
    const title = document.getElementById('ea-net-title');
    const desc  = document.getElementById('ea-net-desc');
    const footer= card?.querySelector('.ea-net-footer');
    if (!card) return;
    card.classList.remove('ea-weak','ea-restored');
    if (state === 'offline') {
      if (title) title.textContent = 'Server unreachable';
      if (desc)  desc.textContent  = 'Emotion Analysis requires a connection. Check your network and try again.';
      if (footer) footer.style.display = 'flex';
      startCountdownLoop();
    } else if (state === 'weak') {
      card.classList.add('ea-weak');
      if (title) title.textContent = 'Weak connection detected';
      if (desc)  desc.textContent  = 'Your connection seems slow. Emotion Analysis may respond slower.';
      if (footer) footer.style.display = 'none';
    }
    document.getElementById('ea-net-banner')?.classList.add('ea-visible');
    if (state === 'offline') startCheckInterval();
  }

  function hideBanner(restored = false) {
    const banner = document.getElementById('ea-net-banner');
    const card   = document.getElementById('ea-net-card');
    stopCountdownLoop(); stopCheckInterval();
    if (restored && banner && card) {
      card.classList.add('ea-restored');
      document.getElementById('ea-net-title').textContent = 'Connection restored';
      document.getElementById('ea-net-desc').textContent  = 'You\'re back online. Resuming normally.';
      const footer = card.querySelector('.ea-net-footer');
      if (footer) footer.style.display = 'none';
      setTimeout(() => {
        banner.classList.remove('ea-visible');
        setTimeout(() => card.classList.remove('ea-restored'), 400);
      }, 1600);
    } else {
      banner?.classList.remove('ea-visible');
    }
    currentState = 'online';
  }

  /* ── Countdown ──────────────────────────────────────────────────────────── */
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
    if (el) el.textContent = retryCountdown <= 0 ? 'Checking now…' : `Retrying in ${retryCountdown}s`;
  }

  /* ── Auto-check loop ────────────────────────────────────────────────────── */
  function startCheckInterval() {
    stopCheckInterval();
    checkInterval = setInterval(async () => {
      retryCountdown = Math.round(CHECK_INTERVAL_MS / 1000);
      const { ok, slow } = await pingServer();
      if (isPostLogin()) {
        if (ok) hideOverlay(true);
      } else {
        if (ok && !slow) hideBanner(true);
        else if (ok && slow) showBanner('weak');
      }
    }, CHECK_INTERVAL_MS);
  }
  function stopCheckInterval() {
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  }

  /* ── Manual retry (overlay) ─────────────────────────────────────────────── */
  window.__eaOvRetry = async function () {
    const btn   = document.getElementById('ea-ov-retry-btn');
    const label = document.getElementById('ea-ov-retry-label');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('ea-spinning');
    if (label) label.textContent = 'Checking…';

    const { ok } = await pingServer();
    btn.disabled = false;
    btn.classList.remove('ea-spinning');
    if (label) label.textContent = 'Retry Connection';

    if (ok) {
      hideOverlay(true);
    } else {
      startCountdownLoop();
      /* Shake the card */
      const body = document.querySelector('.ea-ov-left');
      if (body) {
        body.style.animation = 'ea-shake .4s ease';
        setTimeout(() => { body.style.animation = ''; }, 450);
      }
    }
  };

  /* ── Manual retry (banner) ──────────────────────────────────────────────── */
  window.__eaBannerRetry = async function () {
    const btn = document.getElementById('ea-net-retry-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.classList.add('ea-spinning');
    const { ok, slow } = await pingServer();
    btn.disabled = false; btn.classList.remove('ea-spinning');
    if (ok && !slow) hideBanner(true);
    else if (ok && slow) showBanner('weak');
    else {
      startCountdownLoop();
      const card = document.getElementById('ea-net-card');
      if (card) {
        card.style.animation = 'ea-shake .4s ease';
        setTimeout(() => { card.style.animation = ''; }, 450);
      }
    }
  };

  /* ── Logout from overlay ────────────────────────────────────────────────── */
  window.__eaOvLogout = function () {
    try { if (typeof Auth !== 'undefined') Auth.logout?.(); }
    catch (_) {}
    localStorage.clear();
    window.location.href = 'login.html';
  };

  /* ── How it works (navigate) ────────────────────────────────────────────── */
  window.__eaOvHow = function () {
    window.location.href = 'faq.html';
  };

  /* ── Online / Offline events ────────────────────────────────────────────── */
  async function handleOffline() {
    if (isPostLogin()) showOverlay();
    else               showBanner('offline');
    startCheckInterval();
  }

  async function handleOnline() {
    const { ok, slow } = await pingServer();
    if (isPostLogin()) {
      if (ok) hideOverlay(true);
    } else {
      if (ok && !slow)    hideBanner(true);
      else if (ok && slow) showBanner('weak');
    }
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const setup = async () => {
      if (isPostLogin()) buildOverlay();
      else               buildBanner();

      window.addEventListener('offline', handleOffline);
      window.addEventListener('online',  handleOnline);

      /* Initial check */
      const { ok, slow } = await pingServer();
      if (!ok) {
        if (isPostLogin()) showOverlay();
        else               showBanner('offline');
      } else if (slow && !isPostLogin()) {
        showBanner('weak');
      }
    };

    if (document.body) setup();
    else document.addEventListener('DOMContentLoaded', setup);
  }

  init();
})();