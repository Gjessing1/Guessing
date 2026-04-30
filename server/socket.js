const rm = require('./game/roomManager');
const quizStore = require('./quiz/quizStore');
const resultStore = require('./results/resultStore');

// Stale room cleanup — runs every 30 minutes
setInterval(() => rm.pruneStaleRooms(), 30 * 60 * 1000);

// pin → timeoutId for host disconnect grace period
const hostGraceTimers = new Map();

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

    socket.on('ROOM_JOIN', ({ pin, nickname, emoji, color, token }) => {
      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });

      // Mid-game reconnect via session token
      if (token && room.status === 'playing') {
        const found = rm.findPlayerByToken(room, token);
        if (found) {
          rm.reconnectPlayer(room, found.socketId, socket.id, nickname, emoji, color);
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
        room.players.set(socket.id, { ...existing, nickname, emoji, color });
      } else {
        rm.addPlayer(pin, socket.id, nickname, emoji, color, token || null);
        socket.join(pin);
      }

      io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(room));
      socket.emit('GAME_STATE_CHANGE', { status: 'lobby' });
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

    socket.on('NEXT_QUESTION', ({ pin }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;

      const curQ = room.currentQuestionIndex >= 0
        ? room.quiz.questions[room.currentQuestionIndex] : null;
      const onSlide = curQ?.type === 'slide';

      if (room.questionPhase === null || room.questionPhase === 'results' || onSlide) {
        room.currentQuestionIndex++;

        if (room.currentQuestionIndex >= room.quiz.questions.length) {
          const players = rm.getLeaderboard(room);
          io.to(pin).emit('FINAL_PODIUM', { players });
          room.status = 'ended';

          // Persist game result for analytics
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
              };
            }),
          });
          return;
        }

        const q = room.quiz.questions[room.currentQuestionIndex];
        const isSlide = q.type === 'slide';

        room.questionPhase = isSlide ? 'slide' : 'question';
        room.currentAnswers = new Map();
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

      } else if (room.questionPhase === 'question') {
        const q = room.quiz.questions[room.currentQuestionIndex];
        room.questionPhase = 'results';
        const answerCounts = rm.getAnswerCounts(room);

        room.questionHistory.push({
          quizIndex: room.currentQuestionIndex,
          answerCounts,
          correctIndex: q.correct,
        });

        io.to(pin).emit('RESULTS_BREAKDOWN', {
          correctIndex: q.correct,
          answerCounts,
          players: rm.getLeaderboard(room),
          isLast: room.currentQuestionIndex === room.quiz.questions.length - 1,
        });
      }
    });

    socket.on('ANSWER_SUBMIT', ({ pin, answerIndex }) => {
      const room = rm.getRoom(pin);
      if (!room || room.questionPhase !== 'question') return;
      if (!room.players.has(socket.id)) return;

      const { alreadyAnswered } = rm.recordAnswer(pin, socket.id, answerIndex);
      if (alreadyAnswered) return;

      const q        = room.quiz.questions[room.currentQuestionIndex];
      const correct  = answerIndex === q.correct;
      const scoreDelta = correct ? rm.calcScore(room) : 0;
      if (correct) rm.applyScore(pin, socket.id, scoreDelta);

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
