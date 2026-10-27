import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['websocket', 'polling']
});
const PORT = 3000;

app.use(express.json());

// Enable CORS for cross-device access (e.g. acestudio.mooo.com, local IP, mobile devices)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware to support hosting under any subpath (e.g. /PuzzleBoard, /puzzleboard, /PuzzleBoard-main, etc.)
app.use((req, res, next) => {
  // 1. If any request path contains /api/, strip whatever subpath prefix precedes /api/
  // Examples:
  // - /PuzzleBoard/api/broadcast -> /api/broadcast
  // - /puzzleboard/api/broadcast -> /api/broadcast
  // - /PuzzleBoard-main/api/events?roomid=... -> /api/events?roomid=...
  const apiMatch = req.url.match(/^(?:\/[^\/]+)*(\/api(?:\/.*|\?.*|$))/i);
  if (apiMatch) {
    req.url = apiMatch[1];
    return next();
  }

  // 2. Strip common project folder prefixes for static assets & pages
  // Examples:
  // - /PuzzleBoard/control.html -> /control.html
  // - /PuzzleBoard/ -> /
  // - /PuzzleBoard -> /
  // - /PuzzleBoard-main/player.html -> /player.html
  const prefixMatch = req.url.match(/^\/(?:puzzleboard(?:-main|-master)?)(?:\/(.*)|$)/i);
  if (prefixMatch) {
    req.url = '/' + (prefixMatch[1] || '');
    return next();
  }

  next();
});

// Canonical Room ID normalizer: strips prefixes like crossword_broadcast_room_
export function normalizeRoomId(rawId) {
  if (!rawId) return '123456';
  const str = String(rawId).trim();
  const m = str.match(/^(?:crossword_broadcast_room_)?(.+)$/i);
  return m ? m[1] : str;
}

// Room configurations and real-time state tracking
const sseClients = new Set();
let activeRoomId = '123456';
const roomConfigs = new Map([
  ['123456', { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 }],
  ['default', { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 }]
]);

function getRoomConfig(roomid) {
  const rid = normalizeRoomId(roomid || activeRoomId || 'default');
  if (!roomConfigs.has(rid)) {
    roomConfigs.set(rid, { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 });
  }
  return roomConfigs.get(rid);
}

// Soundboard MP3 dynamic file scanner
app.get('/api/soundboard-files', (req, res) => {
  try {
    const files = fs.readdirSync(__dirname)
      .filter(f => /\.mp3$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, files: [] });
  }
});

app.get('/api/get-active-room', (req, res) => {
  const currentRid = activeRoomId || '123456';
  const config = getRoomConfig(currentRid);
  res.json({ activeRoomId: currentRid, pass: config.pass, buzzerOpen: !!config.buzzerOpen, latestWinner: config.latestWinner });
});

app.get('/api/get-room-config', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || '123456';
  const config = getRoomConfig(roomid);
  res.json({ activeRoomId: activeRoomId || '123456', roomid, pass: config.pass, buzzerOpen: !!config.buzzerOpen });
});

app.get('/api/get-buzzer-state', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || 'default';
  const config = getRoomConfig(roomid);
  res.json({
    roomid,
    buzzerOpen: config.isFortuneFrenzy ? true : !!config.buzzerOpen,
    latestWinner: config.latestWinner,
    latestBuzzTs: config.latestBuzzTs,
    isFortuneFrenzy: !!config.isFortuneFrenzy
  });
});

app.get('/api/get-room-state', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || 'default';
  const config = getRoomConfig(roomid);
  res.json({
    roomid,
    buzzerOpen: config.isFortuneFrenzy ? true : !!config.buzzerOpen,
    latestWinner: config.latestWinner || null,
    latestBuzzTs: config.latestBuzzTs || 0,
    pass: config.pass || '',
    isFortuneFrenzy: !!config.isFortuneFrenzy
  });
});

app.post('/api/set-room-config', (req, res) => {
  const { roomid, pass, buzzerOpen } = req.body;
  const targetRoom = roomid || 'default';
  activeRoomId = targetRoom;
  const config = getRoomConfig(targetRoom);
  if (pass !== undefined && pass !== null) config.pass = pass.toString();
  if (buzzerOpen !== undefined) config.buzzerOpen = !!buzzerOpen;
  
  // Notify connected clients of buzzer state update and active room changes
  const stateMsg = JSON.stringify({ event: 'buzzer-state-update', isOpen: !!config.buzzerOpen, roomid: targetRoom });
  const roomMsg = JSON.stringify({ event: 'active-room-changed', activeRoomId: targetRoom });
  for (const client of sseClients) {
    try {
      client.write(`data: ${stateMsg}\n\n`);
      client.write(`data: ${roomMsg}\n\n`);
    } catch(e) {
      sseClients.delete(client);
    }
  }

  res.json({ ok: true, activeRoomId, pass: config.pass, buzzerOpen: config.buzzerOpen });
});

