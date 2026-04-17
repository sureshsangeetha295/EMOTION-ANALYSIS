const EYE_OPEN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/* ── reCAPTCHA dynamic init ── */
let _recaptchaWidgetId = null;
let _recaptchaSiteKey  = '';
let _recaptchaReady    = false;
let _skipCaptcha       = false; // true when no site key is configured

// Called by reCAPTCHA script once it has loaded (onload=_onRecaptchaLoad)
window._onRecaptchaLoad = function () {
  _recaptchaReady = true;
  if (_recaptchaSiteKey) _renderRecaptcha();
};

function _renderRecaptcha() {
  const container = document.getElementById('g-recaptcha-container');
  if (!container || _recaptchaWidgetId !== null) return;
  if (typeof grecaptcha === 'undefined' || !_recaptchaReady) return;
  _recaptchaWidgetId = grecaptcha.render(container, {
    sitekey: _recaptchaSiteKey,
    theme:   'light',
    size:    'normal',
  });
}

// Fetch public config from backend on page load
(async function loadAuthConfig() {
  try {
    const res = await fetch('/auth/config');
    if (!res.ok) throw new Error('config fetch failed');
    const cfg = await res.json();

    // ── Google OAuth button visibility ─────────────────────────────────────
    const googleBtn = document.querySelector('.btn-google');
    if (googleBtn) googleBtn.style.display = cfg.google_oauth_enabled ? '' : 'none';

    // ── reCAPTCHA ──────────────────────────────────────────────────────────
    if (cfg.recaptcha_site_key) {
      _recaptchaSiteKey = cfg.recaptcha_site_key;
      // If the reCAPTCHA script already loaded, render immediately
      if (_recaptchaReady) _renderRecaptcha();
      // Otherwise _onRecaptchaLoad will call _renderRecaptcha when ready
    } else {
      // No site key configured — hide the captcha widget entirely
      const wrap = document.getElementById('captcha-wrap');
      if (wrap) wrap.style.display = 'none';
      _skipCaptcha = true;
    }
  } catch (e) {
    // If config endpoint unreachable, hide captcha to avoid blocking login
    const wrap = document.getElementById('captcha-wrap');
    if (wrap) wrap.style.display = 'none';
    _skipCaptcha = true;
    console.warn('[EmotionAI] Could not load auth config:', e);
  }
})();

let activeTab        = 'signin';
let resetCurrentStep = 1;
let verifiedResetEmail = '';

const TITLES = {
  signin: ['Hi there!',       'Sign in to continue to your dashboard'],
  signup: ['Create account',  'Set up your free account in seconds'],
  reset:  ['Reset password',  'Recover access in a few simple steps'],
  admin:  ['Admin portal',    'Restricted — authorised personnel only'],
};

/* ── Tab switching ── */
function switchTab(tab) {
  activeTab = tab;
  ['signin','signup','reset','admin'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === tab);
    document.getElementById('panel-'+t).classList.toggle('active', t === tab);
  });
  const [title, sub] = TITLES[tab];
  document.getElementById('card-title').textContent = title;
  document.getElementById('card-sub').textContent   = sub;
  if (tab === 'reset') goResetStep(1);
}

/* ── Toggle password visibility ── */
function togglePw(id, btn) {
  const inp    = document.getElementById(id);
  const hidden = inp.type === 'password';
  inp.type     = hidden ? 'text' : 'password';
  btn.innerHTML = hidden ? EYE_CLOSE : EYE_OPEN;
}

