const socket = io();

const OPTION_COLORS = ['bg-red-600', 'bg-blue-600', 'bg-yellow-500', 'bg-green-600'];
const OPTION_BORDER  = ['border-red-400', 'border-blue-400', 'border-yellow-300', 'border-green-400'];
const OPTION_HEX     = ['#dc2626', '#2563eb', '#ca8a04', '#16a34a'];
const TIMER_CIRC     = 263.9; // 2π × r=42

let gamePin = null;
let selectedQuizId = null;
let timerInterval = null;
let timerTotal = 0;
let currentQuestionNumber = 0;
let totalQuestions = 0;
let isLastQuestion = false;

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  lobby:    document.getElementById('screen-lobby'),
  ready:    document.getElementById('screen-ready'),
  question: document.getElementById('screen-question'),
  results:  document.getElementById('screen-results'),
  podium:   document.getElementById('screen-podium'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ── Init: create room via HTTP then register socket ───────────────────────────

(async function init() {
  document.getElementById('join-url').textContent = `${location.host}/player`;

  AudioManager.load('game-start', '/assets/music/foxboytails-game-start-317318.mp3');
  AudioManager.load('tick-tock',  '/assets/music/freesound_community-tick-tock-104746.mp3');
  AudioManager.load('applause',   '/assets/music/driken5482-applause-cheer-236786.mp3');

  document.getElementById('mute-btn').addEventListener('click', () => {
    const muted = AudioManager.toggleMute();
    document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
  });

  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const { pin } = await res.json();
    gamePin = pin;
    document.getElementById('lobby-pin').textContent = pin;

    QRCode.toDataURL(`${location.origin}/player`, {
      width: 160, margin: 1,
      color: { dark: '#ffffff', light: '#1f2937' },
    }).then(url => { document.getElementById('qr-code').src = url; });

    socket.emit('HOST_REGISTER', { pin });

    // Populate quiz selector
    const quizRes = await fetch('/api/quizzes');
    const quizzes = await quizRes.json();
    const select = document.getElementById('quiz-select');
    quizzes.forEach(({ id, title, questionCount }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${title} (${questionCount} questions)`;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      selectedQuizId = select.value || null;
      updateStartBtn();
    });
  } catch {
    document.body.innerHTML = '<p class="text-red-400 text-center mt-20 text-2xl">Could not connect to server</p>';
  }
})();

// ── Lobby ─────────────────────────────────────────────────────────────────────

function updateStartBtn() {
  const hasPlayers = document.getElementById('player-grid').children.length > 0;
  document.getElementById('start-btn').disabled = !hasPlayers || !selectedQuizId;
}

document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('GAME_START', { pin: gamePin, quizId: selectedQuizId });
});

document.getElementById('first-question-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

socket.on('PLAYER_LIST_UPDATE', (players) => {
  updateStartBtn();
  const count = players.length;
  document.getElementById('lobby-player-count').textContent =
    count === 0 ? 'Waiting for players…' : `${count} player${count !== 1 ? 's' : ''} joined`;

  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';
  players.forEach(({ nickname, emoji, color }) => {
    const card = document.createElement('div');
    card.className = 'flex flex-col items-center gap-1 w-16';
    card.innerHTML = `
      <div class="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
           style="background-color:${color}">${emoji}</div>
      <span class="text-xs text-gray-300 truncate w-full text-center">${nickname}</span>
    `;
    grid.appendChild(card);
  });
});

// ── Game state changes ────────────────────────────────────────────────────────

socket.on('GAME_STATE_CHANGE', ({ status, pin }) => {
  if (status === 'lobby') {
    showScreen('lobby');
  }
  if (status === 'playing') {
    showScreen('ready');
  }
  if (status === 'ended') {
    AudioManager.stopAll();
    location.reload();
  }
});

// ── Question ──────────────────────────────────────────────────────────────────

socket.on('QUESTION_DATA', ({ questionNumber, totalQuestions: total, text, options, timeLimit, image }) => {
  AudioManager.stop('tick-tock');
  AudioManager.play('game-start');
  currentQuestionNumber = questionNumber;
  totalQuestions = total;

  document.getElementById('q-label').textContent = `Question ${questionNumber} of ${total}`;
  document.getElementById('q-text').textContent = text;

  const img = document.getElementById('q-image');
  if (image) { img.src = image; img.classList.remove('hidden'); }
  else { img.classList.add('hidden'); img.src = ''; }
  document.getElementById('answer-count').textContent = `0 / ${document.querySelectorAll('#player-grid > div').length || '?'} answered`;
  document.getElementById('answer-bar').style.width = '0%';

  const optionsEl = document.getElementById('q-options');
  optionsEl.innerHTML = '';
  options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = `${OPTION_COLORS[i]} rounded-2xl p-5 text-xl font-bold flex items-center gap-3`;
    div.innerHTML = `<span class="text-2xl opacity-70">${['▲','◆','●','■'][i]}</span>${opt}`;
    optionsEl.appendChild(div);
  });

  startTimer(timeLimit);
  showScreen('question');
});

document.getElementById('show-results-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

socket.on('ANSWER_COUNT', ({ count, total }) => {
  document.getElementById('answer-count').textContent = `${count} / ${total} answered`;
  document.getElementById('answer-bar').style.width = total > 0 ? `${(count / total) * 100}%` : '0%';
});

function startTimer(seconds) {
  clearInterval(timerInterval);
  timerTotal = seconds;
  let remaining = seconds;
  const circle = document.getElementById('timer-circle');
  const number = document.getElementById('timer-number');

  function tick() {
    number.textContent = remaining;
    const offset = TIMER_CIRC * (1 - remaining / timerTotal);
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = remaining <= 5 ? '#ef4444' : '#6366f1';
  }

  tick();
  timerInterval = setInterval(() => {
    remaining--;
    tick();
    if (remaining === 5) AudioManager.play('tick-tock');
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
}

// ── Results ───────────────────────────────────────────────────────────────────

socket.on('RESULTS_BREAKDOWN', ({ correctIndex, answerCounts, players, isLast }) => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  AudioManager.play('applause');
  isLastQuestion = isLast;

  document.getElementById('results-label').textContent =
    `Question ${currentQuestionNumber} of ${totalQuestions} — Results`;
  document.getElementById('results-q-text').textContent =
    document.getElementById('q-text').textContent;

  const options = Array.from(document.getElementById('q-options').children).map(el =>
    el.textContent.replace(/^[▲◆●■]/, '').trim()
  );

  const maxCount = Math.max(...answerCounts, 1);
  const barsEl = document.getElementById('results-bars');
  barsEl.innerHTML = '';

  answerCounts.forEach((count, i) => {
    const isCorrect = i === correctIndex;
    const widthPct = Math.round((count / maxCount) * 100);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-4';
    row.innerHTML = `
      <div class="w-8 text-center font-black text-lg opacity-70">${['A','B','C','D'][i]}</div>
      <div class="flex-1 bg-gray-800 rounded-xl h-14 relative overflow-hidden">
        <div class="h-full rounded-xl transition-all duration-700 ${OPTION_COLORS[i]}"
             style="width:${widthPct}%;opacity:${isCorrect ? 1 : 0.5}"></div>
        <span class="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg">${options[i] || ''}</span>
        <span class="absolute right-4 top-1/2 -translate-y-1/2 font-bold">${count}</span>
      </div>
      <div class="w-8 text-center text-2xl">${isCorrect ? '✅' : ''}</div>
    `;
    barsEl.appendChild(row);
  });

  const nextBtn = document.getElementById('next-btn');
  nextBtn.textContent = isLast ? 'See Final Scores →' : 'Next Question →';

  // Mini-leaderboard: top 3
  const medals = ['🥇', '🥈', '🥉'];
  const topEl = document.getElementById('results-top');
  topEl.innerHTML = '';
  players.slice(0, 3).forEach(({ nickname, emoji, color, score }, i) => {
    const card = document.createElement('div');
    card.className = 'bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 flex-1 min-w-0';
    card.innerHTML = `
      <span class="text-2xl">${medals[i]}</span>
      <div class="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0"
           style="background-color:${color}">${emoji}</div>
      <div class="min-w-0">
        <p class="font-bold text-sm truncate">${nickname}</p>
        <p class="text-gray-400 text-xs">${score.toLocaleString()} pts</p>
      </div>
    `;
    topEl.appendChild(card);
  });

  showScreen('results');
});

document.getElementById('next-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

// ── Podium ────────────────────────────────────────────────────────────────────

socket.on('REACTION_BROADCAST', ({ emoji, color }) => {
  const overlay = document.getElementById('reaction-overlay');
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.style.bottom = '60px';
  el.textContent = emoji;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

socket.on('FINAL_PODIUM', ({ players }) => {
  clearInterval(timerInterval);
  AudioManager.play('applause');
  const medals = ['🥇', '🥈', '🥉'];
  const list = document.getElementById('podium-list');
  list.innerHTML = '';

  players.forEach(({ nickname, emoji, color, score }, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-4 bg-gray-800 rounded-2xl px-5 py-3';
    row.innerHTML = `
      <span class="text-3xl w-10 text-center">${medals[i] || `${i + 1}.`}</span>
      <div class="w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0"
           style="background-color:${color}">${emoji}</div>
      <span class="flex-1 font-bold text-lg">${nickname}</span>
      <span class="text-gray-300 font-semibold">${score.toLocaleString()} pts</span>
    `;
    list.appendChild(row);
  });

  showScreen('podium');
});

socket.on('ERROR', ({ message }) => {
  console.error('Server error:', message);
});
