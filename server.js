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
import { geminiReady, writeFeedback } from './gemini.js';
import { sensitiveTopic } from './ai-policy.js';
import { loadMemory, recall, remember } from './memory.js';
import { buildProps } from './shared/props.js';
import { buildTrack, gridSlot, prepareTrack, MAX_PLAYERS, WORLD_IDS } from './shared/track.js';
import { clip, speak, voiceReady } from './voice.js';
import { makeBank, noBank } from './server/question-bank.js';
import { createQuestionLifecycle, plainNote } from './server/question-lifecycle.js';
import { createRacePhysics, MAX_SPEED } from './server/race-physics.js';
import { createRoomState } from './server/room-state.js';
import { createQuestionService } from './server/question-service.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(ROOT, '.env')); // where the Gemini key lives; fine if the file is not there
} catch { /* no .env: the game runs on its backup questions */ }
const PORT = Number(process.env.PORT) || 3000;

const TICK = 1 / 60;
const COUNTDOWN_MS = 3500;
const FINISH_GRACE_MS = 30000; // time the others get after the winner finishes
const MAX_RACE_MS = 10 * 60 * 1000;

const QUESTION_EVERY_MS = 20000; // of driving time; the clock stops during a question
const QUESTION_FASTEST_MS = 10000; // short races ask more often, down to this
const MIN_QUESTIONS = 5; // every race should have at least this many
const ANSWER_MS = 12000;
const ANSWER_LOCK_MS = 900; // a steering tap just as the question appears must not count as an answer
const REVEAL_MS = 4500;
const DEFAULT_TOPIC = 'Random';
const LEVEL_NAMES = [null, 'Easy', 'Medium', 'Hard'];

const HEARTBEAT_MS = 1500;
// How long the lobby waits for Gemini before it lets the teacher add questions manually.
const GEMINI_WAIT_MS = Number(process.env.GEMINI_WAIT_MS) || 25000;
const GEMINI_WAIT_PDF_MS = Number(process.env.GEMINI_WAIT_PDF_MS) || 60000;
const MAX_PDF_BYTES = 12 * 1024 * 1024; // Gemini takes about 20 MB per request, and the file grows by a third on the way
const BOT_NAMES = ['Robo Rita', 'Tin Tom', 'Bolt', 'Gizmo', 'Sparky', 'Nutty'];
const RACING = new Set(['countdown', 'race', 'question-countdown', 'question', 'reveal']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, n) => ((value % n) + n) % n;

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const PAGES = { '/': '/public/index.html', '/host': '/public/host.html', '/play': '/public/play.html', '/teacher': '/public/teacher.html' };

// The host uploads a PDF and Gemini writes the questions from it. Only someone with the room's
// host key may do this.
async function receivePdf(request, response) {
  const header = (name) => {
    try {
      return decodeURIComponent(String(request.headers[name] ?? ''));
    } catch {
      return '';
    }
  };
  const reply = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(status === 200 ? { ok: true } : { error: message }));
  };
  const room = rooms.get(header('x-room'));
  if (!room || room.hostKey !== header('x-key')) return reply(403, 'This is not your game.');
  if (!geminiReady()) return reply(400, 'There is no Gemini key on the server, so it cannot read a PDF.');
  if (RACING.has(room.phase)) return reply(409, 'Wait for the race to end.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PDF_BYTES) return reply(413, 'That file is too big. The limit is 12 MB.');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return reply(400, 'That is not a PDF file.');
  const name = header('x-name').replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 40) || 'document';
  room.pdf = { topic: `PDF: ${name}`, key: `pdf:${crypto.createHash('sha1').update(data).digest('hex')}`, data };
  room.topic = room.pdf.topic;
  room.letDown = null; // a new upload means: ask Gemini again, and wait for it
  prepareBank(room);
  sendState(room);
  reply(200);
}

function lanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net.address}:${PORT}`);
}

// One line in the server's output for every page a device opens, and for every join. When a
// phone "cannot get in", this shows at once whether it reached this computer at all (if
// nothing is printed, the network is in the way, not the game).
function seen(request, what) {
  const agent = request.headers['user-agent'] ?? '';
  const device = /Android/i.test(agent) ? 'Android' : /iPhone|iPad|iPod/i.test(agent) ? 'iPhone' : 'computer';
  const address = (request.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
  console.log(`${new Date().toLocaleTimeString()}  ${device} at ${address} ${what}`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (Object.hasOwn(PAGES, url.pathname)) seen(request, `opened ${url.pathname}${url.search}`);
  if (url.pathname === '/pdf' && request.method === 'POST') return receivePdf(request, response);
  if (url.pathname.startsWith('/voice/')) {
    const sound = clip(url.pathname.slice(7).replace(/\.mp3$/, ''));
    response.writeHead(sound ? 200 : 404, { 'Content-Type': sound ? 'audio/mpeg' : 'text/plain', 'Cache-Control': 'no-store' });
    response.end(sound ?? 'Not found');
    return;
  }
  if (url.pathname === '/info') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    // PUBLIC_URL is for when the game is reachable at another address (online, or a tunnel):
    // the QR code then points there.
    response.end(JSON.stringify({ lan: lanUrls(), public: process.env.PUBLIC_URL || null }));
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
    track: null, laps: 1, startAt: 0, raceTime: 0, firstFinish: null, results: null, summary: null,
    question: null, reveal: null, questionEvery: QUESTION_EVERY_MS, nextQuestionAt: 0, questionCount: 0, expectedQuestions: 6,
    topic: DEFAULT_TOPIC, bank: noBank(DEFAULT_TOPIC), bankNote: '', writing: false, pending: null, letDown: null,
    // 'solo': each player gets their own question at their own level.
    // 'team': everyone gets the same question, and the level follows the group as a whole.
    mode: 'team', classLevel: 2, classWeak: new Set(), classSeen: new Set(),
    lastWorld: null, props: [], watchers: new Set(), pdf: null, writingSince: 0, tick: 0, lastActive: Date.now(),
    voiceLine: Promise.resolve(),
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

// The full list of questions with the right answers. Only teacher screens get this.
function sendBank(room, socket) {
  const { topic, source, made, questions } = room.bank;
  send(socket, {
    t: 'bank', topic, source, made, writing: room.writing, writingFor: room.writing ? Date.now() - room.writingSince : 0, wanted: room.topic,
    questions: questions.map((q, index) => ({ id: q.id ?? index + 1, question: q.question, choices: q.choices, correct: q.correct, level: q.level, subtopic: q.subtopic })),
  });
  socket.sawBank = room.bank;
  socket.sawWriting = room.writing;
}

const { stateMessage, snapshotMessage, propsMessage } = createRoomState({
  geminiReady, answerMs: ANSWER_MS, answerLockMs: ANSWER_LOCK_MS,
});

function sendState(room) {
  const message = stateMessage(room);
  broadcast(room, message);
  // Teacher screens get the state too, and the questions again whenever they have changed.
  for (const socket of room.watchers) {
    send(socket, message);
    if (socket.sawBank !== room.bank || socket.sawWriting !== room.writing) sendBank(room, socket);
  }
}

const { banks, prepareBank, useBank, writeBank } = createQuestionService({
  racing: RACING, geminiWaitMs: GEMINI_WAIT_MS, geminiWaitPdfMs: GEMINI_WAIT_PDF_MS, sendState,
});

const { askQuestion, stepQuestion, resumeRace, say } = createQuestionLifecycle({
  crypto, clamp, send, sendState, speak, voiceReady,
});

function editBank(room, message) {
  if (RACING.has(room.phase) || !message.question) return;
  const data = message.question;
  const choices = Array.isArray(data.choices) ? data.choices.map((choice) => String(choice ?? '').trim()).slice(0, 4) : [];
  const question = String(data.question ?? '').trim().slice(0, 300);
  const correct = Number(data.correct);
  const level = clamp(Math.round(Number(data.level) || 2), 1, 3);
  if (!question || choices.length !== 4 || choices.some((choice) => !choice) || ![0, 1, 2, 3].includes(correct)) return;
  const questions = room.bank.questions.map((item, index) => ({ ...item, id: item.id ?? index + 1 }));
  const index = message.action === 'add' ? -1 : questions.findIndex((item) => String(item.id) === String(data.id));
  const updated = { id: index >= 0 ? questions[index].id : crypto.randomUUID(), question, choices, correct, level, subtopic: String(data.subtopic ?? 'General').trim().slice(0, 80) || 'General' };
  if (message.action === 'remove') {
    if (index < 0 || questions.length <= 1) return;
    questions.splice(index, 1);
  } else if (index >= 0) questions[index] = updated;
  else questions.unshift(updated);
  // Questions the teacher adds become this room's own set, so they are kept across replays.
  const own = room.bank.source === 'empty' || room.bank.source === 'teacher';
  useBank(room, makeBank(own ? room.topic : room.bank.topic, own ? 'teacher' : room.bank.source, questions, room.bank.made));
  room.bankNote = ''; // the note about having no questions is no longer true
  for (const socket of room.watchers) sendBank(room, socket);
  sendState(room);
}
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
    // Someone who has played this topic before starts on the level they reached, and the
    // subtopics they got wrong come back first. Everyone else starts on medium.
    // In team mode everyone shares one level, so nobody brings their own.
    player.past = player.device ? recall(player.device, room.bank.topic) : null;
    const before = room.mode === 'team' ? null : player.past?.here;
    Object.assign(player, {
      steer: 0, correct: 0, score: 0, answer: null, answerAt: 0, q: null, botAnswer: null, boostUntil: 0,
      level: before?.level ?? 2, history: [], weak: new Set(before?.weak ?? []),
    });
    player.car = {
      x: spot.x, y: spot.y, a: spot.angle, v: 0, steer: 0,
      index: spot.index, progress: -spot.back, lap: 1, place: slot + 1,
      lost: 0, wrong: 0, done: false, finishTime: null,
    };
  });
  Object.assign(room, {
    raceTime: 0, question: null, reveal: null, questionCount: 0, firstFinish: null,
    classLevel: 2, classWeak: new Set(),
  });
  // Everything on the road is stood back up for the new race.
  room.props = buildProps(room.track).map((prop) => ({ ...prop, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, gone: false, moving: false, settled: false }));
  broadcast(room, propsMessage(room));
  broadcast(room, snapshotMessage(room));
}

const { stepCar, pushApart, stepProps } = createRacePhysics({ broadcast });

function addPlayer(room, { name, bot = false, socket = null, device = null }) {
  const used = new Set(room.players.map((player) => player.color));
  const color = [0, 1, 2, 3, 4, 5].find((index) => !used.has(index));
  const player = {
    id: room.nextId++, key: token(), name, color, type: crypto.randomInt(4), bot, socket,
    connected: !bot && !!socket, leftAt: null, steer: 0, car: null,
    correct: 0, score: 0, answer: null, answerAt: 0, q: null, botAnswer: null, boostUntil: 0,
    level: 2, history: [], weak: new Set(), seen: new Set(), // everyone starts on medium
    device, past: null, // what is remembered about this player from earlier races
    pace: bot ? 0.84 + Math.random() * 0.1 : 1, lane: (Math.random() - 0.5) * 90,
  };
  room.players.push(player);
  return player;
}

function playersChanged(room) {
  if (room.phase === 'lobby') placeOnGrid(room);
  sendState(room);
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
  room.results = order.map(({ id, name, color, type, bot, car, correct, score, level, history }, index) => ({
    id, name, color, type, bot, correct, score, level, place: index + 1, time: car.done ? Math.round(car.finishTime) : null,
    note: bot ? '' : plainNote(history),
  }));
  // The real winner knows the most answers. People come before bots; a tie goes to the faster
  // car. Nobody wins it with zero right answers.
  const people = room.results.filter((result) => !result.bot);
  const quiz = [...(people.length ? people : room.results)].sort((a, b) => b.correct - a.correct || a.place - b.place);
  room.summary = { questions: room.questionCount, realWinner: quiz[0]?.correct > 0 ? quiz[0].id : null, topic: room.bank.topic };
  broadcast(room, snapshotMessage(room));
  sendState(room);

  // Remember this race for every person who answered, so their next race can build on it.
  const at = Date.now();
  for (const player of order) {
    if (player.bot || !player.device || !player.history.length) continue;
    const score = new Map();
    for (const { subtopic, right } of player.history) score.set(subtopic, (score.get(subtopic) ?? 0) + (right ? 1 : -1));
    remember({
      student: player.device, name: player.name, topic: room.bank.topic, asked: player.history.length, right: player.correct,
      // In team mode player.level is the level of the whole group. That says nothing about
      // this player, so they keep the level they had before.
      level: room.mode === 'team' ? (player.past?.here?.level ?? 2) : player.level,
      weak: [...score].filter(([, points]) => points < 0).map(([subtopic]) => subtopic),
      strong: [...score].filter(([, points]) => points > 0).map(([subtopic]) => subtopic),
      at,
    });
  }

  // Ask Gemini for a personal sentence for each person. The results are already on screen;
  // this only improves the notes if the answer arrives while they are still showing.
  const { results } = room;
  const asked = order.filter((player) => !player.bot && player.history.length).map(({ id, name, history, past }) => ({
    id, name, answers: history,
    // What they needed to review last time on this topic, so the note can speak about progress.
    ...(past?.here ? { earlier: { right: past.here.right, asked: past.here.asked, neededReview: past.here.weak } } : {}),
  }));
  if (!geminiReady() || !asked.length) return;
  writeFeedback(room.bank.topic, asked).then((notes) => {
    if (room.results !== results) return;
    for (const result of results) if (notes.has(result.id)) result.note = notes.get(result.id);
    sendState(room);
  }).catch((error) => console.log(`Gemini could not write the notes: ${error.message}`));
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
  // A safety net: a question never lasts longer than its clock, whatever else goes wrong.
  if (room.question && now > room.question.endsAt + REVEAL_MS + 3000) return resumeRace(room);
  if (room.phase === 'question-countdown') {
    if (now >= room.question.readyAt) {
      room.phase = 'question';
      sendState(room);
      if (room.mode === 'team' && room.players[0]?.q) say(room, room.players[0].q.question);
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
  const order = ranked(room);
  order.forEach((player, index) => {
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
  else if (room.firstFinish === null && room.raceTime >= room.nextQuestionAt) askQuestion(room, now);
}

let last = performance.now();
let owed = 0;
setInterval(() => {
  const now = performance.now();
  owed = Math.min(owed + (now - last) / 1000, 0.1);
  last = now;
  while (owed >= TICK) {
    owed -= TICK;
    for (const room of rooms.values()) {
      try {
        stepRoom(room, now);
      } catch (error) {
        rescue(room, error);
      }
    }
  }
}, 1000 / 60);

// A mistake in one room must never stop the server or leave a race stuck. Say what happened
// in the log, and get the room moving again.
function rescue(room, error) {
  console.error(`Room ${room.code} hit an error in "${room.phase}":`, error);
  try {
    if (room.phase === 'question-countdown' || room.phase === 'question' || room.phase === 'reveal') resumeRace(room);
    else if (RACING.has(room.phase)) finishRace(room);
  } catch (second) {
    console.error(`Room ${room.code} could not be rescued and was closed:`, second);
    rooms.delete(room.code);
  }
}
process.on('uncaughtException', (error) => console.error('Unexpected error (the server keeps running):', error));
process.on('unhandledRejection', (error) => console.error('Unexpected error (the server keeps running):', error));

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
    prepareBank(room);
    sendTrack(room);
    placeOnGrid(room);
    sendState(room);
  },
  // What the questions are about. Gemini writes a new set for any topic the host types.
  topic(room, message) {
    if (RACING.has(room.phase)) return;
    // No colon (a topic that starts with "PDF: " means an uploaded file) and no quotes or angle brackets.
    const topic = String(message.topic ?? '').replace(/[^\p{L}\p{N} ,.'&()+#\/%=^?!-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || DEFAULT_TOPIC;
    if (sensitiveTopic(topic)) {
      const text = 'That topic may not be safe for classroom use. Please retry with a different topic.';
      send(room.host, { t: 'topicWarning', topic, text });
      for (const socket of room.watchers) send(socket, { t: 'topicWarning', topic, text });
      room.bankNote = text;
      sendState(room);
      return;
    }
    room.topic = topic;
    room.pdf = null;
    room.letDown = null; // Set means: ask Gemini again, and wait for it
    prepareBank(room);
    sendState(room);
  },
  redraw(room) {
    if (room.phase !== 'lobby' && room.phase !== 'results') return;
    Object.assign(room, { phase: 'draw', track: null, results: null, summary: null });
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
  mode(room, message) {
    if (room.phase !== 'draw' && room.phase !== 'lobby') return;
    room.mode = message.mode === 'team' ? 'team' : 'solo';
    if (room.phase === 'lobby') placeOnGrid(room); // starting levels depend on the mode
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
    if (room.phase !== 'lobby' || !room.players.length || room.writing || !room.bank.questions.length) return; // questions must be generated or added by the teacher
    prepareBank(room); // picks up Gemini's questions if they arrived since the lobby opened
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
  // The host ends a race early, for example when the players have walked away.
  end(room) {
    if (!RACING.has(room.phase)) return;
    if (room.phase === 'question-countdown' || room.phase === 'question') room.questionCount--; // this one was never marked
    finishRace(room);
  },
  again(room) {
    if (room.phase !== 'results') return;
    room.phase = 'lobby';
    room.results = null;
    room.summary = null;
    prepareBank(room);
    placeOnGrid(room);
    sendState(room);
  },
};

function onHost(socket, message) {
  let room = rooms.get(String(message.code ?? ''));
  if (!room || room.hostKey !== message.key) {
    room = createRoom();
    prepareBank(room); // so the first screen already says whether the questions are ready
  }
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

// The teacher's screen: it shows the questions and the answers, so it needs the host key.
function onWatch(socket, message) {
  const room = rooms.get(String(message.code ?? ''));
  if (!room || room.hostKey !== message.key) {
    send(socket, { t: 'error', reason: 'This screen only works from the host\'s own link.' });
    return;
  }
  socket.room = room;
  socket.isWatcher = true;
  room.watchers.add(socket);
  send(socket, stateMessage(room));
  sendBank(room, socket);
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
    // The phone's own id, so this player is recognised in later races. Anything odd is ignored.
    const device = typeof message.device === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(message.device) ? message.device : null;
    player = addPlayer(room, { name: cleanName(message.name), socket, device });
  }
  if (player.socket && player.socket !== socket) player.socket.close();
  player.socket = socket;
  player.connected = true;
  socket.room = room;
  socket.player = player;
  send(socket, { t: 'joined', id: player.id, key: player.key, code: room.code });
  if (socket.request) seen(socket.request, `joined game ${room.code} as "${player.name}"`);
  if (room.track) sendTrack(room, socket);
  if (room.track) send(socket, propsMessage(room));
  playersChanged(room);
  if (room.track) send(socket, snapshotMessage(room));
}

function onPlayer(room, player, message) {
  if (message.t === 'input') {
    player.steer = clamp(Number(message.steer) || 0, -1, 1);
  } else if (message.t === 'name' && !RACING.has(room.phase)) {
    player.name = cleanName(message.name);
    sendState(room);
  } else if (message.t === 'car' && !RACING.has(room.phase)) {
    player.type = mod(Math.round(Number(message.type)) || 0, 4);
    sendState(room);
  } else if (message.t === 'answer' && room.phase === 'question' && player.answer === null && performance.now() >= room.question.askedAt + ANSWER_LOCK_MS) {
    const choice = Number(message.choice);
    if (![0, 1, 2, 3].includes(choice)) return;
    player.answer = choice;
    player.answerAt = performance.now();
    sendState(room);
  }
}

// A phone that "cannot get in" either never reaches this computer, or reaches it and asks in a
// way the server cannot read (most often its browser tries https). These two lines in the
// server's output tell the three cases apart.
const knocked = new Map(); // address -> when it was last printed
const addressOf = (socket) => (socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
server.on('connection', (socket) => {
  const address = addressOf(socket);
  if (address === '::1' || address === '127.0.0.1') return;
  if (Date.now() - (knocked.get(address) ?? 0) < 60000) return;
  knocked.set(address, Date.now());
  console.log(`${new Date().toLocaleTimeString()}  a device at ${address} connected`);
});
server.on('clientError', (error, socket) => {
  console.log(`${new Date().toLocaleTimeString()}  the device at ${addressOf(socket)} sent something that is not plain http (${error.code}). Its browser is probably trying https: type http:// in front of the address.`);
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (socket, request) => {
  socket.alive = true;
  socket.request = request;
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
    if (message.t === 'watch') return onWatch(socket, message);
    if (message.t === 'join') return onJoin(socket, message);
    const { room, player } = socket;
    if (!room) return;
    if (socket.isWatcher) {
      if (message.t === 'topic') hostActions.topic(room, message); // the teacher may set the topic from there too
      else if (['addQuestion', 'editQuestion', 'removeQuestion'].includes(message.t)) editBank(room, { action: message.t === 'addQuestion' ? 'add' : message.t === 'removeQuestion' ? 'remove' : 'edit', question: message.question });
    } else if (socket.isHost) {
      if (Object.hasOwn(hostActions, message.t)) hostActions[message.t](room, message);
    } else if (player) {
      onPlayer(room, player, message);
    }
  });
  socket.on('close', () => {
    const { room, player } = socket;
    if (!room) return;
    room.watchers.delete(socket);
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

// A small message every second and a half. A screen that hears nothing for a few seconds knows
// its connection has died (phones often switch Wi-Fi without noticing) and connects again.
setInterval(() => {
  for (const socket of wss.clients) if (socket.readyState === 1) socket.send('{"t":"hb"}');
}, HEARTBEAT_MS);

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

loadMemory().then(({ store, players }) => {
  console.log(store === 'backboard'
    ? `Backboard key found: player memory is kept in Backboard (${players} players remembered).`
    : `Player memory is kept in data/memory.json (${players} players remembered). Add a Backboard key to keep it online.`);
});

// Have the default questions ready before anyone joins, so the first race does not wait.
if (geminiReady()) {
  writeBank(DEFAULT_TOPIC.toLowerCase(), DEFAULT_TOPIC, null)
    .then(() => console.log(`Gemini wrote ${banks.get(DEFAULT_TOPIC.toLowerCase()).count} questions about "${DEFAULT_TOPIC}".`))
    .catch((error) => console.log(`Gemini could not write the first questions: ${error.message}`));
}

server.listen(PORT, () => {
  console.log(`Race game running. Open the big screen at http://localhost:${PORT}/host`);
  console.log(geminiReady() ? 'Gemini key found: questions will be written by Gemini.' : 'No Gemini key in .env: add questions from the teacher screen.');
  console.log(voiceReady() ? 'ElevenLabs key found: the commentator speaks with an ElevenLabs voice.' : 'No ElevenLabs key in .env: the commentator uses the browser\'s own voice.');
  for (const url of lanUrls()) console.log(`Phones on the same Wi-Fi can reach it at ${url}`);
});