/* ── Password strength ── */
function _strengthCalc(pw) {
  const rules = {
    len:     pw.length >= 8,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    num:     /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
  return Object.values(rules).filter(Boolean).length;
}
function _applyStrength(score, prefix) {
  const cls   = ['','s-weak','s-fair','s-good','s-strong'];
  const slCls = ['','sl-weak','sl-fair','sl-good','sl-strong'];
  const txt   = ['Enter a password','Weak','Fair','Good','Strong'];
  [1,2,3,4].forEach(i => {
    const b = document.getElementById(prefix + i);
    b.className = 'strength-bar';
    if (i <= score && score > 0) b.classList.add(cls[score]);
  });
  const lbl = document.getElementById(prefix === 'sb' ? 'strength-label' : 'rs-strength-label');
  lbl.className   = 'strength-label' + (score > 0 ? ' ' + slCls[score] : '');
  lbl.textContent = txt[score];
}
function checkStrength(pw) {
  _applyStrength(_strengthCalc(pw), 'sb');
  const errEl = document.getElementById('pw-error');
  if (!pw) { errEl.textContent = ''; errEl.classList.remove('visible'); return; }
  const msg = validatePassword(pw);
  if (msg) { errEl.textContent = msg; errEl.classList.add('visible'); }
  else      { errEl.textContent = ''; errEl.classList.remove('visible'); }
}
function checkStrengthReset(pw) { _applyStrength(_strengthCalc(pw), 'rsb'); }

/* ── Username / confirm helpers ── */
function checkUsername(val) {
  const errEl = document.getElementById('un-error');
  if (!val) { errEl.textContent = ''; errEl.classList.remove('visible'); return; }
  const msg = validateUsername(val);
  if (msg) { errEl.textContent = msg; errEl.classList.add('visible'); }
  else      { errEl.textContent = ''; errEl.classList.remove('visible'); }
}
function checkConfirm(val) {
  const pw    = document.getElementById('su-password').value;
  const errEl = document.getElementById('confirm-error');
  if (!val) { errEl.textContent = ''; errEl.classList.remove('visible'); return; }
  if (val !== pw) { errEl.textContent = 'Passwords do not match.'; errEl.classList.add('visible'); }
  else             { errEl.textContent = ''; errEl.classList.remove('visible'); }
}

/* ── Validators ── */
function validateUsername(val) {
  if (!val || val.length < 3)            return 'Too short — min 3 characters.';
  if (val.length > 30)                   return 'Too long — max 30 characters.';
  if (!/^[A-Za-z0-9._ -]+$/.test(val))  return 'Only letters, numbers, space, _ . - allowed.';
  if (!/^[A-Za-z0-9]/.test(val))        return 'Must start with a letter or number.';
  if (!/[A-Za-z0-9]$/.test(val))        return 'Must end with a letter or number.';
  if (!/[A-Za-z]/.test(val))            return 'Must include at least one letter.';
  return null;
}
function validatePassword(pw) {
  if (pw.length < 8)              return 'Min 8 characters required.';
  if (!/[A-Z]/.test(pw))         return 'Add an uppercase letter (A–Z).';
  if (!/[a-z]/.test(pw))         return 'Add a lowercase letter (a–z).';
  if (!/[0-9]/.test(pw))         return 'Add a number (0–9).';
  if (!/[^A-Za-z0-9]/.test(pw))  return 'Add a special character (!@#$…).';
  return null;
}

/* ── Gmail live check (optional helper — keep if your CSS uses it) ── */
function liveGmailCheck(input, errId) {
  const errEl = document.getElementById(errId);
  if (!errEl) return;
  const val = input.value.trim();
  if (!val) { errEl.textContent = ''; errEl.classList.remove('visible'); return; }
  // basic email format check only
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    errEl.textContent = 'Enter a valid email address.';
    errEl.classList.add('visible');
  } else {
    errEl.textContent = ''; errEl.classList.remove('visible');
  }
}

/* ── Message helpers ── */
function showMsg(panel, type, text) {
  const el = document.getElementById('msg-' + panel);
  el.className = 'msg ' + type;
  document.getElementById('msg-' + panel + '-txt').textContent = text;
}
function clearMsg(p) { document.getElementById('msg-' + p).className = 'msg'; }

/* ── Reset step manager ── */
function goResetStep(n) {
  resetCurrentStep = n;
  [1,2,3].forEach(i => {
    document.getElementById('rs'+i).classList.toggle('active', i === n);
    const dot = document.getElementById('sd'+i);
    const lbl = document.getElementById('slbl'+i);
    dot.className = 'step-dot'  + (i < n ? ' done' : i === n ? ' active' : '');
    lbl.className = 'step-lbl'  + (i < n ? ' done' : i === n ? ' active' : '');
    if (i < 3) {
      document.getElementById('sl'+i).className = 'step-line' + (i < n ? ' done' : '');
    }
  });
  clearMsg('reset');
}