app.get('/api/verify-room-pass', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || '123456';
  const playerPass = (req.query.pass || '').toString().trim();
  const config = getRoomConfig(roomid);
  // If player did not specify a pass, allow them in with active room's pass
  if (!playerPass || !config.pass || config.pass.trim() === playerPass) {
    return res.json({ valid: true, requiresPass: false, buzzerOpen: !!config.buzzerOpen, roomid, pass: config.pass });
  }
  // If player explicitly typed an incorrect password
  res.json({ valid: false, requiresPass: true, buzzerOpen: !!config.buzzerOpen, roomid });
});

app.post('/api/set-active-room', (req, res) => {
  const { roomid, pass } = req.body;
  if (roomid) {
    activeRoomId = roomid;
    const config = getRoomConfig(roomid);
    if (pass !== undefined) config.pass = pass.toString();
  }
  res.json({ ok: true, activeRoomId });
});

// Dedicated fast endpoint for contestant buzz
app.post('/api/buzz', (req, res) => {
  const { roomid, playerNum, ts } = req.body;
  const targetRoom = roomid || activeRoomId || 'default';
  const config = getRoomConfig(targetRoom);
  const pNum = parseInt(playerNum) || 1;
  const now = Date.now();

  let won = false;
  // If buzzer is open or no winner yet within last 8 seconds (or 1.5s in Fortune Frenzy)
  const windowMs = config.isFortuneFrenzy ? 1500 : 8000;
  if (!config.latestWinner || (now - config.latestBuzzTs > windowMs)) {
    config.latestWinner = pNum;
    config.latestBuzzTs = now;
    config.buzzerOpen = config.isFortuneFrenzy ? true : false;
    won = true;
  }

  // Broadcast to all SSE clients in this room (controller, display, other players)
  const msgObj = {
    event: 'player-buzz',
    payload: { playerNum: config.latestWinner, ts: config.latestBuzzTs },
    ts: config.latestBuzzTs,
    roomid: targetRoom
  };
  const msgStr = JSON.stringify(msgObj);

  for (const client of sseClients) {
    if (client.roomid === targetRoom || client.roomid === 'default' || targetRoom === 'default') {
      try {
        client.write(`data: ${msgStr}\n\n`);
      } catch (err) {
        sseClients.delete(client);
      }
    }
  }

  // Also broadcast buzzer lock state to all players (in Fortune Frenzy keep open)
  const lockMsg = JSON.stringify({ event: 'buzzer-state-update', isOpen: config.isFortuneFrenzy ? true : false, roomid: targetRoom, latestWinner: config.latestWinner });
  for (const client of sseClients) {
    if (client.roomid === targetRoom || client.roomid === 'default' || targetRoom === 'default') {
      try {
        client.write(`data: ${lockMsg}\n\n`);
      } catch (err) {}
    }
  }

  console.log(`[BUZZ] Room ${targetRoom}: Player ${pNum} buzzed! Winner: ${config.latestWinner}`);
  res.json({ ok: true, won, winner: config.latestWinner, latestBuzzTs: config.latestBuzzTs });
});

// Reset buzzer winner state
app.post('/api/reset-buzz', (req, res) => {
  const targetRoom = req.body.roomid || activeRoomId || 'default';
  const config = getRoomConfig(targetRoom);
  config.latestWinner = null;
  config.latestBuzzTs = 0;
  if (config.isFortuneFrenzy) {
    config.buzzerOpen = true;
  }
  const resetMsg = JSON.stringify({ event: 'buzzer-state-update', isOpen: config.isFortuneFrenzy ? true : !!config.buzzerOpen, roomid: targetRoom, latestWinner: null });
  for (const client of sseClients) {
    if (client.roomid === targetRoom || client.roomid === 'default' || targetRoom === 'default') {
      try {
        client.write(`data: ${resetMsg}\n\n`);
      } catch (err) {}
    }
  }
  res.json({ ok: true });
});

// Real-time Server-Sent Events endpoint for multi-device sync with room isolation
function broadcastOccupiedRoles(roomid) {
  // If the room being checked/broadcasted is not the active room, skip
  if (activeRoomId && roomid !== activeRoomId) return;

  const occupied = [];
  for (const client of sseClients) {
    if (client.roomid === roomid && client.role >= 1 && client.role <= 3) {
      if (!occupied.includes(client.role)) {
        occupied.push(client.role);
      }
    }
  }
  const msgStr = JSON.stringify({ event: 'roles-update', occupiedRoles: occupied, roomid });
  for (const client of sseClients) {
    if (client.roomid === roomid) {
      try {
        client.write(`data: ${msgStr}\n\n`);
      } catch (err) {
        sseClients.delete(client);
      }
    }
  }
}

