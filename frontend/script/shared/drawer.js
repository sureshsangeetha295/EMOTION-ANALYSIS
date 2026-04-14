(function(){
  var btn=document.getElementById('hamburgerBtn');
  var closeBtn=document.getElementById('drawerCloseBtn');
  var drawer=document.getElementById('mobileDrawer');
  var overlay=document.getElementById('mobileOverlay');
  if(!btn)return;
  function openD(){btn.classList.add('open');drawer.classList.add('open');overlay.classList.add('open');btn.setAttribute('aria-expanded','true');document.body.style.overflow='hidden';}
  function closeD(){btn.classList.remove('open');drawer.classList.remove('open');overlay.classList.remove('open');btn.setAttribute('aria-expanded','false');document.body.style.overflow='';}
  btn.addEventListener('click',function(){btn.classList.contains('open')?closeD():openD();});
  if(closeBtn)closeBtn.addEventListener('click',closeD);
  if(overlay)overlay.addEventListener('click',closeD);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeD();});
  if(drawer)drawer.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeD);});
})();