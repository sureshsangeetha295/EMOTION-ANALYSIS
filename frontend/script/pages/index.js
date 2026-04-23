// ── Auth guard: check JWT before allowing /app access ─────────────────────────
function launchApp(e) {
  if (e) e.preventDefault();
  if (Auth.isLoggedIn()) {
    window.location.href = '/livecam';
  } else {
    window.location.href = '/login';
  }
}

// ── Auth state: fetch username from /auth/me → drive greeting ───────────────
document.addEventListener('DOMContentLoaded', function () {
  // Collect token — try every key auth.js might use
  var token = null;
  try {
    var keys = ['access_token','token','ea_token','authToken','jwt','ea_access_token'];
    for (var k = 0; k < keys.length; k++) {
      token = localStorage.getItem(keys[k]);
      if (token) break;
    }
    if (!token && typeof Auth !== 'undefined') {
      if (Auth.getToken) token = Auth.getToken();
      else if (Auth.getAccessToken) token = Auth.getAccessToken();
    }
  } catch(e) {}

  // Try Auth.getUser() cache first (instant — no network)
  try {
    if (!token && typeof Auth !== 'undefined' && Auth.isLoggedIn && Auth.isLoggedIn()) {
      var cached = Auth.getUser ? Auth.getUser() : null;
      if (cached && cached.username) {
        var el = document.getElementById('navGreeting');
        if (el) { el.dataset.username = cached.username.split(' ')[0]; }
        if (window.__startGreeting) window.__startGreeting();
      }
    }
  } catch(e) {}

  if (!token) return;

  // Swap hero CTA to Launch App
  /* Hero btn stays as-is (scrolls to #how) — CTA section handles detect navigation */
  // Swap logout button
  var navActions = document.querySelector('.nav-actions');
  if (navActions) {
    navActions.innerHTML = '<a href="#" onclick="Auth.logout()" class="btn-ghost-sm" style="display:flex;align-items:center;gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Logout</a>';
  }

  // Fetch real username from API — authoritative source
  fetch('/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(user) {
      if (!user || !user.username) return;
      var el = document.getElementById('navGreeting');
      if (!el) return;
      // Use only the first word of the username (handles "Dayana Priya" → "Dayana")
      el.dataset.username = user.username.split(' ')[0];
      if (window.__startGreeting) window.__startGreeting();
    })
    .catch(function() {});
});


