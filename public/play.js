// Phone: join with a code, steer with two buttons while watching a close-up of your car, and
// answer the questions that stop the race.
import { CAR_TYPES, STAT_LABELS } from '/shared/cars.js';
import { prepareTrack } from '/shared/track.js';
import { carIcon, connect, createEffects, createLife, createProps, createScene, createSnapshots, createTiles, drawCar, loadCars, ordinal, CAR_LENGTH } from '/render.js';
import { mixColor } from '/worlds.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const banner = $('banner');

const FIRST = ['Speedy', 'Sleepy', 'Turbo', 'Wobbly', 'Lucky', 'Zippy', 'Grumpy', 'Sunny', 'Rusty', 'Funky'];
const SECOND = ['Otter', 'Panda', 'Llama', 'Gecko', 'Moose', 'Koala', 'Robin', 'Tiger', 'Whale', 'Bison'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const RACING = ['countdown', 'race', 'question', 'reveal'];

const store = {
  get(area, key) {
    try {
      return JSON.parse(window[area].getItem(key));
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      window[area].setItem(key, JSON.stringify(value));
    } catch { /* private mode: play without saving */ }
  },
};

const roomInUrl = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);
const saved = store.get('sessionStorage', 'race-player');

let me = saved && (!roomInUrl || saved.code === roomInUrl) ? saved : null; // { id, key, code, name }
let pending = null; // join request waiting for an answer
let state = null;
let track = null;
let tiles = null;
let scene = null;
let life = null; // the moving layer: smoke, birds, river
let lastFrame = 0;
let slowFrames = 0; // rises when frames take too long
let lite = false; // a struggling phone drops the small decorations and keeps the race smooth
let sheet = null;
let steer = 0;
let countdownEnd = 0;
let goUntil = 0;
let questionEnd = 0;
let retryTimer = 0;
let carInfo = null; // shared/cars.json, once it has loaded
let myChoice = null; // what this phone picked for the question on screen
let choiceFor = 0; // the question number that pick belongs to
let answersOpenAt = 0; // answers stay locked for a moment, so a steering tap cannot pick one
let lockTimer = 0;
const held = { left: false, right: false };
const snapshots = createSnapshots();
const effects = createEffects();
const props = createProps(); // crates, cones and so on, standing on the road

