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
let playerNickname = '';
let playerEmoji    = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
let playerColor    = COLORS[Math.floor(Math.random() * COLORS.length)];
let playerAnswer      = null;
let currentOptions    = [];
let timerInterval     = null;
let playerScore       = 0;
let lastAnswerResult  = { correct: false, scoreDelta: 0, totalScore: 0, didAnswer: false };

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  pin:      document.getElementById('screen-pin'),
  avatar:   document.getElementById('screen-avatar'),
  lobby:    document.getElementById('screen-lobby'),
  ready:    document.getElementById('screen-ready'),
  slide:    document.getElementById('screen-slide'),
  question: document.getElementById('screen-question'),
  answered: document.getElementById('screen-answered'),
  result:   document.getElementById('screen-result'),
  podium:   document.getElementById('screen-podium'),
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

async function submitPin() {
  const pin = pinInput.value.trim();
  if (pin.length !== 6) return showError(pinError, 'Enter a 6-digit PIN');
  try {
    const res = await fetch(`/api/rooms/${pin}`);
    const data = await res.json();
    if (!res.ok) return showError(pinError, data.error || 'Invalid PIN');
    gamePin = pin;
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
  socket.emit('ROOM_JOIN', { pin: gamePin, nickname: playerNickname, emoji: playerEmoji, color: playerColor, token: sessionToken });
}

// ── Socket: state transitions ─────────────────────────────────────────────────

socket.on('GAME_STATE_CHANGE', ({ status, reason }) => {
  if (status === 'lobby') {
    showScreen('lobby');
    const lobbyAvatar = document.getElementById('lobby-avatar');
    lobbyAvatar.style.backgroundColor = playerColor;
    lobbyAvatar.textContent = playerEmoji;
    document.getElementById('lobby-nickname').textContent = playerNickname;
  }
  if (status === 'playing') {
    showScreen('ready');
  }
  if (status === 'ended') {
    showScreen('pin');
    showError(pinError, reason === 'host_disconnected' ? 'Host disconnected' : 'Game ended');
  }
});

socket.on('PLAYER_LIST_UPDATE', (players) => {
  const count = players.length;
  document.getElementById('player-count').textContent =
    `${count} player${count !== 1 ? 's' : ''} in the lobby`;
});

socket.on('ANSWER_RESULT', ({ correct, scoreDelta, totalScore }) => {
  playerScore = totalScore;
  lastAnswerResult = { correct, scoreDelta, totalScore, didAnswer: true };
});

// ── Socket: question flow ─────────────────────────────────────────────────────

socket.on('QUESTION_DATA', ({ questionNumber, totalQuestions, text, options, timeLimit, image, type, showQuestion }) => {
  clearInterval(timerInterval);
  playerAnswer = null;
  currentOptions = options;

  // Slide: just show content, no timer or answers
  if (type === 'slide') {
    const img = document.getElementById('slide-image');
    if (image) { img.src = image; img.classList.remove('hidden'); }
    else { img.classList.add('hidden'); img.src = ''; }
    document.getElementById('slide-text').textContent = text;
    showScreen('slide');
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
    document.getElementById('q-timer-display').textContent = remaining;
    const pct = Math.max(0, (remaining / timeLimit) * 100);
    bar.style.transition = 'width 1s linear';
    bar.style.width = pct + '%';
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);

  showScreen('question');
});

socket.on('RESULTS_BREAKDOWN', ({ correctIndex, players }) => {
  clearInterval(timerInterval);

  const { correct, scoreDelta, totalScore, didAnswer } = lastAnswerResult;
  const screen = document.getElementById('screen-result');

  const rank = players ? players.findIndex(p => p.nickname === playerNickname) + 1 : 0;
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';

  document.getElementById('result-icon').textContent     = !didAnswer ? '😴' : correct ? '✅' : '❌';
  document.getElementById('result-text').textContent     = !didAnswer ? 'Too slow!' : correct ? 'Correct!' : 'Wrong!';
  document.getElementById('result-answer').textContent   = `Answer: ${currentOptions[correctIndex]}`;
  document.getElementById('result-delta').textContent    = (didAnswer && correct) ? `+${scoreDelta.toLocaleString()} pts` : '';
  document.getElementById('result-standing').textContent = rank ? `${rank}${suffix} place` : '';
  document.getElementById('result-total').textContent    = `${playerScore.toLocaleString()} pts total`;

  screen.style.backgroundColor = !didAnswer ? '#111827' : correct ? '#14532d' : '#7f1d1d';

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
});

socket.on('ERROR', ({ message }) => {
  if (!screens.pin.classList.contains('hidden'))    showError(pinError, message);
  if (!screens.avatar.classList.contains('hidden')) showError(document.getElementById('avatar-error'), message);
});
