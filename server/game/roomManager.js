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
    players: new Map(),        // socketId → { nickname, emoji, color, score, token, team }
    tokenIndex: new Map(),     // token → socketId  (for reconnect)
    status: 'lobby',
    teamsEnabled: false,
    teamNames: { red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green' },
    quiz: null,
    currentQuestionIndex: -1,
    questionPhase: null,       // 'question' | 'results' | null
    currentAnswers: new Map(), // socketId → answerIndex / word / coords
    answerTimes: new Map(),    // socketId → seconds elapsed when answered
    teamsTriggered: new Set(), // teams that have already triggered the timer cap this question
    questionStartTime: null,
    questionHistory: [],       // [{ quizIndex, answerCounts, correctIndex, avgAnswerTime }]
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

function addPlayer(pin, socketId, nickname, emoji, color, token = null, team = null) {
  const room = rooms.get(pin);
  if (!room) return null;
  room.players.set(socketId, { nickname, emoji, color, score: 0, streak: 0, token, team });
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

function getTeamCount(room, team) {
  let count = 0;
  for (const player of room.players.values()) {
    if (player.team === team) count++;
  }
  return count;
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

function getTextAnswers(room) {
  const result = [];
  for (const [socketId, answer] of room.currentAnswers.entries()) {
    if (typeof answer === 'string' && answer.trim()) {
      const player = room.players.get(socketId);
      if (player) result.push({ text: answer.trim(), nickname: player.nickname, emoji: player.emoji, color: player.color });
    }
  }
  return result;
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
  return Array.from(room.players.values()).map(({ nickname, emoji, color, score, team }) => ({
    nickname, emoji, color, score, team: team || null,
  }));
}

function getLeaderboard(room) {
  return getPlayerList(room).sort((a, b) => b.score - a.score);
}

const BASE_SCORE     = 500;
const TIME_BONUS_MAX = 500;

function calcScore(room) {
  const q = room.quiz.questions[room.currentQuestionIndex];
  const elapsed  = Math.min(Math.max(0, Date.now() - room.questionStartTime), q.timeLimit * 1000);
  const fraction = 1 - elapsed / (q.timeLimit * 1000);
  const base = BASE_SCORE + Math.round(TIME_BONUS_MAX * fraction);
  // Lightning: 2× multiplier — speed matters even more (range: 1000–2000 pts)
  return q.type === 'lightning' ? Math.round(base * 2) : base;
}

function applyScore(pin, socketId, delta) {
  const room = rooms.get(pin);
  if (!room) return;
  const player = room.players.get(socketId);
  if (player) player.score += delta;
}

function recordStreak(room, socketId, correct) {
  const player = room.players.get(socketId);
  if (!player) return 0;
  player.streak = correct ? (player.streak || 0) + 1 : 0;
  return player.streak;
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
  getTeamCount,
  getWordCounts,
  getTextAnswers,
  getPinCoords,
  getPlayerList,
  getLeaderboard,
  calcScore,
  applyScore,
  recordStreak,
};
