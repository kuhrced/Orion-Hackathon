// Game server: serves the pages, keeps the rooms, runs the race and asks the questions.
// The server is the only place where cars move; screens just draw what it sends.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { carTuning, CAR_TYPES } from './shared/cars.js';
import { buildProps, PROP_KINDS } from './shared/props.js';
import { buildTrack, gridSlot, prepareTrack, MAX_PLAYERS, WORLD, WORLD_IDS } from './shared/track.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const TICK = 1 / 60;
const MAX_SPEED = 430;
const OFFROAD_SPEED = 170;
const ACCEL = 320;
const BRAKE = 700;
const TURN = 2.7; // radians per second at full steer
const CAR_RADIUS = 24; // large enough for the visible car bodies to make contact
const CAR_BUMPER = 21; // a car's size when it hits things standing on the road
const SMASH_SPEED = 260; // hits harder than this can break things
const SMASH_LANDING = 300; // a crate that comes down faster than this breaks on the ground
const GRAVITY = 1100;
const FLY_OVER = 26; // above this height a flying object passes over cars and other objects
const COUNTDOWN_MS = 3500;
const QUESTION_READY_MS = 3000;
const FINISH_GRACE_MS = 30000; // time the others get after the winner finishes
const MAX_RACE_MS = 10 * 60 * 1000;

const QUESTION_EVERY_MS = 20000; // of driving time; the clock stops during a question
const QUESTION_FASTEST_MS = 10000; // short races ask more often, down to this
const MIN_QUESTIONS = 5; // every race should have at least this many
const ANSWER_MS = 12000;
const ANSWER_LOCK_MS = 900; // a steering tap just as the question appears must not count as an answer
const REVEAL_MS = 4500;
const BOOST_MS = 4000;
const BOOST_SPEED = 1.3;
const GREEN_TARGET = 0.6; // share of right answers that makes the map fully clean by the end
const BOT_RIGHT_CHANCE = 0.5;

const BOT_NAMES = ['Robo Rita', 'Tin Tom', 'Bolt', 'Gizmo', 'Sparky', 'Nutty'];
const RACING = new Set(['countdown', 'race', 'question-countdown', 'question', 'reveal']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, n) => ((value % n) + n) % n;

// What each car type is good at, from shared/cars.json. TUNING[player.type] is that car's set.
const CARS = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/cars.json'), 'utf8'));
const TUNING = CAR_TYPES.map((type) => carTuning(CARS.types[type].stats));

// ---------- Questions ----------

// Reads questions.db when this Node version has SQLite built in, and the JSON copy of it
// otherwise. The file is only read, never changed.
async function loadQuestions() {
  let rows;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(ROOT, 'questions.db'), { readOnly: true });
    rows = db.prepare('SELECT id, question, choice_a, choice_b, choice_c, choice_d, correct_index FROM questions').all()
      .map((row) => ({ id: row.id, question: row.question, choices: [row.choice_a, row.choice_b, row.choice_c, row.choice_d], correct: row.correct_index }));
    db.close();
  } catch {
    rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions.json'), 'utf8'));
  }
  return rows.filter((q) => q.question && q.choices.length === 4 && q.choices.every(Boolean) && [0, 1, 2, 3].includes(q.correct));
}

