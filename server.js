import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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

// Middleware to support hosting under subpaths like /PuzzleBoard-main (e.g. https://acestudio.mooo.com/PuzzleBoard-main/...)
app.use((req, res, next) => {
  const lower = req.url.toLowerCase();
  if (lower.startsWith('/puzzleboard-main/')) {
    req.url = req.url.slice('/puzzleboard-main'.length);
    if (!req.url.startsWith('/')) req.url = '/' + req.url;
  } else if (lower === '/puzzleboard-main') {
    req.url = '/';
  }
  next();
});

// Room configurations and real-time state tracking
const sseClients = new Set();
let activeRoomId = '123456';
const roomConfigs = new Map([
  ['123456', { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 }],
  ['default', { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 }]
]);

function getRoomConfig(roomid) {
  const rid = roomid || activeRoomId || 'default';
  if (!roomConfigs.has(rid)) {
    roomConfigs.set(rid, { pass: '8888', buzzerOpen: false, latestWinner: null, latestBuzzTs: 0 });
  }
  return roomConfigs.get(rid);
}

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
  res.json({ roomid, buzzerOpen: !!config.buzzerOpen, latestWinner: config.latestWinner, latestBuzzTs: config.latestBuzzTs });
});

app.get('/api/get-room-state', (req, res) => {
  const roomid = req.query.roomid || activeRoomId || 'default';
  const config = getRoomConfig(roomid);
  res.json({
    roomid,
    buzzerOpen: !!config.buzzerOpen,
    latestWinner: config.latestWinner || null,
    latestBuzzTs: config.latestBuzzTs || 0,
    pass: config.pass || ''
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
  // If buzzer is open or no winner yet within last 8 seconds
  if (!config.latestWinner || (now - config.latestBuzzTs > 8000)) {
    config.latestWinner = pNum;
    config.latestBuzzTs = now;
    config.buzzerOpen = false;
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

  // Also broadcast buzzer lock state to all players
  const lockMsg = JSON.stringify({ event: 'buzzer-state-update', isOpen: false, roomid: targetRoom });
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
    currentConfig.buzzerOpen = false;
    currentConfig.latestWinner = payload?.playerNum ? parseInt(payload.playerNum) : 1;
    currentConfig.latestBuzzTs = Date.now();
  } else if (payload && payload.type) {
    const t = payload.type;
    if (t === 'START_TOSSUP' || t === 'PLAY_TOSSUP' || t === 'START_ROUND30' || t === 'RESUME_ROUND30_MUSIC' || (t === 'SET_BUZZER_STATE' && payload.data && payload.data.state === 'OPEN')) {
      currentConfig.buzzerOpen = true;
      currentConfig.latestWinner = null;
      currentConfig.latestBuzzTs = 0;
    } else if (t === 'PAUSE_TOSSUP' || t === 'PAUSE_ROUND30_MUSIC' || t === 'REVEAL_ALL' || t === 'LOAD_QUIZ' || t === 'RESET_BOARD' || t === 'PLAYER_BUZZ_WIN' || (t === 'SET_BUZZER_STATE' && payload.data && payload.data.state === 'LOCKED') || (t === 'UPDATE_ROUND30_TIMER' && (payload.data?.subTitle === 'TẠM DỪNG' || payload.data?.seconds === 0))) {
      currentConfig.buzzerOpen = false;
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

  const receivers = Array.from(sseClients).filter(c => c.roomid === targetRoom || c.roomid === 'default' || targetRoom === 'default').length;
  res.json({ ok: true, receivers: receivers });
});

// Serve all static assets from the current directory
app.use(express.static(__dirname));

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

