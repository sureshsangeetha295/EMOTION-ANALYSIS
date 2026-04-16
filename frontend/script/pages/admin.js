const TOKEN = () => localStorage.getItem('ea_access_token');
let currentTable = 'users';
let allData = [], filteredData = [], page = 1;
const PAGE_SIZE = 10;
let pendingDelete = null;
const HEADERS = { Authorization: () => ({ 'Authorization': 'Bearer ' + TOKEN() }) };

/* ── Clock ── */
function updateClock() {
  const now = new Date();
  document.getElementById('topbar-time').textContent =
    now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}) + ' · ' +
    now.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
updateClock(); setInterval(updateClock, 30000);

/* ── Boot ── */
async function boot() {
  if (!TOKEN()) { window.location.href = '/login'; return; }
  const me = await apiFetch('/auth/me');
  if (!me || !me.is_admin) { window.location.href = '/login'; return; }
  loadStats();
  loadAllBadges();
  loadTable();
}

async function apiFetch(url, opts={}) {
  try {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers||{}), ...HEADERS.Authorization() } });
    if (res.status === 401) { window.location.href = '/login?reason=session_expired'; return null; }
    return res.ok ? res.json() : null;
  } catch { return null; }
}

/* ── Load all badge counts upfront ── */
async function loadAllBadges() {
  const [users, detections, feedback, faqFeedback, faqs] = await Promise.all([
    apiFetch('/admin/users'),
    apiFetch('/admin/detections'),
    apiFetch('/admin/feedback'),
    apiFetch('/admin/faq-feedback'),
    apiFetch('/admin/faqs'),
  ]);
  if (Array.isArray(users))       document.getElementById('badge-users').textContent       = users.length;
  if (Array.isArray(detections))  document.getElementById('badge-detections').textContent  = detections.length;
  if (Array.isArray(feedback))    document.getElementById('badge-feedback').textContent    = feedback.length;
  if (Array.isArray(faqFeedback)) document.getElementById('badge-faq-feedback').textContent = faqFeedback.length;
  if (Array.isArray(faqs))        document.getElementById('badge-manage-faqs').textContent = faqs.length;
}

