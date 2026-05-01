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
let soundMode = localStorage.getItem('soundMode') || 'default';

const TEAM_COLORS = { red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e' };
const TEAM_LABELS = { red: '🔴 Red', blue: '🔵 Blue', yellow: '🟡 Yellow', green: '🟢 Green' };

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  lobby:     document.getElementById('screen-lobby'),
  ready:     document.getElementById('screen-ready'),
  slide:     document.getElementById('screen-slide'),
  question:  document.getElementById('screen-question'),
  results:   document.getElementById('screen-results'),
  wordcloud: document.getElementById('screen-wordcloud'),
  droppin:   document.getElementById('screen-droppin'),
  opentext:  document.getElementById('screen-opentext'),
  podium:    document.getElementById('screen-podium'),
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ── Init: create room via HTTP then register socket ───────────────────────────

(async function init() {
  document.getElementById('join-url').textContent = `${location.host}/player`;
  const mobileUrl = document.getElementById('join-url-mobile');
  if (mobileUrl) mobileUrl.textContent = `${location.host}/player`;

  AudioManager.load('lobby',      '/assets/music/lobby%20music.mp3');
  AudioManager.load('game-start', '/assets/music/foxboytails-game-start-317318.mp3');
  AudioManager.load('tick-tock',  '/assets/music/freesound_community-tick-tock-104746.mp3');
  AudioManager.load('applause',   '/assets/music/driken5482-applause-cheer-236786.mp3');

  const muteBtn = document.getElementById('mute-btn');
  muteBtn.addEventListener('click', () => {
    const muted = AudioManager.toggleMute();
    muteBtn.innerHTML = muted ? '🔇' : '🔊';
  });
  // Resume lobby music on first interaction (browser autoplay policy)
  document.addEventListener('click', () => AudioManager.resume('lobby'), { once: true });

  // Sound mode toggle (persisted to localStorage)
  function applySoundMode(mode) {
    soundMode = mode;
    localStorage.setItem('soundMode', mode);
    AudioManager.setMuted(mode === 'silent');
    document.querySelectorAll('.sound-mode-btn').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.className = `sound-mode-btn px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`;
    });
  }
  applySoundMode(soundMode); // restore persisted mode
  document.querySelectorAll('.sound-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => applySoundMode(btn.dataset.mode));
  });

  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const { pin, qr } = await res.json();
    gamePin = pin;
    document.getElementById('lobby-pin').textContent = pin;
    document.getElementById('qr-img').src = qr;

    // Fetch quizzes before registering so cards are ready when lobby shows
    const quizRes = await fetch('/api/quizzes');
    const quizzes = await quizRes.json();
    const cardsEl = document.getElementById('quiz-cards');

    if (quizzes.length === 0) {
      cardsEl.innerHTML = '<p class="text-red-400 text-sm text-center py-2">No quizzes yet — create one at /admin</p>';
    } else {
      quizzes.forEach(({ id, title, questionCount }) => {
        const card = document.createElement('button');
        card.className = 'w-full text-left bg-gray-800 hover:bg-gray-700 border-2 border-transparent rounded-xl px-4 py-3 transition-colors';
        card.innerHTML = `<p class="font-bold">${title}</p><p class="text-gray-400 text-xs">${questionCount} question${questionCount !== 1 ? 's' : ''}</p>`;
        card.addEventListener('click', () => {
          cardsEl.querySelectorAll('button').forEach(b => {
            b.classList.remove('border-indigo-500', 'bg-indigo-900');
          });
          card.classList.add('border-indigo-500', 'bg-indigo-900');
          selectedQuizId = id;
          updateStartBtn();
        });
        cardsEl.appendChild(card);
      });
      if (quizzes.length === 1) cardsEl.querySelector('button').click();
    }

    document.getElementById('copy-link-btn').addEventListener('click', () => {
      const url = `${location.origin}/join/${pin}`;
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copy-link-btn');
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '🔗 Copy join link'; }, 2000);
      });
    });

    socket.emit('HOST_REGISTER', { pin });
  } catch (err) {
    console.error('Host init failed:', err);
    document.body.innerHTML = `<p class="text-red-400 text-center mt-20 text-2xl">Could not connect to server</p><p class="text-gray-500 text-center mt-2">${err.message}</p>`;
  }
})();

