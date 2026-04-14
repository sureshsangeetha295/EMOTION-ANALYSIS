
// ════════════════════════════════════════════
//  AVATAR FACES (for animateBreakdownCard)
// ════════════════════════════════════════════

const AVATAR_FACES = {
  happiness: { faceColor:'#FDDFA4', cheekColor:'#F9A8A8', eyeShape:'happy',   browAngle:0,   mouth:'M 30 62 Q 44 76 58 62', mouthColor:'#C0392B', showTeeth:true,  eyeColor:'#3d2800', pupilSize:5   },
  neutral:   { faceColor:'#FDDFA4', cheekColor:'transparent', eyeShape:'normal', browAngle:0, mouth:'M 30 64 Q 44 66 58 64', mouthColor:'#8B6555', showTeeth:false, eyeColor:'#3d2800', pupilSize:4.5 },
  sadness:   { faceColor:'#C9D8F0', cheekColor:'#A8C0E8', eyeShape:'sad',     browAngle:-12, mouth:'M 30 68 Q 44 58 58 68', mouthColor:'#5563A0', showTeeth:false, eyeColor:'#2a3a6b', pupilSize:4   },
  anger:     { faceColor:'#F4A09A', cheekColor:'#E86050', eyeShape:'angry',   browAngle:18,  mouth:'M 30 68 Q 44 60 58 68', mouthColor:'#8B1A1A', showTeeth:true,  eyeColor:'#5a0000', pupilSize:3.5 },
  fear:      { faceColor:'#D8C8EE', cheekColor:'transparent', eyeShape:'wide', browAngle:-8, mouth:'M 32 66 Q 44 72 56 66', mouthColor:'#6a40b0', showTeeth:false, eyeColor:'#2d1a5e', pupilSize:6.5 },
  disgust:   { faceColor:'#B8E8C8', cheekColor:'transparent', eyeShape:'squint', browAngle:10, mouth:'M 28 64 Q 36 70 44 64 Q 52 58 58 64', mouthColor:'#2d7a4a', showTeeth:false, eyeColor:'#1a4d2e', pupilSize:4 },
  surprise:  { faceColor:'#FDDFA4', cheekColor:'#FFB347', eyeShape:'wide',    browAngle:-15, mouth:'M 36 62 Q 44 78 52 62', mouthColor:'#C0392B', showTeeth:false, eyeColor:'#3d2800', pupilSize:7   },
};

function _buildEyes(f) {
  const { eyeColor, pupilSize, eyeShape } = f;
  if (eyeShape === 'happy') return `
    <path d="M 26 42 Q 30 36 34 42" fill="none" stroke="${eyeColor}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M 54 42 Q 58 36 62 42" fill="none" stroke="${eyeColor}" stroke-width="2.5" stroke-linecap="round"/>`;
  if (eyeShape === 'sad') return `
    <ellipse cx="30" cy="42" rx="5.5" ry="5" fill="white"/>
    <ellipse cx="58" cy="42" rx="5.5" ry="5" fill="white"/>
    <ellipse cx="30" cy="43" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="58" cy="43" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="28.5" cy="41.5" rx="1.5" ry="1.5" fill="white" opacity="0.7"/>
    <ellipse cx="56.5" cy="41.5" rx="1.5" ry="1.5" fill="white" opacity="0.7"/>
    <ellipse cx="34" cy="50" rx="2" ry="3" fill="#a8c0e8" opacity="0.7"/>`;
  if (eyeShape === 'angry') return `
    <ellipse cx="30" cy="42" rx="5" ry="4.5" fill="white"/>
    <ellipse cx="58" cy="42" rx="5" ry="4.5" fill="white"/>
    <ellipse cx="30" cy="43" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="58" cy="43" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>`;
  if (eyeShape === 'wide') return `
    <ellipse cx="30" cy="42" rx="7" ry="7" fill="white"/>
    <ellipse cx="58" cy="42" rx="7" ry="7" fill="white"/>
    <ellipse cx="30" cy="42" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="58" cy="42" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="28.5" cy="40.5" rx="1.8" ry="1.8" fill="white" opacity="0.75"/>
    <ellipse cx="56.5" cy="40.5" rx="1.8" ry="1.8" fill="white" opacity="0.75"/>`;
  if (eyeShape === 'squint') return `
    <path d="M 25 42 Q 30 38 35 42" fill="white" stroke="${eyeColor}" stroke-width="1"/>
    <path d="M 53 42 Q 58 38 63 42" fill="white" stroke="${eyeColor}" stroke-width="1"/>
    <ellipse cx="30" cy="41" rx="${pupilSize-1}" ry="${pupilSize-1.5}" fill="${eyeColor}"/>
    <ellipse cx="58" cy="41" rx="${pupilSize-1}" ry="${pupilSize-1.5}" fill="${eyeColor}"/>`;
  return `
    <ellipse cx="30" cy="42" rx="5.5" ry="5.5" fill="white"/>
    <ellipse cx="58" cy="42" rx="5.5" ry="5.5" fill="white"/>
    <ellipse cx="30" cy="42" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="58" cy="42" rx="${pupilSize}" ry="${pupilSize}" fill="${eyeColor}"/>
    <ellipse cx="28.5" cy="40.5" rx="1.5" ry="1.5" fill="white" opacity="0.7"/>
    <ellipse cx="56.5" cy="40.5" rx="1.5" ry="1.5" fill="white" opacity="0.7"/>`;
}

function _buildBrow(cx, cy, angle, emotionKey) {
  const browColor = emotionKey === 'anger' ? '#8B1A1A' : '#3d2800';
  return `<rect x="${cx-8}" y="${cy-1.5}" width="16" height="3" rx="2" fill="${browColor}"
    transform="rotate(${angle} ${cx} ${cy})"/>`;
}