/* ── Stats ── */
async function loadStats() {
  const d = await apiFetch('/admin/stats');
  if (!d) return;
  const u  = d.total_users      ?? 0;
  const de = d.total_detections ?? 0;
  const fb = d.total_feedback   ?? 0;
  const en = d.avg_engagement   != null ? d.avg_engagement * 100 : null;
  animateCount('s-users',      u);
  animateCount('s-detections', de);
  animateCount('s-feedback',   fb);
  if (en !== null) {
    animateDecimal('s-engagement', en, '%');
    setTimeout(() => {
      document.getElementById('bar-engagement').style.width = Math.min(en,100) + '%';
    }, 200);
  } else {
    document.getElementById('s-engagement').textContent = '—';
  }
  const maxVal = Math.max(u, de, fb, 1);
  setTimeout(() => {
    document.getElementById('bar-users').style.width      = (u  / maxVal * 90) + '%';
    document.getElementById('bar-detections').style.width = (de / maxVal * 90) + '%';
    document.getElementById('bar-feedback').style.width   = (fb / maxVal * 90) + '%';
  }, 300);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  const duration = 800, startTime = performance.now();
  function step(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1-p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateDecimal(id, target, suffix='') {
  const el = document.getElementById(id);
  const duration = 800, startTime = performance.now();
  function step(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1-p, 3);
    el.textContent = (eased * target).toFixed(1) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── Table switching ── */
function switchTable(name) {
  currentTable = name; page = 1;

  const isFaqs = name === 'manage-faqs';
  document.getElementById('toolbar-default').style.display = isFaqs ? 'none' : '';
  document.getElementById('toolbar-faqs').style.display    = isFaqs ? ''     : 'none';

  if (!isFaqs) {
    document.getElementById('search-input').value = '';
    document.getElementById('search-wrap').classList.remove('has-value');
  } else {
    const fi = document.getElementById('faq-search-input');
    if (fi) fi.value = '';
  }

  document.querySelectorAll('.ttab').forEach(b => b.classList.remove('active'));
  document.getElementById('ttab-'+name).classList.add('active');
  loadTable();
}

async function loadTable() {
  if (currentTable === 'manage-faqs') {
    showLoading();
    document.getElementById('pagination').innerHTML = '';
    document.getElementById('faq-count-badge').textContent = '';
    await loadManageFaqs();
    return;
  }
  showLoading();
  const endpoints = { users:'/admin/users', detections:'/admin/detections', feedback:'/admin/feedback', 'faq-feedback':'/admin/faq-feedback' };
  const data = await apiFetch(endpoints[currentTable]);
  allData = Array.isArray(data) ? data : [];
  allData.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  document.getElementById('badge-'+currentTable).textContent = allData.length;
  setupFilters(); applyFilters();
}

async function onRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');
  const faqBtn = document.getElementById('faq-refresh-btn');
  if (faqBtn) faqBtn.classList.add('spinning');
  await Promise.all([loadStats(), loadAllBadges()]);
  await loadTable();
  setTimeout(() => {
    if (btn) btn.classList.remove('spinning');
    if (faqBtn) faqBtn.classList.remove('spinning');
  }, 500);
}

function setupFilters() {
  const sel = document.getElementById('filter-select');
  let opts = [['','All']];
  if (currentTable==='users')        opts = [['','All'],['admin','Admin'],['user','User']];
  if (currentTable==='detections')   opts = [['','All'],['Happiness','Happiness'],['Sadness','Sadness'],['Anger','Anger'],['Fear','Fear'],['Neutral','Neutral'],['Surprise','Surprise'],['Disgust','Disgust'],['webcam','Webcam'],['upload','Upload']];
  if (currentTable==='feedback')     opts = [['','All'],['General','General'],['Bug report','Bug report'],['Feature request','Feature request'],['Accuracy','Accuracy'],['Performance','Performance'],['UI / Design','UI / Design']];
  if (currentTable==='faq-feedback') opts = [['','All'],['liked','👍 Liked'],['disliked','👎 Disliked'],['complaint','Has Complaint']];
  sel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
}

function onSearch() {
  const val = document.getElementById('search-input').value;
  document.getElementById('search-wrap').classList.toggle('has-value', val.length > 0);
  page=1; applyFilters();
}
function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-wrap').classList.remove('has-value');
  document.getElementById('search-input').focus();
  page=1; applyFilters();
}
function onFilter() { page=1; applyFilters(); }

function applyFilters() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const f = document.getElementById('filter-select').value.toLowerCase();
  filteredData = allData.filter(row => {
    const str = Object.values(row).join(' ').toLowerCase();
    if (q && !str.includes(q)) return false;
    if (!f) return true;
    if (currentTable==='users') { if (f==='admin') return row.is_admin; if (f==='user') return !row.is_admin; }
    if (currentTable==='faq-feedback' && f==='complaint') return !!(row.complaint && row.complaint.trim());
    if (currentTable==='faq-feedback' && (f==='liked' || f==='disliked')) return row.vote === f;
    return str.includes(f);
  });
  document.getElementById('count-badge').textContent = `${filteredData.length} record${filteredData.length!==1?'s':''}`;
  renderTable(); renderPagination();
}

function showLoading() {
  document.getElementById('table-body').innerHTML = '<tr class="loading-row"><td colspan="10"><div class="spin"></div></td></tr>';
  document.getElementById('table-head').innerHTML = '';
  document.getElementById('pagination').innerHTML = '';
  document.getElementById('count-badge').textContent = '';
}

function fmtDate(s) {
  if (!s) return '<span style="color:var(--text3)">—</span>';
  try {
    const d = new Date(s);
    return `${String(d.getDate()).padStart(2,'0')} ${d.toLocaleString('default',{month:'long'})} ${d.getFullYear()}`;
  } catch { return s; }
}