// ── Lobby ─────────────────────────────────────────────────────────────────────

function updateStartBtn() {
  const hasPlayers = document.getElementById('player-grid').children.length > 0;
  const btn = document.getElementById('start-btn');
  if (!selectedQuizId && !hasPlayers) { btn.textContent = 'Select a quiz first'; btn.disabled = true; }
  else if (!selectedQuizId)           { btn.textContent = 'Select a quiz first'; btn.disabled = true; }
  else if (!hasPlayers)               { btn.textContent = 'Waiting for players…'; btn.disabled = true; }
  else                                { btn.textContent = 'Start Game';           btn.disabled = false; }
}

document.getElementById('start-btn').addEventListener('click', () => {
  AudioManager.stop('lobby'); // Stop immediately, don't wait for GAME_STATE_CHANGE
  const showQ = document.getElementById('show-question-toggle').checked;
  socket.emit('GAME_START', { pin: gamePin, quizId: selectedQuizId, showQuestionOnPlayer: showQ });
});

document.getElementById('slide-continue-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

document.getElementById('first-question-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

socket.on('PLAYER_LIST_UPDATE', (players) => {
  const count = players.length;
  document.getElementById('lobby-player-count').textContent =
    count === 0 ? 'Waiting for players…' : `${count} player${count !== 1 ? 's' : ''} joined`;

  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';
  players.forEach(({ nickname, emoji, color, team }) => {
    const card = document.createElement('div');
    card.className = 'flex flex-col items-center gap-1 w-16';
    const ring = team ? `box-shadow:0 0 0 3px ${TEAM_COLORS[team]}` : '';
    card.innerHTML = `
      <div class="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
           style="background-color:${color};${ring}">${emoji}</div>
      <span class="text-xs text-gray-300 truncate w-full text-center">${nickname}</span>
    `;
    grid.appendChild(card);
  });
  updateStartBtn();
});

// ── Game state changes ────────────────────────────────────────────────────────

socket.on('GAME_STATE_CHANGE', ({ status, pin }) => {
  if (status === 'lobby') {
    AudioManager.play('lobby', true);
    showScreen('lobby');
  }
  if (status === 'playing') {
    AudioManager.stop('lobby');
    showScreen('ready');
  }
  if (status === 'ended') {
    AudioManager.stopAll();
    location.reload();
  }
});

// ── Question ──────────────────────────────────────────────────────────────────

socket.on('QUESTION_DATA', ({ questionNumber, totalQuestions: total, text, options, timeLimit, image, type }) => {
  AudioManager.stop('tick-tock');
  currentQuestionNumber = questionNumber;
  totalQuestions = total;

  // Slide: show the slide screen, no timer
  if (type === 'slide') {
    const img = document.getElementById('slide-image');
    if (image) { img.src = image; img.classList.remove('hidden'); }
    else { img.classList.add('hidden'); img.src = ''; }
    document.getElementById('slide-text').textContent = text;
    showScreen('slide');
    return;
  }

  AudioManager.play('game-start');
  document.getElementById('q-label').textContent =
    `Question ${questionNumber} of ${total}${type === 'lightning' ? ' ⚡' : ''}`;
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

document.getElementById('skip-btn').addEventListener('click', () => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  socket.emit('NEXT_QUESTION', { pin: gamePin, skip: true });
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
    if (remaining === (soundMode === 'party' ? 10 : 5)) AudioManager.play('tick-tock');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      socket.emit('NEXT_QUESTION', { pin: gamePin });
    }
  }, 1000);
}

// ── Results ───────────────────────────────────────────────────────────────────

socket.on('RESULTS_BREAKDOWN', ({ correctIndex, answerCounts, players, isLast }) => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  AudioManager.play('applause');
  if (soundMode === 'party') launchConfetti();
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

  const isPoll = correctIndex === -1;
  answerCounts.forEach((count, i) => {
    const isCorrect = !isPoll && i === correctIndex;
    const widthPct = Math.round((count / maxCount) * 100);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-4';
    row.innerHTML = `
      <div class="w-8 text-center font-black text-lg opacity-70">${['A','B','C','D'][i]}</div>
      <div class="flex-1 bg-gray-800 rounded-xl h-14 relative overflow-hidden">
        <div class="h-full rounded-xl transition-all duration-700 ${OPTION_COLORS[i]}"
             style="width:${widthPct}%;opacity:${isPoll || isCorrect ? 1 : 0.5}"></div>
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

socket.on('WORDCLOUD_RESULTS', ({ wordCounts, isLast }) => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  AudioManager.play('applause');
  if (soundMode === 'party') launchConfetti();
  isLastQuestion = isLast;

  document.getElementById('wc-label').textContent =
    `Question ${currentQuestionNumber} of ${totalQuestions} — Word Cloud`;
  document.getElementById('wc-q-text').textContent =
    document.getElementById('q-text').textContent;

  const entries = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = entries[0]?.[1] || 1;
  const colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#a855f7','#ef4444','#fbbf24'];
  const cloud = document.getElementById('wc-cloud');
  cloud.innerHTML = '';
  entries.forEach(([word, count], idx) => {
    const span = document.createElement('span');
    const size = 16 + Math.round((count / maxCount) * 52);
    span.style.cssText = `font-size:${size}px;font-weight:900;color:${colors[idx % colors.length]};padding:4px 6px;`;
    span.textContent = word;
    cloud.appendChild(span);
  });

  const total = Object.values(wordCounts).reduce((s, c) => s + c, 0);
  document.getElementById('wc-count').textContent = `${total} response${total !== 1 ? 's' : ''}`;
  document.getElementById('wc-next-btn').textContent = isLast ? 'See Final Scores →' : 'Next Question →';
  showScreen('wordcloud');
});

document.getElementById('wc-next-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

socket.on('DROPPIN_RESULTS', ({ pins, image, isLast }) => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  AudioManager.play('applause');
  if (soundMode === 'party') launchConfetti();
  isLastQuestion = isLast;

  document.getElementById('dp-label').textContent =
    `Question ${currentQuestionNumber} of ${totalQuestions} — Drop Pin`;
  document.getElementById('dp-q-text').textContent =
    document.getElementById('q-text').textContent;

  const imgEl = document.getElementById('dp-image');
  if (image) { imgEl.src = image; imgEl.classList.remove('hidden'); }
  else { imgEl.classList.add('hidden'); imgEl.src = ''; }

  const pinsEl = document.getElementById('dp-pins');
  pinsEl.innerHTML = '';
  pins.forEach(({ x, y, emoji, color }) => {
    const dot = document.createElement('div');
    dot.className = 'absolute flex items-center justify-center text-lg rounded-full shadow-lg border-2 border-white w-9 h-9';
    dot.style.cssText = `left:${x * 100}%;top:${y * 100}%;transform:translate(-50%,-50%);background-color:${color};`;
    dot.textContent = emoji;
    pinsEl.appendChild(dot);
  });

  document.getElementById('dp-count').textContent =
    `${pins.length} pin${pins.length !== 1 ? 's' : ''} placed`;
  document.getElementById('dp-next-btn').textContent = isLast ? 'See Final Scores →' : 'Next Question →';
  showScreen('droppin');
});

document.getElementById('dp-next-btn').addEventListener('click', () => {
  socket.emit('NEXT_QUESTION', { pin: gamePin });
});

socket.on('OPENTEXT_RESULTS', ({ answers, isLast }) => {
  clearInterval(timerInterval);
  AudioManager.stop('tick-tock');
  AudioManager.play('applause');
  if (soundMode === 'party') launchConfetti();
  isLastQuestion = isLast;

  document.getElementById('ot-label').textContent =
    `Question ${currentQuestionNumber} of ${totalQuestions} — Responses`;
  document.getElementById('ot-q-text').textContent =
    document.getElementById('q-text').textContent;
  document.getElementById('ot-count').textContent =
    `${answers.length} response${answers.length !== 1 ? 's' : ''}`;

  const answersEl = document.getElementById('ot-answers');
  answersEl.innerHTML = '';
  if (answers.length === 0) {
    answersEl.innerHTML = '<p class="text-gray-500 text-center py-8">No responses submitted</p>';
  } else {
    answers.forEach(({ text, nickname, emoji, color }) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3';
      row.innerHTML = `
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-xl flex-shrink-0"
             style="background-color:${color}">${emoji}</div>
        <span class="text-gray-400 text-sm flex-shrink-0 truncate max-w-[6rem]">${escapeHtml(nickname)}:</span>
        <span class="font-semibold flex-1 min-w-0 break-words">${escapeHtml(text)}</span>
      `;
      answersEl.appendChild(row);
    });
  }

  document.getElementById('ot-next-btn').textContent = isLast ? 'See Final Scores →' : 'Next Question →';
  showScreen('opentext');
});

document.getElementById('ot-next-btn').addEventListener('click', () => {
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

  const medals  = ['🥇', '🥈', '🥉'];
  const top3El  = document.getElementById('podium-top3');
  const listEl  = document.getElementById('podium-list');
  top3El.innerHTML = '';
  listEl.innerHTML = '';

  // Top-3 podium blocks — staggered slide-in (2nd, 1st, 3rd for visual height order)
  const podiumOrder = [1, 0, 2]; // indices into players array, rendered left→right
  const heights = ['h-28 md:h-36', 'h-36 md:h-44', 'h-24 md:h-32'];
  const delays  = [200, 0, 400]; // ms delay per slot

  podiumOrder.forEach((playerIdx, slot) => {
    const p = players[playerIdx];
    if (!p) return;
    const block = document.createElement('div');
    block.className = `podium-row flex-1 flex flex-col items-center justify-end rounded-2xl pb-3 pt-2 px-2 bg-gray-800 ${heights[slot]}`;
    block.style.animationDelay = `${delays[slot]}ms`;
    block.innerHTML = `
      <div class="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-2xl md:text-3xl mb-1 flex-shrink-0"
           style="background-color:${p.color}">${p.emoji}</div>
      <span class="text-2xl md:text-3xl mb-1">${medals[playerIdx] || ''}</span>
      <p class="font-black text-sm md:text-base text-center leading-tight truncate w-full text-center">${p.nickname}</p>
      <p class="text-gray-400 text-xs mt-0.5">${p.score.toLocaleString()} pts</p>
    `;
    top3El.appendChild(block);
  });

  // Remaining players (4th onward) — simple rows, fading in after top-3 settles
  players.slice(3).forEach(({ nickname, emoji, color, score }, i) => {
    const row = document.createElement('div');
    row.className = 'podium-row flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2.5';
    row.style.animationDelay = `${700 + i * 80}ms`;
    row.innerHTML = `
      <span class="text-gray-400 w-6 text-center text-sm font-bold">${i + 4}.</span>
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
           style="background-color:${color}">${emoji}</div>
      <span class="flex-1 font-semibold text-sm">${nickname}</span>
      <span class="text-gray-400 text-sm">${score.toLocaleString()} pts</span>
    `;
    listEl.appendChild(row);
  });

  // Team leaderboard — only shown when players have chosen teams
  const teamScores = {};
  players.forEach(p => {
    if (!p.team) return;
    teamScores[p.team] = (teamScores[p.team] || 0) + p.score;
  });
  const teamEntries = Object.entries(teamScores).sort(([, a], [, b]) => b - a);
  const teamPodium = document.getElementById('team-podium');
  const teamList   = document.getElementById('team-scores-list');
  teamList.innerHTML = '';

  if (teamEntries.length > 0) {
    teamPodium.classList.remove('hidden');
    const teamMedals = ['🥇', '🥈', '🥉'];
    teamEntries.forEach(([team, score], i) => {
      const row = document.createElement('div');
      row.className = 'podium-row flex items-center gap-3 rounded-xl px-4 py-3';
      row.style.cssText = `background-color:${TEAM_COLORS[team]}33;animation-delay:${900 + i * 100}ms`;
      row.innerHTML = `
        <span class="text-xl w-8 text-center">${teamMedals[i] || `${i + 1}.`}</span>
        <span class="flex-1 font-bold text-lg">${TEAM_LABELS[team] || team}</span>
        <span class="font-black text-xl">${score.toLocaleString()} pts</span>
      `;
      teamList.appendChild(row);
    });
  } else {
    teamPodium.classList.add('hidden');
  }

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
  const particles = Array.from({ length: 140 }, () => ({
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
  let raf;
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
      raf = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.add('hidden');
    }
  })();
}

socket.on('ERROR', ({ message }) => {
  console.error('Server error:', message);
});
