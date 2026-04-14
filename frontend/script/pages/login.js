const EYE_OPEN  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

let activeTab = 'signin';
let resetCurrentStep = 1;
let verifiedResetEmail = '';

const TITLES = {
  signin: ['Hi there!', 'Sign in to continue to your dashboard'],
  signup: ['Create account', 'Set up your free account in seconds'],
  reset:  ['Reset password', 'Recover access in a few simple steps'],
  admin:  ['Admin portal', 'Restricted — authorised personnel only'],
};

function switchTab(tab) {
  activeTab = tab;
  ['signin','signup','reset','admin'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
    document.getElementById('panel-'+t).classList.toggle('active', t===tab);
  });
  const [title, sub] = TITLES[tab];
  document.getElementById('card-title').textContent = title;
  document.getElementById('card-sub').textContent   = sub;
  if (tab === 'reset') goResetStep(1);
  if (tab === 'signin') setTimeout(generateCaptcha, 50);
}

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  const hidden = inp.type === 'password';
  inp.type = hidden ? 'text' : 'password';
  btn.innerHTML = hidden ? EYE_CLOSE : EYE_OPEN;
}

/* ── Gmail validation ── */
function validateGmail(email) {
  if (!email || !email.trim()) return 'Please enter your email address.';
  const t = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'Please enter a valid email address.';
  if (!t.endsWith('@gmail.com')) return 'Only Gmail addresses (@gmail.com) are accepted.';
  return null;
}
function liveGmailCheck(input, errorId) {
  const val = input.value.trim();
  const errEl = document.getElementById(errorId);
  if (!errEl) return;

  // Clear and return silently if nothing typed yet
  if (!val) { errEl.textContent = ''; errEl.classList.remove('visible'); return; }

  // As soon as @ is present, validate the full email
  if (val.includes('@')) {
    const atIndex = val.indexOf('@');
    const domain = val.slice(atIndex + 1).toLowerCase();

    // Show error immediately if domain is being typed and it's not gmail.com
    if (domain.length > 0 && !('gmail.com'.startsWith(domain)) && domain !== 'gmail.com') {
      errEl.textContent = 'Only @gmail.com addresses are accepted.';
      errEl.style.color = '#dc2626';
      errEl.style.display = 'block';
      errEl.classList.add('visible');
      return;
    }

    // Full validation once domain looks complete (has a dot)
    if (domain.includes('.')) {
      const msg = validateGmail(val);
      if (msg) {
        errEl.textContent = msg;
        errEl.style.color = '#dc2626';
        errEl.style.display = 'block';
        errEl.classList.add('visible');
      } else {
        errEl.textContent = '';
        errEl.style.display = '';
        errEl.classList.remove('visible');
      }
      return;
    }
  }

  errEl.textContent = '';
  errEl.style.display = '';
  errEl.classList.remove('visible');
}

/* ── Strength checker ── */
function _strengthCalc(pw) {
  const rules = {len:pw.length>=8,upper:/[A-Z]/.test(pw),lower:/[a-z]/.test(pw),num:/[0-9]/.test(pw),special:/[^A-Za-z0-9]/.test(pw)};
  return Object.values(rules).filter(Boolean).length;
}
function _applyStrength(score, prefix) {
  const cls=['','s-weak','s-fair','s-good','s-strong'];
  const slCls=['','sl-weak','sl-fair','sl-good','sl-strong'];
  const txt=['Enter a password','Weak','Fair','Good','Strong'];
  [1,2,3,4].forEach(i=>{const b=document.getElementById(prefix+i);b.className='strength-bar';if(i<=score&&score>0)b.classList.add(cls[score]);});
  const lbl=document.getElementById(prefix==='sb'?'strength-label':'rs-strength-label');
  lbl.className='strength-label'+(score>0?' '+slCls[score]:'');lbl.textContent=txt[score];
}
function checkStrength(pw) {
  _applyStrength(_strengthCalc(pw), 'sb');
  const errEl=document.getElementById('pw-error');
  if(!pw){errEl.textContent='';errEl.classList.remove('visible');return;}
  const msg=validatePassword(pw);
  if(msg){errEl.textContent=msg;errEl.classList.add('visible');}else{errEl.textContent='';errEl.classList.remove('visible');}
}
function checkStrengthReset(pw) { _applyStrength(_strengthCalc(pw), 'rsb'); }