app.get('/api/events', (req, res) => {
  const roomid = req.query.roomid || 'default';
  const clientId = req.query.clientId || 'unknown';
  const role = parseInt(req.query.role) || 0;

  res.roomid = roomid;
  res.clientId = clientId;
  res.role = role;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write('data: {"event":"connected"}\n\n');
  const currentRoomConfig = getRoomConfig(roomid);
  res.write(`data: ${JSON.stringify({ event: 'buzzer-state-update', isOpen: !!currentRoomConfig.buzzerOpen, roomid })}\n\n`);

  if (roomid === 'default' && activeRoomId) {
    res.write(`data: ${JSON.stringify({ event: 'active-room-changed', activeRoomId })}\n\n`);
  }

  sseClients.add(res);
  broadcastOccupiedRoles(roomid);

  req.on('close', () => {
    sseClients.delete(res);
    broadcastOccupiedRoles(roomid);
  });
});

app.get('/api/check-role', (req, res) => {
  // Always permit role selection so contestants are never locked out by stale connections
  res.json({ occupied: false });
});

app.get('/api/connected-clients', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || '123456';
  let total = 0;
  const roles = [];
  for (const client of sseClients) {
    if (client.roomid === roomid || client.roomid === 'default') {
      total++;
      if (client.role >= 1 && client.role <= 3 && !roles.includes(client.role)) {
        roles.push(client.role);
      }
    }
  }
  res.json({ activeRoomId: activeRoomId || '123456', total, roles, roomid });
});

// Periodic heartbeat to keep SSE connections open through proxies/firewalls
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write('data: {"event":"ping"}\n\n');
    } catch (err) {
      sseClients.delete(client);
    }
  }
}, 15000);

// Broadcast API endpoint for any device to broadcast to all other devices in the same room
app.post('/api/broadcast', (req, res) => {
  const { event, payload, ts, id, roomid } = req.body;
  const targetRoom = roomid || 'default';

  // Update room buzzer state based on command type
  const currentConfig = getRoomConfig(targetRoom);
  if (event === 'player-buzz') {
    if (!currentConfig.isFortuneFrenzy) {
      currentConfig.buzzerOpen = false;
    }
    currentConfig.latestWinner = payload?.playerNum ? parseInt(payload.playerNum) : 1;
    currentConfig.latestBuzzTs = Date.now();
  } else if (payload && payload.type) {
    const t = payload.type;
    const isFortuneFrenzyCmd = payload.isFortuneFrenzy || payload.data?.isFortuneFrenzy || payload.index === 12 || payload.data?.index === 12 || (t === 'UPDATE_QUIZ_ACTIVE' && (payload.data === 12 || payload.data === '12')) || t === 'START_ROUND30' || t === 'UPDATE_ROUND30_TIMER' || t === 'PAUSE_ROUND30_MUSIC' || t === 'RESUME_ROUND30_MUSIC' || t === 'STOP_ROUND30_MUSIC';

    if (t === 'UPDATE_QUIZ_ACTIVE') {
      currentConfig.isFortuneFrenzy = (payload.data === 12 || payload.data === '12');
    } else if (isFortuneFrenzyCmd) {
      currentConfig.isFortuneFrenzy = true;
    }

    if (currentConfig.isFortuneFrenzy) {
      // Vòng Fortune Frenzy luôn luôn mở chuông bất cứ lúc nào!
      currentConfig.buzzerOpen = true;
      if (t === 'LOAD_QUIZ' || t === 'CLEAR_BUZZER' || t === 'START_ROUND30' || t === 'PAUSE_ROUND30_MUSIC' || t === 'RESUME_ROUND30_MUSIC' || (t === 'SET_BUZZER_STATE' && payload.data?.state === 'OPEN')) {
        currentConfig.latestWinner = null;
        currentConfig.latestBuzzTs = 0;
      }
    } else {
      if (t === 'START_TOSSUP' || t === 'PLAY_TOSSUP' || t === 'PAUSE_TOSSUP' || t === 'CLEAR_BUZZER' || (t === 'SET_BUZZER_STATE' && payload.data && payload.data.state === 'OPEN')) {
        currentConfig.buzzerOpen = true;
        currentConfig.latestWinner = null;
        currentConfig.latestBuzzTs = 0;
      } else if (t === 'REVEAL_ALL' || t === 'LOAD_QUIZ' || t === 'RESET_BOARD' || t === 'PLAYER_BUZZ_WIN' || (t === 'SET_BUZZER_STATE' && payload.data && payload.data.state === 'LOCKED')) {
        currentConfig.buzzerOpen = false;
      }
    }
  }

  const msgStr = JSON.stringify({ event, payload, ts: ts || Date.now(), id, roomid: targetRoom });
  
  for (const client of sseClients) {
    if (client.roomid === targetRoom || client.roomid === 'default' || targetRoom === 'default') {
      try {
        client.write(`data: ${msgStr}\n\n`);
      } catch (err) {
        sseClients.delete(client);
      }
    }
  }

  // Also broadcast via Socket.IO with canonical room resolution
  const cleanTargetRoom = normalizeRoomId(targetRoom);
  const socketData = { event, payload, ts: ts || Date.now(), id, roomid: cleanTargetRoom };
  io.to(cleanTargetRoom).emit(event || 'control-command', socketData);
  io.to('crossword_broadcast_room_' + cleanTargetRoom).emit(event || 'control-command', socketData);
  io.to('default').emit(event || 'control-command', socketData);
  io.emit('broadcast', socketData);

  const receivers = Array.from(sseClients).filter(c => normalizeRoomId(c.roomid) === cleanTargetRoom || c.roomid === 'default' || cleanTargetRoom === 'default').length;
  res.json({ ok: true, receivers: receivers });
});