function emotionChipClass(e) {
  if (!e) return '';
  const map = {happiness:'happiness',sadness:'sadness',anger:'anger',fear:'fear',neutral:'neutral',surprise:'surprise',disgust:'disgust'};
  return map[e.toLowerCase()] || '';
}

function engBar(v) {
  if (v==null) return '<span style="color:var(--text3)">—</span>';
  const pct = Math.round(v*100);
  const col = pct>=70?'var(--green)':pct>=40?'var(--yellow)':'var(--red)';
  return `<div class="eng-wrap">
    <div class="eng-bar-bg"><div class="eng-bar-fill" style="width:${pct}%;background:${col}"></div></div>
    <span class="eng-val" style="color:${col}">${pct}%</span>
  </div>`;
}

function stars(n) {
  if (!n) return '<span style="color:var(--text3)">—</span>';
  return `<span class="chip-star">${'★'.repeat(n)}<span style="opacity:.2">${'★'.repeat(5-n)}</span></span>`;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
}

const DEL_ICON    = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const SHIELD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

function renderTable() {
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  const slice = filteredData.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const base = (page-1)*PAGE_SIZE+1;

  if (currentTable === 'users') {
    head.innerHTML = `<tr>
      <th>#</th><th>User</th><th>Role</th><th>Joined</th><th>Last Login</th><th>Actions</th>
    </tr>`;
    body.innerHTML = slice.length===0
      ? `<tr class="empty-row"><td colspan="6"><span class="empty-icon">👥</span><span class="empty-label">No users found</span></td></tr>`
      : slice.map((r,i) => `<tr>
          <td><span class="row-num">${base+i}</span></td>
          <td>
            <div class="user-cell">
              <div class="avatar">${initials(r.username)}</div>
              <div>
                <div class="user-name">${r.username}</div>
                <div class="user-email">${r.email||'—'}</div>
              </div>
            </div>
          </td>
          <td><span class="chip ${r.is_admin?'chip-admin':'chip-user'}">${r.is_admin?'Admin':'User'}</span></td>
          <td style="color:var(--text2)">${fmtDate(r.created_at)}</td>
          <td style="color:var(--text2)">${fmtDate(r.last_login)}</td>
          <td>
            <div class="action-group">
              <button class="toggle-btn" title="Toggle Admin" onclick="toggleAdmin(${r.id})">${SHIELD_ICON}</button>
              <button class="del-btn" title="Delete user" onclick="askDelete('users',${r.id},'user &ldquo;${r.username}&rdquo;')">${DEL_ICON}</button>
            </div>
          </td>
        </tr>`).join('');
  }
  else if (currentTable === 'detections') {
    head.innerHTML = `<tr>
      <th>#</th><th>User</th><th>Emotion</th><th>Confidence</th><th>Engagement</th><th>Source</th><th>Time</th><th>Del</th>
    </tr>`;
    body.innerHTML = slice.length===0
      ? `<tr class="empty-row"><td colspan="8"><span class="empty-icon">😶</span><span class="empty-label">No detections found</span></td></tr>`
      : slice.map((r,i) => `<tr>
          <td><span class="row-num">${base+i}</span></td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="font-size:10px">${initials(r.username??String(r.user_id??'?'))}</div>
              <b>${r.username??(r.user_id??'—')}</b>
            </div>
          </td>
          <td><span class="chip chip-emotion ${emotionChipClass(r.emotion)}">${r.emotion}</span></td>
          <td style="font-weight:700;font-variant-numeric:tabular-nums">${r.confidence!=null?Math.round(r.confidence*100)+'%':'—'}</td>
          <td>${engBar(r.engagement)}</td>
          <td><span class="chip chip-source">${r.source}</span></td>
          <td style="color:var(--text2)">${fmtDate(r.created_at)}</td>
          <td><button class="del-btn" title="Delete" onclick="askDelete('detections',${r.id},'detection #${r.id}')">${DEL_ICON}</button></td>
        </tr>`).join('');
  }
  else if (currentTable === 'feedback') {
    head.innerHTML = `<tr>
      <th>#</th><th>User</th><th>Rating</th><th>Category</th><th>Message</th><th>Time</th><th>Del</th>
    </tr>`;
    body.innerHTML = slice.length===0
      ? `<tr class="empty-row"><td colspan="7"><span class="empty-icon">💬</span><span class="empty-label">No feedback yet</span></td></tr>`
      : slice.map((r,i) => `<tr>
          <td><span class="row-num">${base+i}</span></td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="font-size:10px">${initials(r.username??'Guest')}</div>
              <b>${r.username??'Guest'}</b>
            </div>
          </td>
          <td>${stars(r.rating)}</td>
          <td><span class="chip chip-cat">${r.category}</span></td>
          <td class="wrap" style="max-width:200px;color:var(--text2)">${r.message}</td>
          <td style="color:var(--text2)">${fmtDate(r.created_at)}</td>
          <td><button class="del-btn" title="Delete" onclick="askDelete('feedback',${r.id},'feedback #${r.id}')">${DEL_ICON}</button></td>
        </tr>`).join('');
  }
  else if (currentTable === 'faq-feedback') {
    head.innerHTML = `<tr>
      <th>#</th><th>Question</th><th>Vote</th><th>Complaint</th><th>User</th><th>Date</th><th>Del</th>
    </tr>`;
    body.innerHTML = slice.length===0
      ? `<tr class="empty-row"><td colspan="7"><span class="empty-icon">❓</span><span class="empty-label">No FAQ feedback yet</span></td></tr>`
      : slice.map((r,i) => `<tr>
          <td><span class="row-num">${base+i}</span></td>
          <td class="wrap" style="max-width:220px;color:var(--text2)">${r.faq_question}</td>
          <td><span class="chip ${r.vote==='liked'?'chip-liked':'chip-disliked'}">${r.vote==='liked'?'👍 Liked':'👎 Disliked'}</span></td>
          <td class="wrap" style="max-width:180px;color:var(--text2)">${r.complaint||'<span style="color:var(--text3)">—</span>'}</td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="font-size:10px">${initials(r.username??'Guest')}</div>
              <b>${r.username??'Guest'}</b>
            </div>
          </td>
          <td style="color:var(--text2)">${fmtDate(r.created_at)}</td>
          <td><button class="del-btn" title="Delete" onclick="askDelete('faq-feedback',${r.id},'FAQ feedback #${r.id}')">${DEL_ICON}</button></td>
        </tr>`).join('');
  }
}