const EMOTIONS=[
  {name:'Happiness',pct:87,color:'#f59e0b',ms:28,probs:[2,1,1,87,5,3,1],mouth:'M37 86 Q53 100 69 86',browL:'M26 46 Q34 41 43 43',browR:'M63 43 Q72 41 80 46'},
  {name:'Sadness',pct:65,color:'#3b82f6',ms:31,probs:[5,2,8,3,12,65,5],mouth:'M37 92 Q53 84 69 92',browL:'M26 44 Q34 48 43 46',browR:'M63 46 Q72 48 80 44'},
  {name:'Anger',pct:72,color:'#ef4444',ms:24,probs:[72,5,4,3,8,6,2],mouth:'M38 91 Q53 86 68 91',browL:'M26 48 Q34 44 43 47',browR:'M63 47 Q72 44 80 48'},
  {name:'Surprise',pct:74,color:'#f97316',ms:26,probs:[3,1,6,10,4,2,74],mouth:'M42 88 Q53 97 64 88',browL:'M26 42 Q34 37 43 40',browR:'M63 40 Q72 37 80 42'},
  {name:'Fear',pct:61,color:'#8b5cf6',ms:33,probs:[3,2,61,4,12,6,12],mouth:'M40 90 Q53 86 66 90',browL:'M26 44 Q34 40 43 43',browR:'M63 43 Q72 40 80 44'},
  {name:'Disgust',pct:58,color:'#06b6d4',ms:29,probs:[4,58,3,2,14,12,7],mouth:'M38 90 Q53 85 68 89',browL:'M26 46 Q34 43 43 45',browR:'M63 45 Q72 43 80 46'},
  {name:'Neutral',pct:76,color:'#6b7280',ms:22,probs:[4,2,3,8,76,5,2],mouth:'M38 89 Q53 89 68 89',browL:'M26 45 Q34 43 43 44',browR:'M63 44 Q72 43 80 45'},
];
let ei=0;
function cycleMock(){
  const e=EMOTIONS[ei%EMOTIONS.length];ei++;
  const box=document.getElementById('det-box');
  box.style.borderColor=e.color;
  box.style.boxShadow='0 0 18px '+e.color+'55';
  box.querySelectorAll('.corner').forEach(c=>c.style.borderColor=e.color);
  const lbl=document.getElementById('det-lbl');
  lbl.textContent=e.name+' · '+e.pct+'%';
  lbl.style.background=e.color;
  lbl.style.color=(e.color==='#f59e0b'||e.color==='#f97316')?'#000':'#fff';
  document.getElementById('res-name').textContent=e.name;
  document.getElementById('res-name').style.color=e.color;
  document.getElementById('res-conf').textContent=e.pct+'% confidence';
  document.getElementById('res-ms').textContent=e.ms+' ms';
  const icon=document.getElementById('res-icon');
  icon.style.background=e.color+'22';
  icon.querySelector('svg').setAttribute('stroke',e.color);
  e.probs.forEach((p,i)=>{
    document.getElementById('bf'+i).style.width=p+'%';
    document.getElementById('bp'+i).textContent=p+'%';
  });
  document.getElementById('mock-mouth').setAttribute('d',e.mouth);
  /* Update realtime inference card bars */
  const rtColors=['#f59e0b','#6b7280','#3b82f6','#ef4444','#f97316','#8b5cf6','#06b6d4'];
  const rtOrder=[3,4,0,1,2,5,6]; /* map EMOTIONS.probs indices to rt bar order: happy,neutral,sad,angry,surprise,fear,disgust */
  const rtProbs=[e.probs[3],e.probs[4],e.probs[0],e.probs[1],e.probs[2],e.probs[5],e.probs[6]];
  rtProbs.forEach((p,i)=>{
    const b=document.getElementById('rt-b'+i);
    const s=document.getElementById('rt-p'+i);
    if(b)b.style.width=p+'%';
    if(s)s.textContent=p+'%';
  });
  const rtEmo=document.getElementById('rt-emotion');
  const rtMs=document.getElementById('rt-ms');
  if(rtEmo){rtEmo.textContent=e.name;rtEmo.style.color=e.color;}
  if(rtMs)rtMs.textContent=e.ms+'ms';
  document.getElementById('mock-brow-l').setAttribute('d',e.browL);
  document.getElementById('mock-brow-r').setAttribute('d',e.browR);
}
setInterval(cycleMock,2600);

/* Education card animation */
const eduEmotions=[
  {engage:'86%',focus:'4.2',alert:'Low',alertColor:'#22c55e',mouth:'M37 86 Q53 100 69 86'},
  {engage:'74%',focus:'3.8',alert:'Medium',alertColor:'#f59e0b',mouth:'M37 89 Q53 89 69 89'},
  {engage:'91%',focus:'4.7',alert:'Low',alertColor:'#22c55e',mouth:'M37 86 Q53 100 69 86'},
  {engage:'62%',focus:'3.1',alert:'High',alertColor:'#ef4444',mouth:'M37 93 Q53 85 69 93'},
];
let edi=0;
function cycleEdu(){
  const e=eduEmotions[edi%eduEmotions.length];edi++;
  const engEl=document.getElementById('edu-engage');
  const focEl=document.getElementById('edu-focus');
  const altEl=document.getElementById('edu-alert');
  const mEl=document.getElementById('edu-mouth');
  if(engEl)engEl.textContent=e.engage;
  if(focEl)focEl.textContent=e.focus;
  if(altEl){altEl.textContent=e.alert;altEl.style.color=e.alertColor;}
  if(mEl)mEl.setAttribute('d',e.mouth);
}
setInterval(cycleEdu,3200);

