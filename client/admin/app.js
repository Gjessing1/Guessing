const OPTION_COLORS = ['bg-red-600', 'bg-blue-600', 'bg-yellow-500', 'bg-green-600'];
const OPTION_LABELS = ['A', 'B', 'C', 'D'];

let adminPassword = '';
let currentQuiz = null;
let editingIndex = null;
let pendingImageUrl = null;

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  login:         document.getElementById('screen-login'),
  list:          document.getElementById('screen-list'),
  editor:        document.getElementById('screen-editor'),
  resultsList:   document.getElementById('screen-results-list'),
  resultsDetail: document.getElementById('screen-results-detail'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function adminFetch(url, options = {}) {
  const headers = { 'x-admin-password': adminPassword, ...(options.headers || {}) };
  return fetch(url, { ...options, headers });
}

document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('login-btn').addEventListener('click', login);

async function login() {
  const pw = document.getElementById('password-input').value;
  const res = await fetch('/api/admin/verify', { method: 'POST', headers: { 'x-admin-password': pw } });
  if (!res.ok) {
    document.getElementById('login-error').textContent = 'Wrong password';
    return;
  }
  adminPassword = pw;
  sessionStorage.setItem('adminPassword', pw);
  loadQuizList();
}

// On page load: try stored password
(async function init() {
  const stored = sessionStorage.getItem('adminPassword');
  if (stored) {
    const res = await fetch('/api/admin/verify', { method: 'POST', headers: { 'x-admin-password': stored } });
    if (res.ok) {
      adminPassword = stored;
      return loadQuizList();
    }
  }
  showScreen('login');
})();

// ── Quiz List ─────────────────────────────────────────────────────────────────

let allQuizzes = [];
let currentSort = localStorage.getItem('quizSort') || 'newest';

function applySort(quizzes, sort) {
  const arr = [...quizzes];
  if (sort === 'newest')     return arr.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
  if (sort === 'oldest')     return arr.sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? 1 : -1);
  if (sort === 'lastplayed') return arr.sort((a, b) => (b.lastPlayedAt || '') > (a.lastPlayedAt || '') ? 1 : -1);
  if (sort === 'az')         return arr.sort((a, b) => a.title.localeCompare(b.title));
  return arr;
}

function setSortActive(sort) {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const active = btn.dataset.sort === sort;
    btn.className = `sort-btn px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
      active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
    }`;
  });
}

document.getElementById('sort-btns').addEventListener('click', e => {
  const btn = e.target.closest('.sort-btn');
  if (!btn) return;
  currentSort = btn.dataset.sort;
  localStorage.setItem('quizSort', currentSort);
  setSortActive(currentSort);
  renderQuizList(allQuizzes);
});

async function loadQuizList() {
  const res = await adminFetch('/api/quizzes');
  allQuizzes = await res.json();
  setSortActive(currentSort);
  renderQuizList(allQuizzes);
  showScreen('list');
}