/* ── Reset active form ── */
function resetActiveForm() {
  document.querySelectorAll('input').forEach(el => { el.value = ''; });
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; el.classList.remove('visible'); });
  ['signin','signup','reset','admin'].forEach(p => clearMsg(p));
  if (activeTab === 'reset') goResetStep(1);
  if (typeof grecaptcha !== 'undefined' && _recaptchaWidgetId !== null) grecaptcha.reset(_recaptchaWidgetId);
}


/* ══════════════════════════════════════════════════════════
   SIGN IN (reCAPTCHA v2 — optional, skipped if not configured)
══════════════════════════════════════════════════════════ */
async function handleSignIn() {
  const email    = document.getElementById('si-email').value.trim();
  const password = document.getElementById('si-password').value;
  const captchaErr = document.getElementById('captcha-error');

  if (!email || !password) {
    showMsg('signin', 'error', 'Please enter your email and password.');
    return;
  }

  let recaptchaToken = '';
  if (!_skipCaptcha && _recaptchaWidgetId !== null) {
    recaptchaToken = grecaptcha.getResponse(_recaptchaWidgetId);
    if (!recaptchaToken) {
      if (captchaErr) captchaErr.style.display = 'block';
      return;
    }
  }
  if (captchaErr) captchaErr.style.display = 'none';

  clearMsg('signin');
  const btn = document.getElementById('btn-signin');
  btn.classList.add('loading');

  try {
    const res  = await fetch('/auth/login-captcha', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, recaptcha_token: recaptchaToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (_recaptchaWidgetId !== null) grecaptcha.reset(_recaptchaWidgetId);
      throw new Error(data.detail || 'Incorrect email or password');
    }
    localStorage.setItem('ea_access_token',  data.access_token);
    localStorage.setItem('ea_refresh_token', data.refresh_token);
    showMsg('signin', 'success', 'Signed in! Redirecting…');
    setTimeout(() => { window.location.href = '/home'; }, 700);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('signin', 'error', err.message);
  }
}


/* ══════════════════════════════════════════════════════════
   SIGN UP
══════════════════════════════════════════════════════════ */
async function handleSignUp() {
  const email    = document.getElementById('su-email').value.trim();
  const username = document.getElementById('su-username').value.trim();
  const password = document.getElementById('su-password').value;
  const confirm  = document.getElementById('su-confirm').value;
  if (!email || !username || !password) { showMsg('signup', 'error', 'Please fill in all required fields.'); return; }
  const unErr = validateUsername(username); if (unErr) { showMsg('signup', 'error', unErr); return; }
  const pwErr = validatePassword(password); if (pwErr) { showMsg('signup', 'error', pwErr); return; }
  if (password !== confirm) { showMsg('signup', 'error', 'Passwords do not match.'); return; }

  clearMsg('signup');
  const btn = document.getElementById('btn-signup');
  btn.classList.add('loading');

  try {
    const res  = await fetch('/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        email, username, password,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Registration failed');

    showMsg('signup', 'success', 'Account created! Signing you in…');
    btn.classList.remove('loading');
    setTimeout(() => { switchTab('signin'); document.getElementById('si-email').value = email; }, 1200);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('signup', 'error', err.message);
  }
}


/* ══════════════════════════════════════════════════════════
   ADMIN LOGIN
══════════════════════════════════════════════════════════ */
async function handleAdmin() {
  const username = document.getElementById('ad-username').value.trim();
  const password = document.getElementById('ad-password').value;
  if (!username || !password) { showMsg('admin', 'error', 'Please enter admin email and password.'); return; }
  clearMsg('admin');
  const btn = document.getElementById('btn-admin');
  btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Invalid admin credentials');
    localStorage.setItem('ea_access_token',  data.access_token);
    localStorage.setItem('ea_refresh_token', data.refresh_token);
    localStorage.setItem('ea_is_admin', '1');
    showMsg('admin', 'success', 'Admin access granted! Redirecting…');
    setTimeout(() => { window.location.href = '/admin'; }, 700);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('admin', 'error', err.message);
  }
}


