const rm = require('./game/roomManager');
const quizStore = require('./quiz/quizStore');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {

    socket.on('HOST_REGISTER', ({ pin }) => {
      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });
      room.hostSocketId = socket.id;
      socket.join(pin);
      socket.emit('GAME_STATE_CHANGE', { status: room.status, pin });
    });

    socket.on('ROOM_JOIN', ({ pin, nickname, emoji, color }) => {
      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });
      if (room.status !== 'lobby') return socket.emit('ERROR', { message: 'Game already in progress' });

      rm.addPlayer(pin, socket.id, nickname, emoji, color);
      socket.join(pin);

      io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(room));
      socket.emit('GAME_STATE_CHANGE', { status: 'lobby' });
    });

    socket.on('GAME_START', ({ pin, quizId }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;
      if (room.players.size === 0) return socket.emit('ERROR', { message: 'No players in room' });

      const quiz = quizStore.get(quizId);
      if (!quiz) return socket.emit('ERROR', { message: 'Select a quiz before starting' });

      room.status = 'playing';
      rm.loadQuiz(pin, quiz);
      io.to(pin).emit('GAME_STATE_CHANGE', { status: 'playing' });
    });

    socket.on('NEXT_QUESTION', ({ pin }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;

      if (room.questionPhase === null || room.questionPhase === 'results') {
        room.currentQuestionIndex++;

        if (room.currentQuestionIndex >= room.quiz.questions.length) {
          io.to(pin).emit('FINAL_PODIUM', { players: rm.getLeaderboard(room) });
          room.status = 'ended';
          return;
        }

        const q = room.quiz.questions[room.currentQuestionIndex];
        room.questionPhase = 'question';
        room.currentAnswers = new Map();
        room.questionStartTime = Date.now();

        io.to(pin).emit('QUESTION_DATA', {
          questionNumber: room.currentQuestionIndex + 1,
          totalQuestions: room.quiz.questions.length,
          text: q.text,
          options: q.options,
          timeLimit: q.timeLimit,
          image: q.image || null,
        });

      } else if (room.questionPhase === 'question') {
        const q = room.quiz.questions[room.currentQuestionIndex];
        room.questionPhase = 'results';

        io.to(pin).emit('RESULTS_BREAKDOWN', {
          correctIndex: q.correct,
          answerCounts: rm.getAnswerCounts(room),
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

      const q       = room.quiz.questions[room.currentQuestionIndex];
      const correct = answerIndex === q.correct;
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
        io.to(hostRoom.pin).emit('GAME_STATE_CHANGE', { status: 'ended', reason: 'host_disconnected' });
        rm.removeRoom(hostRoom.pin);
        return;
      }

      const playerRoom = rm.getRoomByPlayerSocket(socket.id);
      if (playerRoom) {
        rm.removePlayer(socket.id);
        io.to(playerRoom.pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(playerRoom));
      }
    });
  });
}

module.exports = registerSocketHandlers;