function _buildAvatarSVG(emotionKey) {
  const f = AVATAR_FACES[emotionKey] || AVATAR_FACES.neutral;
  const cheeks = f.cheekColor !== 'transparent'
    ? `<ellipse cx="20" cy="58" rx="10" ry="6" fill="${f.cheekColor}" opacity="0.45"/>
       <ellipse cx="68" cy="58" rx="10" ry="6" fill="${f.cheekColor}" opacity="0.45"/>` : '';
  const mouthFill = f.showTeeth
    ? `<path d="${f.mouth}" fill="${f.mouthColor}" stroke="${f.mouthColor}" stroke-width="1.5" stroke-linecap="round"/>
       <ellipse cx="44" cy="67" rx="8" ry="4" fill="white" opacity="0.85"/>`
    : `<path d="${f.mouth}" fill="none" stroke="${f.mouthColor}" stroke-width="2.5" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" style="width:56px;height:56px;display:block;">
  <defs>
    <radialGradient id="fg_${emotionKey}" cx="45%" cy="40%" r="55%">
      <stop offset="0%" stop-color="white" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${f.faceColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="44" cy="46" rx="34" ry="36" fill="${f.faceColor}"/>
  <ellipse cx="44" cy="46" rx="34" ry="36" fill="url(#fg_${emotionKey})"/>
  <ellipse cx="10" cy="46" rx="5" ry="7" fill="${f.faceColor}"/>
  <ellipse cx="78" cy="46" rx="5" ry="7" fill="${f.faceColor}"/>
  <ellipse cx="44" cy="14" rx="32" ry="14" fill="#3d2800"/>
  <rect x="12" y="10" width="64" height="12" fill="#3d2800" rx="4"/>
  ${cheeks}
  ${_buildBrow(22, 30, f.browAngle, emotionKey)}
  ${_buildBrow(54, 30, -f.browAngle, emotionKey)}
  ${_buildEyes(f)}
  <ellipse cx="44" cy="56" rx="3.5" ry="2.5" fill="rgba(0,0,0,0.1)"/>
  ${mouthFill}
</svg>`;
}


// ════════════════════════════════════════════
//  ANIMATED BREAKDOWN CARD (dominantCard)
// ════════════════════════════════════════════

let _typewriterTimer = null;
let _particleTimers  = [];

function animateBreakdownCard(emotion, emo, conf) {
  const card = document.getElementById('dominantCard');
  if (!card) return;
  const label   = emotion.charAt(0).toUpperCase() + emotion.slice(1);
  const fullMsg = EMOTION_MESSAGES[emotion.toLowerCase()] || '';
  const emoKey  = emotion.toLowerCase();
  const accentC = emo?.color || '#64748b';

  clearTimeout(_typewriterTimer);
  _particleTimers.forEach(clearTimeout);
  _particleTimers = [];

  card.className = 'dominant-card animating';
  card.innerHTML = `
    <div class="avatar-col" data-emotion="${emoKey}">
      <div class="avatar-glow"></div>
      <div class="avatar-face" id="avatarFace">${_buildAvatarSVG(emoKey)}</div>
      <div class="avatar-label" id="avatarLabel">${label}</div>
    </div>
    <div class="message-col">
      <div class="dom-name" id="domName" data-emotion="${emoKey}" style="color:${accentC}">${label}</div>
      <div class="dom-conf-pill" id="domPill">⚡ ${conf}% confidence</div>
      <div class="dom-message" id="domMsg"><span class="dom-cursor"></span></div>
    </div>`;

  setTimeout(() => card.classList.remove('animating'), 750);
  requestAnimationFrame(() => {
    const face = document.getElementById('avatarFace');
    if (face) { face.classList.add('visible'); setTimeout(() => face.classList.add('idle'), 550); }
  });
  setTimeout(() => {
    document.getElementById('avatarLabel')?.classList.add('visible');
    document.getElementById('domName')?.classList.add('revealed');
  }, 220);
  setTimeout(() => document.getElementById('domPill')?.classList.add('revealed'), 380);
  setTimeout(() => typewriteMessage(fullMsg, 0), 560);
  [300, 650, 1000].forEach((delay, i) => {
    const t = setTimeout(() => {
      const avatarCol = card.querySelector('.avatar-col');
      if (avatarCol) _spawnParticle(avatarCol, emo?.icon || '😐', i);
    }, delay);
    _particleTimers.push(t);
  });
}

function typewriteMessage(text, index) {
  const msgEl = document.getElementById('domMsg');
  if (!msgEl) return;
  if (index === 0) msgEl.innerHTML = '<span class="dom-cursor"></span>';
  if (index >= text.length) {
    _typewriterTimer = setTimeout(() => {
      const cursor = msgEl.querySelector('.dom-cursor');
      if (cursor) cursor.style.display = 'none';
    }, 900);
    return;
  }
  const cursor = msgEl.querySelector('.dom-cursor');
  if (cursor) cursor.insertAdjacentText('beforebegin', text[index]);
  const ch    = text[index];
  const delay = ch === ' ' ? 52 : (ch === ',' || ch === '.' || ch === '!') ? 155 : 36;
  _typewriterTimer = setTimeout(() => typewriteMessage(text, index + 1), delay);
}

function _spawnParticle(container, icon, idx) {
  const p = document.createElement('span');
  p.className   = 'dom-particle';
  p.textContent = icon;
  p.style.left   = (15 + idx * 25) + '%';
  p.style.bottom = '8px';
  container.appendChild(p);
  setTimeout(() => p.remove(), 1500);
