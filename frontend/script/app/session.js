
// ════════════════════════════════════════════
//  VIDEO UPLOAD
// ════════════════════════════════════════════

async function handleVideoUpload(file) {
  if (!file) return;
  const bar = document.getElementById('detectionBar');
  if (bar) { bar.textContent = '⏳ Analyzing video…'; bar.classList.add('visible'); }

  try {
    const result    = await API.analyzeVideo(file);
    const emotion   = result.dominant_emotion || '—';
    const engPct    = Math.round((result.average_engagement || 0) * 100);
    const emoLower  = emotion.toLowerCase();
    const emo       = EMOTIONS.find(e => e.label.toLowerCase() === emoLower);

    const rdot = document.getElementById('resultDot');
    const remo = document.getElementById('resultEmotion');
    const rcon = document.getElementById('resultConf');
    if (rdot) rdot.style.background = emo?.color || '#94a3b8';
    if (remo) remo.textContent = emotion;
    if (rcon) rcon.textContent = `Video · Avg Engagement ${engPct}%`;

    if (bar) bar.textContent = `Video done · Dominant: ${emotion} · Avg Engagement ${engPct}%`;

    const lastEl = document.getElementById('lastDetected');
    if (lastEl) lastEl.textContent = `Video: ${emotion} (${engPct}% avg)`;

    if (result.timeline && result.timeline.length) {
      result.timeline.forEach(entry => addTimelineDot((entry.emotion || '').toLowerCase(), entry.engagement));
    }

    if (emo) animateBreakdownCard(emoLower, emo, engPct);

  } catch (err) {
    console.error('[EmotionAI] Video analysis error:', err);
    showError(err.message || 'Video analysis failed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('videoFileInput');
  if (input) {
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) handleVideoUpload(input.files[0]);
      input.value = '';
    });
  }
});


// ════════════════════════════════════════════
//  NOTES
// ════════════════════════════════════════════

function toggleNoteInput() {
  const wrap = document.getElementById('noteInputWrap');
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
  if (!open) document.getElementById('noteTextarea')?.focus();
}

function saveNote() {
  const ta   = document.getElementById('noteTextarea');
  const text = ta.value.trim();
  if (!text) return;
  _notesList.unshift({ text, ts: _sessionTime(), id: Date.now() });
  ta.value = '';
  document.getElementById('noteInputWrap').style.display = 'none';
  _renderNotes();
}

function deleteNote(id) {
  _notesList = _notesList.filter(n => n.id !== id);
  _renderNotes();
}

function _renderNotes() {
  const list  = document.getElementById('notesList');
  const empty = document.getElementById('notesEmpty');
  if (!_notesList.length) {
    if (empty) empty.style.display = 'block';
    list.innerHTML = '';
    if (empty) list.appendChild(empty);
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = _notesList.map(n => `
    <div class="note-item">
      <span class="note-ts">${n.ts}</span>
      <span class="note-text">${n.text.replace(/</g,'&lt;')}</span>
      <button class="note-delete" onclick="deleteNote(${n.id})" title="Delete">✕</button>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('noteTextarea');
  if (ta) ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveNote();
  });
});


// ════════════════════════════════════════════
//  REACTIONS (float-up emoji on camera)
// ════════════════════════════════════════════

function sendReaction(type, btn) {
  btn.classList.add('active');
  setTimeout(() => btn.classList.remove('active'), 600);

  const labels = { thumbsup:'👍 Liked content', thumbsdown:'👎 Unclear', handraise:'✋ Doubt raised', confused:'😕 Confused', clap:'👏 Appreciated' };
  const colors = { thumbsup:'#16a34a', thumbsdown:'#dc2626', handraise:'#e8440a', confused:'#ca8a04', clap:'#3b82f6' };
  const icons  = { thumbsup:'👍', thumbsdown:'👎', handraise:'✋', confused:'😕', clap:'👏' };

  _addTLScrollItem(labels[type], colors[type] || '#6b7280', icons[type] || '⭐');

  const camBox = document.getElementById('camBox');
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className  = 'float-reaction';
      el.textContent = icons[type];
      el.style.cssText = `left:${15 + Math.random()*50}%;bottom:70px;position:absolute;font-size:22px;pointer-events:none;z-index:20;animation:floatUp 1.6s ease-out forwards`;
      camBox.appendChild(el);
      setTimeout(() => el.remove(), 1800);
    }, i * 200);
  }
}