function formatTime(seconds) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function renderQuizList(quizzes) {
  const list = document.getElementById('quiz-list');
  const empty = document.getElementById('list-empty');
  list.innerHTML = '';

  const sorted = applySort(quizzes, currentSort);

  if (sorted.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  sorted.forEach(({ id, title, questionCount, totalTime, lastPlayedAt }) => {
    const row = document.createElement('div');
    row.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between bg-gray-800 rounded-2xl px-4 md:px-6 py-4 gap-3';
    const lastPlayedStr = lastPlayedAt
      ? `Last played ${new Date(lastPlayedAt).toLocaleDateString()}`
      : 'Never played';
    row.innerHTML = `
      <div>
        <p class="font-bold text-base md:text-lg">${escapeHtml(title)}</p>
        <p class="text-gray-400 text-sm">${questionCount} question${questionCount !== 1 ? 's' : ''} &middot; ${formatTime(totalTime || 0)} &middot; ${lastPlayedStr}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button data-action="duplicate" data-id="${id}"
          class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1.5 px-3 rounded-lg text-xs md:text-sm transition-colors">Duplicate</button>
        <button data-action="export" data-id="${id}"
          class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1.5 px-3 rounded-lg text-xs md:text-sm transition-colors">Export</button>
        <button data-action="edit" data-id="${id}"
          class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs md:text-sm transition-colors">Edit</button>
        <button data-action="delete" data-id="${id}"
          class="bg-gray-700 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs md:text-sm transition-colors">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit')      openEditor(id);
    if (action === 'export')    exportQuiz(id);
    if (action === 'delete')    deleteQuiz(id);
    if (action === 'duplicate') duplicateQuiz(id);
  });
}

async function duplicateQuiz(id) {
  await adminFetch(`/api/quizzes/${id}/duplicate`, { method: 'POST' });
  loadQuizList();
}

document.getElementById('new-quiz-btn').addEventListener('click', createQuiz);
document.getElementById('nav-to-results').addEventListener('click', loadResultsList);
document.getElementById('nav-to-quizzes').addEventListener('click', loadQuizList);
document.getElementById('results-back-btn').addEventListener('click', loadResultsList);

async function createQuiz() {
  const title = prompt('Quiz title:');
  if (!title?.trim()) return;
  const res = await adminFetch('/api/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim() }),
  });
  const quiz = await res.json();
  openEditor(quiz.id);
}

async function deleteQuiz(id) {
  if (!confirm('Delete this quiz?')) return;
  await adminFetch(`/api/quizzes/${id}`, { method: 'DELETE' });
  loadQuizList();
}

async function exportQuiz(id) {
  const a = document.createElement('a');
  a.href = `/api/quizzes/${id}/export`;
  a.click();
}

// Import
document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const res = await adminFetch('/api/quizzes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { alert('Invalid quiz format'); return; }
    e.target.value = '';
    loadQuizList();
  } catch {
    alert('Could not parse JSON file');
  }
});

// ── Quiz Editor ───────────────────────────────────────────────────────────────

async function openEditor(id) {
  const res = await adminFetch(`/api/quizzes/${id}`);
  currentQuiz = await res.json();
  document.getElementById('quiz-title').value = currentQuiz.title;
  renderQuestions();
  showScreen('editor');
}

document.getElementById('back-btn').addEventListener('click', () => {
  currentQuiz = null;
  loadQuizList();
});

document.getElementById('save-btn').addEventListener('click', saveQuiz);
document.getElementById('save-btn-mobile').addEventListener('click', saveQuiz);
document.getElementById('export-btn').addEventListener('click', () => exportQuiz(currentQuiz.id));
document.getElementById('export-btn-mobile').addEventListener('click', () => exportQuiz(currentQuiz.id));

async function saveQuiz() {
  const title = document.getElementById('quiz-title').value.trim();
  if (!title) { alert('Enter a quiz title'); return; }
  currentQuiz.title = title;
  const res = await adminFetch(`/api/quizzes/${currentQuiz.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentQuiz),
  });
  currentQuiz = await res.json();
  for (const id of ['save-btn', 'save-btn-mobile']) {
    const btn = document.getElementById(id);
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.textContent = 'Save'; }, 2000);
  }
}

