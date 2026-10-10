// Big screen: the host draws the track here, and everyone watches the race here.
import { prepareTrack, MAX_PLAYERS, WORLD } from '/shared/track.js';
import { carIcon, connect, createSnapshots, drawCar, formatTime, loadCars, ordinal, renderMap, CAR_LENGTH } from '/render.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const drawCanvas = $('draw');
const gameCanvas = $('game');
const hint = $('hint');
const mainButton = $('main');
const secondButton = $('second');

const HINTS = {
  draw: 'Draw a big loop with your mouse or finger',
  lobby: 'Track ready. Press Start when everyone has joined.',
};
const LABELS = {
  draw: ['Make track', 'Clear'],
  lobby: ['Start race', 'Draw again'],
  results: ['Race again', 'New track'],
};

let state = { phase: 'draw', players: [], laps: 3, results: null };
let track = null;
let map = null;
let sheet = null;
let view = { width: 0, height: 0, scale: 1, dpr: 1 };
let stroke = []; // the drawn line, as fractions of the canvas size
let drawing = false;
let countdownEnd = 0;
let goUntil = 0;
let trackError = '';
let listStamp = 0;
const snapshots = createSnapshots();

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem('race-host')) ?? {};
  } catch {
    return {};
  }
}

// ---------- Layout ----------

function layout() {
  const box = stage.getBoundingClientRect();
  const scale = Math.max(0.05, Math.min((box.width - 40) / WORLD.width, (box.height - 40) / WORLD.height));
  view = { width: Math.floor(WORLD.width * scale), height: Math.floor(WORLD.height * scale), scale, dpr: Math.min(window.devicePixelRatio || 1, 2) };
  for (const canvas of [drawCanvas, gameCanvas]) {
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    canvas.width = view.width * view.dpr;
    canvas.height = view.height * view.dpr;
  }
  map = null; // drawn again at the new size
  paintDrawing();
}

// ---------- Drawing the track ----------

function paintDrawing() {
  const ctx = drawCanvas.getContext('2d');
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < view.width; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, view.height);
  }
  for (let y = 40; y < view.height; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(view.width, y);
  }
  ctx.stroke();
  if (!stroke.length) return;

  const at = ([x, y]) => [x * view.width, y * view.height];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(10, view.width * 0.022);
  ctx.strokeStyle = '#b9ee4f';
  ctx.beginPath();
  ctx.moveTo(...at(stroke[0]));
  for (const point of stroke) ctx.lineTo(...at(point));
  ctx.stroke();
  // The game closes the loop; show how.
  ctx.setLineDash([10, 14]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(185, 238, 79, 0.6)';
  ctx.beginPath();
  ctx.moveTo(...at(stroke.at(-1)));
  ctx.lineTo(...at(stroke[0]));
  ctx.stroke();
  ctx.setLineDash([]);
}

function pointerSpot(event) {
  const box = drawCanvas.getBoundingClientRect();
  return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
}

drawCanvas.addEventListener('pointerdown', (event) => {
  drawing = true;
  trackError = '';
  stroke = [pointerSpot(event)];
  try {
    drawCanvas.setPointerCapture(event.pointerId);
  } catch { /* not a real pointer */ }
  paintDrawing();
  updateUI();
});
drawCanvas.addEventListener('pointermove', (event) => {
  if (!drawing) return;
  const spot = pointerSpot(event);
  const last = stroke.at(-1);
  if (Math.hypot(spot[0] - last[0], spot[1] - last[1]) < 0.004) return;
  stroke.push(spot);
  paintDrawing();
});
for (const type of ['pointerup', 'pointercancel']) {
  drawCanvas.addEventListener(type, () => {
    drawing = false;
    updateUI();
  });
}

// ---------- Side panel ----------

function playerRow(player, { place, info } = {}) {
  const row = document.createElement('li');
  if (!player.bot && !player.connected) row.classList.add('gone');
  if (place) {
    const number = document.createElement('span');
    number.className = 'place';
    number.textContent = place;
    row.append(number);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = player.name;
  const note = document.createElement('span');
  note.className = 'info';
  note.textContent = info ?? (player.bot ? 'bot' : player.connected ? '' : 'left');
  row.append(carIcon(player.color, player.type, 40), name, note);
  return row;
}

function paintPlayers() {
  const racing = state.phase === 'countdown' || state.phase === 'race';
  const cars = snapshots.latest()?.cars;
  let rows;
  if (racing && cars) {
    rows = [...state.players]
      .sort((a, b) => (cars.get(a.id)?.place ?? 9) - (cars.get(b.id)?.place ?? 9))
      .map((player) => {
        const car = cars.get(player.id);
        return playerRow(player, { place: car?.place, info: car?.done ? 'Finished' : `Lap ${car?.lap ?? 1}/${state.laps}` });
      });
  } else {
    rows = state.players.map((player) => playerRow(player));
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Scan the code to join';
      rows.push(empty);
    }
  }
  $('players').replaceChildren(...rows);
  $('listTitle').textContent = racing ? 'Ranking' : `Players (${state.players.length}/${MAX_PLAYERS})`;
}

function paintResults() {
  $('resultList').replaceChildren(...(state.results ?? []).map((result) => {
    const row = document.createElement('li');
    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = ordinal(result.place);
    const name = document.createElement('span');
    name.textContent = result.name;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = result.time === null ? 'Did not finish' : formatTime(result.time);
    row.append(place, carIcon(result.color, result.type, 44), name, time);
    return row;
  }));
}

