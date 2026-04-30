const path = require('path');
const multer = require('multer');
const QRCode = require('qrcode');
const quizStore = require('../quiz/quizStore');
const { createRoom, getRoom } = require('../game/roomManager');

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  if (req.headers['x-admin-password'] !== password) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../public/assets/images'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

function routes(app) {
  app.get('/', (req, res) => res.redirect('/player'));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // ── Room routes ───────────────────────────────────────────────────────────────

  app.post('/api/rooms', async (req, res) => {
    const room = createRoom();
    const playerUrl = `${req.protocol}://${req.get('host')}/player?pin=${room.pin}`;
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
    res.json({ pin: room.pin, playerCount: room.players.size });
  });

  // ── Admin auth ────────────────────────────────────────────────────────────────

  app.post('/api/admin/verify', adminAuth, (req, res) => {
    res.json({ ok: true });
  });

  // ── Quiz routes (read: public, write: admin) ──────────────────────────────────

  app.get('/api/quizzes', (req, res) => {
    res.json(quizStore.list());
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

  // ── Image upload ──────────────────────────────────────────────────────────────

  app.post('/api/upload', adminAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/assets/images/${req.file.filename}` });
  });
}

module.exports = routes;