function renderQuestions() {
  const list = document.getElementById('question-list');
  list.innerHTML = '';

  if (currentQuiz.questions.length === 0) {
    list.innerHTML = '<p class="text-gray-500 text-center py-8">No questions yet. Add one below.</p>';
    return;
  }

  const TYPE_BADGE = { lightning: '⚡', truefalse: 'T/F', slide: '🖼', poll: '📊', wordcloud: '☁️', droppin: '📍' };

  currentQuiz.questions.forEach((q, i) => {
    const isFirst = i === 0;
    const isLast  = i === currentQuiz.questions.length - 1;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 bg-gray-800 rounded-2xl px-4 py-3';
    row.innerHTML = `
      <div class="flex flex-col gap-1 flex-shrink-0">
        <button data-action="up" data-idx="${i}"
          class="text-gray-500 hover:text-white disabled:opacity-20 text-xs leading-none px-1" ${isFirst ? 'disabled' : ''}>▲</button>
        <span class="text-gray-500 font-black text-center text-sm">${i + 1}</span>
        <button data-action="down" data-idx="${i}"
          class="text-gray-500 hover:text-white disabled:opacity-20 text-xs leading-none px-1" ${isLast ? 'disabled' : ''}>▼</button>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold truncate">${escapeHtml(q.text)}</p>
        <p class="text-gray-400 text-xs mt-0.5">
          ${TYPE_BADGE[q.type] ? `<span class="font-bold text-yellow-400">${TYPE_BADGE[q.type]}</span>` : 'Multiple choice'}
          ${q.type !== 'slide' && q.type !== 'wordcloud' && q.type !== 'droppin' && q.type !== 'poll'
            ? ` &middot; Correct: <span class="text-green-400 font-bold">${OPTION_LABELS[q.correct]}: ${escapeHtml(q.options[q.correct] || '')}</span>`
            : ''}
          ${q.timeLimit ? ` &middot; ${q.timeLimit}s` : ''}
          ${q.image ? ' &middot; <span class="text-blue-400">📷</span>' : ''}
        </p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button data-action="edit" data-idx="${i}"
          class="bg-gray-700 hover:bg-indigo-600 text-white font-semibold py-1.5 px-3 rounded-lg text-sm transition-colors">Edit</button>
        <button data-action="delete" data-idx="${i}"
          class="bg-gray-700 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-sm transition-colors">✕</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.dataset.action === 'edit')   openQuestionModal(idx);
    if (btn.dataset.action === 'delete') deleteQuestion(idx);
    if (btn.dataset.action === 'up' && idx > 0) {
      [currentQuiz.questions[idx - 1], currentQuiz.questions[idx]] =
        [currentQuiz.questions[idx], currentQuiz.questions[idx - 1]];
      renderQuestions();
    }
    if (btn.dataset.action === 'down' && idx < currentQuiz.questions.length - 1) {
      [currentQuiz.questions[idx], currentQuiz.questions[idx + 1]] =
        [currentQuiz.questions[idx + 1], currentQuiz.questions[idx]];
      renderQuestions();
    }
  });
}

function deleteQuestion(idx) {
  if (!confirm('Delete this question?')) return;
  currentQuiz.questions.splice(idx, 1);
  renderQuestions();
}

document.getElementById('add-question-btn').addEventListener('click', () => openQuestionModal(null));

// ── Question Modal ────────────────────────────────────────────────────────────

function applyQuestionType(type) {
  const isTF        = type === 'truefalse';
  const isSlide     = type === 'slide';
  const isWordCloud = type === 'wordcloud';
  const isDropPin   = type === 'droppin';
  const isPoll      = type === 'poll';

  const noOpts    = isSlide || isWordCloud || isDropPin;
  const noCorrect = isSlide || isWordCloud || isDropPin || isPoll;
  const noTime    = isSlide || isDropPin;

  document.getElementById('opts-section').style.display    = noOpts    ? 'none' : '';
  document.getElementById('correct-section').style.display = noCorrect ? 'none' : '';
  document.getElementById('time-section').style.display    = noTime    ? 'none' : '';

  document.getElementById('opt-cd-row').style.display  = (isTF || noOpts) ? 'none' : 'contents';
  document.getElementById('correct-cd').style.display  = (isTF || noOpts) ? 'none' : 'contents';

  if (isTF) {
    document.getElementById('q-opt-a').value = 'True';
    document.getElementById('q-opt-b').value = 'False';
    document.getElementById('q-opt-a').readOnly = true;
    document.getElementById('q-opt-b').readOnly = true;
    const cur = parseInt(document.querySelector('input[name="q-correct"]:checked')?.value ?? 0);
    document.querySelector(`input[name="q-correct"][value="${cur > 1 ? 0 : cur}"]`).checked = true;
  } else {
    document.getElementById('q-opt-a').readOnly = false;
    document.getElementById('q-opt-b').readOnly = false;
  }
}

document.querySelectorAll('input[name="q-type"]').forEach(r => {
  r.addEventListener('change', () => applyQuestionType(r.value));
});

function openQuestionModal(idx) {
  editingIndex = idx;
  pendingImageUrl = null;
  const q = idx !== null ? currentQuiz.questions[idx] : null;
  const type = q?.type || 'multiple';

  document.getElementById('modal-title').textContent = idx !== null ? 'Edit Question' : 'Add Question';
  document.querySelector(`input[name="q-type"][value="${type}"]`).checked = true;
  document.getElementById('q-text').value = q?.text || '';
  document.getElementById('q-opt-a').value = q?.options?.[0] || '';
  document.getElementById('q-opt-b').value = q?.options?.[1] || '';
  document.getElementById('q-opt-c').value = q?.options?.[2] || '';
  document.getElementById('q-opt-d').value = q?.options?.[3] || '';
  document.querySelector(`input[name="q-correct"][value="${q?.correct ?? 0}"]`).checked = true;
  document.getElementById('q-time').value = q?.timeLimit ?? 20;
  document.getElementById('modal-error').textContent = '';
  document.getElementById('q-image-input').value = '';
  applyQuestionType(type);

  const preview = document.getElementById('q-image-preview');
  const removeBtn = document.getElementById('q-image-remove');
  if (q?.image) {
    preview.src = q.image;
    preview.classList.remove('hidden');
    removeBtn.classList.remove('hidden');
    pendingImageUrl = q.image;
  } else {
    preview.src = '';
    preview.classList.add('hidden');
    removeBtn.classList.add('hidden');
  }

  document.getElementById('modal-question').classList.remove('hidden');
  document.getElementById('q-text').focus();
}

function closeModal() {
  document.getElementById('modal-question').classList.add('hidden');
  editingIndex = null;
  pendingImageUrl = null;
}

document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-save').addEventListener('click', saveQuestion);

document.getElementById('q-image-remove').addEventListener('click', () => {
  pendingImageUrl = null;
  document.getElementById('q-image-preview').classList.add('hidden');
  document.getElementById('q-image-preview').src = '';
  document.getElementById('q-image-remove').classList.add('hidden');
  document.getElementById('q-image-input').value = '';
});

document.getElementById('q-image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const uploading = document.getElementById('q-image-uploading');
  uploading.classList.remove('hidden');

  const formData = new FormData();
  formData.append('image', file);
  const res = await adminFetch('/api/upload', { method: 'POST', body: formData });

  uploading.classList.add('hidden');

  if (!res.ok) { alert('Upload failed'); return; }
  const { url } = await res.json();
  pendingImageUrl = url;

  const preview = document.getElementById('q-image-preview');
  preview.src = url;
  preview.classList.remove('hidden');
  document.getElementById('q-image-remove').classList.remove('hidden');
});

function saveQuestion() {
  const type      = document.querySelector('input[name="q-type"]:checked').value;
  const text      = document.getElementById('q-text').value.trim();
  const correct   = parseInt(document.querySelector('input[name="q-correct"]:checked').value);
  const timeLimit = Math.max(5, Math.min(120, parseInt(document.getElementById('q-time').value) || 20));
  const errEl     = document.getElementById('modal-error');

  const isTF        = type === 'truefalse';
  const isSlide     = type === 'slide';
  const isWordCloud = type === 'wordcloud';
  const isDropPin   = type === 'droppin';
  const isPoll      = type === 'poll';
  const noOpts      = isSlide || isWordCloud || isDropPin;

  const options = noOpts ? [] : isTF
    ? ['True', 'False']
    : [
        document.getElementById('q-opt-a').value.trim(),
        document.getElementById('q-opt-b').value.trim(),
        document.getElementById('q-opt-c').value.trim(),
        document.getElementById('q-opt-d').value.trim(),
      ];

  if (!text) { errEl.textContent = 'Enter question text'; return; }
  if (!noOpts && !isTF && options.some(o => !o)) { errEl.textContent = 'Fill in all 4 options'; return; }
  if (isDropPin && !pendingImageUrl) { errEl.textContent = 'Drop Pin requires an image'; return; }

  const noCorrect = isSlide || isWordCloud || isDropPin || isPoll;
  const noTime    = isSlide || isDropPin;

  const q = {
    text,
    options,
    correct: noCorrect ? 0 : correct,
    timeLimit: noTime ? 0 : timeLimit,
  };
  if (type !== 'multiple') q.type = type;
  if (pendingImageUrl) q.image = pendingImageUrl;

  if (editingIndex !== null) {
    currentQuiz.questions[editingIndex] = q;
  } else {
    currentQuiz.questions.push(q);
  }

  closeModal();
  renderQuestions();
}

// Close modal on backdrop click
document.getElementById('modal-question').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-question')) closeModal();
});

// ── Results ───────────────────────────────────────────────────────────────────

async function loadResultsList() {
  const res = await adminFetch('/api/results');
  if (!res) return;
  const results = await res.json();
  renderResultsList(results);
  showScreen('resultsList');
}

function renderResultsList(results) {
  const listEl = document.getElementById('results-list-el');
  const emptyEl = document.getElementById('results-empty');
  listEl.innerHTML = '';

  if (results.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  results.forEach(({ id, quizTitle, playerCount, playedAt }) => {
    const row = document.createElement('div');
    row.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between bg-gray-800 rounded-2xl px-4 md:px-6 py-4 gap-3';
    const date = new Date(playedAt).toLocaleString();
    row.innerHTML = `
      <div>
        <p class="font-bold">${escapeHtml(quizTitle)}</p>
        <p class="text-gray-400 text-sm">${date} &middot; ${playerCount} player${playerCount !== 1 ? 's' : ''}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button data-action="view" data-id="${id}"
          class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition-colors">View</button>
        <button data-action="export" data-id="${id}"
          class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors">Export CSV</button>
        <button data-action="delete" data-id="${id}"
          class="bg-gray-700 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors">Delete</button>
      </div>
    `;
    listEl.appendChild(row);
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'view')   openResultDetail(id);
    if (action === 'export') exportResult(id);
    if (action === 'delete') deleteResult(id);
  });
}

async function openResultDetail(id) {
  const res = await adminFetch(`/api/results/${id}`);
  if (!res) return;
  const result = await res.json();

  document.getElementById('detail-title').textContent = result.quizTitle;
  document.getElementById('detail-meta').textContent =
    `${new Date(result.playedAt).toLocaleString()} · ${result.playerCount} player${result.playerCount !== 1 ? 's' : ''}`;
  document.getElementById('detail-export-btn').onclick = () => exportResult(id);

  // Standings
  const medals = ['🥇', '🥈', '🥉'];
  const playersEl = document.getElementById('detail-players');
  playersEl.innerHTML = '';
  result.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3';
    row.innerHTML = `
      <span class="text-xl w-8 text-center flex-shrink-0">${medals[i] || `${i + 1}.`}</span>
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0"
           style="background-color:${p.color}">${p.emoji}</div>
      <span class="flex-1 font-semibold truncate">${escapeHtml(p.nickname)}</span>
      <span class="text-gray-300 font-semibold flex-shrink-0">${p.score.toLocaleString()} pts</span>
    `;
    playersEl.appendChild(row);
  });

  // Question breakdown
  const questionsEl = document.getElementById('detail-questions');
  questionsEl.innerHTML = '';
  if (result.questions.length === 0) {
    questionsEl.innerHTML = '<p class="text-gray-500 text-sm">No question data recorded.</p>';
  }
  result.questions.forEach((q, i) => {
    const pct = q.correctPct || 0;
    const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
    const textColor = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400';
    const row = document.createElement('div');
    row.className = 'bg-gray-800 rounded-xl px-4 py-3';
    row.innerHTML = `
      <div class="flex items-start justify-between gap-4 mb-2">
        <p class="font-semibold text-sm flex-1">${i + 1}. ${escapeHtml(q.text)}</p>
        <span class="text-sm font-black flex-shrink-0 ${textColor}">${pct}%</span>
      </div>
      <div class="w-full bg-gray-700 rounded-full h-2">
        <div class="${color} h-2 rounded-full transition-all" style="width:${pct}%"></div>
      </div>
      <p class="text-gray-500 text-xs mt-1">${q.correctCount} / ${q.answeredCount} answered correctly</p>
    `;
    questionsEl.appendChild(row);
  });

  showScreen('resultsDetail');
}

async function exportResult(id) {
  const res = await adminFetch(`/api/results/${id}/export`);
  if (!res || !res.ok) return;
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="(.+?)"/)?.[1] || 'result.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function deleteResult(id) {
  if (!confirm('Delete this result?')) return;
  await adminFetch(`/api/results/${id}`, { method: 'DELETE' });
  loadResultsList();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
