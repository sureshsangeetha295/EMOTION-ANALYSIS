// ════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (!isLive) doDetect(); }
  if (e.key  === 'l' || e.key === 'L') { isLive ? stopLive() : startLive(); }
});


// ════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════

if (!Auth.requireAuth()) throw new Error('Not authenticated');

const _user   = Auth.getUser();
const _userEl = document.getElementById('topbarUser');
if (_userEl && _user) _userEl.textContent = _user.username || _user.email || '';

buildProbList();
startCamera();
setSpeedometer(0);

// ════════════════════════════════════════════
//  RESPONSIVE: resize / orientation handling
// ════════════════════════════════════════════

(function () {
  // Re-measure cam-pane on resize so the video feed fills correctly
  function onResize() {
    const camPane = document.querySelector('.cam-pane');
    const feed    = document.getElementById('camFeed') || document.querySelector('.cam-feed');
    if (!camPane || !feed) return;

    // In landscape on mobile, cap cam height to viewport height - topbar
    const isMobileLandscape =
      window.innerWidth <= 768 && window.innerHeight < window.innerWidth;

    if (isMobileLandscape) {
      const topbarH = document.querySelector('.topbar')?.offsetHeight || 44;
      camPane.style.maxHeight = (window.innerHeight - topbarH) + 'px';
    } else {
      camPane.style.maxHeight = '';
    }
  }

  // Debounced resize listener
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(onResize, 120);
  });

  // Also fire on orientation change (iOS fires this before resize)
  window.addEventListener('orientationchange', () => {
    setTimeout(onResize, 300);
  });

  // Initial call
  document.addEventListener('DOMContentLoaded', onResize);

  // Mobile hamburger: close drawer on nav link click (if not already wired)
  document.addEventListener('DOMContentLoaded', () => {
    const drawer  = document.getElementById('mobileNavDrawer');
    const overlay = document.getElementById('mobileNavOverlay');
    const btn     = document.getElementById('hamburgerBtn');
    if (!drawer) return;

    function closeDrawer() {
      drawer.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
      document.body.style.overflow = '';
    }

    // Close on any internal anchor click
    drawer.querySelectorAll('a, button').forEach(el => {
      el.addEventListener('click', closeDrawer);
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDrawer();
    });
  });
})();