const socket = io();

// Persist session token for mid-game reconnect
let sessionToken = sessionStorage.getItem('playerToken');
if (!sessionToken) {
  sessionToken = crypto.randomUUID();
  sessionStorage.setItem('playerToken', sessionToken);
}

AudioManager.load('submit', '/assets/music/freesound_community-success-1-6297.mp3');

const EMOJIS = [
  '🐶','🐱','🐼','🦊','🐨',
  '🦁','🐯','🐸','🐙','🦄',
  '🐲','🦋','🐧','🦜','🐺',
  '🐻','🦝','🐮','🦕','👻',
];
const COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#14b8a6','#3b82f6','#a855f7','#ec4899',
];
const OPTION_COLORS = ['bg-red-600','bg-blue-600','bg-yellow-500','bg-green-600'];

let gamePin        = null;
let teamsEnabled   = false;
let playerNickname = '';
let playerEmoji    = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
let playerColor    = COLORS[Math.floor(Math.random() * COLORS.length)];
let playerTeam     = null; // 'red' | 'blue' | 'yellow' | 'green' | null
let playerAnswer      = null;
let playerTimerCap    = Infinity; // set by TIMER_CAP when first team completes
let currentTeamNames  = { red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green' };
const TEAM_COLORS_P   = { red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e' };
const MAX_TEAM_SIZE   = 4;
let currentOptions    = [];
let timerInterval     = null;
let playerScore       = 0;
let lastAnswerResult  = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  pin:       document.getElementById('screen-pin'),
  avatar:    document.getElementById('screen-avatar'),
  lobby:     document.getElementById('screen-lobby'),
  ready:     document.getElementById('screen-ready'),
  slide:     document.getElementById('screen-slide'),
  wordcloud: document.getElementById('screen-wordcloud'),
  droppin:   document.getElementById('screen-droppin'),
  opentext:  document.getElementById('screen-opentext'),
  question:  document.getElementById('screen-question'),
  answered:  document.getElementById('screen-answered'),
  result:    document.getElementById('screen-result'),
  podium:    document.getElementById('screen-podium'),
};

const REACTION_SCREENS = new Set(['lobby', 'answered', 'result']);

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
  document.getElementById('reaction-bar').classList.toggle('hidden', !REACTION_SCREENS.has(name));
}

function showError(el, msg) {
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

document.getElementById('mute-btn').addEventListener('click', () => {
  const muted = AudioManager.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
});

document.getElementById('change-avatar-btn').addEventListener('click', () => {
  showScreen('avatar');
});

document.getElementById('rename-team-btn').addEventListener('click', () => {
  if (!playerTeam || !gamePin) return;
  const current = currentTeamNames[playerTeam] || playerTeam;
  const newName = prompt(`Rename "${current}" to:`, current);
  if (!newName || !newName.trim()) return;
  socket.emit('RENAME_TEAM', { pin: gamePin, team: playerTeam, name: newName.trim() });
});

document.querySelectorAll('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (gamePin) socket.emit('REACTION_SEND', { pin: gamePin, emoji: btn.dataset.emoji });
  });
});

// ── PIN screen ────────────────────────────────────────────────────────────────

const pinInput = document.getElementById('pin-input');
const pinError = document.getElementById('pin-error');

pinInput.addEventListener('input', () => {
  pinInput.value = pinInput.value.replace(/\D/g, '');
});
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });
document.getElementById('pin-btn').addEventListener('click', submitPin);

// Auto-submit PIN when arriving from a QR code scan
const qrPin = new URLSearchParams(location.search).get('pin');
if (qrPin) { pinInput.value = qrPin; submitPin(); }

function applyTeamsEnabled(enabled) {
  teamsEnabled = enabled;
  document.getElementById('team-section').classList.toggle('hidden', !enabled);
  if (!enabled) {
    playerTeam = null;
    document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('border-white'));
    document.getElementById('lobby-team-wrapper').classList.add('hidden');
  }
}

