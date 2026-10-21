'use strict';
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 10000;
const players = new Map();
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'online', game: 'Battle Loot Tycoon', players: players.size }));
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});
const wss = new WebSocket.Server({ server, maxPayload: 4096 });
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(data, except) {
  for (const client of wss.clients) if (client !== except) send(client, data);
}
wss.on('connection', ws => {
  const id = crypto.randomUUID();
  const player = { id, username: 'Player', x: 0, y: 0, z: 0 };
  players.set(id, player);
  send(ws, { type: 'welcome', id, players: [...players.values()] });
  broadcast({ type: 'player_joined', player }, ws);
  let lastMove = 0;
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'set_username') {
      const username = String(message.username || '').trim();
      if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) return send(ws, { type: 'error', message: 'Invalid username' });
      player.username = username;
      broadcast({ type: 'player_updated', player });
      send(ws, { type: 'player_updated', player });
    } else if (message.type === 'move') {
      if (Date.now() - lastMove < 50) return;
      lastMove = Date.now();
      for (const key of ['x', 'y', 'z']) {
        if (!Number.isFinite(message[key]) || Math.abs(message[key]) > 100000) return;
      }
      player.x = message.x; player.y = message.y; player.z = message.z;
      broadcast({ type: 'player_moved', id, x: player.x, y: player.y, z: player.z }, ws);
    }
  });
  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'player_left', id });
  });
  ws.on('error', () => {});
});
server.listen(PORT, '0.0.0.0', () => console.log(`Battle Loot server listening on ${PORT}`));
