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
    players: new Map(),        // socketId → { nickname, emoji, color, score, token }
    tokenIndex: new Map(),     // token → socketId  (for reconnect)
    status: 'lobby',
    quiz: null,
    currentQuestionIndex: -1,
    questionPhase: null,       // 'question' | 'results' | null
    currentAnswers: new Map(), // socketId → answerIndex
    questionStartTime: null,
    questionHistory: [],       // [{ quizIndex, answerCounts, correctIndex }]
    createdAt: Date.now(),
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

function addPlayer(pin, socketId, nickname, emoji, color, token = null) {
  const room = rooms.get(pin);
  if (!room) return null;
  room.players.set(socketId, { nickname, emoji, color, score: 0, token });
  if (token) room.tokenIndex.set(token, socketId);
  return room;
}

function findPlayerByToken(room, token) {
  if (!token || !room.tokenIndex.has(token)) return null;
  const socketId = room.tokenIndex.get(token);
  const player = room.players.get(socketId);
  return player ? { socketId, player } : null;
}

function reconnectPlayer(room, oldSocketId, newSocketId, nickname, emoji, color) {
  const player = room.players.get(oldSocketId);
  if (!player) return false;
  room.players.delete(oldSocketId);
  room.players.set(newSocketId, { ...player, nickname, emoji, color });
  if (player.token) room.tokenIndex.set(player.token, newSocketId);
  return true;
}

function removePlayer(socketId) {
  const room = getRoomByPlayerSocket(socketId);
  if (!room) return null;
  const player = room.players.get(socketId);
  if (player?.token) room.tokenIndex.delete(player.token);
  room.players.delete(socketId);
  return room;
}

function removeRoom(pin) {
  rooms.delete(pin);
}

// Remove rooms idle for more than 3 hours
function pruneStaleRooms() {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [pin, room] of rooms.entries()) {
    if (room.createdAt < cutoff) rooms.delete(pin);
  }
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
  const optionCount = room.quiz?.questions[room.currentQuestionIndex]?.options?.length || 4;
  const counts = Array(optionCount).fill(0);
  for (const idx of room.currentAnswers.values()) {
    if (typeof idx === 'number' && idx >= 0 && idx < optionCount) counts[idx]++;
  }
  return counts;
}

function getWordCounts(room) {
  const counts = {};
  for (const answer of room.currentAnswers.values()) {
    if (typeof answer === 'string' && answer.trim()) {
      const key = answer.trim().toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function getPinCoords(room) {
  const result = [];
  for (const [socketId, answer] of room.currentAnswers.entries()) {
    if (answer && typeof answer === 'object' && typeof answer.x === 'number') {
      const player = room.players.get(socketId);
      if (player) result.push({ x: answer.x, y: answer.y, emoji: player.emoji, color: player.color });
    }
  }
  return result;
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
  if (q.type === 'lightning') return BASE_SCORE;
  const elapsed  = Math.min(Date.now() - room.questionStartTime, q.timeLimit * 1000);
  const fraction = 1 - elapsed / (q.timeLimit * 1000);
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
  findPlayerByToken,
  reconnectPlayer,
  removePlayer,
  removeRoom,
  pruneStaleRooms,
  loadQuiz,
  recordAnswer,
  getAnswerCounts,
  getAnswerCount,
  getWordCounts,
  getPinCoords,
  getPlayerList,
  getLeaderboard,
  calcScore,
  applyScore,
};
