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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(` Logistics Tracker running at http://localhost:${PORT}`);
  console.log(` Admin:  http://localhost:${PORT}/admin.html`);
  console.log(` Driver: http://localhost:${PORT}/driver.html`);
  console.log(` User:   http://localhost:${PORT}/user.html`);
});
