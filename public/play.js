// Phone: join with a code, then steer with two buttons while watching a close-up of your car.
import { prepareTrack, WORLD } from '/shared/track.js';
import { carIcon, connect, createSnapshots, drawCar, loadCars, ordinal, renderMap } from '/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const banner = $('banner');

const FIRST = ['Speedy', 'Sleepy', 'Turbo', 'Wobbly', 'Lucky', 'Zippy', 'Grumpy', 'Sunny', 'Rusty', 'Funky'];
const SECOND = ['Otter', 'Panda', 'Llama', 'Gecko', 'Moose', 'Koala', 'Robin', 'Tiger', 'Whale', 'Bison'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

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
let map = null;
let sheet = null;
let steer = 0;
let countdownEnd = 0;
let goUntil = 0;
let retryTimer = 0;
const held = { left: false, right: false };
const snapshots = createSnapshots();

$('codeInput').value = roomInUrl;
$('nameInput').value = store.get('localStorage', 'race-name') || `${pick(FIRST)} ${pick(SECOND)}`;

// ---------- Screens ----------

function showScreen() {
  const phase = state?.phase;
  let screen = 'join';
  // Someone who joined after the race has no result to show, so they wait in the lobby.
  const raced = state?.results?.some((entry) => entry.id === me?.id);
  if (me && state) screen = phase === 'results' && raced ? 'results' : phase === 'countdown' || phase === 'race' ? 'race' : 'lobby';
  document.body.dataset.screen = screen;
  if (screen === 'join') return;

  const mine = state.players.find((player) => player.id === me.id);
  if (!mine) return;
  $('hello').textContent = `You are in, ${mine.name}!`;
  $('myCar').replaceChildren(carIcon(mine.color, mine.type, 200));
  $('status').textContent = {
    draw: 'Look at the big screen. The host is drawing the track.',
    results: 'A race just ended. You are in the next one!',
  }[phase] ?? 'The track is ready. The race starts soon!';

  if (screen === 'results') {
    const result = state.results.find((entry) => entry.id === me.id);
    $('myPlace').textContent = result ? ordinal(result.place) : '';
    $('doneList').replaceChildren(...state.results.map((entry) => {
      const row = document.createElement('li');
      if (entry.id === me.id) row.className = 'me';
      const name = document.createElement('span');
      name.textContent = `${ordinal(entry.place)}  ${entry.name}`;
      row.append(carIcon(entry.color, entry.type, 32), name);
      return row;
    }));
  }
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
  if (!KEYS[event.code] || document.body.dataset.screen !== 'race') return;
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
  if ((screen !== 'race' && screen !== 'results') || !track || !sheet || !me) return;

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
  map ??= renderMap(track, 1);

  // The camera turns with the car, so "left" on the phone is always the car's left.
  const zoom = (height >= width ? Math.max(width / 640, height / 1100) : height / 620) * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#6f6c66';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height * 0.6);
  ctx.rotate(-mine.a - Math.PI / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-mine.x, -mine.y);
  ctx.drawImage(map, 0, 0, WORLD.width, WORLD.height);

  const camera = ctx.getTransform();
  const labels = [];
  for (const player of state.players) {
    const car = cars.get(player.id);
    if (!car || player.id === me.id) continue;
    drawCar(ctx, sheet, player.color, player.type, car.x, car.y, car.a);
    labels.push([player.name, camera.transformPoint(new DOMPoint(car.x, car.y))]);
  }
  const self = state.players.find((player) => player.id === me.id);
  if (self) drawCar(ctx, sheet, self.color, self.type, mine.x, mine.y, mine.a);

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
  else if (mine.done && state.phase === 'race') text = `Finished!<small>${ordinal(mine.place)} place</small>`;
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
      if (state?.phase === 'countdown' && message.phase === 'race') goUntil = performance.now() + 900;
      if (message.phase === 'countdown') countdownEnd = performance.now() + message.countdown;
      if (message.phase === 'draw') track = map = null;
      state = message;
      showScreen();
    } else if (message.t === 'track') {
      track = prepareTrack(message.track);
      map = null;
    } else if (message.t === 's') {
      snapshots.push(message);
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
requestAnimationFrame(frame);
