const rm = require('./game/roomManager');
const quizStore = require('./quiz/quizStore');
const resultStore = require('./results/resultStore');

// Stale room cleanup — runs every 30 minutes
setInterval(() => rm.pruneStaleRooms(), 30 * 60 * 1000);

// pin → timeoutId for host disconnect grace period
const hostGraceTimers = new Map();
// socketId → timeoutId for lobby player disconnect grace period
const playerGraceTimers = new Map();

// Extra time after the displayed countdown before the server forces results,
// so in-flight answers (auto-submitted pins, slow networks) still land.
const TIMER_GRACE_MS = 800;

function sanitize(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim().slice(0, 20);
}

function clearQuestionTimer(room) {
  if (room.questionTimerId) clearTimeout(room.questionTimerId);
  room.questionTimerId = null;
  room.timerFireAt = null;
}

// Server-authoritative question end. The host's on-screen countdown is purely
// visual — this timeout is what actually ends the question, so a throttled or
// disconnected host tab can no longer stall the game. Re-arming only ever
// shortens the deadline (ALL_ANSWERED / team TIMER_CAP), never extends it.
function armQuestionTimer(io, room, pin, seconds) {
  const fireAt = Date.now() + seconds * 1000 + TIMER_GRACE_MS;
  if (room.timerFireAt && fireAt >= room.timerFireAt) return;
  if (room.questionTimerId) clearTimeout(room.questionTimerId);
  room.timerFireAt = fireAt;

  const qIndex = room.currentQuestionIndex;
  room.questionTimerId = setTimeout(() => {
    const r = rm.getRoom(pin);
    if (!r || r !== room) return;
    if (room.questionPhase !== 'question' || room.currentQuestionIndex !== qIndex) return;
    showResults(io, room, pin, false);
  }, Math.max(0, fireAt - Date.now()));
}

// Advance room to the next question (or end game). Called from both normal flow
// and skip flow so the logic lives in one place.
function advanceRoom(io, room, pin) {
  clearQuestionTimer(room);
  room.currentQuestionIndex++;

  if (room.currentQuestionIndex >= room.quiz.questions.length) {
    const players = rm.getLeaderboard(room);
    io.to(pin).emit('FINAL_PODIUM', { players, teamNames: room.teamNames });
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
  const isSlide     = q.type === 'slide';
  const isLightning = q.type === 'lightning';
  // Normalize: a missing/zero time limit would end the question instantly and
  // produce NaN scores in calcScore — fall back to 30 s for answerable types.
  const timeLimit = isSlide ? 0 : (q.timeLimit > 0 ? q.timeLimit : 30);

  room.questionPhase = isSlide ? 'slide' : (isLightning ? 'intro' : 'question');
  room.currentAnswers = new Map();
  room.answerTimes = new Map();
  room.teamsTriggered = new Set();
  room.currentTimeLimit = timeLimit;

  const questionData = {
    questionNumber: room.currentQuestionIndex + 1,
    totalQuestions: room.quiz.questions.length,
    text: q.text,
    options: q.options || [],
    timeLimit,
    image: q.image || null,
    type: q.type || 'multiple',
    showQuestion: isSlide ? true : room.showQuestionOnPlayer === true,
  };

  if (isLightning) {
    // Show a 3.5-second intro flash; phase stays 'intro' so answers can't be
    // submitted (or scored off a bogus start time) until the question begins.
    io.to(pin).emit('LIGHTNING_INTRO');
    setTimeout(() => {
      const r = rm.getRoom(pin);
      if (!r || r !== room) return; // room may have been cleaned up
      if (room.questionPhase !== 'intro') return;
      room.questionPhase = 'question';
      room.questionStartTime = Date.now();
      io.to(pin).emit('QUESTION_DATA', questionData);
      armQuestionTimer(io, room, pin, timeLimit);
    }, 3500);
  } else {
    room.questionStartTime = Date.now();
    io.to(pin).emit('QUESTION_DATA', questionData);
    if (!isSlide) armQuestionTimer(io, room, pin, timeLimit);
  }
}

// End the current question: record history, then either emit results to all
// clients or (skip=true) advance straight to the next question.
function showResults(io, room, pin, skip) {
  clearQuestionTimer(room);
  const q     = room.quiz.questions[room.currentQuestionIndex];
  const qType = q.type || 'multiple';
  const isLast = room.currentQuestionIndex === room.quiz.questions.length - 1;
  room.questionPhase = 'results';
  room.resultsShownAt = Date.now();

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
    io.to(pin).emit('OPENTEXT_RESULTS', { answers, isLast, showNames: q.showNames !== false });
  } else if (qType === 'droppin') {
    const pins = rm.getPinCoords(room);
    io.to(pin).emit('DROPPIN_RESULTS', { pins, image: q.image || null, isLast });
  } else {
    const h = room.questionHistory[room.questionHistory.length - 1];
    let fastestCorrect = null;
    if (h.correctIndex >= 0) {
      let bestTime = Infinity;
      for (const [sid, answer] of room.currentAnswers.entries()) {
        if (answer === h.correctIndex) {
          const t = room.answerTimes.get(sid);
          if (t !== undefined && t < bestTime) {
            bestTime = t;
            const p = room.players.get(sid);
            if (p) fastestCorrect = { nickname: p.nickname, emoji: p.emoji, color: p.color };
          }
        }
      }
    }
    io.to(pin).emit('RESULTS_BREAKDOWN', {
      correctIndex: h.correctIndex,
      answerCounts: h.answerCounts,
      players: rm.getLeaderboard(room),
      isLast,
      fastestCorrect,
    });
  }
}