const QUESTIONS = await loadQuestions();

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const PAGES = { '/': '/public/index.html', '/host': '/public/host.html', '/play': '/public/play.html' };

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
    phase: 'draw', // draw > lobby > countdown > race (> question > reveal > race ...) > results
    track: null, laps: 2, startAt: 0, raceTime: 0, firstFinish: null, results: null, summary: null,
    green: 0, // 0 = polluted, 1 = fully green; shared by everyone in the room
    question: null, reveal: null, questionEvery: QUESTION_EVERY_MS, nextQuestionAt: 0, questionCount: 0, expectedQuestions: 6, asked: new Set(),
    lastWorld: null, props: [], tick: 0, lastActive: Date.now(),
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
  const now = performance.now();
  const { question, reveal } = room;
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    laps: room.laps,
    green: room.green,
    countdown: room.phase === 'countdown' ? Math.max(0, room.startAt - now) : 0,
    players: room.players.map((player) => ({
      id: player.id, name: player.name, color: player.color, type: player.type, bot: player.bot,
      connected: player.connected, correct: player.correct,
      answered: player.answer !== null,
      answer: reveal ? player.answer : null, // what each player picked is only shown afterwards
    })),
    question: question && {
      number: question.number, text: question.text, choices: question.choices,
      endsIn: Math.max(0, question.endsAt - now), seconds: ANSWER_MS / 1000,
      lockedFor: Math.max(0, question.askedAt + ANSWER_LOCK_MS - now),
      readyIn: room.phase === 'question-countdown' ? Math.max(0, question.readyAt - now) : 0,
    },
    reveal: reveal && { correct: reveal.correct, counts: reveal.counts, endsIn: Math.max(0, reveal.until - now) },
    results: room.results,
    summary: room.summary,
  };
}

function snapshotMessage(room, moved = []) {
  return {
    t: 's',
    time: Math.round(room.raceTime),
    props: moved.map((prop) => [prop.id, Math.round(prop.x), Math.round(prop.y), Math.round(prop.a * 100) / 100, Math.round(prop.z)]),
    cars: room.players.filter((player) => player.car).map((player) => {
      const { car } = player;
      return [
        player.id, Math.round(car.x * 10) / 10, Math.round(car.y * 10) / 10, Math.round(car.a * 1000) / 1000,
        car.lap, car.place, car.done ? 1 : 0, Math.round(car.v), room.raceTime < player.boostUntil ? 1 : 0,
        car.offRoad ? 1 : 0,
      ];
    }),
  };
}

const sendState = (room) => broadcast(room, stateMessage(room));
const sendTrack = (room, socket) => {
  const { seed, world, width, points, checkpoints } = room.track;
  const message = { t: 'track', track: { seed, world, width, points, checkpoints } };
  if (socket) send(socket, message);
  else broadcast(room, message);
};

function placeOnGrid(room) {
  if (!room.track) return;
  room.players.forEach((player, slot) => {
    const spot = gridSlot(room.track, slot);
    Object.assign(player, { steer: 0, correct: 0, answer: null, botAnswer: null, boostUntil: 0 });
    player.car = {
      x: spot.x, y: spot.y, a: spot.angle, v: 0, steer: 0,
      index: spot.index, progress: -spot.back, lap: 1, place: slot + 1,
      lost: 0, wrong: 0, done: false, finishTime: null,
    };
  });
  Object.assign(room, { raceTime: 0, green: 0, question: null, reveal: null, questionCount: 0, firstFinish: null });
  // Everything on the road is stood back up for the new race.
  room.props = buildProps(room.track).map((prop) => ({ ...prop, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, gone: false, moving: false, settled: false }));
  broadcast(room, propsMessage(room));
  broadcast(room, snapshotMessage(room));
}

// Where every road object is right now, for a screen that has just joined or a race that has
// just been reset. During a race only the ones that move are sent, inside the snapshots.
function propsMessage(room) {
  return { t: 'props', props: room.props.map((prop) => [prop.id, Math.round(prop.x), Math.round(prop.y), Math.round(prop.a * 100) / 100, prop.gone ? 1 : 0]) };
}

function addPlayer(room, { name, bot = false, socket = null }) {
  const used = new Set(room.players.map((player) => player.color));
  const color = [0, 1, 2, 3, 4, 5].find((index) => !used.has(index));
  const player = {
    id: room.nextId++, key: token(), name, color, type: crypto.randomInt(4), bot, socket,
    connected: !bot && !!socket, leftAt: null, steer: 0, car: null,
    correct: 0, answer: null, botAnswer: null, boostUntil: 0,
    pace: bot ? 0.84 + Math.random() * 0.1 : 1, lane: (Math.random() - 0.5) * 90,
  };
  room.players.push(player);
  return player;
}

