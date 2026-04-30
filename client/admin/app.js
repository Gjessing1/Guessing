const OPTION_COLORS = ['bg-red-600', 'bg-blue-600', 'bg-yellow-500', 'bg-green-600'];
const OPTION_LABELS = ['A', 'B', 'C', 'D'];

let adminPassword = '';
let currentQuiz = null;
let editingIndex = null;
let pendingImageUrl = null;

// ── Screens ───────────────────────────────────────────────────────────────────

const screens = {
  login:  document.getElementById('screen-login'),
  list:   document.getElementById('screen-list'),
  editor: document.getElementById('screen-editor'),
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

async function loadQuizList() {
  const res = await adminFetch('/api/quizzes');
  const quizzes = await res.json();
  renderQuizList(quizzes);
  showScreen('list');
}

function formatTime(seconds) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function renderQuizList(quizzes) {
  const list = document.getElementById('quiz-list');
  const empty = document.getElementById('list-empty');
  list.innerHTML = '';

  if (quizzes.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  quizzes.forEach(({ id, title, questionCount, totalTime }) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between bg-gray-800 rounded-2xl px-6 py-4';
    row.innerHTML = `
      <div>
        <p class="font-bold text-lg">${escapeHtml(title)}</p>
        <p class="text-gray-400 text-sm">${questionCount} question${questionCount !== 1 ? 's' : ''} &middot; ${formatTime(totalTime || 0)}</p>
      </div>
      <div class="flex gap-2">
        <button data-action="duplicate" data-id="${id}"
          class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-xl text-sm transition-colors">Duplicate</button>
        <button data-action="export" data-id="${id}"
          class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-xl text-sm transition-colors">Export</button>
        <button data-action="edit" data-id="${id}"
          class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-xl text-sm transition-colors">Edit</button>
        <button data-action="delete" data-id="${id}"
          class="bg-gray-700 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-xl text-sm transition-colors">Delete</button>
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
document.getElementById('export-btn').addEventListener('click', () => exportQuiz(currentQuiz.id));

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
  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save'; }, 2000);
}

function renderQuestions() {
  const list = document.getElementById('question-list');
  list.innerHTML = '';

  if (currentQuiz.questions.length === 0) {
    list.innerHTML = '<p class="text-gray-500 text-center py-8">No questions yet. Add one below.</p>';
    return;
  }

  const TYPE_BADGE = { lightning: '⚡', truefalse: 'T/F' };

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
          ${TYPE_BADGE[q.type] ? `<span class="font-bold text-yellow-400">${TYPE_BADGE[q.type]}</span> &middot; ` : ''}
          Correct: <span class="text-green-400 font-bold">${OPTION_LABELS[q.correct]}: ${escapeHtml(q.options[q.correct])}</span>
          &nbsp;·&nbsp;${q.timeLimit}s
          ${q.image ? '&nbsp;·&nbsp;<span class="text-blue-400">📷</span>' : ''}
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
  const isTF = type === 'truefalse';
  document.getElementById('opt-cd-row').style.display = isTF ? 'none' : 'contents';
  document.getElementById('correct-cd').style.display = isTF ? 'none' : 'contents';
  if (isTF) {
    document.getElementById('q-opt-a').value = 'True';
    document.getElementById('q-opt-b').value = 'False';
    document.getElementById('q-opt-a').readOnly = true;
    document.getElementById('q-opt-b').readOnly = true;
    // Clamp correct to 0 or 1
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
  document.getElementById('q-opt-a').value = q?.options[0] || '';
  document.getElementById('q-opt-b').value = q?.options[1] || '';
  document.getElementById('q-opt-c').value = q?.options[2] || '';
  document.getElementById('q-opt-d').value = q?.options[3] || '';
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
  const type    = document.querySelector('input[name="q-type"]:checked').value;
  const text    = document.getElementById('q-text').value.trim();
  const correct = parseInt(document.querySelector('input[name="q-correct"]:checked').value);
  const timeLimit = Math.max(5, Math.min(120, parseInt(document.getElementById('q-time').value) || 20));
  const errEl = document.getElementById('modal-error');

  const isTF = type === 'truefalse';
  const options = isTF
    ? ['True', 'False']
    : [
        document.getElementById('q-opt-a').value.trim(),
        document.getElementById('q-opt-b').value.trim(),
        document.getElementById('q-opt-c').value.trim(),
        document.getElementById('q-opt-d').value.trim(),
      ];

  if (!text) { errEl.textContent = 'Enter question text'; return; }
  if (!isTF && options.some(o => !o)) { errEl.textContent = 'Fill in all 4 options'; return; }

  const q = { text, options, correct, timeLimit };
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
