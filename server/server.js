'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// ─── App & Server Setup ───────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 4096 }); // 4KB max WS frame

const ALLOWED_ORIGINS = [
  'https://aa4474.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'null' // file:// origin for local testing
];

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'wss:', 'ws:'],
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '1kb' }));

// HTTP rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
}));

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => {
  res.json({
    name: 'Serpentine Snake Game Server',
    status: 'running',
    rooms: rooms.size,
    players: wss.clients.size,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ─── Room Management ──────────────────────────────────────────────────────────
// rooms: code → { host: ws, guest: ws|null, gameMode, createdAt, lastActivity }
const rooms = new Map();
// playerRooms: ws → roomCode
const playerRooms = new Map();

function generateRoomCode() {
  let code;
  let attempts = 0;
  do {
    code = String(crypto.randomInt(100000, 999999));
    attempts++;
  } while (rooms.has(code) && attempts < 100);
  return code;
}

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (_) {}
  }
}

function cleanupPlayer(ws) {
  // Remove per-connection rate limit state
  msgCounts.delete(ws);

  const code = playerRooms.get(ws);
  if (!code) return;
  playerRooms.delete(ws);

  const room = rooms.get(code);
  if (!room) return;

  if (room.host === ws) {
    if (room.guest) {
      safeSend(room.guest, { type: 'player_disconnected', role: 'host' });
      playerRooms.delete(room.guest);
    }
    rooms.delete(code);
    log(`Room ${code} closed (host left). Rooms: ${rooms.size}`);
  } else if (room.guest === ws) {
    safeSend(room.host, { type: 'player_disconnected', role: 'guest' });
    room.guest = null;
    room.lastActivity = Date.now();
    log(`Room ${code}: guest left. Room stays open.`);
  }
}

// ─── Per-Connection Rate Limiting ─────────────────────────────────────────────
const msgCounts = new Map(); // ws → { count, windowStart }
const MAX_MSG_PER_SEC = 40;
const MAX_RELAY_SIZE = 2048; // 2KB per relay payload

function checkRate(ws) {
  const now = Date.now();
  const entry = msgCounts.get(ws) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 1000) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  msgCounts.set(ws, entry);
  return entry.count <= MAX_MSG_PER_SEC;
}

// ─── Input Validators ─────────────────────────────────────────────────────────
const VALID_MODES = new Set(['classic','speed_rush','portal','time_attack','coop','versus','chaos']);
const VALID_MSG_TYPES = new Set(['create_room','join_room','relay','ping','leave_room']);