function playersChanged(room) {
  if (room.phase === 'lobby') placeOnGrid(room);
  sendState(room);
}

// ---------- Questions during the race ----------

function askQuestion(room, now) {
  let pool = QUESTIONS.filter((q) => !room.asked.has(q.id));
  if (!pool.length) {
    room.asked.clear();
    pool = QUESTIONS;
  }
  const picked = pool[crypto.randomInt(pool.length)];
  room.asked.add(picked.id);
  room.questionCount++;
  room.phase = 'question-countdown';
  room.question = {
    number: room.questionCount, text: picked.question, choices: picked.choices, correct: picked.correct,
    // askedAt is the moment the question itself appears, after the "get ready" countdown.
    readyAt: now + QUESTION_READY_MS, askedAt: now + QUESTION_READY_MS, endsAt: now + QUESTION_READY_MS + ANSWER_MS, closeAt: null,
  };
  for (const player of room.players) {
    player.answer = null;
    const right = Math.random() < BOT_RIGHT_CHANCE;
    player.botAnswer = player.bot
      ? { at: room.question.readyAt + 1500 + Math.random() * 6000, choice: right ? picked.correct : (picked.correct + 1 + crypto.randomInt(3)) % 4 }
      : null;
  }
  sendState(room);
}

function stepQuestion(room, now) {
  const { question } = room;
  const humans = room.players.filter((player) => !player.bot && player.connected);
  const humansIn = humans.length > 0 && humans.every((player) => player.answer !== null);
  let changed = false;
  for (const player of room.players) {
    if (player.bot && player.answer === null && (humansIn || now >= player.botAnswer.at)) {
      player.answer = player.botAnswer.choice;
      changed = true;
    }
  }
  if (changed) sendState(room);
  // Once everybody has answered there is no reason to wait for the clock.
  const waiting = room.players.filter((player) => (player.bot || player.connected) && player.answer === null);
  if (!waiting.length) question.closeAt ??= now + 700;
  if (now < question.endsAt && !(question.closeAt && now >= question.closeAt)) return;

  const counts = [0, 0, 0, 0];
  let right = 0;
  for (const player of room.players) {
    if (player.answer !== null) counts[player.answer]++;
    if (player.answer !== question.correct) continue;
    right++;
    player.correct++;
    player.boostUntil = room.raceTime + BOOST_MS;
  }
  // Only people count for the map: bots guess, and their guesses should not hold it back.
  // No answer counts as wrong, so everyone has to take part.
  const people = room.players.filter((player) => !player.bot && player.connected);
  const voters = people.length ? people : room.players;
  const share = voters.filter((player) => player.answer === question.correct).length / Math.max(1, voters.length);
  room.green = Math.min(1, room.green + share / (room.expectedQuestions * GREEN_TARGET));
  room.reveal = { correct: question.correct, counts, until: now + REVEAL_MS };
  room.phase = 'reveal';
  sendState(room);
}

function resumeRace(room) {
  room.phase = 'race';
  room.question = null;
  room.reveal = null;
  room.nextQuestionAt = room.raceTime + room.questionEvery;
  for (const player of room.players) player.answer = null;
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
  car.offRoad = !onRoad; // sent to the screens so they can kick up dust
  const boosted = !car.done && room.raceTime < player.boostUntil;
  const tune = TUNING[player.type];
  let top = (onRoad ? MAX_SPEED * tune.topSpeed : OFFROAD_SPEED * tune.offRoad) * player.pace * (1 - tune.cornerLoss * Math.abs(car.steer));
  if (boosted) top *= BOOST_SPEED;
  if (car.done) top *= 0.45;
  car.v = car.v < top ? Math.min(top, car.v + ACCEL * tune.accel * (boosted ? 2.5 : 1) * dt) : Math.max(top, car.v - BRAKE * dt);
  car.a += car.steer * TURN * tune.turn * dt * Math.min(1, car.v / 160);
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
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.001) {
        // Give perfectly coincident cars a deterministic direction to separate.
        dx = players[j].id >= players[i].id ? 1 : -1;
        dy = 0;
        d = 1;
      }
      const overlap = CAR_RADIUS * 2 - d;
      if (overlap <= 0) continue;
      const massA = TUNING[players[i].type].mass;
      const massB = TUNING[players[j].type].mass;
      // The heavier car always wins contact. It keeps its line and speed while
      // the lighter car is moved clear; equal weights share the correction.
      const pushA = (overlap / d) * (massA === massB ? 0.5 : massA < massB ? 1 : 0);
      const pushB = (overlap / d) * (massA === massB ? 0.5 : massB < massA ? 1 : 0);
      a.x -= dx * pushA;
      a.y -= dy * pushA;
      b.x += dx * pushB;
      b.y += dy * pushB;
      if (massA < massB) a.v *= 0.72;
      else if (massB < massA) b.v *= 0.72;
      else { a.v *= 0.88; b.v *= 0.88; }
    }
  }
}