function renderPagination() {
  const total = Math.max(1, Math.ceil(filteredData.length/PAGE_SIZE));
  const pg = document.getElementById('pagination');
  if (filteredData.length===0) { pg.innerHTML=''; return; }
  pg.innerHTML = `
    <span class="page-info">${filteredData.length} record${filteredData.length!==1?'s':''}</span>
    <button class="page-btn" onclick="goPage(${page-1})" ${page<=1?'disabled':''}>←</button>
    <span style="font-size:12px;color:var(--text2);padding:0 6px;font-weight:600">${page} / ${total}</span>
    <button class="page-btn" onclick="goPage(${page+1})" ${page>=total?'disabled':''}>→</button>`;
}

function goPage(p) {
  const total = Math.ceil(filteredData.length/PAGE_SIZE);
  if (p<1||p>total) return;
  page=p; renderTable(); renderPagination();
  document.querySelector('.panel').scrollIntoView({behavior:'smooth',block:'start'});
}

function askDelete(table, id, label) {
  pendingDelete = {table, id};
  document.getElementById('modal-title').textContent = 'Confirm Delete';
  document.getElementById('modal-body').textContent = `Delete ${label}? This action cannot be undone.`;
  document.getElementById('modal-bg').classList.add('open');
}
function closeModal() { document.getElementById('modal-bg').classList.remove('open'); pendingDelete=null; }

