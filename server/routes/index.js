const { createRoom, getRoom } = require('../game/roomManager');

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next(); // no password set = open (dev mode)
  if (req.headers['x-admin-password'] !== password) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function routes(app) {
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Host creates a new game room; returns the PIN
  app.post('/api/rooms', (req, res) => {
    const room = createRoom();
    res.json({ pin: room.pin });
  });

  // Player validates a PIN before entering nickname/avatar
  app.get('/api/rooms/:pin', (req, res) => {
    const room = getRoom(req.params.pin);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status !== 'lobby') return res.status(409).json({ error: 'Game already in progress' });
    res.json({ pin: room.pin, playerCount: room.players.size });
  });

  // Validates admin password — used by the editor UI to gate access
  app.post('/api/admin/verify', adminAuth, (req, res) => {
    res.json({ ok: true });
  });

  // Phase 4: Quiz CRUD routes mount here, all protected by adminAuth
}

module.exports = routes;