function updateUI() {
  const { phase } = state;
  const racing = phase === 'countdown' || phase === 'race';
  drawCanvas.hidden = phase !== 'draw';
  gameCanvas.hidden = phase === 'draw';
  hint.hidden = !HINTS[phase];
  hint.textContent = (phase === 'draw' && trackError) || HINTS[phase] || '';
  hint.classList.toggle('error', phase === 'draw' && !!trackError);

  const [mainLabel, secondLabel] = LABELS[phase] ?? [];
  mainButton.hidden = secondButton.hidden = racing;
  mainButton.textContent = mainLabel ?? '';
  secondButton.textContent = secondLabel ?? '';
  mainButton.disabled = (phase === 'draw' && stroke.length < 8) || (phase === 'lobby' && !state.players.length);
  $('lapsRow').hidden = phase !== 'lobby';
  $('laps').textContent = state.laps;
  $('botRow').hidden = phase !== 'draw' && phase !== 'lobby';
  $('addBot').disabled = state.players.length >= MAX_PLAYERS;
  $('removeBot').disabled = !state.players.some((player) => player.bot);
  $('clock').hidden = !racing;
  $('results').hidden = phase !== 'results';
  if (phase === 'results') paintResults();
  paintPlayers();
}

// ---------- The race view ----------

function frame(now) {
  requestAnimationFrame(frame);
  const { phase } = state;

  const count = $('count');
  if (phase === 'countdown') {
    count.hidden = false;
    count.textContent = Math.max(1, Math.min(3, Math.ceil((countdownEnd - now) / 1000)));
  } else if (now < goUntil) {
    count.hidden = false;
    count.textContent = 'GO!';
  } else {
    count.hidden = true;
  }

  if (phase === 'draw' || !track || !sheet || !view.width) return;
  if (phase === 'race') {
    $('clock').textContent = formatTime(snapshots.latest()?.time ?? 0);
    if (now - listStamp > 250) {
      listStamp = now;
      paintPlayers();
    }
  }

  map ??= renderMap(track, view.scale * view.dpr);
  const ctx = gameCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(map, 0, 0, gameCanvas.width, gameCanvas.height);

  const cars = snapshots.sample();
  const shown = state.players.filter((player) => cars.has(player.id)).sort((a, b) => cars.get(b.id).place - cars.get(a.id).place);
  const zoom = view.scale * view.dpr;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  // Cars are drawn larger than life so they can be seen from the back of the room.
  for (const player of shown) {
    const car = cars.get(player.id);
    drawCar(ctx, sheet, player.color, player.type, car.x, car.y, car.a, CAR_LENGTH * 1.45);
  }
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const player of shown) {
    const car = cars.get(player.id);
    const x = car.x * view.scale;
    const y = car.y * view.scale - 26;
    const width = ctx.measureText(player.name).width + 12;
    ctx.fillStyle = 'rgba(23, 25, 28, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 10, width, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#f1efe9';
    ctx.fillText(player.name, x, y + 1);
  }
}

// ---------- Server ----------

async function showJoin(code) {
  let base = location.origin;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    // Phones cannot open "localhost", so show this computer's Wi-Fi address instead.
    try {
      const info = await (await fetch('/info')).json();
      if (info.lan[0]) base = info.lan[0];
    } catch { /* keep the origin */ }
  }
  const url = `${base}/play?room=${code}`;
  $('qr').src = `/qr.svg?d=${encodeURIComponent(url)}`;
  $('joinUrl').textContent = `${base.replace(/^https?:\/\//, '')}/play`;
  $('code').textContent = code;
}

const send = connect({
  onOpen: () => send({ t: 'host', ...loadSaved() }),
  onMessage(message) {
    if (message.t === 'hosted') {
      try {
        sessionStorage.setItem('race-host', JSON.stringify({ code: message.code, key: message.key }));
      } catch { /* the room still works, it just will not survive a reload */ }
      showJoin(message.code);
    } else if (message.t === 'state') {
      if (state.phase === 'countdown' && message.phase === 'race') goUntil = performance.now() + 900;
      if (message.phase === 'countdown') countdownEnd = performance.now() + message.countdown;
      if (message.phase === 'draw') track = map = null;
      state = message;
      updateUI();
    } else if (message.t === 'track') {
      track = prepareTrack(message.track);
      map = null;
      trackError = '';
    } else if (message.t === 's') {
      snapshots.push(message);
    } else if (message.t === 'trackError') {
      trackError = message.reason;
      updateUI();
    }
  },
});

mainButton.addEventListener('click', () => {
  if (state.phase === 'draw') send({ t: 'track', points: stroke.map(([x, y]) => [x * WORLD.width, y * WORLD.height]) });
  else if (state.phase === 'lobby') send({ t: 'start' });
  else if (state.phase === 'results') send({ t: 'again' });
});
secondButton.addEventListener('click', () => {
  if (state.phase === 'draw') {
    stroke = [];
    trackError = '';
    paintDrawing();
    updateUI();
  } else {
    send({ t: 'redraw' });
  }
});
$('lapsDown').addEventListener('click', () => send({ t: 'laps', laps: Math.max(1, state.laps - 1) }));
$('lapsUp').addEventListener('click', () => send({ t: 'laps', laps: Math.min(5, state.laps + 1) }));
$('addBot').addEventListener('click', () => send({ t: 'bot' }));
$('removeBot').addEventListener('click', () => send({ t: 'bot', remove: true }));

new ResizeObserver(layout).observe(stage);
layout();
updateUI();
loadCars().then((image) => {
  sheet = image;
});
requestAnimationFrame(frame);