async function confirmDelete() {
  if (!pendingDelete) return;

  if (pendingDelete.table === 'manage-faqs') {
    closeModal();
    const res = await fetch(`/admin/faqs/${pendingDelete.id}`, {
      method: 'DELETE',
      headers: HEADERS.Authorization()
    });
    pendingDelete = null;
    if (res && res.ok) {
      showToast('✓ FAQ deleted', 'success');
      await loadManageFaqs();
      loadAllBadges();
    } else {
      showToast('✕ Failed to delete FAQ', 'error');
    }
    return;
  }

  const {table, id} = pendingDelete; closeModal();
  const urlMap = { users:`/admin/users/${id}`, detections:`/admin/detections/${id}`, feedback:`/admin/feedback/${id}`, 'faq-feedback':`/admin/faq-feedback/${id}` };
  const res = await fetch(urlMap[table], { method:'DELETE', headers:HEADERS.Authorization() });
  if (res&&res.ok) { showToast('✓  Deleted successfully','success'); loadStats(); loadAllBadges(); loadTable(); }
  else showToast('✕  Delete failed','error');
}

async function toggleAdmin(userId) {
  const res = await fetch(`/admin/users/${userId}/toggle-admin`, { method:'PATCH', headers:HEADERS.Authorization() });
  if (res&&res.ok) { showToast('✓  Admin status updated','success'); loadTable(); loadStats(); }
  else showToast('✕  Failed to update','error');
}

let toastTimer;
function showToast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show'+(type?' '+type:'');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.className='toast'; }, 2800);
}

function doLogout() { localStorage.clear(); window.location.href='/login'; }

document.getElementById('modal-bg').addEventListener('click', e => {
  if (e.target===document.getElementById('modal-bg')) closeModal();
});

/* ══════════════════════════════════════════════════
   FAQ MANAGEMENT — full CRUD with pagination & search
══════════════════════════════════════════════════ */
let faqEditId    = null;
let allFaqs      = [];
let filteredFaqs = [];
let faqPage      = 1;
const FAQ_PAGE_SIZE = 10;

/* ─────────────────────────────────────────────────
   Single source of truth for FAQ category chips.
   Matches the exact pill style seen in image 2
   (soft tinted background + matching border + bold text).
   Detection now gets an indigo pill — same visual
   weight as General (green) and Analysis (teal).
───────────────────────────────────────────────── */
const FAQ_CAT = {
  general: {
    label:  'General',
    bg:     'rgba(34, 197, 94, 0.13)',
    color:  '#15803d',
    border: '1.5px solid rgba(34, 197, 94, 0.40)'
  },
  detection: {
    label:  'Detection',
    bg:     'rgba(99, 102, 241, 0.13)',
    color:  '#4338ca',
    border: '1.5px solid rgba(99, 102, 241, 0.40)'
  },
  analysis: {
    label:  'Analysis & Insights',
    bg:     'rgba(20, 184, 166, 0.13)',
    color:  '#0f766e',
    border: '1.5px solid rgba(20, 184, 166, 0.40)'
  },
  privacy: {
    label:  'Privacy & Security',
    bg:     'rgba(239, 68, 68, 0.13)',
    color:  '#b91c1c',
    border: '1.5px solid rgba(239, 68, 68, 0.40)'
  }
};

function faqCatChip(category) {
  const c = FAQ_CAT[category] || {
    label:  category,
    bg:     'rgba(150,150,150,0.12)',
    color:  '#555',
    border: '1.5px solid rgba(150,150,150,0.30)'
  };
  return `<span style="
    display: inline-block;
    padding: 3px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    background: ${c.bg};
    color: ${c.color};
    border: ${c.border};
    line-height: 1.6;
  ">${c.label}</span>`;
}

/* ── Load FAQs from backend ── */
async function loadManageFaqs() {
  const data = await apiFetch('/admin/faqs');
  if (!Array.isArray(data)) { renderFaqTable([]); return; }
  allFaqs = data;
  const badge = document.getElementById('badge-manage-faqs');
  if (badge) badge.textContent = data.length;
  applyFaqFilters();
}

