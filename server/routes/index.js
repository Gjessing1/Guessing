const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const quizStore = require('../quiz/quizStore');
const resultStore = require('../results/resultStore');
const { createRoom, getRoom } = require('../game/roomManager');

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  if (req.headers['x-admin-password'] !== password) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Accept any image type into memory; sharp converts to JPEG before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB raw; output will be smaller
});

function routes(app) {
  app.get('/', (req, res) => res.redirect('/player'));

  // Clean join link — QR code and sharable URL
  app.get('/join/:pin', (req, res) => {
    res.redirect(`/player?pin=${req.params.pin}`);
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // ── Room routes ───────────────────────────────────────────────────────────────

  app.post('/api/rooms', async (req, res) => {
    const room = createRoom();
    const playerUrl = `${req.protocol}://${req.get('host')}/join/${room.pin}`;
    const qr = await QRCode.toDataURL(playerUrl, {
      width: 160, margin: 1,
      color: { dark: '#ffffff', light: '#1f2937' },
    });
    res.json({ pin: room.pin, qr });
  });

  app.get('/api/rooms/:pin', (req, res) => {
    const room = getRoom(req.params.pin);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status !== 'lobby') return res.status(409).json({ error: 'Game already in progress' });
    res.json({ pin: room.pin, playerCount: room.players.size, teamsEnabled: room.teamsEnabled });
  });

  // ── Admin auth ────────────────────────────────────────────────────────────────

  app.post('/api/admin/verify', adminAuth, (req, res) => {
    res.json({ ok: true });
  });

  // ── Quiz routes (read: public, write: admin) ──────────────────────────────────

  app.get('/api/quizzes', (req, res) => {
    const quizzes = quizStore.list();
    const lastPlayed = resultStore.lastPlayedByQuizId();
    res.json(quizzes.map(q => ({ ...q, lastPlayedAt: lastPlayed[q.id] || null })));
  });

  app.post('/api/quizzes', adminAuth, (req, res) => {
    const { title, questions } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    res.status(201).json(quizStore.create({ title, questions }));
  });

  app.get('/api/quizzes/:id', adminAuth, (req, res) => {
    const quiz = quizStore.get(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Not found' });
    res.json(quiz);
  });

  app.put('/api/quizzes/:id', adminAuth, (req, res) => {
    const quiz = quizStore.update(req.params.id, req.body);
    if (!quiz) return res.status(404).json({ error: 'Not found' });
    res.json(quiz);
  });

  app.delete('/api/quizzes/:id', adminAuth, (req, res) => {
    if (!quizStore.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  // Duplicate quiz
  app.post('/api/quizzes/:id/duplicate', adminAuth, (req, res) => {
    const original = quizStore.get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Not found' });
    const copy = quizStore.create({ title: `Copy of ${original.title}`, questions: original.questions });
    res.status(201).json(copy);
  });

  // Export: download quiz as JSON file
  app.get('/api/quizzes/:id/export', adminAuth, (req, res) => {
    const quiz = quizStore.get(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Not found' });
    const filename = `${quiz.title.replace(/[^a-z0-9]/gi, '_')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(quiz);
  });

  // Import: POST a quiz JSON body
  app.post('/api/quizzes/import', adminAuth, (req, res) => {
    const { title, questions } = req.body;
    if (!title || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Invalid quiz format' });
    }
    res.status(201).json(quizStore.create({ title, questions }));
  });

  // ── Results ───────────────────────────────────────────────────────────────────

  app.get('/api/results/summary', adminAuth, (req, res) => {
    res.json(resultStore.countByQuizId());
  });

  app.get('/api/results', adminAuth, (req, res) => {
    res.json(resultStore.list());
  });

  app.get('/api/results/:id/export', adminAuth, (req, res) => {
    const result = resultStore.get(req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });

    const rows = [
      [`Game: ${result.quizTitle}`],
      [`Date: ${result.playedAt}`],
      [`Players: ${result.playerCount}`],
      [],
      ['Rank', 'Nickname', 'Score'],
      ...result.players.map(p => [p.rank, p.nickname, p.score]),
      [],
      ['#', 'Question', 'Correct', 'Answered', '% Correct'],
      ...result.questions.map((q, i) => [i + 1, q.text, q.correctCount, q.answeredCount, `${q.correctPct}%`]),
    ];

    const csv = rows.map(r =>
      r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    const filename = `${result.quizTitle.replace(/[^a-z0-9]/gi, '_')}_${result.playedAt.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  });

  app.get('/api/results/:id', adminAuth, (req, res) => {
    const result = resultStore.get(req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  });

  app.delete('/api/results/:id', adminAuth, (req, res) => {
    if (!resultStore.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  // ── Image upload ──────────────────────────────────────────────────────────────

  app.post('/api/upload', adminAuth, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const stem = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const filename = `${stem}.jpg`;
      const dest = path.join(__dirname, '../../public/assets/images', filename);
      await sharp(req.file.buffer)
        .rotate()           // auto-orient from EXIF (fixes rotated phone photos)
        .jpeg({ quality: 85 })
        .toFile(dest);
      res.json({ url: `/assets/images/${filename}` });
    } catch (err) {
      res.status(422).json({ error: 'Could not process image. Try JPEG, PNG, WebP, GIF, AVIF, or HEIC.' });
    }
  });
}

module.exports = routes;
