const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const routes = require('./routes');
const registerSocketHandlers = require('./socket');

function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/player', express.static(path.join(__dirname, '../client/player')));
  app.use('/host', express.static(path.join(__dirname, '../client/host')));
  app.use('/admin', express.static(path.join(__dirname, '../client/admin')));

  routes(app);
  registerSocketHandlers(io);

  return httpServer;
}

module.exports = { createServer };