// Road objects: a car throws them into the air. They tumble, come down, bounce, slide, and knock
// into each other. Nothing here is scripted, so every crash comes out differently.
function launch(prop, nx, ny, closing, share) {
  const kind = PROP_KINDS[prop.kind];
  const power = closing * (1.5 + Math.random() * 0.9) * share;
  const swerve = (Math.random() - 0.5) * 1.1; // thrown off to one side or the other
  prop.vx += (nx * Math.cos(swerve) - ny * Math.sin(swerve)) * power;
  prop.vy += (nx * Math.sin(swerve) + ny * Math.cos(swerve)) * power;
  prop.vz = Math.max(prop.vz, closing * (0.7 + Math.random() * 0.7) * kind.lift);
  prop.spin = (Math.random() - 0.5) * 30;
  prop.moving = true;
}

const smash = (room, prop, extra) => broadcast(room, { t: 'break', id: prop.id, x: Math.round(prop.x), y: Math.round(prop.y), vx: Math.round(prop.vx), vy: Math.round(prop.vy), ...extra });

function stepProps(room, dt) {
  const { props } = room;
  for (const player of room.players) {
    const { car } = player;
    if (car.v < 30) continue;
    const carMass = 2 + Math.sqrt(TUNING[player.type].mass); // mass is weight squared; objects use plain weight
    const headingX = Math.cos(car.a);
    const headingY = Math.sin(car.a);
    for (const prop of props) {
      if (prop.gone || prop.z > FLY_OVER) continue; // cars drive under whatever is in the air
      const kind = PROP_KINDS[prop.kind];
      const reach = CAR_BUMPER + kind.radius;
      const dx = prop.x - car.x;
      const dy = prop.y - car.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.hypot(dx, dy);
      if (d >= reach) continue;
      const nx = d ? dx / d : headingX;
      const ny = d ? dy / d : headingY;
      prop.x = car.x + nx * (reach + 0.5);
      prop.y = car.y + ny * (reach + 0.5);
      const closing = (headingX * car.v - prop.vx) * nx + (headingY * car.v - prop.vy) * ny;
      if (closing <= 0) continue;
      // The car keeps all its speed. Its weight only decides how far things fly.
      launch(prop, nx, ny, closing, carMass / (carMass + kind.mass));
      if (kind.breaks && closing > SMASH_SPEED && Math.random() < 0.45) {
        prop.gone = true;
        smash(room, prop);
      } else if (prop.kind === 'dummy' && closing > SMASH_SPEED) {
        smash(room, prop, { limb: true }); // a dummy hit this hard loses an arm, a leg or its head
      }
    }
  }
  for (const prop of props) {
    if (prop.gone || !prop.moving) continue;
    const kind = PROP_KINDS[prop.kind];
    prop.x = clamp(prop.x + prop.vx * dt, 20, WORLD.width - 20);
    prop.y = clamp(prop.y + prop.vy * dt, 20, WORLD.height - 20);
    prop.a += prop.spin * dt;
    if (prop.z > 0 || prop.vz > 0) {
      prop.vz -= GRAVITY * dt;
      prop.z += prop.vz * dt;
      if (prop.z <= 0) { // it has come down
        prop.z = 0;
        if (kind.breaks && prop.vz < -SMASH_LANDING) {
          prop.gone = true;
          smash(room, prop);
          continue;
        }
        prop.vz = prop.vz < -150 ? -prop.vz * kind.bounce : 0;
        prop.vx *= 0.8;
        prop.vy *= 0.8;
      }
    }
    // In the air almost nothing slows it down; on the ground it scrapes to a stop.
    const drag = Math.exp(-(prop.z > 0 ? 0.25 : kind.friction) * dt);
    prop.vx *= drag;
    prop.vy *= drag;
    prop.spin *= Math.exp(-(prop.z > 0 ? 0.3 : kind.friction) * dt);
    if (prop.z > FLY_OVER) continue; // too high to hit anything
    for (const other of props) {
      if (other === prop || other.gone || other.z > FLY_OVER) continue;
      const otherKind = PROP_KINDS[other.kind];
      const reach = kind.radius + otherKind.radius;
      const dx = other.x - prop.x;
      const dy = other.y - prop.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d >= reach) continue;
      const nx = dx / d;
      const ny = dy / d;
      const total = kind.mass + otherKind.mass;
      prop.x -= nx * (reach - d) * (otherKind.mass / total);
      prop.y -= ny * (reach - d) * (otherKind.mass / total);
      other.x += nx * (reach - d) * (kind.mass / total);
      other.y += ny * (reach - d) * (kind.mass / total);
      const closing = (prop.vx - other.vx) * nx + (prop.vy - other.vy) * ny;
      if (closing <= 0) continue;
      const impulse = (1.8 * closing) / (1 / kind.mass + 1 / otherKind.mass); // a bouncy hit
      prop.vx -= (impulse / kind.mass) * nx;
      prop.vy -= (impulse / kind.mass) * ny;
      other.vx += (impulse / otherKind.mass) * nx;
      other.vy += (impulse / otherKind.mass) * ny;
      other.spin += (Math.random() - 0.5) * 16;
      if (closing > 110) other.vz = Math.max(other.vz, closing * 0.4 * otherKind.lift); // it hops into the air too
      other.moving = true;
    }
    if (prop.z === 0 && prop.vz === 0 && Math.hypot(prop.vx, prop.vy) < 8) {
      Object.assign(prop, { vx: 0, vy: 0, spin: 0, moving: false, settled: true });
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

function finishRace(room) {
  const order = ranked(room);
  room.phase = 'results';
  room.question = null;
  room.reveal = null;
  room.results = order.map(({ id, name, color, type, bot, car, correct }, index) => ({
    id, name, color, type, bot, correct, place: index + 1, time: car.done ? Math.round(car.finishTime) : null,
  }));
  // The real winner knows the most answers. People come before bots; a tie goes to the faster
  // car. Nobody wins it with zero right answers.
  const people = room.results.filter((result) => !result.bot);
  const quiz = [...(people.length ? people : room.results)].sort((a, b) => b.correct - a.correct || a.place - b.place);
  room.summary = { green: room.green, questions: room.questionCount, realWinner: quiz[0]?.correct > 0 ? quiz[0].id : null };
  broadcast(room, snapshotMessage(room));
  sendState(room);
}

function stepRoom(room, now) {
  if (room.phase === 'countdown') {
    if (now >= room.startAt) {
      room.phase = 'race';
      sendState(room);
    } else if (room.tick++ % 12 === 0) {
      broadcast(room, snapshotMessage(room));
    }
    return;
  }
  if (room.phase === 'question-countdown') {
    if (now >= room.question.readyAt) {
      room.phase = 'question';
      sendState(room);
    }
    return;
  }
  if (room.phase === 'question') return stepQuestion(room, now);
  if (room.phase === 'reveal') {
    if (now >= room.reveal.until) resumeRace(room);
    return;
  }
  if (room.phase !== 'race') return;

  room.raceTime += TICK * 1000; // driving time only: it stands still during questions
  for (const player of room.players) stepCar(room, player, TICK);
  pushApart(room.players);
  stepProps(room, TICK);
  ranked(room).forEach((player, index) => {
    player.car.place = index + 1;
  });
  if (room.tick++ % 2 === 0) {
    // Only the road objects that are moving, or have just stopped, need to be sent.
    const moved = room.props.filter((prop) => !prop.gone && (prop.moving || prop.settled));
    broadcast(room, snapshotMessage(room, moved));
    for (const prop of moved) prop.settled = false;
  }

  const over = room.players.every((player) => player.car.done)
    || (room.firstFinish !== null && room.raceTime - room.firstFinish > FINISH_GRACE_MS)
    || room.raceTime > MAX_RACE_MS;
  if (over) finishRace(room);
  else if (room.firstFinish === null && room.raceTime >= room.nextQuestionAt && QUESTIONS.length) askQuestion(room, now);
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
    const before = room.players.length;
    if (!RACING.has(room.phase)) room.players = room.players.filter((player) => player.bot || player.connected || now - player.leftAt < 20000);
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
    // A different world from last time, so two tracks in a row never look the same.
    const worlds = WORLD_IDS.filter((id) => id !== room.lastWorld);
    room.lastWorld = worlds[crypto.randomInt(worlds.length)];
    const built = buildTrack(message.points, crypto.randomInt(1, 1e9), room.lastWorld);
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
    Object.assign(room, { phase: 'draw', track: null, results: null, summary: null, green: 0 });
    sendState(room);
  },
  // The host did not like the look: move on to the next world, same track.
  world(room) {
    if (room.phase !== 'lobby') return;
    room.lastWorld = WORLD_IDS[(WORLD_IDS.indexOf(room.track.world) + 1) % WORLD_IDS.length];
    room.track.world = room.lastWorld;
    sendTrack(room);
    broadcast(room, propsMessage(room));
  },
  laps(room, message) {
    const laps = Number(message.laps);
    room.laps = clamp(Number.isFinite(laps) ? Math.round(laps) : 2, 1, 5);
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
    // A question every 20 seconds of driving, or more often in a short race, so that every race
    // has enough questions for the map to become fully clean.
    const raceMs = ((room.laps * room.track.length) / (MAX_SPEED * 0.88)) * 1000;
    const questionEvery = clamp(raceMs / (MIN_QUESTIONS + 0.5), QUESTION_FASTEST_MS, QUESTION_EVERY_MS);
    Object.assign(room, {
      phase: 'countdown', startAt: performance.now() + COUNTDOWN_MS, results: null, summary: null, tick: 0,
      questionEvery, nextQuestionAt: questionEvery, expectedQuestions: Math.max(3, Math.floor(raceMs / questionEvery)),
    });
    sendState(room);
  },
  again(room) {
    if (room.phase !== 'results') return;
    room.phase = 'lobby';
    room.results = null;
    room.summary = null;
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
  if (room.track) send(socket, propsMessage(room));
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
    if (RACING.has(room.phase)) {
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
  if (room.track) send(socket, propsMessage(room));
  playersChanged(room);
  if (room.track) send(socket, snapshotMessage(room));
}

function onPlayer(room, player, message) {
  if (message.t === 'input') {
    player.steer = clamp(Number(message.steer) || 0, -1, 1);
  } else if (message.t === 'car' && !RACING.has(room.phase)) {
    player.type = mod(Math.round(Number(message.type)) || 0, 4);
    sendState(room);
  } else if (message.t === 'answer' && room.phase === 'question' && player.answer === null && performance.now() >= room.question.askedAt + ANSWER_LOCK_MS) {
    const choice = Number(message.choice);
    if (![0, 1, 2, 3].includes(choice)) return;
    player.answer = choice;
    sendState(room);
  }
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
      onPlayer(room, player, message);
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
  console.log(`Race game running with ${QUESTIONS.length} questions. Open the big screen at http://localhost:${PORT}/host`);
  for (const url of lanUrls()) console.log(`Phones on the same Wi-Fi can reach it at ${url}`);
});
