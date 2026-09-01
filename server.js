import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Set of connected SSE clients
const sseClients = new Set();
let activeRoomId = null;

app.post('/api/set-active-room', (req, res) => {
  const { roomid } = req.body;
  if (roomid) {
    activeRoomId = roomid;
    console.log(`Active room set to: ${activeRoomId}`);
    
    // Disconnect and invalidate all clients from old/inactive rooms (excluding public 'default' spectators)
    for (const client of sseClients) {
      if (client.roomid !== activeRoomId && client.roomid !== 'default') {
        try {
          client.write('data: {"event":"room-invalidated"}\n\n');
          client.end();
        } catch (e) {}
        sseClients.delete(client);
      }
    }
  }
  res.json({ ok: true, activeRoomId });
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
  const url = new URL(req.url, 'http://localhost' + req.originalUrl);
  const roomid = url.searchParams.get('roomid') || 'default';
  const clientId = url.searchParams.get('clientId') || 'unknown';
  const role = parseInt(url.searchParams.get('role')) || 0;

  if (activeRoomId && roomid !== 'default' && roomid !== activeRoomId) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Phòng chơi này không hoạt động hoặc đã cũ.", inactive: true }));
    return;
  }

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

  sseClients.add(res);
  broadcastOccupiedRoles(roomid);

  req.on('close', () => {
    sseClients.delete(res);
    broadcastOccupiedRoles(roomid);
  });
});

app.get('/api/check-role', (req, res) => {
  const roomid = req.query.roomid || 'default';
  const role = parseInt(req.query.role) || 0;
  const clientId = req.query.clientId || 'unknown';

  if (activeRoomId && roomid !== activeRoomId) {
    return res.status(403).json({ error: "Phòng chơi này không hoạt động hoặc đã cũ.", inactive: true });
  }

  if (role < 1 || role > 3) {
    return res.json({ occupied: false });
  }

  let isOccupied = false;
  for (const client of sseClients) {
    if (client.roomid === roomid && client.role === role && client.clientId !== clientId) {
      isOccupied = true;
      break;
    }
  }

  res.json({ occupied: isOccupied });
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
}, 20000);

// Broadcast API endpoint for any device to broadcast to all other devices in the same room
app.post('/api/broadcast', (req, res) => {
  const { event, payload, ts, id, roomid } = req.body;
  const targetRoom = roomid || 'default';

  if (activeRoomId && targetRoom !== 'default' && targetRoom !== activeRoomId) {
    return res.status(403).json({ error: "Phòng chơi này không hoạt động hoặc đã cũ.", inactive: true });
  }

  const msgStr = JSON.stringify({ event, payload, ts: ts || Date.now(), id, roomid: targetRoom });
  
  for (const client of sseClients) {
    if (client.roomid === targetRoom || client.roomid === 'default') {
      try {
        client.write(`data: ${msgStr}\n\n`);
      } catch (err) {
        sseClients.delete(client);
      }
    }
  }

  const receivers = Array.from(sseClients).filter(c => c.roomid === targetRoom || c.roomid === 'default').length;
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