async function submitPin() {
  const pin = pinInput.value.trim();
  if (pin.length !== 6) return showError(pinError, 'Enter a 6-digit PIN');
  try {
    const res = await fetch(`/api/rooms/${pin}`);
    const data = await res.json();
    if (!res.ok) return showError(pinError, data.error || 'Invalid PIN');
    gamePin = pin;
    applyTeamsEnabled(data.teamsEnabled || false);
    showScreen('avatar');
    document.getElementById('nickname-input').focus();
  } catch {
    showError(pinError, 'Connection error — try again');
  }
}

// ── Avatar screen ─────────────────────────────────────────────────────────────

function updatePreview() {
  const el = document.getElementById('avatar-preview');
  el.style.backgroundColor = playerColor;
  el.textContent = playerEmoji;
}

const emojiGrid = document.getElementById('emoji-grid');
EMOJIS.forEach((emoji, i) => {
  const btn = document.createElement('button');
  btn.textContent = emoji;
  btn.className = 'text-3xl p-2 rounded-xl hover:bg-gray-700 active:bg-gray-600 transition-colors';
  if (emoji === playerEmoji) btn.classList.add('ring-2', 'ring-white', 'bg-gray-700');
  btn.addEventListener('click', () => {
    emojiGrid.querySelectorAll('button').forEach(b => b.classList.remove('ring-2', 'ring-white', 'bg-gray-700'));
    btn.classList.add('ring-2', 'ring-white', 'bg-gray-700');
    playerEmoji = emoji;
    updatePreview();
  });
  emojiGrid.appendChild(btn);
});

const colorGrid = document.getElementById('color-grid');
COLORS.forEach((color, i) => {
  const btn = document.createElement('button');
  btn.style.backgroundColor = color;
  btn.className = 'w-12 h-12 rounded-full border-4 border-transparent hover:scale-110 active:scale-95 transition-transform';
  if (color === playerColor) btn.classList.add('border-white');
  btn.addEventListener('click', () => {
    colorGrid.querySelectorAll('button').forEach(b => b.classList.remove('border-white'));
    btn.classList.add('border-white');
    playerColor = color;
    updatePreview();
  });
  colorGrid.appendChild(btn);
});

updatePreview();

// Team picker — toggles selection (tap again to deselect)
document.querySelectorAll('.team-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const isSelected = btn.classList.contains('border-white');
    document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('border-white'));
    if (!isSelected) {
      btn.classList.add('border-white');
      playerTeam = btn.dataset.team;
    } else {
      playerTeam = null;
    }
  });
});

document.getElementById('nickname-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAvatar();
});
document.getElementById('join-btn').addEventListener('click', submitAvatar);

function submitAvatar() {
  const nickname = document.getElementById('nickname-input').value.trim();
  const avatarError = document.getElementById('avatar-error');
  if (!nickname) return showError(avatarError, 'Enter a nickname');
  if (nickname.length > 20) return showError(avatarError, 'Max 20 characters');
  playerNickname = nickname;
  socket.emit('ROOM_JOIN', { pin: gamePin, nickname: playerNickname, emoji: playerEmoji, color: playerColor, token: sessionToken, team: playerTeam });
}

// ── Socket: state transitions ─────────────────────────────────────────────────

socket.on('GAME_STATE_CHANGE', ({ status, reason }) => {
  if (status === 'lobby') {
    showScreen('lobby');
    const lobbyAvatar = document.getElementById('lobby-avatar');
    lobbyAvatar.style.backgroundColor = playerColor;
    lobbyAvatar.textContent = playerEmoji;
    document.getElementById('lobby-nickname').textContent = playerNickname;
    const teamWrapper = document.getElementById('lobby-team-wrapper');
    const teamEl = document.getElementById('lobby-team');
    if (playerTeam) {
      teamEl.textContent = currentTeamNames[playerTeam] || playerTeam;
      teamEl.style.color = TEAM_COLORS_P[playerTeam];
      teamWrapper.classList.remove('hidden');
    } else {
      teamWrapper.classList.add('hidden');
    }
  }
  if (status === 'playing') {
    showScreen('ready');
  }
  if (status === 'ended') {
    showScreen('pin');
    showError(pinError, reason === 'host_disconnected' ? 'Host disconnected' : 'Game ended');
  }
});

