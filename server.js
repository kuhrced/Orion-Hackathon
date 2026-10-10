// Game server: serves the pages, keeps the rooms, and runs the race.
// The server is the only place where cars move; screens just draw what it sends.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { buildTrack, gridSlot, prepareTrack, MAX_PLAYERS, WORLD } from './shared/track.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const TICK = 1 / 60;
const MAX_SPEED = 430;
const OFFROAD_SPEED = 170;
const ACCEL = 320;
const BRAKE = 700;
const TURN = 2.7; // radians per second at full steer
const CAR_RADIUS = 17;
const COUNTDOWN_MS = 3500;
const FINISH_GRACE_MS = 20000; // time the others get after the winner finishes
const BOT_NAMES = ['Robo Rita', 'Tin Tom', 'Bolt', 'Gizmo', 'Sparky', 'Nutty'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, n) => ((value % n) + n) % n;

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const PAGES = { '/': '/public/host.html', '/play': '/public/play.html' };

function lanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net.address}:${PORT}`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/info') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ lan: lanUrls() }));
    return;
  }
  if (url.pathname === '/qr.svg') {
    const text = (url.searchParams.get('d') || '').slice(0, 300);
    const svg = await QRCode.toString(text || ' ', { type: 'svg', margin: 1 });
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(svg);
    return;
  }
  const relative = PAGES[url.pathname] ?? (url.pathname.startsWith('/shared/') ? url.pathname : `/public${url.pathname}`);
  const file = path.join(ROOT, path.normalize(relative));
  if (!file.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(data);
  });
});

// ---------- Rooms ----------

const rooms = new Map();
const token = () => crypto.randomBytes(9).toString('base64url');

function createRoom() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  const room = {
    code, hostKey: token(), host: null, players: [], nextId: 1,
    phase: 'draw', // draw > lobby > countdown > race > results
    track: null, laps: 3, startAt: 0, raceStart: 0, raceTime: 0,
    firstFinish: null, results: null, tick: 0, lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function send(socket, message) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const socket of [room.host, ...room.players.map((player) => player.socket)]) {
    if (socket && socket.readyState === 1) socket.send(data);
  }
}

function stateMessage(room) {
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    laps: room.laps,
    countdown: room.phase === 'countdown' ? Math.max(0, room.startAt - performance.now()) : 0,
    players: room.players.map(({ id, name, color, type, bot, connected }) => ({ id, name, color, type, bot, connected })),
    results: room.results,
  };
}

function snapshotMessage(room) {
  return {
    t: 's',
    time: Math.round(room.raceTime),
    cars: room.players.filter((player) => player.car).map(({ id, car }) => [
      id, Math.round(car.x * 10) / 10, Math.round(car.y * 10) / 10, Math.round(car.a * 1000) / 1000,
      car.lap, car.place, car.done ? 1 : 0, Math.round(car.v),
    ]),
  };
}

const sendState = (room) => broadcast(room, stateMessage(room));
const sendTrack = (room, socket) => {
  const { seed, width, points, checkpoints } = room.track;
  const message = { t: 'track', track: { seed, width, points, checkpoints } };
  if (socket) send(socket, message);
  else broadcast(room, message);
};

function placeOnGrid(room) {
  if (!room.track) return;
  room.players.forEach((player, slot) => {
    const spot = gridSlot(room.track, slot);
    player.steer = 0;
    player.car = {
      x: spot.x, y: spot.y, a: spot.angle, v: 0, steer: 0,
      index: spot.index, progress: -spot.back, lap: 1, place: slot + 1,
      lost: 0, wrong: 0, done: false, finishTime: null,
    };
  });
  room.raceTime = 0;
  broadcast(room, snapshotMessage(room));
}

function addPlayer(room, { name, bot = false, socket = null }) {
  const used = new Set(room.players.map((player) => player.color));
  const color = [0, 1, 2, 3, 4, 5].find((index) => !used.has(index));
  const player = {
    id: room.nextId++, key: token(), name, color, type: crypto.randomInt(4), bot, socket,
    connected: !bot && !!socket, leftAt: null, steer: 0, car: null,
    pace: bot ? 0.84 + Math.random() * 0.1 : 1, lane: (Math.random() - 0.5) * 90,
  };
  room.players.push(player);
  return player;
}

function playersChanged(room) {
  if (room.phase === 'lobby') placeOnGrid(room);
  sendState(room);
}

// ---------- Race ----------

function respawn(track, car) {
  [car.x, car.y] = track.points[car.index];
  car.a = track.angles[car.index];
  car.v = 0;
  car.steer = 0;
  car.lost = 0;
  car.wrong = 0;
}

// Steers toward a point a little way down the road. Used by bots and by finished cars.
function autoSteer(track, player) {
  const { car } = player;
  const ahead = mod(car.index + 9, track.n);
  const [x, y] = track.points[ahead];
  const side = track.angles[ahead] + Math.PI / 2;
  let turn = Math.atan2(y + Math.sin(side) * player.lane - car.y, x + Math.cos(side) * player.lane - car.x) - car.a;
  turn = mod(turn + Math.PI, 2 * Math.PI) - Math.PI;
  return clamp(turn * 2.5, -1, 1);
}

function stepCar(room, player, dt) {
  const { track } = room;
  const { car } = player;

  // Follow the car along the centreline. Looking only a short way ahead stops shortcuts.
  let best = 0;
  let off = Infinity;
  for (let k = -4; k <= 14; k++) {
    const [x, y] = track.points[mod(car.index + k, track.n)];
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < off) {
      off = d;
      best = k;
    }
  }
  if (off < track.width * 0.9) {
    car.index = mod(car.index + best, track.n);
    car.progress += best;
    car.lost = 0;
  } else {
    car.lost += dt;
  }
  let facing = car.a - track.angles[car.index];
  facing = mod(facing + Math.PI, 2 * Math.PI) - Math.PI;
  car.wrong = Math.abs(facing) > 2.1 && car.v > 60 ? car.wrong + dt : 0;
  if (car.lost > 2.2 || car.wrong > 1.5) respawn(track, car);

  const input = player.bot || car.done ? autoSteer(track, player) : player.steer;
  car.steer += (input - car.steer) * Math.min(1, 12 * dt);
  const onRoad = off < track.width / 2 + 4;
  let top = (onRoad ? MAX_SPEED : OFFROAD_SPEED) * player.pace * (1 - 0.2 * Math.abs(car.steer));
  if (car.done) top *= 0.45;
  car.v = car.v < top ? Math.min(top, car.v + ACCEL * dt) : Math.max(top, car.v - BRAKE * dt);
  car.a += car.steer * TURN * dt * Math.min(1, car.v / 160);
  car.x = clamp(car.x + Math.cos(car.a) * car.v * dt, 20, WORLD.width - 20);
  car.y = clamp(car.y + Math.sin(car.a) * car.v * dt, 20, WORLD.height - 20);

  car.lap = clamp(Math.floor(car.progress / track.n) + 1, 1, room.laps);
  if (!car.done && car.progress >= room.laps * track.n) {
    car.done = true;
    car.finishTime = room.raceTime;
    room.firstFinish ??= room.raceTime;
  }
}

function pushApart(players) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i].car;
      const b = players[j].car;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const overlap = CAR_RADIUS * 2 - d;
      if (overlap <= 0) continue;
      const push = overlap / 2 / d;
      a.x -= dx * push;
      a.y -= dy * push;
      b.x += dx * push;
      b.y += dy * push;
    }
  }
}

function ranked(room) {
  return [...room.players].sort((p, q) => {
    if (p.car.done !== q.car.done) return p.car.done ? -1 : 1;
    if (p.car.done) return p.car.finishTime - q.car.finishTime;
    return q.car.progress - p.car.progress;
  });
}

function stepRoom(room, now) {
  if (room.phase === 'countdown' && now >= room.startAt) {
    room.phase = 'race';
    room.raceStart = now;
    sendState(room);
  }
  if (room.phase === 'countdown' && room.tick++ % 12 === 0) broadcast(room, snapshotMessage(room));
  if (room.phase !== 'race') return;

  room.raceTime = now - room.raceStart;
  for (const player of room.players) stepCar(room, player, TICK);
  pushApart(room.players);
  ranked(room).forEach((player, index) => {
    player.car.place = index + 1;
  });
  if (room.tick++ % 2 === 0) broadcast(room, snapshotMessage(room));

  const over = room.players.every((player) => player.car.done)
    || (room.firstFinish !== null && room.raceTime - room.firstFinish > FINISH_GRACE_MS)
    || room.raceTime > 6 * 60 * 1000;
  if (!over) return;

  room.phase = 'results';
  room.results = ranked(room).map(({ id, name, color, type, bot, car }, index) => ({
    id, name, color, type, bot, place: index + 1, time: car.done ? Math.round(car.finishTime) : null,
  }));
  broadcast(room, snapshotMessage(room));
  sendState(room);
}

let last = performance.now();
let owed = 0;
setInterval(() => {
  const now = performance.now();
  owed = Math.min(owed + (now - last) / 1000, 0.1);
  last = now;
  while (owed >= TICK) {
    owed -= TICK;
    for (const room of rooms.values()) stepRoom(room, now);
  }
}, 1000 / 60);

// Housekeeping: drop players who left the lobby, and rooms nobody uses.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const racing = room.phase === 'countdown' || room.phase === 'race';
    const before = room.players.length;
    if (!racing) room.players = room.players.filter((player) => player.bot || player.connected || now - player.leftAt < 20000);
    if (room.players.length !== before) playersChanged(room);
    if (room.host || room.players.some((player) => player.connected)) room.lastActive = now;
    if (now - room.lastActive > 10 * 60 * 1000) rooms.delete(room.code);
  }
}, 5000);

// ---------- Messages ----------

const cleanName = (name) => String(name ?? '').replace(/[^\p{L}\p{N} _.!?-]/gu, '').trim().slice(0, 14) || 'Racer';

const hostActions = {
  track(room, message) {
    if (room.phase !== 'draw' && room.phase !== 'lobby') return;
    const built = buildTrack(message.points, crypto.randomInt(1, 1e9));
    if (!built.ok) {
      send(room.host, { t: 'trackError', reason: built.reason });
      return;
    }
    room.track = prepareTrack(built.track);
    room.phase = 'lobby';
    sendTrack(room);
    placeOnGrid(room);
    sendState(room);
  },
  redraw(room) {
    if (room.phase !== 'lobby' && room.phase !== 'results') return;
    room.phase = 'draw';
    room.track = null;
    room.results = null;
    sendState(room);
  },
  laps(room, message) {
    const laps = Number(message.laps);
    room.laps = clamp(Number.isFinite(laps) ? Math.round(laps) : 3, 1, 5);
    sendState(room);
  },
  bot(room, message) {
    if (room.phase !== 'draw' && room.phase !== 'lobby') return;
    if (message.remove) {
      const index = room.players.findLastIndex((player) => player.bot);
      if (index >= 0) room.players.splice(index, 1);
    } else if (room.players.length < MAX_PLAYERS) {
      const taken = new Set(room.players.map((player) => player.name));
      addPlayer(room, { name: BOT_NAMES.find((name) => !taken.has(name)) ?? 'Bot', bot: true });
    }
    playersChanged(room);
  },
  start(room) {
    if (room.phase !== 'lobby' || !room.players.length) return;
    placeOnGrid(room);
    Object.assign(room, { phase: 'countdown', startAt: performance.now() + COUNTDOWN_MS, firstFinish: null, results: null, tick: 0 });
    sendState(room);
  },
  again(room) {
    if (room.phase !== 'results') return;
    room.phase = 'lobby';
    room.results = null;
    placeOnGrid(room);
    sendState(room);
  },
};

function onHost(socket, message) {
  let room = rooms.get(String(message.code ?? ''));
  if (!room || room.hostKey !== message.key) room = createRoom();
  if (room.host && room.host !== socket) room.host.close();
  room.host = socket;
  socket.room = room;
  socket.isHost = true;
  send(socket, { t: 'hosted', code: room.code, key: room.hostKey });
  if (room.track) sendTrack(room, socket);
  send(socket, stateMessage(room));
  if (room.track) send(socket, snapshotMessage(room));
}

function onJoin(socket, message) {
  const room = rooms.get(String(message.code ?? '').toUpperCase().trim());
  if (!room) {
    send(socket, { t: 'error', reason: 'No game with this code. Check the big screen.' });
    return;
  }
  let player = room.players.find((candidate) => !candidate.bot && candidate.key === message.key);
  if (!player) {
    if (room.phase === 'countdown' || room.phase === 'race') {
      send(socket, { t: 'error', reason: 'A race is running. You can join when it ends.', retry: true });
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      send(socket, { t: 'error', reason: 'This game is full (6 players).' });
      return;
    }
    player = addPlayer(room, { name: cleanName(message.name), socket });
  }
  if (player.socket && player.socket !== socket) player.socket.close();
  player.socket = socket;
  player.connected = true;
  socket.room = room;
  socket.player = player;
  send(socket, { t: 'joined', id: player.id, key: player.key, code: room.code });
  if (room.track) sendTrack(room, socket);
  playersChanged(room);
  if (room.track) send(socket, snapshotMessage(room));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (socket) => {
  socket.alive = true;
  socket.on('pong', () => {
    socket.alive = true;
  });
  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message.t !== 'string') return;
    if (message.t === 'host') return onHost(socket, message);
    if (message.t === 'join') return onJoin(socket, message);
    const { room, player } = socket;
    if (!room) return;
    if (socket.isHost) {
      if (Object.hasOwn(hostActions, message.t)) hostActions[message.t](room, message);
    } else if (player) {
      if (message.t === 'input') player.steer = clamp(Number(message.steer) || 0, -1, 1);
      if (message.t === 'car' && room.phase !== 'race' && room.phase !== 'countdown') {
        player.type = mod(Math.round(Number(message.type)) || 0, 4);
        sendState(room);
      }
    }
  });
  socket.on('close', () => {
    const { room, player } = socket;
    if (!room) return;
    if (socket.isHost && room.host === socket) room.host = null;
    if (player && player.socket === socket) {
      player.socket = null;
      player.connected = false;
      player.leftAt = Date.now();
      player.steer = 0;
      sendState(room);
    }
  });
});

// Pings keep phone connections open through proxies and spot dead ones.
setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    socket.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Race game running. Open the host screen at http://localhost:${PORT}`);
  for (const url of lanUrls()) console.log(`Phones on the same Wi-Fi can reach it at ${url}`);
});