/* ══════════════════════════════════════════════════════════
   GOOGLE OAUTH
══════════════════════════════════════════════════════════ */
function handleGoogleLogin() {
  window.location.href = '/auth/google/login';
}

/* Handle redirect back from Google (tokens arrive in URL hash) */
(function handleGoogleCallback() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access=')) return;

  const params  = new URLSearchParams(hash.substring(1));
  const access  = params.get('access');
  const refresh = params.get('refresh');
  const isAdmin = params.get('admin') === '1';

  if (access) {
    localStorage.setItem('ea_access_token',  access);
    localStorage.setItem('ea_refresh_token', refresh || '');
    if (isAdmin) localStorage.setItem('ea_is_admin', '1');
    window.history.replaceState(null, '', '/login');
    window.location.href = isAdmin ? '/admin' : '/home';
  }
})();


/* ══════════════════════════════════════════════════════════
   PASSWORD RESET — OTP FLOW
══════════════════════════════════════════════════════════ */

/* Step 1: Send OTP */
async function resetStep1() {
  const email = document.getElementById('rs-email').value.trim();
  if (!email) { showMsg('reset', 'error', 'Please enter your email address.'); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs1');
  btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/otp/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Could not send OTP. Please try again.');
    btn.classList.remove('loading');
    verifiedResetEmail = email;
    document.getElementById('rs2-info-text').textContent =
      `OTP sent to ${email}. Enter the 6-digit code below.`;
    goResetStep(2);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('reset', 'error', err.message);
  }
}

/* Step 2: Verify OTP */
async function resetStep2() {
  const otp = document.getElementById('rs-otp').value.trim();
  if (!otp || otp.length < 6) { showMsg('reset', 'error', 'Please enter the 6-digit OTP.'); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs2');
  btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/otp/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: verifiedResetEmail, otp }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'OTP verification failed.');
    btn.classList.remove('loading');
    goResetStep(3);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('reset', 'error', err.message);
  }
}

/* Step 3: Set new password */
async function resetStep3() {
  const otp  = document.getElementById('rs-otp').value.trim();
  const pw   = document.getElementById('rs-newpw').value;
  const cpw  = document.getElementById('rs-confirmpw').value;
  const pwErr = validatePassword(pw);
  if (pwErr)      { showMsg('reset', 'error', pwErr); return; }
  if (pw !== cpw) { showMsg('reset', 'error', 'Passwords do not match.'); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs3');
  btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/otp/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: verifiedResetEmail, otp, new_password: pw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Password reset failed. Please try again.');
    btn.classList.remove('loading');
    showMsg('reset', 'success', 'Password reset successfully! Redirecting to sign in…');
    setTimeout(() => {
      switchTab('signin');
      document.getElementById('si-email').value = verifiedResetEmail;
    }, 1400);
  } catch (err) {
    btn.classList.remove('loading');
    showMsg('reset', 'error', err.message);
  }
}

/* Resend OTP */
async function resendOtp() {
  if (!verifiedResetEmail) return;
  try {
    await fetch('/auth/otp/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: verifiedResetEmail }),
    });
    showMsg('reset', 'success', 'New OTP sent to your email!');
  } catch {
    showMsg('reset', 'error', 'Could not resend OTP. Try again.');
  }
}


/* ══════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════ */

/* Session-expired notice */
if (new URLSearchParams(window.location.search).get('reason') === 'session_expired')
  showMsg('signin', 'error', 'Your session expired. Please sign in again.');

/* Auto-redirect if already logged in */
(function () {
  const t = localStorage.getItem('ea_access_token');
  if (!t) return;
  fetch('/auth/me', { headers: { 'Authorization': 'Bearer ' + t } })
    .then(r => r.json())
    .then(me => { if (me && me.id) window.location.href = me.is_admin ? '/admin' : '/home'; })
    .catch(() => {});
})();