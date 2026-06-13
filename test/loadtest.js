/**
 * Multiplayer load / stability test.
 *
 * Simulates a host + 15 phone players over real websockets through a full
 * 3-question game, including the failure modes seen with real phones:
 *   - a player who answers, drops, reconnects and tries to answer again
 *     (must NOT be scored twice)
 *   - a player who drops mid-question without answering
 *     (must NOT block the "all answered" early finish)
 *   - an early submit during the lightning intro (must be ignored)
 *   - the host never emits NEXT_QUESTION at timer 0 — the server must end
 *     every question on its own.
 *
 * Run: npm run test:load
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate quiz/result storage so the test never touches real data files.
// Must be set before the stores are required.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guessing-test-'));

const { createServer } = require('../server/app');
const { io: ioc } = require('socket.io-client');

const PLAYER_COUNT = 15;
const failures = [];

function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { failures.push(msg); console.error(`  ✗ FAIL: ${msg}`); }
}

function waitFor(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const httpServer = createServer();
  await new Promise(r => httpServer.listen(0, r));
  const port = httpServer.address().port;
  const base = `http://localhost:${port}`;
  console.log(`Server up on :${port}`);

  // ── Create a test quiz (stored in the isolated DATA_DIR) ───────────────────
  const quizRes = await fetch(`${base}/api/quizzes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '__loadtest__',
      questions: [
        { text: 'Q1 multiple', type: 'multiple', options: ['a', 'b', 'c', 'd'], correct: 1, timeLimit: 5 },
        { text: 'Q2 truefalse', type: 'truefalse', options: ['True', 'False'], correct: 0, timeLimit: 10 },
        { text: 'Q3 lightning', type: 'lightning', options: ['a', 'b', 'c', 'd'], correct: 2, timeLimit: 5 },
      ],
    }),
  });
  const quiz = await quizRes.json();

  // ── Host setup ──────────────────────────────────────────────────────────────
  const { pin } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
  const host = ioc(base, { transports: ['websocket'] });
  host.on('ERROR', ({ message }) => failures.push(`host ERROR: ${message}`));
  await waitFor(host, 'connect');
  host.emit('HOST_REGISTER', { pin });
  await waitFor(host, 'GAME_STATE_CHANGE');

  // ── 15 players join ─────────────────────────────────────────────────────────
  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const token = `tok-${i}-${Date.now()}`;
    const s = ioc(base, { transports: ['websocket'] });
    const p = { i, token, nickname: `Player${i}`, socket: s, lastTotal: 0 };
    s.on('ERROR', ({ message }) => {
      // The double-answer reconnector legitimately gets no error; any ERROR is a failure
      failures.push(`player${i} ERROR: ${message}`);
    });
    s.on('ANSWER_RESULT', ({ totalScore }) => { p.lastTotal = totalScore; });
    await waitFor(s, 'connect');
    s.emit('ROOM_JOIN', { pin, nickname: p.nickname, emoji: '🐶', color: '#ef4444', token });
    players.push(p);
  }
  await sleep(300);
  console.log(`\n${PLAYER_COUNT} players joined room ${pin}`);

  // ── Start game ──────────────────────────────────────────────────────────────
  host.emit('GAME_START', { pin, quizId: quiz.id, showQuestionOnPlayer: true });
  await waitFor(host, 'GAME_STATE_CHANGE');

  // ── Q1: everyone answers; player 0 reconnects and tries to answer again ────
  console.log('\nQ1: multiple choice — reconnect double-answer check');
  const q1 = waitFor(host, 'QUESTION_DATA');
  host.emit('NEXT_QUESTION', { pin });
  await q1;

  players[0].socket.emit('ANSWER_SUBMIT', { pin, answerIndex: 1 }); // correct
  await sleep(200);
  // Simulate phone refresh: drop, reconnect with same token, answer again
  players[0].socket.disconnect();
  await sleep(200);
  const re0 = ioc(base, { transports: ['websocket'] });
  re0.on('ERROR', ({ message }) => failures.push(`reconnect ERROR: ${message}`));
  re0.on('ANSWER_RESULT', ({ totalScore }) => { players[0].lastTotal = totalScore; });
  await waitFor(re0, 'connect');
  re0.emit('ROOM_JOIN', { pin, nickname: 'Player0', emoji: '🐶', color: '#ef4444', token: players[0].token });
  const reQd = await waitFor(re0, 'QUESTION_DATA');
  assert(reQd.alreadyAnswered === true, 'reconnect mid-question is told it already answered');
  players[0].socket = re0;
  re0.emit('ANSWER_SUBMIT', { pin, answerIndex: 1 }); // double-answer attempt

  for (let i = 1; i < PLAYER_COUNT; i++) {
    setTimeout(() => players[i].socket.emit('ANSWER_SUBMIT', { pin, answerIndex: i % 4 }), i * 40);
  }
  const t1 = Date.now();
  const r1 = await waitFor(host, 'RESULTS_BREAKDOWN', 8000); // server must end it alone
  const sum1 = r1.answerCounts.reduce((s, c) => s + c, 0);
  assert(sum1 === PLAYER_COUNT, `answer count is exactly ${PLAYER_COUNT} (got ${sum1}) — no double answer`);
  assert(Date.now() - t1 < 4000, 'server ended Q1 early via ALL_ANSWERED (no host timer involved)');
  const p0Score = r1.players.find(p => p.nickname === 'Player0')?.score;
  assert(p0Score === players[0].lastTotal, `Player0 score ${p0Score} matches single-answer total ${players[0].lastTotal}`);

  // ── Q2: one player drops without answering — must not block early finish ───
  console.log('\nQ2: true/false — ghost player check (timeLimit 10s)');
  await sleep(600); // results debounce window — instant Next clicks are ignored
  const q2 = waitFor(host, 'QUESTION_DATA');
  host.emit('NEXT_QUESTION', { pin });
  await q2;
  const qStart = Date.now();

  players[14].socket.disconnect(); // ghost: never answers, never returns
  await sleep(300);
  for (let i = 0; i < 14; i++) {
    setTimeout(() => players[i].socket.emit('ANSWER_SUBMIT', { pin, answerIndex: 0 }), i * 40);
  }
  const r2 = await waitFor(host, 'RESULTS_BREAKDOWN', 12000);
  const q2Elapsed = (Date.now() - qStart) / 1000;
  assert(q2Elapsed < 6, `Q2 ended in ${q2Elapsed.toFixed(1)}s (<6s) — dropped phone did not block ALL_ANSWERED`);
  const sum2 = r2.answerCounts.reduce((s, c) => s + c, 0);
  assert(sum2 === 14, `14 answers recorded (got ${sum2})`);

  // ── Q3: lightning — early submit during intro must be ignored ──────────────
  console.log('\nQ3: lightning — intro submit-block check');
  await sleep(600);
  const intro = waitFor(host, 'LIGHTNING_INTRO');
  const q3 = waitFor(host, 'QUESTION_DATA');
  host.emit('NEXT_QUESTION', { pin });
  await intro;
  players[1].socket.emit('ANSWER_SUBMIT', { pin, answerIndex: 2 }); // during intro — must be ignored
  await q3;

  for (let i = 0; i < 14; i++) {
    setTimeout(() => players[i].socket.emit('ANSWER_SUBMIT', { pin, answerIndex: 2 }), 100 + i * 40);
  }
  const r3 = await waitFor(host, 'RESULTS_BREAKDOWN', 10000);
  const sum3 = r3.answerCounts.reduce((s, c) => s + c, 0);
  assert(sum3 === 14, `intro submit ignored, 14 answers recorded (got ${sum3})`);
  assert(r3.isLast === true, 'last question flagged');

  // ── Podium ──────────────────────────────────────────────────────────────────
  console.log('\nFinal podium');
  await sleep(600);
  const podiumP = waitFor(players[0].socket, 'FINAL_PODIUM');
  const podium = waitFor(host, 'FINAL_PODIUM');
  host.emit('NEXT_QUESTION', { pin });
  const { players: board } = await podium;
  await podiumP;
  assert(board.length === PLAYER_COUNT, `podium lists all ${PLAYER_COUNT} players (got ${board.length})`);
  assert(board.every(p => Number.isFinite(p.score)), 'all scores are finite numbers (no NaN)');
  const sorted = board.every((p, i) => i === 0 || board[i - 1].score >= p.score);
  assert(sorted, 'leaderboard sorted descending');
  console.log('  top 3:', board.slice(0, 3).map(p => `${p.nickname}=${p.score}`).join(', '));

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  host.disconnect();
  players.forEach(p => p.socket.disconnect());
  httpServer.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

  console.log(failures.length === 0
    ? '\n✅ All checks passed'
    : `\n❌ ${failures.length} failure(s):\n${failures.map(f => ` - ${f}`).join('\n')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