// Emit the live answered-count to the host. Total counts connected players
// only, so a dropped phone doesn't block the "all answered" early finish.
function emitAnswerCount(io, room, pin) {
  if (room.questionPhase !== 'question') return;
  const count = rm.getAnswerCount(room);
  const total = rm.getConnectedCount(room);
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('ANSWER_COUNT', { count, total });
  }
  // When every connected player has answered, cap the timer to 1 s
  if (count >= total && total > 0) {
    io.to(pin).emit('ALL_ANSWERED');
    armQuestionTimer(io, room, pin, 1);
  }
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

      // On reconnect during a question: replay question data so host can control the game
      if (room.status === 'playing' && room.questionPhase === 'question') {
        const q = room.quiz?.questions?.[room.currentQuestionIndex];
        if (q) {
          const elapsed = Math.floor((Date.now() - room.questionStartTime) / 1000);
          socket.emit('QUESTION_DATA', {
            questionNumber: room.currentQuestionIndex + 1,
            totalQuestions: room.quiz.questions.length,
            text: q.text,
            options: q.options || [],
            timeLimit: Math.max(1, (room.currentTimeLimit || q.timeLimit || 30) - elapsed),
            image: q.image || null,
            type: q.type || 'multiple',
          });
          socket.emit('ANSWER_COUNT', {
            count: rm.getAnswerCount(room),
            total: rm.getConnectedCount(room),
          });
        }
      }
    });

    socket.on('ROOM_JOIN', ({ pin, nickname, emoji, color, token, team }) => {
      const room = rm.getRoom(pin);
      if (!room) return socket.emit('ERROR', { message: 'Room not found' });

      const cleanNick = sanitize(nickname);
      if (!cleanNick) return socket.emit('ERROR', { message: 'Invalid nickname' });
      // Only accept a team choice if the host has enabled team mode and team is not full
      const MAX_TEAM = 4;
      const wantedTeam = room.teamsEnabled && ['red', 'blue', 'yellow', 'green'].includes(team) ? team : null;
      const existingTeam = room.players.get(socket.id)?.team ?? null;
      const teamFull = wantedTeam && wantedTeam !== existingTeam && rm.getTeamCount(room, wantedTeam) >= MAX_TEAM;
      const cleanTeam = teamFull ? existingTeam : wantedTeam;
      if (teamFull) socket.emit('TEAM_FULL', { team: wantedTeam, name: room.teamNames[wantedTeam] || wantedTeam });

      // Token-based reconnect — works in both lobby and playing phases
      if (token) {
        const found = rm.findPlayerByToken(room, token);
        if (found) {
          // Cancel any pending lobby grace-period removal for the old socket
          if (playerGraceTimers.has(found.socketId)) {
            clearTimeout(playerGraceTimers.get(found.socketId));
            playerGraceTimers.delete(found.socketId);
          }
          rm.reconnectPlayer(room, found.socketId, socket.id, cleanNick, emoji, color);
          socket.join(pin);
          if (room.status === 'lobby') {
            socket.emit('GAME_STATE_CHANGE', { status: 'lobby' });
            io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(room));
          } else {
            socket.emit('GAME_STATE_CHANGE', { status: 'playing' });
            if (room.questionPhase === 'question') {
              const q = room.quiz.questions[room.currentQuestionIndex];
              const elapsed = Math.floor((Date.now() - room.questionStartTime) / 1000);
              const alreadyAnswered = room.currentAnswers.has(socket.id);
              socket.emit('QUESTION_DATA', {
                questionNumber: room.currentQuestionIndex + 1,
                totalQuestions: room.quiz.questions.length,
                text: q.text,
                options: q.options || [],
                timeLimit: Math.max(1, (room.currentTimeLimit || q.timeLimit || 30) - elapsed),
                image: q.image || null,
                type: q.type || 'multiple',
                showQuestion: room.showQuestionOnPlayer === true,
                alreadyAnswered,
              });
              if (alreadyAnswered) {
                const p = room.players.get(socket.id);
                socket.emit('ANSWER_RESULT', {
                  correct: p.lastCorrect ?? null,
                  scoreDelta: p.lastDelta || 0,
                  totalScore: p.score,
                  streak: p.streak || 0,
                });
              }
            } else if (room.questionPhase === 'results') {
              socket.emit('RECONNECT_WAITING');
            }
            // Reconnect changes the connected total — refresh the host count
            emitAnswerCount(io, room, pin);
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

    socket.on('RENAME_TEAM', ({ pin, team, name }) => {
      const room = rm.getRoom(pin);
      if (!room || room.status !== 'lobby') return;
      if (!['red', 'blue', 'yellow', 'green'].includes(team)) return;
      const player = room.players.get(socket.id);
      if (!player || player.team !== team) return; // must be on that team
      const cleanName = String(name || '').trim().slice(0, 20);
      if (!cleanName) return;
      room.teamNames[team] = cleanName;
      io.to(pin).emit('TEAM_NAMES_UPDATE', { teamNames: room.teamNames });
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
        if (teamsEnabled) io.to(pin).emit('TEAM_NAMES_UPDATE', { teamNames: room.teamNames });
      }
    });

    socket.on('GAME_START', ({ pin, quizId, showQuestionOnPlayer }) => {
      const room = rm.getRoom(pin);
      if (!room || room.hostSocketId !== socket.id) return;
      if (room.status !== 'lobby') return; // guard against duplicate starts
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
      if (room.questionPhase === 'intro') return; // lightning intro playing

      const curQ = room.currentQuestionIndex >= 0
        ? room.quiz.questions[room.currentQuestionIndex] : null;
      const onSlide = curQ?.type === 'slide';

      if (room.questionPhase === null || room.questionPhase === 'results' || onSlide) {
        // Debounce: a double-click right as results appear must not skip them
        if (room.questionPhase === 'results' && Date.now() - room.resultsShownAt < 500) return;
        advanceRoom(io, room, pin);
      } else if (room.questionPhase === 'question') {
        showResults(io, room, pin, skip === true);
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
      let streak     = null;
      if (isScored) {
        correct    = recordValue === q.correct;
        scoreDelta = correct ? rm.calcScore(room) : 0;
        if (correct) rm.applyScore(pin, socket.id, scoreDelta);
        streak = rm.recordStreak(room, socket.id, correct);
        if (correct && streak >= 3) {
          const bonus = 100;
          room.players.get(socket.id).score += bonus;
          scoreDelta += bonus;
        }
      }

      // Remember the outcome so a reconnect can replay it faithfully
      const player = room.players.get(socket.id);
      player.lastCorrect = correct;
      player.lastDelta   = scoreDelta;

      socket.emit('ANSWER_RESULT', { correct, scoreDelta, totalScore: player.score, streak });
      emitAnswerCount(io, room, pin);

      // Team mode: when the first team completes, cap remaining time to 8 s
      if (room.teamsEnabled && room.questionPhase === 'question') {
        const playerTeam = player.team;
        if (playerTeam && !room.teamsTriggered.has(playerTeam)) {
          let allAnswered = true;
          let teamSize = 0;
          for (const [sid, p] of room.players.entries()) {
            if (p.team !== playerTeam) continue;
            teamSize++;
            if (!room.currentAnswers.has(sid)) { allAnswered = false; break; }
          }
          if (allAnswered && teamSize > 0) {
            room.teamsTriggered.add(playerTeam);
            const teamName = room.teamNames[playerTeam] || playerTeam;
            io.to(pin).emit('TIMER_CAP', { seconds: 8, teamName });
            const elapsed = (Date.now() - room.questionStartTime) / 1000;
            const remaining = Math.max(1, (room.currentTimeLimit || 30) - elapsed);
            armQuestionTimer(io, room, pin, Math.min(remaining, 8));
          }
        }
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
          clearQuestionTimer(hostRoom);
          rm.removeRoom(hostRoom.pin);
          hostGraceTimers.delete(hostRoom.pin);
        }, 30000);
        hostGraceTimers.set(hostRoom.pin, timerId);
        return;
      }

      const playerRoom = rm.getRoomByPlayerSocket(socket.id);
      if (playerRoom) {
        const player = playerRoom.players.get(socket.id);
        if (player) player.connected = false;

        if (playerRoom.status === 'lobby') {
          // Short grace period so brief network blips don't drop the player from the lobby
          const sid = socket.id;
          const { pin } = playerRoom;
          const tid = setTimeout(() => {
            playerGraceTimers.delete(sid);
            const r = rm.getRoom(pin);
            if (r && r.status === 'lobby' && r.players.has(sid)) {
              rm.removePlayer(sid);
              io.to(pin).emit('PLAYER_LIST_UPDATE', rm.getPlayerList(r));
            }
          }, 8000);
          playerGraceTimers.set(sid, tid);
        } else if (playerRoom.status === 'playing') {
          // Mid-game: keep player data so they can reconnect, but update the
          // connected total so one dropped phone doesn't stall the question.
          emitAnswerCount(io, playerRoom, playerRoom.pin);
        }
      }
    });
  });
}

module.exports = registerSocketHandlers;