socket.on('LOBBY_UPDATE', ({ teamsEnabled: enabled }) => {
  applyTeamsEnabled(enabled);
});

socket.on('ALL_ANSWERED', () => {
  playerTimerCap = Math.min(playerTimerCap, 1);
});

socket.on('TIMER_CAP', ({ seconds }) => {
  playerTimerCap = Math.min(playerTimerCap, seconds);
});

socket.on('TEAM_NAMES_UPDATE', ({ teamNames }) => {
  currentTeamNames = { ...currentTeamNames, ...teamNames };
  // Update team picker labels
  document.querySelectorAll('[data-team]').forEach(wrapper => {
    const t = wrapper.dataset.team;
    const lbl = wrapper.querySelector('.team-label');
    if (lbl && currentTeamNames[t]) lbl.textContent = currentTeamNames[t];
  });
  // Update lobby team badge
  if (playerTeam && currentTeamNames[playerTeam]) {
    document.getElementById('lobby-team').textContent =
      `${currentTeamNames[playerTeam]}`;
  }
});

socket.on('TEAM_FULL', ({ name }) => {
  showError(document.getElementById('avatar-error'), `"${name}" is full (${MAX_TEAM_SIZE}/4) — pick another`);
  playerTeam = null;
  document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('border-white'));
});

socket.on('PLAYER_LIST_UPDATE', (players) => {
  const count = players.length;
  document.getElementById('player-count').textContent =
    `${count} player${count !== 1 ? 's' : ''} in the lobby`;

  // Update team button availability (cap at MAX_TEAM_SIZE)
  if (teamsEnabled) {
    const teamCounts = {};
    players.forEach(p => { if (p.team) teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });
    document.querySelectorAll('[data-team]').forEach(wrapper => {
      const t = wrapper.dataset.team;
      const cnt = teamCounts[t] || 0;
      const countEl = wrapper.querySelector('.team-count');
      if (countEl) countEl.textContent = cnt > 0 ? `${cnt}/${MAX_TEAM_SIZE}` : '';
      const btn = wrapper.querySelector('.team-btn');
      if (btn) {
        const full = cnt >= MAX_TEAM_SIZE && t !== playerTeam;
        btn.disabled = full;
        btn.style.opacity = full ? '0.3' : '1';
      }
    });
  }
});

socket.on('ANSWER_RESULT', ({ correct, scoreDelta, totalScore }) => {
  playerScore = totalScore;
  lastAnswerResult = { correct, scoreDelta, totalScore, didAnswer: true };
});

// ── Socket: question flow ─────────────────────────────────────────────────────