function checkUsername(val) {
  const errEl=document.getElementById('un-error');
  if(!val){errEl.textContent='';errEl.classList.remove('visible');return;}
  const msg=validateUsername(val);
  if(msg){errEl.textContent=msg;errEl.classList.add('visible');}else{errEl.textContent='';errEl.classList.remove('visible');}
}
function checkConfirm(val) {
  const pw=document.getElementById('su-password').value;
  const errEl=document.getElementById('confirm-error');
  if(!val){errEl.textContent='';errEl.classList.remove('visible');return;}
  if(val!==pw){errEl.textContent='Passwords do not match.';errEl.classList.add('visible');}
  else{errEl.textContent='';errEl.classList.remove('visible');}
}

function validateUsername(val) {
  if(!val||val.length<3) return 'Too short — min 3 characters.';
  if(val.length>30) return 'Too long — max 30 characters.';
  if(!/^[A-Za-z0-9._ -]+$/.test(val)) return 'Only letters, numbers, space, _ . - allowed.';
  if(!/^[A-Za-z0-9]/.test(val)) return 'Must start with a letter or number.';
  if(!/[A-Za-z0-9]$/.test(val)) return 'Must end with a letter or number.';
  if(!/[A-Za-z]/.test(val)) return 'Must include at least one letter.';
  return null;
}
function validatePassword(pw) {
  if(pw.length<8) return 'Min 8 characters required.';
  if(!/[A-Z]/.test(pw)) return 'Add an uppercase letter (A–Z).';
  if(!/[a-z]/.test(pw)) return 'Add a lowercase letter (a–z).';
  if(!/[0-9]/.test(pw)) return 'Add a number (0–9).';
  if(!/[^A-Za-z0-9]/.test(pw)) return 'Add a special character (!@#$…).';
  return null;
}

function showMsg(panel,type,text){
  const el=document.getElementById('msg-'+panel);
  el.className='msg '+type;
  document.getElementById('msg-'+panel+'-txt').textContent=text;
}
function clearMsg(p){document.getElementById('msg-'+p).className='msg';}

/* ── Reset flow step management ── */
function goResetStep(n) {
  resetCurrentStep = n;
  [1,2,3].forEach(i => {
    document.getElementById('rs'+i).classList.toggle('active', i===n);
    const dot = document.getElementById('sd'+i);
    const lbl = document.getElementById('slbl'+i);
    dot.className = 'step-dot' + (i<n?' done':i===n?' active':'');
    lbl.className = 'step-lbl' + (i<n?' done':i===n?' active':'');
    if (i<3) {
      document.getElementById('sl'+i).className = 'step-line' + (i<n?' done':'');
    }
  });
  clearMsg('reset');
}