// Socket.IO real-time connection handler with dual room support
io.on('connection', (socket) => {
  const rawRid = socket.handshake.query.roomid || '123456';
  const cleanRid = normalizeRoomId(rawRid);
  socket.join(cleanRid);
  socket.join('crossword_broadcast_room_' + cleanRid);
  socket.join('default');

  socket.on('join-room', (rid) => {
    if (rid) {
      const cRid = normalizeRoomId(rid);
      socket.join(cRid);
      socket.join('crossword_broadcast_room_' + cRid);
    }
  });

  socket.on('control-command', (data) => {
    const targetRoom = normalizeRoomId(data.roomid || data.roomId || '123456');
    data.roomid = targetRoom;
    io.to(targetRoom).emit('control-command', data);
    io.to('crossword_broadcast_room_' + targetRoom).emit('control-command', data);
    io.to('default').emit('control-command', data);
    socket.broadcast.emit('control-command', data);
  });

  socket.on('display-message', (data) => {
    const targetRoom = normalizeRoomId(data.roomid || data.roomId || '123456');
    data.roomid = targetRoom;
    io.to(targetRoom).emit('display-message', data);
    io.to('crossword_broadcast_room_' + targetRoom).emit('display-message', data);
    io.to('default').emit('display-message', data);
    socket.broadcast.emit('display-message', data);
  });

  socket.on('player-buzz', (data) => {
    const targetRoom = normalizeRoomId(data.roomid || data.roomId || '123456');
    const config = getRoomConfig(targetRoom);
    const pNum = parseInt(data.playerNum) || 1;
    const now = Date.now();
    let won = false;
    if (!config.latestWinner || (now - config.latestBuzzTs > 8000)) {
      config.latestWinner = pNum;
      config.latestBuzzTs = now;
      config.buzzerOpen = false;
      won = true;
    }
    const buzzPayload = {
      event: 'player-buzz',
      payload: { playerNum: config.latestWinner, ts: config.latestBuzzTs, won },
      ts: config.latestBuzzTs,
      roomid: targetRoom
    };
    io.to(targetRoom).emit('player-buzz', buzzPayload);
    io.to('crossword_broadcast_room_' + targetRoom).emit('player-buzz', buzzPayload);
    io.to('default').emit('player-buzz', buzzPayload);
    socket.broadcast.emit('player-buzz', buzzPayload);
  });
});

// Serve all static assets from the current directory with aggressive media caching
app.use(express.static(__dirname, {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (/\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|ogg|ttf|otf|woff|woff2)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
}));

// Route shortcuts
app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'control.html'));
});

app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'player.html'));
});

app.get('/player1', (req, res) => {
  res.redirect('/player' + (req.query.roomid ? '?roomid=' + req.query.roomid : ''));
});

app.get('/player2', (req, res) => {
  res.redirect('/player' + (req.query.roomid ? '?roomid=' + req.query.roomid : ''));
});

app.get('/player3', (req, res) => {
  res.redirect('/player' + (req.query.roomid ? '?roomid=' + req.query.roomid : ''));
});

app.get('/scoreboard1', (req, res) => {
  res.sendFile(path.join(__dirname, 'scoreboard1.html'));
});

app.get('/scoreboard2', (req, res) => {
  res.sendFile(path.join(__dirname, 'scoreboard2.html'));
});

app.get('/scoreboard3', (req, res) => {
  res.sendFile(path.join(__dirname, 'scoreboard3.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

