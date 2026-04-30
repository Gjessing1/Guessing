const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/results.json');
const MAX_RESULTS = 200;

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { results: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function save(result) {
  const db = read();
  const entry = { id: randomUUID(), ...result };
  db.results.unshift(entry);
  if (db.results.length > MAX_RESULTS) db.results = db.results.slice(0, MAX_RESULTS);
  write(db);
  return entry;
}

function list() {
  return read().results.map(({ id, quizId, quizTitle, playerCount, playedAt }) => ({
    id, quizId, quizTitle, playerCount, playedAt,
  }));
}

function get(id) {
  return read().results.find(r => r.id === id) || null;
}

function remove(id) {
  const db = read();
  const idx = db.results.findIndex(r => r.id === id);
  if (idx === -1) return false;
  db.results.splice(idx, 1);
  write(db);
  return true;
}

function countByQuizId() {
  const counts = {};
  for (const r of read().results) {
    if (r.quizId) counts[r.quizId] = (counts[r.quizId] || 0) + 1;
  }
  return counts;
}

function lastPlayedByQuizId() {
  const latest = {};
  for (const r of read().results) {
    if (r.quizId && (!latest[r.quizId] || r.playedAt > latest[r.quizId])) {
      latest[r.quizId] = r.playedAt;
    }
  }
  return latest;
}

module.exports = { save, list, get, remove, countByQuizId, lastPlayedByQuizId };