/* ── FAQ search filtering ── */
function applyFaqFilters() {
  const q = (document.getElementById('faq-search-input')?.value || '').trim().toLowerCase();

  const categoryAliases = {
    'general':               'general',
    'detection':             'detection',
    'analysis':              'analysis',
    'analysis & insights':   'analysis',
    'analysis and insights': 'analysis',
    'insights':              'analysis',
    'privacy':               'privacy',
    'privacy & security':    'privacy',
    'privacy and security':  'privacy',
    'security':              'privacy',
  };

  if (!q) {
    filteredFaqs = [...allFaqs];
  } else {
    const matchedAlias = Object.keys(categoryAliases).find(alias => alias.startsWith(q) || alias === q);
    if (matchedAlias) {
      const targetKey = categoryAliases[matchedAlias];
      filteredFaqs = allFaqs.filter(f => f.category === targetKey);
    } else {
      filteredFaqs = allFaqs.filter(f => {
        const question = (f.question || '').toLowerCase();
        const answer   = (f.answer   || '').toLowerCase();
        return question.includes(q) || answer.includes(q);
      });
    }
  }

  faqPage = 1;
  const badge = document.getElementById('faq-count-badge');
  if (badge) badge.textContent = filteredFaqs.length ? `${filteredFaqs.length} record${filteredFaqs.length!==1?'s':''}` : '';
  renderFaqTable(filteredFaqs);
  renderFaqPagination();
}

/* ── Render the FAQ management panel ── */
function renderFaqTable(faqs) {
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');

  head.innerHTML = `<tr>
    <th style="width:50px">#</th>
    <th style="width:160px">Category</th>
    <th>Question</th>
    <th>Answer</th>
    <th style="width:140px">Created</th>
    <th style="width:100px">Actions</th>
  </tr>`;

  if (!faqs.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text2)">No FAQs found.</td></tr>';
    return;
  }

  const slice = faqs.slice((faqPage-1)*FAQ_PAGE_SIZE, faqPage*FAQ_PAGE_SIZE);
  const base  = (faqPage-1)*FAQ_PAGE_SIZE + 1;

  body.innerHTML = slice.map((f, i) => `
    <tr>
      <td style="color:var(--text2);font-size:12px">${base+i}</td>
      <td>${faqCatChip(f.category)}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.question)}">${escHtml(f.question)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2);font-size:12px" title="${escHtml(f.answer)}">${escHtml(f.answer)}</td>
      <td style="color:var(--text2);font-size:12px">${f.created_at ? new Date(f.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
      <td style="display:flex;gap:6px;align-items:center">
        <button class="del-btn" title="Edit"
          style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer"
          onclick="openEditFaq(${f.id})">Edit</button>
        <button class="del-btn" title="Delete" onclick="askDeleteFaq(${f.id},'${escHtml(f.question).replace(/'/g,"\\'")}')">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>
    </tr>`).join('');
}

/* ── FAQ Pagination ── */
function renderFaqPagination() {
  const pg = document.getElementById('pagination');
  const total = Math.max(1, Math.ceil(filteredFaqs.length / FAQ_PAGE_SIZE));
  if (filteredFaqs.length === 0) { pg.innerHTML = ''; return; }
  pg.innerHTML = `
    <span class="page-info">${filteredFaqs.length} record${filteredFaqs.length!==1?'s':''}</span>
    <button class="page-btn" onclick="goFaqPage(${faqPage-1})" ${faqPage<=1?'disabled':''}>←</button>
    <span style="font-size:12px;color:var(--text2);padding:0 6px;font-weight:600">${faqPage} / ${total}</span>
    <button class="page-btn" onclick="goFaqPage(${faqPage+1})" ${faqPage>=total?'disabled':''}>→</button>`;
}

function goFaqPage(p) {
  const total = Math.ceil(filteredFaqs.length / FAQ_PAGE_SIZE);
  if (p < 1 || p > total) return;
  faqPage = p;
  renderFaqTable(filteredFaqs);
  renderFaqPagination();
  document.querySelector('.panel').scrollIntoView({behavior:'smooth',block:'start'});
}