$('codeInput').value = roomInUrl;
$('nameInput').value = store.get('localStorage', 'race-name') || `${pick(FIRST)} ${pick(SECOND)}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Screens ----------

function showScreen() {
  const phase = state?.phase;
  let screen = 'join';
  // Someone who joined after the race has no result to show, so they wait in the lobby.
  const raced = state?.results?.some((entry) => entry.id === me?.id);
  if (me && state) screen = phase === 'results' && raced ? 'results' : RACING.includes(phase) ? 'race' : 'lobby';
  document.body.dataset.screen = screen;
  if (screen === 'join') return;

  const mine = state.players.find((player) => player.id === me.id);
  if (!mine) return;
  $('hello').textContent = `You are in, ${mine.name}!`;
  $('myCar').replaceChildren(carIcon(mine.color, mine.type, 170));
  showCarCard(mine.type);
  $('status').textContent = {
    draw: 'Look at the big screen. The host is drawing the track.',
    results: 'A race just ended. You are in the next one!',
  }[phase] ?? 'The track is ready. The race starts soon!';
  $('score').textContent = `✓ ${mine.correct}`;

  showQuiz(mine);
  if (screen === 'results') showResults();
}

// What the chosen car is good and bad at, from the team's car stats.
function showCarCard(type) {
  const car = carInfo?.types[CAR_TYPES[type]];
  $('carCard').hidden = !car;
  if (!car) return;
  $('carName').textContent = `${car.name} · ${car.title}`;
  $('carNote').textContent = car.strength;
  $('carStats').replaceChildren(...Object.entries(STAT_LABELS).flatMap(([key, label]) => {
    const pips = element('dd');
    pips.setAttribute('aria-label', `${car.stats[key]} out of 5`);
    for (let i = 1; i <= 5; i++) pips.append(element('span', i <= car.stats[key] ? 'pip on' : 'pip'));
    return [element('dt', '', label), pips];
  }));
}

function showQuiz(mine) {
  const { question, reveal, phase } = state;
  const asking = phase === 'question' || phase === 'reveal';
  $('quiz').hidden = !asking;
  if (!asking || !question) return;
  if (choiceFor !== question.number) {
    choiceFor = question.number;
    myChoice = null;
    releaseAll();
  }
  const picked = reveal ? mine.answer ?? myChoice : myChoice;
  const locked = !reveal && performance.now() < answersOpenAt;
  $('quizNumber').textContent = `Question ${question.number}`;
  $('quizText').textContent = question.text;
  let note = picked !== null ? 'Answer sent' : locked ? 'Read the question…' : 'Pick one';
  if (reveal) note = picked === null ? 'Too slow!' : picked === reveal.correct ? 'Right! Speed boost' : 'Wrong';
  $('quizNote').textContent = note;
  $('quizNote').className = reveal ? (picked === reveal.correct ? 'good' : 'bad') : '';
  $('quizChoices').replaceChildren(...question.choices.map((choice, index) => {
    const button = element('button', `choice c${index}`);
    button.type = 'button';
    button.disabled = picked !== null || !!reveal || locked;
    if (locked) button.classList.add('locked');
    if (picked === index) button.classList.add('picked');
    if (reveal) button.classList.add(index === reveal.correct ? 'right' : 'dim');
    button.append(element('span', 'letter', 'ABCD'[index]), element('span', 'text', choice));
    // pointerdown, not click: the buttons are rebuilt whenever someone else answers.
    button.addEventListener('pointerdown', () => {
      if (myChoice !== null || state.phase !== 'question' || performance.now() < answersOpenAt) return;
      myChoice = index;
      send({ t: 'answer', choice: index });
      showQuiz(mine);
    });
    return button;
  }));
}

function showResults() {
  const { results, summary } = state;
  const result = results.find((entry) => entry.id === me.id);
  const winner = results.find((entry) => entry.id === summary?.realWinner);
  $('myPlace').textContent = ordinal(result.place);
  $('myScore').textContent = `You got ${result.correct} of ${summary.questions} questions right. The map is ${Math.round(summary.green * 100)}% green.`;
  $('doneWinner').textContent = winner ? (winner.id === me.id ? 'You are the real winner!' : `Real winner: ${winner.name}`) : '';
  $('doneList').replaceChildren(...results.map((entry) => {
    const row = element('li', entry.id === me.id ? 'me' : '');
    row.append(carIcon(entry.color, entry.type, 32), element('span', '', `${ordinal(entry.place)}  ${entry.name}  ✓ ${entry.correct}`));
    return row;
  }));
}

// ---------- Steering ----------

function sendSteer() {
  const next = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  $('left').classList.toggle('down', held.left);
  $('right').classList.toggle('down', held.right);
  if (next === steer) return;
  steer = next;
  send({ t: 'input', steer });
}

function releaseAll() {
  held.left = held.right = false;
  sendSteer();
}

for (const side of ['left', 'right']) {
  const button = $(side);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      button.setPointerCapture(event.pointerId);
    } catch { /* not a real pointer */ }
    held[side] = true;
    sendSteer();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => {
      held[side] = false;
      sendSteer();
    });
  }
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', (event) => {
  if (!KEYS[event.code] || state?.phase !== 'race') return;
  held[KEYS[event.code]] = true;
  sendSteer();
  event.preventDefault();
});
addEventListener('keyup', (event) => {
  if (!KEYS[event.code]) return;
  held[KEYS[event.code]] = false;
  sendSteer();
});
addEventListener('blur', releaseAll);

// ---------- The close-up view ----------

function frame(now) {
  requestAnimationFrame(frame);
  const screen = document.body.dataset.screen;
  if ((screen !== 'race' && screen !== 'results') || !tiles || !sheet || !me) return;

  if (state.phase === 'question') $('quizTimer').style.width = `${Math.max(0, (questionEnd - now) / (state.question.seconds * 1000)) * 100}%`;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const cars = snapshots.sample();
  const mine = cars.get(me.id);
  if (!mine || !width) return;

  // The camera turns with the car, so "left" on the phone is always the car's left.
  const zoom = (height >= width ? Math.max(width / 640, height / 1100) : height / 620) * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = mixColor(scene.theme.ground[0], scene.theme.ground[1], state.green); // shows where a tile is not painted yet
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height * 0.6);
  ctx.rotate(-mine.a - Math.PI / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-mine.x, -mine.y);

  // Work out which part of the world is on screen, plus a margin so the next tiles are ready.
  const camera = ctx.getTransform();
  const toWorld = camera.inverse();
  const corners = [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]].map(([x, y]) => toWorld.transformPoint(new DOMPoint(x, y)));
  const margin = 260;
  const region = {
    x0: Math.min(...corners.map((p) => p.x)) - margin,
    y0: Math.min(...corners.map((p) => p.y)) - margin,
    x1: Math.max(...corners.map((p) => p.x)) + margin,
    y1: Math.max(...corners.map((p) => p.y)) + margin,
  };
  tiles.draw(ctx, state.green, region);

  const racing = state.phase === 'race';
  const pixel = dpr / zoom; // world units per screen pixel
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  slowFrames = slowFrames * 0.97 + (dt > 0.034 ? 0.03 : 0);
  if (slowFrames > 0.6) lite = true;
  life.ground(ctx, state.green, now / 1000, region, pixel, lite);
  effects.update(cars, { dt, now, green: state.green, racing, length: CAR_LENGTH, spray: scene.theme.spray });
  props.draw(ctx, region);
  effects.draw(ctx, now);
  const labels = [];
  for (const player of state.players) {
    const car = cars.get(player.id);
    if (!car || player.id === me.id) continue;
    drawCar(ctx, sheet, player.color, player.type, car.x, car.y, car.a, undefined, car.boost && racing);
    labels.push([player.name, camera.transformPoint(new DOMPoint(car.x, car.y))]);
  }
  const self = state.players.find((player) => player.id === me.id);
  if (self) drawCar(ctx, sheet, self.color, self.type, mine.x, mine.y, mine.a, undefined, mine.boost && racing);
  life.sky(ctx, state.green, now / 1000, region, pixel, lite);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [name, point] of labels) {
    const x = point.x / dpr;
    const y = point.y / dpr - 44;
    const box = ctx.measureText(name).width + 12;
    ctx.fillStyle = 'rgba(23, 25, 28, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x - box / 2, y - 10, box, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#f1efe9';
    ctx.fillText(name, x, y + 1);
  }

  const place = `${ordinal(mine.place)}<small>of ${state.players.length}</small>`;
  if ($('place').innerHTML !== place) $('place').innerHTML = place;
  $('lap').textContent = `Lap ${mine.lap}/${state.laps}`;

  let text = '';
  if (state.phase === 'countdown') text = String(Math.max(1, Math.min(3, Math.ceil((countdownEnd - now) / 1000))));
  else if (now < goUntil) text = 'GO!';
  else if (mine.done && racing) text = `Finished!<small>${ordinal(mine.place)} place</small>`;
  else if (mine.boost && racing) text = '<small>Speed boost!</small>';
  if (banner.innerHTML !== text) banner.innerHTML = text;
}

// ---------- Server ----------

function join(request) {
  pending = request;
  send({ t: 'join', ...request });
}

const send = connect({
  onOpen() {
    if (me) join({ code: me.code, key: me.key, name: me.name });
    else if (pending) join(pending);
  },
  onMessage(message) {
    if (message.t === 'joined') {
      me = { id: message.id, key: message.key, code: message.code, name: pending?.name ?? me?.name };
      pending = null;
      store.set('sessionStorage', 'race-player', me);
      $('joinError').textContent = '';
      steer = 0;
      sendSteer();
      showScreen();
    } else if (message.t === 'error') {
      // A saved seat that no longer exists: go back to the join form.
      me = null;
      store.set('sessionStorage', 'race-player', null);
      $('joinError').textContent = message.reason;
      clearTimeout(retryTimer);
      if (message.retry && pending) retryTimer = setTimeout(() => pending && join(pending), 2000);
      else pending = null;
      showScreen();
    } else if (message.t === 'state') {
      const now = performance.now();
      if (message.phase === 'race' && (state?.phase === 'countdown' || state?.phase === 'reveal')) goUntil = now + 900;
      if (message.phase === 'countdown') countdownEnd = now + message.countdown;
      if (message.phase === 'question') {
        questionEnd = now + message.question.endsIn;
        answersOpenAt = now + message.question.lockedFor;
        clearTimeout(lockTimer);
        if (message.question.lockedFor > 0) lockTimer = setTimeout(showScreen, message.question.lockedFor + 30);
      }
      if (message.phase === 'draw') track = tiles = life = null;
      state = message;
      showScreen();
    } else if (message.t === 'track') {
      track = prepareTrack(message.track);
      scene = createScene(track);
      tiles = createTiles(scene);
      life = createLife(scene);
      props.load(track);
      effects.clear();
    } else if (message.t === 's') {
      snapshots.push(message);
      props.move(message.props);
    } else if (message.t === 'props') {
      props.reset(message.props);
    } else if (message.t === 'break') {
      if (props.smash(message.id)) effects.shatter(message.x, message.y, message.vx, message.vy);
    }
  },
});

$('join').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('nameInput').value.trim();
  store.set('localStorage', 'race-name', name);
  navigator.wakeLock?.request('screen').catch(() => {}); // keep the phone awake where allowed
  join({ code: $('codeInput').value.trim().toUpperCase(), name });
});

$('changeCar').addEventListener('click', () => {
  const mine = state?.players.find((player) => player.id === me?.id);
  if (mine) send({ t: 'car', type: (mine.type + 1) % 4 });
});

loadCars().then((image) => {
  sheet = image;
});
fetch('/shared/cars.json').then((response) => response.json()).then((info) => {
  carInfo = info;
  showScreen();
}).catch(() => { /* the game works without the stats card */ });
requestAnimationFrame(frame);