function sanitizeString(s, maxLen = 32) {
  if (typeof s !== 'string') return '';
  return s.slice(0, maxLen).replace(/[<>"']/g, '');
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// ─── WebSocket Handler ───────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // Never log or expose client IP anywhere
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Validate origin
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    log(`Rejected connection from disallowed origin`);
    ws.close(1008, 'Forbidden');
    return;
  }

  log(`New connection. Total: ${wss.clients.size}`);

  ws.on('message', (rawData, isBinary) => {
    if (isBinary) return; // Reject binary frames

    // Size guard
    if (rawData.length > 3072) {
      safeSend(ws, { type: 'error', message: 'Message too large' });
      return;
    }

    // Rate limit
    if (!checkRate(ws)) {
      safeSend(ws, { type: 'error', message: 'Rate limit exceeded' });
      return;
    }

    // Parse JSON safely
    let msg;
    try {
      msg = JSON.parse(rawData.toString('utf8'));
    } catch {
      safeSend(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    // Basic schema check
    if (!msg || typeof msg !== 'object' || !VALID_MSG_TYPES.has(msg.type)) {
      safeSend(ws, { type: 'error', message: 'Unknown message type' });
      return;
    }

    // Update room activity
    const existingCode = playerRooms.get(ws);
    if (existingCode) {
      const r = rooms.get(existingCode);
      if (r) r.lastActivity = Date.now();
    }

    // ── Message Handlers ──
    switch (msg.type) {

      case 'create_room': {
        if (playerRooms.has(ws)) {
          safeSend(ws, { type: 'error', message: 'Already in a room' });
          return;
        }
        const gameMode = VALID_MODES.has(msg.gameMode) ? msg.gameMode : 'classic';
        const code = generateRoomCode();
        rooms.set(code, {
          host: ws,
          guest: null,
          gameMode,
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
        playerRooms.set(ws, code);
        safeSend(ws, { type: 'room_created', code, gameMode });
        log(`Room ${code} created. Mode: ${gameMode}. Rooms: ${rooms.size}`);
        break;
      }

      case 'join_room': {
        if (playerRooms.has(ws)) {
          safeSend(ws, { type: 'error', message: 'Already in a room' });
          return;
        }
        const rawCode = sanitizeString(msg.code, 6);
        // Only allow 6-digit numeric codes
        if (!/^\d{6}$/.test(rawCode)) {
          safeSend(ws, { type: 'error', message: 'Invalid room code format' });
          return;
        }
        const room = rooms.get(rawCode);
        if (!room) {
          safeSend(ws, { type: 'error', message: 'Room not found. Check the code.' });
          return;
        }
        if (room.guest) {
          safeSend(ws, { type: 'error', message: 'Room is already full' });
          return;
        }
        room.guest = ws;
        room.lastActivity = Date.now();
        playerRooms.set(ws, rawCode);
        safeSend(ws, { type: 'room_joined', code: rawCode, gameMode: room.gameMode });
        safeSend(room.host, { type: 'guest_joined' });
        log(`Room ${rawCode}: guest joined`);
        break;
      }

      case 'relay': {
        const code = playerRooms.get(ws);
        if (!code) {
          safeSend(ws, { type: 'error', message: 'Not in a room' });
          return;
        }
        const room = rooms.get(code);
        if (!room) return;

        // Validate relay payload size (serialized)
        const payloadStr = JSON.stringify(msg.data);
        if (!payloadStr || payloadStr.length > MAX_RELAY_SIZE) return;

        // Only relay objects with a known action field (prevents smuggling arbitrary data)
        if (!msg.data || typeof msg.data !== 'object') return;
        const validActions = new Set(['input','state','start','game_over','emoji','ready']);
        if (!validActions.has(msg.data.action)) return;

        const isHost = room.host === ws;
        const recipient = isHost ? room.guest : room.host;
        const role = isHost ? 'host' : 'guest';

        if (recipient) {
          safeSend(recipient, { type: 'relay', from: role, data: msg.data });
        }
        break;
      }

      case 'ping': {
        safeSend(ws, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0 });
        break;
      }

      case 'leave_room': {
        cleanupPlayer(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    cleanupPlayer(ws);
    log(`Connection closed. Total: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    log(`WS error (suppressed):`, err.message);
    cleanupPlayer(ws);
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupPlayer(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000); // every 25s

// ─── Room Cleanup (inactive > 5 min) ─────────────────────────────────────────
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [code, room] of rooms.entries()) {
    if (now - room.lastActivity > 5 * 60 * 1000) {
      safeSend(room.host, { type: 'room_expired' });
      if (room.guest) {
        safeSend(room.guest, { type: 'room_expired' });
        playerRooms.delete(room.guest);
      }
      playerRooms.delete(room.host);
      rooms.delete(code);
      cleaned++;
    }
  }
  if (cleaned > 0) log(`Cleaned ${cleaned} inactive rooms. Remaining: ${rooms.size}`);
}, 60 * 1000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(cleanupInterval);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`🐍 Serpentine Server running on port ${PORT}`);
  log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  log(`   Rate limit: ${MAX_MSG_PER_SEC} msg/sec per connection`);
  log(`   Max relay payload: ${MAX_RELAY_SIZE} bytes`);
});

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});