/* Healthcare affect cycle */
const hcAffects=[
  {txt:'Neutral',bg:'rgba(245,158,11,0.1)',color:'#d97706'},
  {txt:'Positive',bg:'rgba(34,197,94,0.1)',color:'#15803d'},
  {txt:'Distressed',bg:'rgba(239,68,68,0.1)',color:'#dc2626'},
  {txt:'Calm',bg:'rgba(14,165,233,0.1)',color:'#0284c7'},
];
let hci=0;
function cycleHC(){
  const a=hcAffects[hci%hcAffects.length];hci++;
  const el=document.getElementById('hc-affect');
  if(el){el.textContent=a.txt;el.style.background=a.bg;el.style.color=a.color;}
}
setInterval(cycleHC,2800);

/* Radar pulse animation */
const polyFrames=[
  '45,15 70,34 66,58 45,74 24,60 22,30',
  '45,12 72,30 68,62 45,76 22,62 20,28',
  '45,18 68,36 64,56 45,72 26,58 24,32',
];
let pfi=0;
function cycleRadar(){
  const el=document.getElementById('psy-poly');
  if(el){el.setAttribute('points',polyFrames[pfi%polyFrames.length]);pfi++;}
}
setInterval(cycleRadar,1800);

/* Intersection observer for card fade-in */
const observer=new IntersectionObserver((entries)=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';}});
},{threshold:0.1});
document.querySelectorAll('.uc-card').forEach(c=>{
  c.style.opacity='0';c.style.transform='translateY(24px)';c.style.transition='opacity 0.6s ease, transform 0.6s ease';
  observer.observe(c);
});

// ── Time-aware typewriter greeting — self-contained, no emoji, no icon ──────
(function () {
  // Returns greeting word based on current hour — no emoji
  function getPhrase() {
    var h = new Date().getHours();
    if (h >= 5  && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 21) return "Good evening";
    return "Good night";
  }

  // "Good morning, Alex" or just "Good morning" if no name yet
  function buildText(username) {
    var phrase = getPhrase();
    var name   = (username || "").trim();
    if (name) {
      return phrase + ", " + name.charAt(0).toUpperCase() + name.slice(1);
    }
    return phrase;
  }

  function typewrite(el, text, delay) {
    el.textContent = "";
    el.classList.remove("nav-greeting--done");
    var i = 0;
    function step() {
      if (i >= text.length) {
        el.textContent = text;
        el.classList.add("nav-greeting--done");
        return;
      }
      el.innerHTML = text.slice(0, i) + '<span class="nav-cursor" aria-hidden="true"></span>';
      i++;
      var last = text[i - 2] || "";
      var wait = last === "," ? 200 : last === " " ? 50 : 68;
      setTimeout(step, wait);
    }
    setTimeout(step, delay || 0);
  }

  function startGreeting() {
    var el = document.getElementById("navGreeting");
    if (!el) return;
    var name = el.dataset.username || window.__username || "";
    typewrite(el, buildText(name), 350);
  }

  function scheduleHourly() {
    var now = new Date();
    var ms  = (60 - now.getMinutes()) * 60000
              - now.getSeconds() * 1000
              - now.getMilliseconds();
    setTimeout(function () {
      startGreeting();
      setInterval(startGreeting, 3600000);
    }, ms);
  }

  window.__startGreeting = startGreeting;

  document.addEventListener("DOMContentLoaded", function () {
    startGreeting();
    scheduleHourly();
  });
})();

(function(){
  var btn=document.getElementById('hamburgerBtn');
  var closeBtn=document.getElementById('drawerCloseBtn');
  var drawer=document.getElementById('mobileDrawer');
  var overlay=document.getElementById('mobileOverlay');
  if(!btn)return;
  function openD(){btn.classList.add('open');if(drawer){drawer.classList.add('open');}if(overlay)overlay.classList.add('open');btn.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
  function closeD(){btn.classList.remove('open');if(drawer){drawer.classList.remove('open');}if(overlay)overlay.classList.remove('open');btn.setAttribute('aria-expanded','false');document.body.style.overflow='';}
  window.closeDrawer=closeD;
  btn.addEventListener('click',function(){btn.classList.contains('open')?closeD():openD();});
  if(closeBtn)closeBtn.addEventListener('click',closeD);
  if(overlay)overlay.addEventListener('click',closeD);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeD();});
  if(drawer)drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeD);});
})();