/* ── Reset Step 1 ── */
async function resetStep1() {
  const email = document.getElementById('rs-email').value.trim();
  const gmailErr = validateGmail(email);
  if (gmailErr) { showMsg('reset','error', gmailErr); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs1'); btn.classList.add('loading');
  try {
    const res = await fetch('/auth/reset/verify-email', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Could not verify email. Please try again.');
    btn.classList.remove('loading');
    verifiedResetEmail = email;
    document.getElementById('rs-q1-label').textContent = data.q1label;
    document.getElementById('rs-q2-label').textContent = data.q2label;
    goResetStep(2);
  } catch(err) { btn.classList.remove('loading'); showMsg('reset','error',err.message); }
}

/* ── Reset Step 2 ── */
async function resetStep2() {
  const a1 = document.getElementById('rs-a1').value.trim().toLowerCase();
  const a2 = document.getElementById('rs-a2').value.trim().toLowerCase();
  if (!a1 || !a2) { showMsg('reset','error','Please answer both security questions.'); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs2'); btn.classList.add('loading');
  try {
    const res = await fetch('/auth/reset/verify-answers', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: verifiedResetEmail, a1, a2})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Answers do not match. Please check and try again.');
    btn.classList.remove('loading');
    goResetStep(3);
  } catch(err) { btn.classList.remove('loading'); showMsg('reset','error',err.message); }
}

/* ── Reset Step 3 ── */
async function resetStep3() {
  const pw  = document.getElementById('rs-newpw').value;
  const cpw = document.getElementById('rs-confirmpw').value;
  const pwErr = validatePassword(pw);
  if (pwErr) { showMsg('reset','error', pwErr); return; }
  if (pw !== cpw) { showMsg('reset','error','Passwords do not match.'); return; }
  clearMsg('reset');
  const btn = document.getElementById('btn-rs3'); btn.classList.add('loading');
  try {
    const res = await fetch('/auth/reset/password', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email: verifiedResetEmail, new_password: pw})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Password reset failed. Please try again.');
    btn.classList.remove('loading');
    showMsg('reset','success','Password reset successfully! Redirecting to sign in…');
    setTimeout(() => {
      switchTab('signin');
      document.getElementById('si-email').value = verifiedResetEmail;
    }, 1400);
  } catch(err) { btn.classList.remove('loading'); showMsg('reset','error',err.message); }
}

/* ── CAPTCHA ── */
let currentCaptcha = '';

function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  currentCaptcha = code;

  const canvas = document.getElementById('captcha-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#edeae4';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 200; i++) {
    const a = Math.random() * 0.06;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(Math.random()*W, Math.random()*H, 1.5, 1.5);
  }

  ctx.strokeStyle = 'rgba(180,170,160,0.5)';
  ctx.lineWidth = 0.6;
  for (let x = 0; x < W; x += 12) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 12) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  for (let l = 0; l < 4; l++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${100+Math.random()*80},${80+Math.random()*60},${60+Math.random()*40},0.35)`;
    ctx.lineWidth = 1 + Math.random() * 1.2;
    const yBase = 10 + Math.random() * (H - 20);
    ctx.moveTo(0, yBase);
    for (let x = 0; x <= W; x += 6) {
      ctx.lineTo(x, yBase + Math.sin(x * 0.07 + l) * (5 + Math.random() * 6));
    }
    ctx.stroke();
  }

  const charW = (W - 20) / code.length;
  const fonts = ['bold italic', 'bold', '900 italic', '800'];
  for (let i = 0; i < code.length; i++) {
    ctx.save();
    const cx = 10 + i * charW + charW * 0.5 + (Math.random() - 0.5) * 5;
    const cy = H / 2 + (Math.random() - 0.5) * 10;
    ctx.translate(cx, cy);
    ctx.rotate((Math.random() - 0.5) * 0.85);
    ctx.transform(1, (Math.random()-0.5)*0.3, (Math.random()-0.5)*0.25, 1, 0, 0);
    const sz = 22 + Math.random() * 8;
    const fw = fonts[Math.floor(Math.random() * fonts.length)];
    ctx.font = `${fw} ${sz}px 'Fraunces', Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const inkColors = ['#1a1612','#1e2a4a','#2d1a0e','#0d2b1a','#3a1a2e','#1a2a3a'];
    const col = inkColors[Math.floor(Math.random() * inkColors.length)];
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.random() * 1.5;
    ctx.strokeText(code[i], 0, 0);
    ctx.fillStyle = col;
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  for (let s = 0; s < 6; s++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(80,60,40,${0.1 + Math.random()*0.12})`;
    ctx.lineWidth = 0.8 + Math.random();
    ctx.moveTo(Math.random()*W, Math.random()*H);
    ctx.bezierCurveTo(
      Math.random()*W, Math.random()*H,
      Math.random()*W, Math.random()*H,
      Math.random()*W, Math.random()*H
    );
    ctx.stroke();
  }

  const inp = document.getElementById('si-captcha');
  if (inp) inp.value = '';
  const err = document.getElementById('captcha-error');
  if (err) err.classList.remove('visible');
}

document.addEventListener('DOMContentLoaded', generateCaptcha);

function resetActiveForm() {
  if (activeTab === 'signin') {
    document.getElementById('si-email').value    = '';
    document.getElementById('si-password').value = '';
    document.getElementById('si-captcha').value  = '';
    clearMsg('signin');
    document.getElementById('captcha-error').classList.remove('visible');
    const errEl = document.getElementById('msg-si-email');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
    generateCaptcha();
    document.getElementById('si-email').focus();
  } else if (activeTab === 'signup') {
    ['su-email','su-username','su-password','su-confirm','sq1-a','sq2-a'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('sq1-q').selectedIndex = 0;
    document.getElementById('sq2-q').selectedIndex = 0;
    clearMsg('signup');
    ['un-error','pw-error','confirm-error','msg-su-email'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.classList.remove('visible'); }
    });
    _applyStrength(0, 'sb');
    _applyStrength(0, 'rsb');
    document.getElementById('su-email').focus();
  } else if (activeTab === 'admin') {
    document.getElementById('ad-username').value = '';
    document.getElementById('ad-password').value = '';
    clearMsg('admin');
    const errEl = document.getElementById('msg-ad-email');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
    document.getElementById('ad-username').focus();
  } else if (activeTab === 'reset') {
    ['rs-email','rs-a1','rs-a2','rs-newpw','rs-confirmpw'].forEach(id => {
      document.getElementById(id).value = '';
    });
    clearMsg('reset');
    const errEl = document.getElementById('msg-rs-email');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
    goResetStep(1);
  }
}

/* ── Sign In ── */
async function handleSignIn() {
  const email    = document.getElementById('si-email').value.trim();
  const password = document.getElementById('si-password').value;
  const captchaInput = document.getElementById('si-captcha').value.trim();
  const captchaErr   = document.getElementById('captcha-error');

  if (!email || !password) { showMsg('signin','error','Please enter your email and password.'); return; }
  const gmailErr = validateGmail(email);
  if (gmailErr) {
    showMsg('signin','error', gmailErr);
    const fieldErr = document.getElementById('msg-si-email');
    if (fieldErr) { fieldErr.textContent = gmailErr; fieldErr.style.color='#dc2626'; fieldErr.style.display='block'; fieldErr.classList.add('visible'); }
    return;
  }

  if (!captchaInput) {
    captchaErr.textContent = 'Please enter the verification code.';
    captchaErr.classList.add('visible');
    generateCaptcha();
    return;
  }
  if (captchaInput !== currentCaptcha) {
    captchaErr.textContent = 'Incorrect code. Please try again.';
    captchaErr.classList.add('visible');
    generateCaptcha();
    return;
  }
  captchaErr.classList.remove('visible');

  clearMsg('signin');
  const btn = document.getElementById('btn-signin'); btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:email,password})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail||'Incorrect email or password');
    localStorage.setItem('ea_access_token',  data.access_token);
    localStorage.setItem('ea_refresh_token', data.refresh_token);
    showMsg('signin','success','Signed in! Redirecting…');
    setTimeout(()=>{ window.location.href='/home'; }, 700);
  } catch(err) { btn.classList.remove('loading'); showMsg('signin','error',err.message); generateCaptcha(); }
}

/* ── Sign Up ── */
async function handleSignUp() {
  const email    = document.getElementById('su-email').value.trim();
  const username = document.getElementById('su-username').value.trim();
  const password = document.getElementById('su-password').value;
  const confirm  = document.getElementById('su-confirm').value;
  const sq1q     = document.getElementById('sq1-q').value;
  const sq1a     = document.getElementById('sq1-a').value.trim();
  const sq2q     = document.getElementById('sq2-q').value;
  const sq2a     = document.getElementById('sq2-a').value.trim();

  if (!email||!username||!password) { showMsg('signup','error','Please fill in all required fields.'); return; }
  const gmailErr = validateGmail(email);
  if (gmailErr) {
    showMsg('signup','error', gmailErr);
    const fieldErr = document.getElementById('msg-su-email');
    if (fieldErr) { fieldErr.textContent = gmailErr; fieldErr.style.color='#dc2626'; fieldErr.style.display='block'; fieldErr.classList.add('visible'); }
    return;
  }
  const unErr = validateUsername(username); if (unErr) { showMsg('signup','error',unErr); return; }
  const pwErr = validatePassword(password); if (pwErr) { showMsg('signup','error',pwErr); return; }
  if (password!==confirm) { showMsg('signup','error','Passwords do not match.'); return; }
  if (!sq1q||!sq1a) { showMsg('signup','error','Please select and answer Security Question 1.'); return; }
  if (!sq2q||!sq2a) { showMsg('signup','error','Please select and answer Security Question 2.'); return; }
  if (sq1q===sq2q)  { showMsg('signup','error','Please choose two different security questions.'); return; }

  clearMsg('signup');
  const btn = document.getElementById('btn-signup'); btn.classList.add('loading');
  try {
    const res = await fetch('/auth/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, username, password, security_q1: sq1q, security_a1: sq1a.toLowerCase(), security_q2: sq2q, security_a2: sq2a.toLowerCase()})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail||'Registration failed');

    const qMap = {
      school:'What was the name of your first school?',pet:'What was the name of your first pet?',
      city:'In what city were you born?',mother:"What is your mother's maiden name?",
      street:'What street did you grow up on?',food:'What is your all-time favourite food?',
      movie:'What is your favourite childhood movie?',teacher:"What was your favourite teacher's name?",
      sport:'What sport did you play first?',colour:'What is your favourite colour?'
    };
    localStorage.setItem('ea_sq_' + email, JSON.stringify({
      q1label: qMap[sq1q] || sq1q,
      q2label: qMap[sq2q] || sq2q,
      a1: sq1a.toLowerCase(),
      a2: sq2a.toLowerCase()
    }));

    showMsg('signup','success','Account created! Signing you in…');
    btn.classList.remove('loading');
    setTimeout(()=>{ switchTab('signin'); document.getElementById('si-email').value=email; }, 1200);
  } catch(err) { btn.classList.remove('loading'); showMsg('signup','error',err.message); }
}

/* ── Admin ── */
async function handleAdmin() {
  const username = document.getElementById('ad-username').value.trim();
  const password = document.getElementById('ad-password').value;
  if (!username||!password) { showMsg('admin','error','Please enter admin email and password.'); return; }
  const gmailErr = validateGmail(username);
  if (gmailErr) {
    showMsg('admin','error', gmailErr);
    const fieldErr = document.getElementById('msg-ad-email');
    if (fieldErr) { fieldErr.textContent = gmailErr; fieldErr.style.color='#dc2626'; fieldErr.style.display='block'; fieldErr.classList.add('visible'); }
    return;
  }
  clearMsg('admin');
  const btn = document.getElementById('btn-admin'); btn.classList.add('loading');
  try {
    const res  = await fetch('/auth/admin/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username,password})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail||'Invalid admin credentials');
    localStorage.setItem('ea_access_token',  data.access_token);
    localStorage.setItem('ea_refresh_token', data.refresh_token);
    localStorage.setItem('ea_is_admin','1');
    showMsg('admin','success','Admin access granted! Redirecting…');
    setTimeout(()=>{ window.location.href='/admin'; }, 700);
  } catch(err) { btn.classList.remove('loading'); showMsg('admin','error',err.message); }
}

/* ── Keyboard ── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (activeTab==='signin')  handleSignIn();
  else if (activeTab==='signup') handleSignUp();
  else if (activeTab==='reset') {
    if (resetCurrentStep===1) resetStep1();
    else if (resetCurrentStep===2) resetStep2();
    else resetStep3();
  }
  else handleAdmin();
});

/* ── Session expired notice ── */
if (new URLSearchParams(window.location.search).get('reason')==='session_expired')
  showMsg('signin','error','Your session expired. Please sign in again.');

/* ── Auto-redirect if already logged in ── */
(function(){
  const t = localStorage.getItem('ea_access_token');
  if (!t) return;
  fetch('/auth/me',{headers:{'Authorization':'Bearer '+t}})
    .then(r=>r.json())
    .then(me=>{ if(me&&me.id) window.location.href=me.is_admin?'/admin':'/home'; })
    .catch(()=>{});
})();