socket.on('QUESTION_DATA', ({ questionNumber, totalQuestions, text, options, timeLimit, image, type, showQuestion }) => {
  clearInterval(timerInterval);
  playerAnswer      = null;
  pendingCoords     = null;
  currentOptions    = options;
  lastAnswerResult  = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };
  playerTimerCap    = Infinity; // reset cap for each question

  // Slide: just show content, no timer or answers
  if (type === 'slide') {
    const img = document.getElementById('slide-image');
    if (image) { img.src = image; img.classList.remove('hidden'); }
    else { img.classList.add('hidden'); img.src = ''; }
    document.getElementById('slide-text').textContent = text;
    showScreen('slide');
    return;
  }

  // Word Cloud: free-text input with countdown
  if (type === 'wordcloud') {
    document.getElementById('wc-number').textContent = `Question ${questionNumber} of ${totalQuestions} ☁️`;
    document.getElementById('wc-text').textContent = text;
    document.getElementById('wc-input').value = '';
    document.getElementById('wc-timer').textContent = timeLimit;
    const wcBar = document.getElementById('wc-timer-bar');
    wcBar.style.transition = 'none'; wcBar.style.width = '100%';
    let wcRemaining = timeLimit;
    timerInterval = setInterval(() => {
      wcRemaining--;
      document.getElementById('wc-timer').textContent = wcRemaining;
      const pct = Math.max(0, (wcRemaining / timeLimit) * 100);
      wcBar.style.transition = 'width 1s linear'; wcBar.style.width = pct + '%';
      if (wcRemaining <= 0) clearInterval(timerInterval);
    }, 1000);
    showScreen('wordcloud');
    return;
  }

  // Open Text: free-text input with countdown
  if (type === 'opentext') {
    document.getElementById('ot-number').textContent = `Question ${questionNumber} of ${totalQuestions} 📝`;
    document.getElementById('ot-text').textContent = text;
    document.getElementById('ot-input').value = '';
    document.getElementById('ot-timer').textContent = timeLimit;
    const otBar = document.getElementById('ot-timer-bar');
    otBar.style.transition = 'none'; otBar.style.width = '100%';
    let otRemaining = timeLimit;
    timerInterval = setInterval(() => {
      otRemaining--;
      document.getElementById('ot-timer').textContent = otRemaining;
      const pct = Math.max(0, (otRemaining / timeLimit) * 100);
      otBar.style.transition = 'width 1s linear'; otBar.style.width = pct + '%';
      if (otRemaining <= 0) clearInterval(timerInterval);
    }, 1000);
    showScreen('opentext');
    return;
  }

  // Drop Pin: tap-on-image with countdown
  if (type === 'droppin') {
    document.getElementById('dp-number').textContent = `Question ${questionNumber} of ${totalQuestions} 📍`;
    document.getElementById('dp-text').textContent = text;
    document.getElementById('dp-timer').textContent = timeLimit;
    const dpImg = document.getElementById('dp-image');
    if (image) { dpImg.src = image; dpImg.classList.remove('hidden'); }
    else { dpImg.classList.add('hidden'); dpImg.src = ''; }
    document.getElementById('dp-bg').style.display = '';
    document.getElementById('dp-marker').classList.add('hidden');
    document.getElementById('dp-confirm').disabled = true;
    document.getElementById('dp-confirm').textContent = 'Tap the image first';
    const dpBar = document.getElementById('dp-timer-bar');
    dpBar.style.transition = 'none'; dpBar.style.width = '100%';
    let dpRemaining = timeLimit;
    timerInterval = setInterval(() => {
      dpRemaining--;
      document.getElementById('dp-timer').textContent = dpRemaining;
      const pct = Math.max(0, (dpRemaining / timeLimit) * 100);
      dpBar.style.transition = 'width 1s linear'; dpBar.style.width = pct + '%';
      if (dpRemaining <= 0) clearInterval(timerInterval);
    }, 1000);
    showScreen('droppin');
    return;
  }

  const isLightning = type === 'lightning';
  const isTF = type === 'truefalse';
  document.getElementById('q-number').textContent =
    `Question ${questionNumber} of ${totalQuestions}${isLightning ? ' ⚡' : ''}`;
  document.getElementById('q-text').textContent = text;
  document.getElementById('q-timer-display').textContent = timeLimit;

  const img = document.getElementById('q-image');
  if (image) { img.src = image; img.classList.remove('hidden'); }
  else { img.classList.add('hidden'); img.src = ''; }

  // Toggle question text area visibility based on host setting
  const textArea = document.getElementById('q-text-area');
  const grid = document.getElementById('q-options');
  if (showQuestion) {
    textArea.classList.remove('hidden');
    grid.className = 'grid grid-cols-2 gap-2 p-3 flex-shrink-0';
  } else {
    textArea.classList.add('hidden');
    grid.className = 'grid grid-cols-2 grid-rows-2 gap-2 p-3 flex-1';
  }

  grid.innerHTML = '';
  options.forEach((option, i) => {
    const btn = document.createElement('button');
    btn.className = `${OPTION_COLORS[i]} active:opacity-70 text-white font-bold text-base rounded-2xl p-3 ${showQuestion ? (isTF ? 'min-h-[90px]' : 'min-h-[72px]') : 'h-full'} flex items-center justify-center text-center leading-tight`;
    btn.textContent = option;
    btn.addEventListener('click', () => {
      if (playerAnswer !== null) return;
      playerAnswer = i;
      AudioManager.play('submit');
      socket.emit('ANSWER_SUBMIT', { pin: gamePin, answerIndex: i });
      showScreen('answered');
    });
    grid.appendChild(btn);
  });

  // Countdown timer bar
  const bar = document.getElementById('q-timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  let remaining = timeLimit;

  timerInterval = setInterval(() => {
    remaining--;
    remaining = Math.min(remaining, playerTimerCap);
    document.getElementById('q-timer-display').textContent = remaining;
    const pct = Math.max(0, (remaining / timeLimit) * 100);
    bar.style.transition = 'width 1s linear';
    bar.style.width = pct + '%';
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);

  showScreen('question');
});

// ── Word Cloud submit ─────────────────────────────────────────────────────────

document.getElementById('wc-submit').addEventListener('click', () => {
  const word = document.getElementById('wc-input').value.trim();
  if (!word || playerAnswer !== null) return;
  playerAnswer = word;
  AudioManager.play('submit');
  socket.emit('ANSWER_SUBMIT', { pin: gamePin, word });
  showScreen('answered');
});

document.getElementById('wc-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('wc-submit').click();
});

