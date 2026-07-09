const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const connectDB = require('./db');
const setupSocket = require('./socket-handler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Serve static client files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Make io accessible in routes
app.set('io', io);

// API Routes
app.use('/api/auth', require('./auth-routes'));
app.use('/api/admin', require('./admin-routes'));
app.use('/api/driver', require('./driver-routes'));
app.use('/api/user', require('./user-routes'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Catch-all: serve client
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Setup Socket.IO
setupSocket(io);

const DEFAULT_PORT = Number(process.env.PORT) || 5000;

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

(async () => {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 10; port += 1) {
    const activePort = await listenOnPort(port);
    if (activePort) {
      console.log(` Logistics Tracker running at http://localhost:${activePort}`);
      console.log(` Admin:  http://localhost:${activePort}/admin.html`);
      console.log(` Driver: http://localhost:${activePort}/driver.html`);
      console.log(` User:   http://localhost:${activePort}/user.html`);
      return;
    }

    console.warn(` Port ${port} is already in use, trying ${port + 1}...`);
  }

  console.error(` Unable to start the server: ports ${DEFAULT_PORT}-${DEFAULT_PORT + 9} are already in use.`);
  process.exit(1);
})();