/* ── FAQ search handlers ── */
window.onFaqSearch = function() {
  const q = document.getElementById('faq-search-input')?.value || '';
  const clear = document.getElementById('faq-search-clear');
  if (clear) clear.style.display = q ? 'flex' : 'none';
  applyFaqFilters();
};

window.clearFaqSearch = function() {
  const fi = document.getElementById('faq-search-input');
  if (fi) { fi.value = ''; fi.focus(); }
  const clear = document.getElementById('faq-search-clear');
  if (clear) clear.style.display = 'none';
  applyFaqFilters();
};

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Open Add modal ── */
function openAddFaq() {
  faqEditId = null;
  document.getElementById('faq-modal-title').textContent = 'Add FAQ';
  document.getElementById('faq-form-submit-btn').textContent = 'Add FAQ';
  document.getElementById('faq-form-q').value = '';
  document.getElementById('faq-form-a').value = '';
  document.getElementById('faq-form-cat').value = 'general';
  hideFaqErr();
  document.getElementById('faq-modal-bg').style.display = 'flex';
}

window.openAddFaqModal = openAddFaq;

/* ── Open Edit modal ── */
function openEditFaq(id) {
  const faq = allFaqs.find(f => f.id === id);
  if (!faq) return;
  faqEditId = id;
  document.getElementById('faq-modal-title').textContent = 'Edit FAQ';
  document.getElementById('faq-form-submit-btn').textContent = 'Save Changes';
  document.getElementById('faq-form-q').value = faq.question || '';
  document.getElementById('faq-form-a').value = faq.answer || '';
  document.getElementById('faq-form-cat').value = faq.category || 'general';
  hideFaqErr();
  document.getElementById('faq-modal-bg').style.display = 'flex';
}

function closeFaqModal() {
  document.getElementById('faq-modal-bg').style.display = 'none';
}

function showFaqErr(msg) {
  const el = document.getElementById('faq-form-err');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideFaqErr() {
  const el = document.getElementById('faq-form-err');
  el.textContent = '';
  el.style.display = 'none';
}

/* ── Submit Add / Edit ── */
async function submitFaqForm() {
  const q   = document.getElementById('faq-form-q').value.trim();
  const a   = document.getElementById('faq-form-a').value.trim();
  const cat = document.getElementById('faq-form-cat').value;
  if (!q) { showFaqErr('Question is required.'); document.getElementById('faq-form-q').focus(); return; }
  if (!a) { showFaqErr('Answer is required.');   document.getElementById('faq-form-a').focus(); return; }
  hideFaqErr();

  const btn = document.getElementById('faq-form-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let res;
  if (faqEditId === null) {
    res = await fetch('/admin/faqs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS.Authorization() },
      body: JSON.stringify({ question: q, answer: a, category: cat })
    });
  } else {
    res = await fetch(`/admin/faqs/${faqEditId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...HEADERS.Authorization() },
      body: JSON.stringify({ question: q, answer: a, category: cat })
    });
  }

  btn.disabled = false;
  btn.textContent = faqEditId === null ? 'Add FAQ' : 'Save Changes';

  if (res && res.ok) {
    closeFaqModal();
    showToast(faqEditId === null ? '✓ FAQ added successfully' : '✓ FAQ updated successfully', 'success');
    await loadManageFaqs();
    loadAllBadges();
  } else {
    showFaqErr('Failed to save. Please try again.');
  }
}

/* ── Delete FAQ ── */
function askDeleteFaq(id, question) {
  pendingDelete = { table: 'manage-faqs', id };
  document.getElementById('modal-title').textContent = 'Delete FAQ';
  document.getElementById('modal-body').textContent = `Delete "${question}"? This cannot be undone.`;
  document.getElementById('modal-bg').classList.add('open');
}

/* ── Close FAQ modal on background click ── */
document.addEventListener('DOMContentLoaded', () => {
  const bg = document.getElementById('faq-modal-bg');
  if (bg) bg.addEventListener('click', e => { if (e.target === bg) closeFaqModal(); });
});

boot();