// ── Open Text submit ──────────────────────────────────────────────────────────

document.getElementById('ot-submit').addEventListener('click', () => {
  const word = document.getElementById('ot-input').value.trim();
  if (!word || playerAnswer !== null) return;
  playerAnswer = word;
  AudioManager.play('submit');
  socket.emit('ANSWER_SUBMIT', { pin: gamePin, word });
  showScreen('answered');
});

document.getElementById('ot-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('ot-submit').click();
});

// ── Drop Pin tap + confirm ────────────────────────────────────────────────────

let pendingCoords = null;

document.getElementById('dp-area').addEventListener('click', (e) => {
  if (playerAnswer !== null) return;
  const area = document.getElementById('dp-area');
  const rect = area.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top)  / rect.height;
  pendingCoords = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };

  const marker = document.getElementById('dp-marker');
  marker.style.left = `${x * 100}%`;
  marker.style.top  = `${y * 100}%`;
  marker.classList.remove('hidden');
  document.getElementById('dp-bg').style.display = 'none';

  const btn = document.getElementById('dp-confirm');
  btn.disabled = false;
  btn.textContent = 'Confirm pin';
});

document.getElementById('dp-confirm').addEventListener('click', () => {
  if (!pendingCoords || playerAnswer !== null) return;
  playerAnswer = pendingCoords;
  AudioManager.play('submit');
  socket.emit('ANSWER_SUBMIT', { pin: gamePin, coords: pendingCoords });
  pendingCoords = null;
  showScreen('answered');
});

socket.on('RESULTS_BREAKDOWN', ({ correctIndex, players }) => {
  clearInterval(timerInterval);

  const { correct, scoreDelta, totalScore, didAnswer } = lastAnswerResult;
  const screen = document.getElementById('screen-result');

  const rank = players ? players.findIndex(p => p.nickname === playerNickname) + 1 : 0;
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';

  const isPoll = correctIndex === -1;
  if (isPoll) {
    document.getElementById('result-icon').textContent     = !didAnswer ? '😴' : '📊';
    document.getElementById('result-text').textContent     = !didAnswer ? 'No vote recorded' : 'Vote counted!';
    document.getElementById('result-answer').textContent   = '';
    document.getElementById('result-delta').textContent    = '';
    document.getElementById('result-standing').textContent = '';
    document.getElementById('result-total').textContent    = '';
    screen.style.backgroundColor = '#111827';
  } else {
    document.getElementById('result-icon').textContent     = !didAnswer ? '😴' : correct ? '✅' : '❌';
    document.getElementById('result-text').textContent     = !didAnswer ? 'Too slow!' : correct ? 'Correct!' : 'Wrong!';
    document.getElementById('result-answer').textContent   = correctIndex >= 0 ? `Answer: ${currentOptions[correctIndex]}` : '';
    document.getElementById('result-delta').textContent    = (didAnswer && correct) ? `+${scoreDelta.toLocaleString()} pts` : '';
    document.getElementById('result-standing').textContent = rank ? `${rank}${suffix} place` : '';
    document.getElementById('result-total').textContent    = `${playerScore.toLocaleString()} pts total`;
    screen.style.backgroundColor = !didAnswer ? '#111827' : correct ? '#14532d' : '#7f1d1d';
  }

  lastAnswerResult = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };
  showScreen('result');
});

