/* ── launchApp: same logic as landing page ── */
function launchApp(e) {
  if (e) e.preventDefault();
  if (typeof Auth !== 'undefined' && Auth.isLoggedIn && Auth.isLoggedIn()) {
    window.location.href = '/livecam';
  } else {
    window.location.href = '/login';
  }
}

/* ── FAQ dynamic loading ── */
var _allFaqItems = [];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderFaqItem(faq, first) {
  var item = document.createElement('div');
  item.className = 'faq-item' + (first ? ' open' : '');
  item.dataset.cat = faq.category || 'general';
  item.dataset.id  = faq.id || '';
  item.innerHTML =
    '<div class="faq-q" onclick="toggleFAQ(this.parentElement)">'
    + escapeHtml(faq.question)
    + '<svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    + '</div>'
    + '<div class="faq-a"><p>' + escapeHtml(faq.answer) + '</p>'
    + '<div class="faq-a-footer">'
    + '<span class="helpful-txt">Was this helpful?</span>'
    + '<button class="helpful-btn" onclick="vote(this,\'yes\')">👍 Yes</button>'
    + '<button class="helpful-btn" onclick="vote(this,\'no\')">👎 No</button>'
    + '</div></div>';
  return item;
}

function loadFAQs() {
  fetch('/api/faqs')
    .then(function(r){ return r.json(); })
    .then(function(faqs) {
      var list = document.getElementById('faqList');
      var loading = document.getElementById('faqLoading');
      if (loading) loading.remove();

      if (!Array.isArray(faqs) || faqs.length === 0) {
        list.innerHTML = '<p style="padding:2rem;color:var(--text2,#888);text-align:center;">No FAQs available yet.</p>';
        return;
      }

      _allFaqItems = faqs;
      faqs.forEach(function(faq, i) {
        list.appendChild(renderFaqItem(faq, i === 0));
      });
    })
    .catch(function() {
      var loading = document.getElementById('faqLoading');
      if (loading) loading.textContent = 'Could not load FAQs. Please try refreshing.';
    });
}

document.addEventListener('DOMContentLoaded', loadFAQs);

/* ── FAQ logic ── */
function toggleFAQ(item){item.classList.toggle('open');}

function filterFAQ(q){
  var lower=q.toLowerCase();
  document.querySelectorAll('.faq-item').forEach(function(item){
    var text=item.querySelector('.faq-q').textContent.toLowerCase();
    item.style.display=text.includes(lower)?'':'none';
  });
}

function filterCat(btn,cat){
  document.querySelectorAll('.cat-item').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  var labels={all:'All questions',general:'General',detection:'Detection',analysis:'Analysis & Insights',privacy:'Privacy & Security'};
  document.getElementById('faqHeading').textContent=labels[cat]||'All questions';
  document.querySelectorAll('.faq-item').forEach(function(item){
    item.style.display=(cat==='all'||item.dataset.cat===cat)?'':'none';
  });
}

/* ── Vote / feedback ── */
var toastTimer=null;
function vote(btn,type){
  var footer=btn.closest('.faq-a-footer');
  if(footer.dataset.voted)return;
  var faqQuestion=btn.closest('.faq-item').querySelector('.faq-q').childNodes[0].textContent.trim();
  footer.querySelectorAll('.helpful-btn').forEach(function(b){b.onclick=null;b.style.pointerEvents='none';});
  btn.classList.add(type==='yes'?'voted-yes':'voted-no');
  if(type==='yes'){
    footer.dataset.voted='true';
    btn.textContent='👍 Helpful';
    footer.querySelectorAll('.helpful-btn').forEach(function(b){if(!b.classList.contains('voted-yes'))b.style.opacity='0.35';});
    submitFaqVote(faqQuestion,'liked',null);
    showToast('Thank you! Glad this was helpful 🎉');
  } else {
    btn.textContent='👎 Not helpful';
    footer.querySelectorAll('.helpful-btn').forEach(function(b){if(!b.classList.contains('voted-no'))b.style.opacity='0.35';});
    var box=document.createElement('div');
    box.className='complaint-box';
    box.innerHTML='<p class="complaint-label">What went wrong? <span>(optional)</span></p>'
      +'<textarea class="complaint-input" placeholder="Describe what was incorrect or missing…" rows="3"></textarea>'
      +'<div class="complaint-actions"><button class="complaint-submit">Submit</button><button class="complaint-skip">Skip</button></div>';
    footer.appendChild(box);
    function submitComplaint(complaint){
      footer.dataset.voted='true';
      box.remove();
      submitFaqVote(faqQuestion,'disliked',complaint||null);
      showToast("Thanks for the feedback — we'll improve this answer.");
    }
    box.querySelector('.complaint-submit').onclick=function(){submitComplaint(box.querySelector('.complaint-input').value.trim());};
    box.querySelector('.complaint-skip').onclick=function(){submitComplaint('');};
  }
}

function submitFaqVote(question,vote,complaint){
  var token=localStorage.getItem('ea_access_token');
  var headers={'Content-Type':'application/json'};
  if(token)headers['Authorization']='Bearer '+token;
  fetch('/api/faq-feedback',{
    method:'POST',headers:headers,
    body:JSON.stringify({faq_question:question,vote:vote,complaint:complaint})
  }).catch(function(){});
}

function showToast(msg){
  var toast=document.getElementById('toast');
  document.getElementById('toastMsg').textContent=msg;
  toast.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){toast.classList.remove('show');},3000);
}

/* ── Mobile drawer ── */
(function(){
  var btn=document.getElementById('hamburgerBtn');
  var closeBtn=document.getElementById('drawerCloseBtn');
  var drawer=document.getElementById('mobileDrawer');
  var overlay=document.getElementById('mobileOverlay');
  if(!btn)return;

  function openD(){
    btn.classList.add('open');
    drawer.classList.add('open');
    overlay.classList.add('open');
    btn.setAttribute('aria-expanded','true');
    document.body.style.overflow='hidden';
  }
  function closeD(){
    btn.classList.remove('open');
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
    document.body.style.overflow='';
  }

  btn.addEventListener('click',function(){btn.classList.contains('open')?closeD():openD();});
  if(closeBtn)closeBtn.addEventListener('click',closeD);
  overlay.addEventListener('click',closeD);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeD();});
  drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeD);});
})();