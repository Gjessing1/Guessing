const rm = require('./game/roomManager');
const quizStore = require('./quiz/quizStore');
const resultStore = require('./results/resultStore');

// Stale room cleanup — runs every 30 minutes
setInterval(() => rm.pruneStaleRooms(), 30 * 60 * 1000);

// pin → timeoutId for host disconnect grace period
const hostGraceTimers = new Map();

function sanitize(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim().slice(0, 20);
}

// Advance room to the next question (or end game). Called from both normal flow
// and skip flow so the logic lives in one place.
function advanceRoom(io, room, pin) {
  room.currentQuestionIndex++;

  if (room.currentQuestionIndex >= room.quiz.questions.length) {
    const players = rm.getLeaderboard(room);
    io.to(pin).emit('FINAL_PODIUM', { players });
    room.status = 'ended';

    resultStore.save({
      quizId: room.quiz.id || null,
      quizTitle: room.quiz.title,
      playedAt: new Date().toISOString(),
      playerCount: players.length,
      players: players.map((p, i) => ({
        nickname: p.nickname, emoji: p.emoji, color: p.color,
        score: p.score, rank: i + 1,
      })),
      questions: room.questionHistory.map(h => {
        const q = room.quiz.questions[h.quizIndex];
        const correctCount  = h.answerCounts[h.correctIndex] || 0;
        const answeredCount = h.answerCounts.reduce((s, c) => s + c, 0);
        return {
          text: q.text,
          type: q.type || 'multiple',
          correctCount,
          answeredCount,
          correctPct: answeredCount > 0 ? Math.round(correctCount / answeredCount * 100) : 0,
          avgAnswerTime: h.avgAnswerTime ?? null,
        };
      }),
    });
    return;
  }

  const q = room.quiz.questions[room.currentQuestionIndex];
  const isSlide = q.type === 'slide';

  room.questionPhase = isSlide ? 'slide' : 'question';
  room.currentAnswers = new Map();
  room.answerTimes = new Map();
  room.questionStartTime = Date.now();

  io.to(pin).emit('QUESTION_DATA', {
    questionNumber: room.currentQuestionIndex + 1,
    totalQuestions: room.quiz.questions.length,
    text: q.text,
    options: q.options || [],
    timeLimit: q.timeLimit || 0,
    image: q.image || null,
    type: q.type || 'multiple',
    showQuestion: isSlide ? true : room.showQuestionOnPlayer === true,
  });
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {

    socket.on('HOST_REGISTER', ({ pin }) => {
      // Cancel any pending grace-period shutdown for this room
      if (hostGraceTimers.has(pin)) {
        clearTimeout(hostGraceTimers.get(pin));
        hostGraceTimers.delete(pin);
      }

      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });
      room.hostSocketId = socket.id;
      socket.join(pin);
      socket.emit('GAME_STATE_CHANGE', { status: room.status, pin });
    });

    socket.on('ROOM_JOIN', ({ pin, nickname, emoji, color, token, team }) => {
      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });

      const cleanNick = sanitize(nickname);
      if (!cleanNick) return socket.emit('ERROR', { message: 'Invalid nickname' });
      // Only accept a team choice if the host has enabled team mode
      const cleanTeam = room.teamsEnabled && ['red', 'blue', 'yellow', 'green'].includes(team) ? team : null;

      // Mid-game reconnect via session token
      if (token && room.status === 'playing') {
        const found = rm.findPlayerByToken(room, token);
        if (found) {
          rm.reconnectPlayer(room, found.socketId, socket.id, cleanNick, emoji, color);
          socket.join(pin);
          socket.emit('GAME_STATE_CHANGE', { status: 'playing' });
          if (room.questionPhase === 'question') {
            const q = room.quiz.questions[room.currentQuestionIndex];
            const elapsed = Math.floor((Date.now() - room.questionStartTime) / 1000);
            socket.emit('QUESTION_DATA', {
              questionNumber: room.currentQuestionIndex + 1,
              totalQuestions: room.quiz.questions.length,
              text: q.text,
              options: q.options,
              timeLimit: Math.max(1, q.timeLimit - elapsed),
              image: q.image || null,
              type: q.type || 'multiple',
            });
          }
          return;
        }
      }

      if (room.status !== 'lobby') return socket.emit('ERROR', { message: 'Game already in progress' });

      const existing = room.players.get(socket.id);
      if (existing) {
        room.players.set(socket.id, { ...existing, nickname: cleanNick, emoji, color, team: cleanTeam });
      } else {
        rm.addPlayer(pin, socket.id, cleanNick, emoji, color, token || null, cleanTeam);
        socket.join(pin);
      }

      io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(room));
      socket.emit('GAME_STATE_CHANGE', { status: 'lobby' });
    });

    socket.on('HOST_SETTING', ({ pin, teamsEnabled }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id || room.status !== 'lobby') return;
      if (typeof teamsEnabled === 'boolean') {
        room.teamsEnabled = teamsEnabled;
        // Clear teams from all players if host disables team mode
        if (!teamsEnabled) {
          for (const player of room.players.values()) player.team = null;
        }
        io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(room));
        io.to(pin).emit('LOBBY_UPDATE', { teamsEnabled });
      }
    });

    socket.on('GAME_START', ({ pin, quizId, showQuestionOnPlayer }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;
      if (room.players.size === 0) return socket.emit('ERROR', { message: 'No players in room' });

      const quiz = quizStore.get(quizId);
      if (!quiz) return socket.emit('ERROR', { message: 'Select a quiz before starting' });

      room.status = 'playing';
      room.showQuestionOnPlayer = showQuestionOnPlayer === true;
      rm.loadQuiz(pin, quiz);
      io.to(pin).emit('GAME_STATE_CHANGE', { status: 'playing' });
    });

    socket.on('NEXT_QUESTION', ({ pin, skip }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;

      const curQ = room.currentQuestionIndex >= 0
        ? room.quiz.questions[room.currentQuestionIndex] : null;
      const onSlide = curQ?.type === 'slide';

      if (room.questionPhase === null || room.questionPhase === 'results' || onSlide) {
        advanceRoom(io, room, pin);

      } else if (room.questionPhase === 'question') {
        const q     = room.quiz.questions[room.currentQuestionIndex];
        const qType = q.type || 'multiple';
        const isLast = room.currentQuestionIndex === room.quiz.questions.length - 1;
        room.questionPhase = 'results';

        // Record to question history (needed for analytics regardless of skip)
        const times = Array.from(room.answerTimes.values());
        const avgAnswerTime = times.length > 0
          ? Math.round(times.reduce((s, t) => s + t, 0) / times.length * 10) / 10
          : null;

        if (qType === 'wordcloud' || qType === 'opentext' || qType === 'droppin') {
          room.questionHistory.push({
            quizIndex: room.currentQuestionIndex,
            answerCounts: [room.currentAnswers.size],
            correctIndex: -1,
            avgAnswerTime,
          });
        } else {
          const answerCounts = rm.getAnswerCounts(room);
          const correctIndex = qType === 'poll' ? -1 : q.correct;
          room.questionHistory.push({ quizIndex: room.currentQuestionIndex, answerCounts, correctIndex, avgAnswerTime });
        }

        if (skip) {
          advanceRoom(io, room, pin);
          return;
        }

        // Emit results to all clients
        if (qType === 'wordcloud') {
          const wordCounts = rm.getWordCounts(room);
          io.to(pin).emit('WORDCLOUD_RESULTS', { wordCounts, isLast });
        } else if (qType === 'opentext') {
          const answers = rm.getTextAnswers(room);
          io.to(pin).emit('OPENTEXT_RESULTS', { answers, isLast });
        } else if (qType === 'droppin') {
          const pins = rm.getPinCoords(room);
          io.to(pin).emit('DROPPIN_RESULTS', { pins, image: q.image || null, isLast });
        } else {
          const h = room.questionHistory[room.questionHistory.length - 1];
          io.to(pin).emit('RESULTS_BREAKDOWN', {
            correctIndex: h.correctIndex,
            answerCounts: h.answerCounts,
            players: rm.getLeaderboard(room),
            isLast,
          });
        }
      }
    });

    socket.on('ANSWER_SUBMIT', ({ pin, answerIndex, word, coords }) => {
      const room = rm.getRoom(pin);
      if (!room || room.questionPhase !== 'question') return;
      if (!room.players.has(socket.id)) return;

      const q     = room.quiz.questions[room.currentQuestionIndex];
      const qType = q.type || 'multiple';

      let recordValue;
      if (qType === 'wordcloud' || qType === 'opentext') {
        recordValue = typeof word === 'string' ? word.trim().slice(0, 60) : '';
        if (!recordValue) return;
      } else if (qType === 'droppin') {
        if (!coords || typeof coords.x !== 'number') return;
        recordValue = { x: Math.max(0, Math.min(1, coords.x)), y: Math.max(0, Math.min(1, coords.y)) };
      } else {
        recordValue = typeof answerIndex === 'number' ? answerIndex : 0;
      }

      const { alreadyAnswered } = rm.recordAnswer(pin, socket.id, recordValue);
      if (alreadyAnswered) return;

      room.answerTimes.set(socket.id, (Date.now() - room.questionStartTime) / 1000);

      const isScored = qType !== 'poll' && qType !== 'wordcloud' && qType !== 'droppin' && qType !== 'opentext';
      let correct    = null;
      let scoreDelta = 0;
      if (isScored) {
        correct    = recordValue === q.correct;
        scoreDelta = correct ? rm.calcScore(room) : 0;
        if (correct) rm.applyScore(pin, socket.id, scoreDelta);
      }

      const totalScore = room.players.get(socket.id).score;
      socket.emit('ANSWER_RESULT', { correct, scoreDelta, totalScore });

      const count = rm.getAnswerCount(room);
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('ANSWER_COUNT', { count, total: room.players.size });
      }
    });

    socket.on('REACTION_SEND', ({ pin, emoji }) => {
      const room = rm.getRoom(pin);
      if (!room || !room.hostSocketId) return;
      if (!room.players.has(socket.id)) return;
      const { color } = room.players.get(socket.id);
      io.to(room.hostSocketId).emit('REACTION_BROADCAST', { emoji, color });
    });

    socket.on('disconnect', () => {
      const hostRoom = rm.getRoomByHostSocket(socket.id);
      if (hostRoom) {
        // 30-second grace period before ending the game
        hostRoom.hostSocketId = null;
        const timerId = setTimeout(() => {
          io.to(hostRoom.pin).emit('GAME_STATE_CHANGE', { status: 'ended', reason: 'host_disconnected' });
          rm.removeRoom(hostRoom.pin);
          hostGraceTimers.delete(hostRoom.pin);
        }, 30000);
        hostGraceTimers.set(hostRoom.pin, timerId);
        return;
      }

      const playerRoom = rm.getRoomByPlayerSocket(socket.id);
      if (playerRoom) {
        if (playerRoom.status === 'lobby') {
          rm.removePlayer(socket.id);
          io.to(playerRoom.pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(playerRoom));
        }
        // Mid-game: keep player data so they can reconnect
      }
    });
  });
}

module.exports = registerSocketHandlers;
