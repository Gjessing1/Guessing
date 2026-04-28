const rooms = new Map();

function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(pin));
  return pin;
}

function createRoom() {
  const pin = generatePin();
  rooms.set(pin, {
    pin,
    hostSocketId: null,
    players: new Map(),       // socketId → { nickname, emoji, color, score }
    status: 'lobby',
    quiz: null,
    currentQuestionIndex: -1,
    questionPhase: null,      // 'question' | 'results' | null
    currentAnswers: new Map(), // socketId → answerIndex
    questionStartTime: null,
  });
  return rooms.get(pin);
}

function getRoom(pin) {
  return rooms.get(pin) || null;
}

function getRoomByHostSocket(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId) return room;
  }
  return null;
}

function getRoomByPlayerSocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

function addPlayer(pin, socketId, nickname, emoji, color) {
  const room = rooms.get(pin);
  if (!room) return null;
  room.players.set(socketId, { nickname, emoji, color, score: 0 });
  return room;
}

function removePlayer(socketId) {
  const room = getRoomByPlayerSocket(socketId);
  if (!room) return null;
  room.players.delete(socketId);
  return room;
}

function removeRoom(pin) {
  rooms.delete(pin);
}

function loadQuiz(pin, quiz) {
  const room = rooms.get(pin);
  if (room) room.quiz = quiz;
}

function recordAnswer(pin, socketId, answerIndex) {
  const room = rooms.get(pin);
  if (!room) return { alreadyAnswered: false };
  if (room.currentAnswers.has(socketId)) return { alreadyAnswered: true };
  room.currentAnswers.set(socketId, answerIndex);
  return { alreadyAnswered: false };
}

function getAnswerCounts(room) {
  const counts = [0, 0, 0, 0];
  for (const idx of room.currentAnswers.values()) {
    if (idx >= 0 && idx <= 3) counts[idx]++;
  }
  return counts;
}

function getAnswerCount(room) {
  return room.currentAnswers.size;
}

function getPlayerList(room) {
  return Array.from(room.players.values()).map(({ nickname, emoji, color, score }) => ({
    nickname, emoji, color, score,
  }));
}

function getLeaderboard(room) {
  return getPlayerList(room).sort((a, b) => b.score - a.score);
}

const BASE_SCORE     = 500;
const TIME_BONUS_MAX = 500;

function calcScore(room) {
  const q = room.quiz.questions[room.currentQuestionIndex];
  const elapsed   = Math.min(Date.now() - room.questionStartTime, q.timeLimit * 1000);
  const fraction  = 1 - elapsed / (q.timeLimit * 1000);
  return BASE_SCORE + Math.round(TIME_BONUS_MAX * fraction);
}

function applyScore(pin, socketId, delta) {
  const room = rooms.get(pin);
  if (!room) return;
  const player = room.players.get(socketId);
  if (player) player.score += delta;
}

module.exports = {
  createRoom,
  getRoom,
  getRoomByHostSocket,
  getRoomByPlayerSocket,
  addPlayer,
  removePlayer,
  removeRoom,
  loadQuiz,
  recordAnswer,
  getAnswerCounts,
  getAnswerCount,
  getPlayerList,
  getLeaderboard,
  calcScore,
  applyScore,
};
