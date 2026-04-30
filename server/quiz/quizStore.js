const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/quizzes.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { quizzes: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function list() {
  return read().quizzes.map(({ id, title, questions, createdAt }) => ({
    id,
    title,
    questionCount: questions.length,
    totalTime: questions.reduce((s, q) => s + (q.timeLimit || 20), 0),
    createdAt: createdAt || null,
  }));
}

function get(id) {
  return read().quizzes.find(q => q.id === id) || null;
}

function create({ title, questions = [] }) {
  const db = read();
  const quiz = { id: randomUUID(), title, questions, createdAt: new Date().toISOString() };
  db.quizzes.push(quiz);
  write(db);
  return quiz;
}

function update(id, patch) {
  const db = read();
  const idx = db.quizzes.findIndex(q => q.id === id);
  if (idx === -1) return null;
  db.quizzes[idx] = { ...db.quizzes[idx], ...patch, id };
  write(db);
  return db.quizzes[idx];
}

function remove(id) {
  const db = read();
  const idx = db.quizzes.findIndex(q => q.id === id);
  if (idx === -1) return false;
  db.quizzes.splice(idx, 1);
  write(db);
  return true;
}

module.exports = { list, get, create, update, remove };