socket.on('WORDCLOUD_RESULTS', () => {
  clearInterval(timerInterval);
  const { didAnswer } = lastAnswerResult;
  const screen = document.getElementById('screen-result');
  document.getElementById('result-icon').textContent     = didAnswer ? '☁️' : '😴';
  document.getElementById('result-text').textContent     = didAnswer ? 'Word submitted!' : 'No response';
  document.getElementById('result-answer').textContent   = '';
  document.getElementById('result-delta').textContent    = '';
  document.getElementById('result-standing').textContent = '';
  document.getElementById('result-total').textContent    = '';
  screen.style.backgroundColor = '#111827';
  lastAnswerResult = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };
  showScreen('result');
});

socket.on('DROPPIN_RESULTS', () => {
  clearInterval(timerInterval);
  const { didAnswer } = lastAnswerResult;
  const screen = document.getElementById('screen-result');
  document.getElementById('result-icon').textContent     = didAnswer ? '📍' : '😴';
  document.getElementById('result-text').textContent     = didAnswer ? 'Pin placed!' : 'No pin placed';
  document.getElementById('result-answer').textContent   = '';
  document.getElementById('result-delta').textContent    = '';
  document.getElementById('result-standing').textContent = '';
  document.getElementById('result-total').textContent    = '';
  screen.style.backgroundColor = '#111827';
  lastAnswerResult = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };
  showScreen('result');
});

socket.on('OPENTEXT_RESULTS', () => {
  clearInterval(timerInterval);
  const { didAnswer } = lastAnswerResult;
  const screen = document.getElementById('screen-result');
  document.getElementById('result-icon').textContent     = didAnswer ? '📝' : '😴';
  document.getElementById('result-text').textContent     = didAnswer ? 'Response recorded!' : 'No response';
  document.getElementById('result-answer').textContent   = '';
  document.getElementById('result-delta').textContent    = '';
  document.getElementById('result-standing').textContent = '';
  document.getElementById('result-total').textContent    = '';
  screen.style.backgroundColor = '#111827';
  lastAnswerResult = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };
  showScreen('result');
});

socket.on('FINAL_PODIUM', ({ players }) => {
  clearInterval(timerInterval);
  const rank = players.findIndex(p => p.nickname === playerNickname) + 1;
  const me   = players.find(p => p.nickname === playerNickname);
  document.getElementById('podium-score').textContent = me ? `${me.score.toLocaleString()} pts` : '';
  document.getElementById('podium-rank').textContent  = rank ? `#${rank} of ${players.length}` : '';
  showScreen('podium');
  launchConfetti();
});

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.classList.remove('hidden');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#a855f7','#fbbf24'];
  const particles = Array.from({ length: 100 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.6,
    w: Math.random() * 10 + 6,
    h: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    speed: Math.random() * 3 + 2,
    drift: (Math.random() - 0.5) * 1.5,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.12,
  }));

  const end = Date.now() + 5500;
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.y   += p.speed;
      p.x   += p.drift;
      p.rot += p.rotSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (Date.now() < end) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add('hidden');
    }
  })();
}

socket.on('ERROR', ({ message }) => {
  if (!screens.pin.classList.contains('hidden'))    showError(pinError, message);
  if (!screens.avatar.classList.contains('hidden')) showError(document.getElementById('avatar-error'), message);
});
