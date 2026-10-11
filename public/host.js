// Big screen: the host draws the track here, and everyone watches the race here.
import { prepareTrack, MAX_PLAYERS, WORLD } from '/shared/track.js';
import { createCommentator } from '/commentator.js';
import { carIcon, connect, createEffects, createLife, createProps, createScene, createSnapshots, drawCar, formatTime, loadCars, ordinal, renderMap, CAR_LENGTH, WORLDS } from '/render.js';

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
const RACING = ['countdown', 'race', 'question-countdown', 'question', 'reveal'];
const REVEAL_HOLD = 2200; // how long the answer stays up before the map is shown changing
const MAP_FADE = 1500;

let state = { phase: 'draw', players: [], laps: 1, mode: 'team', results: null };
let track = null;
let scene = null;
let life = null; // the moving layer: smoke, birds, river
let lastFrame = 0;
let map = null;
let oldMap = null; // the map before the last change of green, while it fades out
let shownGreen = 0;
let fadeStart = 0;
let sheet = null;
let view = { width: 0, height: 0, scale: 1, dpr: 1 };
let stroke = []; // the drawn line, as fractions of the canvas size
let drawing = false;
let countdownEnd = 0;
let goUntil = 0;
let questionEnd = 0;
let revealStart = 0;
let trackError = '';
let uploading = false; // a PDF is on its way to the server
let uploadError = '';
let listStamp = 0;
const snapshots = createSnapshots(150); // patient: Wi-Fi often holds updates back for a tenth of a second
const effects = createEffects();
const props = createProps(); // crates, cones and so on, standing on the road
const commentator = createCommentator($('caption'));
const WHOLE_MAP = { x0: 0, y0: 0, x1: WORLD.width, y1: WORLD.height };

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
  const scale = Math.max(0.02, Math.min((box.width - 40) / WORLD.width, (box.height - 40) / WORLD.height));
  view = { width: Math.floor(WORLD.width * scale), height: Math.floor(WORLD.height * scale), scale, dpr: Math.min(window.devicePixelRatio || 1, 2) };
  for (const canvas of [drawCanvas, gameCanvas]) {
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    canvas.width = view.width * view.dpr;
    canvas.height = view.height * view.dpr;
  }
  map = oldMap = null; // drawn again at the new size
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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function playerRow(player, { place, info } = {}) {
  const row = element('li');
  if (!player.bot && !player.connected) row.classList.add('gone');
  if (place) row.append(element('span', 'place', place));
  row.append(carIcon(player.color, player.type, 40), element('span', 'name', player.name));
  row.append(element('span', 'info', info ?? (player.bot ? 'bot' : player.connected ? '' : 'left')));
  return row;
}

function paintPlayers() {
  const racing = RACING.includes(state.phase);
  const cars = snapshots.latest()?.cars;
  let rows;
  if (racing && cars) {
    rows = [...state.players]
      .sort((a, b) => (cars.get(a.id)?.place ?? 9) - (cars.get(b.id)?.place ?? 9))
      .map((player) => {
        const car = cars.get(player.id);
        const lap = car?.done ? 'Finished' : `Lap ${car?.lap ?? 1}/${state.laps}`;
        return playerRow(player, { place: car?.place, info: `✓ ${player.correct} · ${lap}` });
      });
  } else {
    rows = state.players.map((player) => playerRow(player));
    if (!rows.length) rows.push(element('li', 'empty', 'Scan the code to join'));
  }
  $('players').replaceChildren(...rows);
  $('listTitle').textContent = racing ? 'Ranking' : `Players (${state.players.length}/${MAX_PLAYERS})`;
}

function paintRanking() {
  const rows = (state.leaderboard ?? []).map((player, index) => `${index + 1}. ${player.name} <span>${player.correct} right</span> <b>${player.score}</b>`);
  $('ranking').hidden = !rows.length || !RACING.includes(state.phase) && state.phase !== 'results';
  $('ranking').innerHTML = rows.length ? `<strong>Top 3</strong>${rows.map((row) => `<div>${row}</div>`).join('')}` : '';
}

const LEVELS = [null, 'Easy', 'Medium', 'Hard'];
const levelBadge = (level) => element('span', `level l${level}`, LEVELS[level]);

function paintResults() {
  const { results, summary } = state;
  const winner = results.find((result) => result.id === summary?.realWinner);
  $('realWinner').textContent = winner
    ? `Real winner: ${winner.name}, with ${winner.correct} right ${winner.correct === 1 ? 'answer' : 'answers'}`
    : summary?.questions ? 'No real winner this time: no player got a question right.' : '';
  $('resultList').replaceChildren(...results.map((result) => {
    const row = element('li');
    if (result.id === summary?.realWinner) row.classList.add('real');
    const who = element('span', 'who');
    who.append(element('span', 'name', result.name));
    if (result.note) who.append(element('span', 'note', result.note)); // what this player should review
    row.append(
      element('span', 'place', ordinal(result.place)),
      carIcon(result.color, result.type, 44),
      who,
      levelBadge(result.level),
      element('span', 'score', `${result.score} pts · ✓ ${result.correct}`),
      element('span', 'time', result.time === null ? 'Did not finish' : formatTime(result.time)),
    );
    return row;
  }));
}

// Team mode: everyone has the same question, so it is shown big, with its four answers, and
// each player is a small tag underneath.
function paintClassQuiz(shared) {
  const { reveal, players } = state;
  const asked = players.filter((player) => player.q);
  const right = reveal ? asked[0].right : null;
  $('quizNumber').replaceChildren(`Question ${state.question.number} `, levelBadge(shared.level));
  $('quizText').textContent = shared.text;
  $('quizChoices').replaceChildren(...shared.choices.map((choice, index) => {
    const row = element('li', `choice c${index}`);
    row.append(element('span', 'letter', 'ABCD'[index]), element('span', 'text', choice));
    if (reveal) {
      row.classList.add(index === right ? 'right' : 'dim');
      row.append(element('span', 'votes', String(asked.filter((player) => player.answer === index).length))); // how many picked it
    }
    return row;
  }));
  $('quizWho').replaceChildren(...asked.map((player) => {
    const correct = reveal && player.answer !== null && player.answer === right;
    const tag = element('li', reveal ? (correct ? 'good' : 'bad') : player.answered ? 'in' : '');
    tag.append(carIcon(player.color, player.type, 26), element('span', 'name', player.name), element('span', 'mark', reveal ? (correct ? '✓' : '✗') : player.answered ? '●' : '…'));
    return tag;
  }));
}

// Solo mode: every player has a different question, so the big screen shows one row per player.
function paintQuiz() {
  const { question, reveal, players } = state;
  if (!question) return;
  $('quizCount').textContent = reveal
    ? `${players.filter((player) => player.answer !== null && player.answer === player.right).length} of ${players.length} got it right`
    : `${players.filter((player) => player.answered).length} of ${players.length} answered`;
  const shared = state.mode === 'team' ? players.find((player) => player.q)?.q : null;
  $('quizChoices').hidden = $('quizWho').hidden = !shared;
  $('quizRows').hidden = !!shared;
  if (shared) return paintClassQuiz(shared);
  $('quizNumber').textContent = `Question ${question.number}`;
  $('quizText').textContent = reveal ? 'Time is up!' : 'Everyone gets their own question';
  $('quizRows').replaceChildren(...players.filter((player) => player.q).map((player) => {
    const row = element('li');
    const text = element('span', 'ask');
    text.append(element('span', 'name', player.name), element('span', 'text', player.q.text));
    if (reveal) text.append(element('span', 'answer', `Answer: ${player.q.choices[player.right]}`));
    const correct = reveal && player.answer !== null && player.answer === player.right;
    const mark = element('span', reveal ? (correct ? 'mark good' : 'mark bad') : 'mark', reveal ? (correct ? '✓' : '✗') : player.answered ? '●' : '…');
    row.append(carIcon(player.color, player.type, 40), levelBadge(player.q.level), text, mark);
    return row;
  }));
}

function updateUI() {
  const { phase } = state;
  const racing = RACING.includes(phase);
  drawCanvas.hidden = phase !== 'draw';
  gameCanvas.hidden = phase === 'draw';
  hint.hidden = !HINTS[phase];
  // With no questions Start cannot work, so the banner says why instead of "Press Start".
  const noQuestions = phase === 'lobby' && !!state.bank && !state.bank.count && !state.bank.writing && !uploading;
  hint.textContent = (phase === 'draw' && trackError) || (noQuestions && (state.bank.note || 'Add questions on the teacher screen to start.')) || HINTS[phase] || '';
  hint.classList.toggle('error', (phase === 'draw' && !!trackError) || noQuestions);

  const [mainLabel, secondLabel] = LABELS[phase] ?? (racing ? [null, 'End race'] : []);
  mainButton.hidden = racing;
  secondButton.hidden = phase === 'countdown'; // not during 3-2-1, so a double click on Start cannot end the race
  const { bank } = state;
  // The race waits for Gemini: the questions the host asked for are the ones that get played.
  const writing = uploading || !!bank?.writing;
  mainButton.textContent = (phase === 'lobby' && writing ? 'Gemini is writing…' : mainLabel) ?? '';
  secondButton.textContent = secondLabel ?? '';
  mainButton.disabled = (phase === 'draw' && stroke.length < 8) || (phase === 'lobby' && (!state.players.length || writing || !bank?.count));
  $('lapsRow').hidden = $('worldRow').hidden = phase !== 'lobby';
  // The topic can be set while the track is still being drawn, so Gemini works in the meantime.
  const choosing = phase === 'draw' || phase === 'lobby';
  $('topicRow').hidden = $('sourceRow').hidden = !choosing;
  $('modeRow').title = state.mode === 'team'
    ? 'Team: everyone gets the same question, on the big screen. The level follows the group.'
    : 'Solo: each player gets their own question, at their own level.';
  if (document.activeElement !== $('topic')) $('topic').value = state.topic?.startsWith('PDF: ') ? '' : state.topic ?? '';
  $('pdfButton').classList.toggle('disabled', writing || !bank?.gemini);
  $('pdf').disabled = writing || !bank?.gemini;
  $('bankNote').hidden = !choosing || !bank;
  $('bankNote').classList.toggle('busy', writing);
  $('bankNote').classList.toggle('error', !writing && !!uploadError);
  if (bank) {
    const about = state.topic?.startsWith('PDF: ') ? `from "${state.topic.slice(5)}"` : `about "${state.topic}"`;
    $('bankNote').textContent = uploading ? 'Sending the PDF…'
      : bank.writing ? `Gemini is writing questions ${about}…`
        : uploadError ? uploadError
          : bank.source === 'gemini' ? `Gemini wrote ${bank.count} questions ${about}, in three levels.`
            : bank.note || (bank.count ? `${bank.count} questions ready.` : 'Add questions on the teacher screen to start.');
  }
  $('worldName').textContent = WORLDS[track?.world]?.label ?? '';
  $('laps').textContent = state.laps;
  // The commentator's switch stays in reach all the time; the bot buttons only before a race.
  $('addBot').hidden = $('removeBot').hidden = phase !== 'draw' && phase !== 'lobby';
  $('addBot').disabled = state.players.length >= MAX_PLAYERS;
  $('removeBot').disabled = !state.players.some((player) => player.bot);
  $('clock').hidden = !racing;
  $('modeRow').hidden = phase !== 'draw' && phase !== 'lobby';
  $('soloMode').classList.toggle('primary', state.mode !== 'team');
  $('teamMode').classList.toggle('primary', state.mode === 'team');
  $('joinBox').classList.toggle('small', racing || phase === 'results');
  $('results').hidden = phase !== 'results';
  if (phase === 'results') paintResults();
  paintQuiz();
  paintPlayers();
  paintRanking();
}

// ---------- The race view ----------

function frame(now) {
  requestAnimationFrame(frame);
  const { phase } = state;

  const count = $('count');
  if (phase === 'countdown') {
    count.hidden = false;
    count.textContent = Math.max(1, Math.min(3, Math.ceil((countdownEnd - now) / 1000)));
    $('clock').textContent = formatTime(0); // not the time of the last race
  } else if (phase === 'question-countdown') {
    count.hidden = false;
    // Small words above the big digit, so it fits any screen.
    count.replaceChildren(element('small', '', 'GET READY'), String(Math.max(1, Math.min(3, Math.ceil((questionEnd - now) / 1000)))));
  } else if (now < goUntil) {
    count.hidden = false;
    count.textContent = 'GO!';
  } else {
    count.hidden = true;
  }

  // The question stays up while people answer and for a moment after the answer is shown.
  // Then it steps aside so the room can watch the map change.
  const holding = phase === 'reveal' && now < revealStart + REVEAL_HOLD;
  $('quiz').hidden = !(phase === 'question' || holding);
  $('ranking').style.visibility = $('quiz').hidden ? '' : 'hidden'; // the Top 3 box would lie on the question panel
  if (phase === 'question') $('quizTimer').style.width = `${Math.max(0, (questionEnd - now) / (state.question.seconds * 1000)) * 100}%`;

  if (phase === 'draw' || !scene || !sheet || !view.width) return;
  if (phase === 'race') {
    $('clock').textContent = formatTime(snapshots.latest()?.time ?? 0);
    if (now - listStamp > 250) {
      listStamp = now;
      paintPlayers();
    }
  }

  shownGreen = 0;
  map ??= renderMap(scene, view.scale * view.dpr, shownGreen);
  const fade = oldMap ? Math.min(1, (now - fadeStart) / MAP_FADE) : 1;
  const ctx = gameCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fade < 1) {
    ctx.drawImage(oldMap, 0, 0, gameCanvas.width, gameCanvas.height);
    ctx.globalAlpha = fade;
  } else {
    oldMap = null;
  }
  ctx.drawImage(map, 0, 0, gameCanvas.width, gameCanvas.height);
  ctx.globalAlpha = 1;

  const cars = snapshots.sample(state.phase === 'race');
  const shown = state.players.filter((player) => cars.has(player.id)).sort((a, b) => cars.get(b.id).place - cars.get(a.id).place);
  const zoom = view.scale * view.dpr;
  const pixel = 1 / view.scale; // world units per screen pixel
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  // The map is far bigger than the screen, so cars are drawn as large icons, not to scale.
  const length = Math.max(CAR_LENGTH * 1.45, 40 / view.scale);
  life.ground(ctx, shownGreen, now / 1000, WHOLE_MAP, pixel);
  effects.update(cars, { dt, now, green: shownGreen, racing: phase === 'race', length, spray: scene.theme.spray });
  props.draw(ctx, WHOLE_MAP, Math.max(1, pixel / 3)); // drawn larger than life, like the cars
  effects.draw(ctx, now);
  for (const player of shown) {
    const car = cars.get(player.id);
    drawCar(ctx, sheet, player.color, player.type, car.x, car.y, car.a, length, car.boost && phase === 'race');
  }
  life.sky(ctx, shownGreen, now / 1000, WHOLE_MAP, pixel);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const player of shown) {
    const car = cars.get(player.id);
    const x = car.x * view.scale;
    const y = car.y * view.scale - 32;
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
  try {
    const info = await (await fetch('/info')).json();
    // A public address, if the game has one, works for every phone. Otherwise phones cannot
    // open "localhost", so show this computer's Wi-Fi address instead.
    if (info.public) base = info.public.replace(/\/$/, '');
    else if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && info.lan[0]) base = info.lan[0];
  } catch { /* keep the origin */ }
  const url = `${base}/play?room=${code}`;
  $('qr').src = `/qr.svg?d=${encodeURIComponent(url)}`;
  // No address to type: the QR code goes straight into this game. The code is for anyone
  // whose camera will not scan; the front page has a box for it.
  $('joinUrl').textContent = `No camera? Open ${base.replace(/^https?:\/\//, '')} and type the code.`;
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
      const now = performance.now();
      if (message.phase === 'race' && (state.phase === 'countdown' || state.phase === 'reveal')) goUntil = now + 900;
      if (message.phase === 'countdown') countdownEnd = now + message.countdown;
      if (message.phase === 'question-countdown') questionEnd = now + message.question.readyIn;
      if (message.phase === 'question') questionEnd = now + message.question.endsIn;
      if (message.phase === 'reveal' && state.phase !== 'reveal') revealStart = now;
      if (message.phase === 'draw') track = scene = life = map = oldMap = null;
      state = message;
      updateUI();
    } else if (message.t === 'track') {
      track = prepareTrack(message.track);
      scene = createScene(track);
      life = createLife(scene);
      props.load(track);
      effects.clear();
      map = oldMap = null;
      trackError = '';
      updateUI();
    } else if (message.t === 's') {
      snapshots.push(message);
      props.move(message.props);
    } else if (message.t === 'props') {
      props.reset(message.props);
    } else if (message.t === 'break') {
      const what = message.limb ? props.loseLimb(message.id) : props.smash(message.id) && 'crate';
      if (what) effects.shatter(what, message.x, message.y, message.vx, message.vy, Math.max(1, 1 / view.scale / 3));
    } else if (message.t === 'say') {
      commentator.say(message);
    } else if (message.t === 'trackError') {
      trackError = message.reason;
      updateUI();
    }
  },
});

let lobbyAt = -Infinity; // when "Make track" or "Race again" was pressed; a moment later the same button says "Start race"
mainButton.addEventListener('click', () => {
  const now = performance.now();
  if (state.phase === 'lobby') {
    if (now - lobbyAt > 1000) send({ t: 'start' }); // a double click on "Make track" or "Race again" must not start the race
    return;
  }
  lobbyAt = now;
  if (state.phase === 'draw') send({ t: 'track', points: stroke.map(([x, y]) => [x * WORLD.width, y * WORLD.height]) });
  else if (state.phase === 'results') send({ t: 'again' });
});
let endedAt = -Infinity; // when "End race" was pressed; a moment later the same button says "New track"
secondButton.addEventListener('click', () => {
  if (state.phase === 'draw') {
    stroke = [];
    trackError = '';
    paintDrawing();
    updateUI();
  } else if (RACING.includes(state.phase)) {
    endedAt = performance.now();
    send({ t: 'end' });
  } else if (performance.now() - endedAt > 1500) { // a double click on "End race" must not throw the track away
    send({ t: 'redraw' });
  }
});
$('lapsDown').addEventListener('click', () => send({ t: 'laps', laps: Math.max(1, state.laps - 1) }));
$('lapsUp').addEventListener('click', () => send({ t: 'laps', laps: Math.min(5, state.laps + 1) }));
$('worldNext').addEventListener('click', () => send({ t: 'world' }));
$('topicRow').addEventListener('submit', (event) => {
  event.preventDefault();
  $('topic').blur();
  send({ t: 'topic', topic: $('topic').value });
});
$('topic').addEventListener('input', () => {
  uploadError = '';
});
// A PDF goes to the server, and Gemini writes the questions from what it says.
$('pdf').addEventListener('change', async () => {
  const [file] = $('pdf').files;
  $('pdf').value = '';
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { // the server's limit: say so at once and send nothing
    uploadError = 'That file is too big. The limit is 12 MB.';
    updateUI();
    return;
  }
  const { code, key } = loadSaved();
  uploading = true;
  uploadError = '';
  updateUI();
  try {
    const response = await fetch('/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Room': code, 'X-Key': encodeURIComponent(key), 'X-Name': encodeURIComponent(file.name) },
      body: file,
    });
    if (!response.ok) uploadError = (await response.json()).error;
  } catch {
    uploadError = 'The PDF could not be sent. Is it bigger than 12 MB?';
  }
  uploading = false;
  updateUI();
});
// The teacher screen shows the questions with their answers, so it opens with the host's key.
$('teacher').addEventListener('click', () => {
  const { code, key } = loadSaved();
  if (code) window.open(`/teacher#${code}.${key}`, 'teacher');
});
const showVoice = () => {
  $('voiceToggle').textContent = `Voice: ${commentator.muted ? 'off' : 'on'}`;
  $('voiceToggle').title = 'In team mode a voice reads the question and the right answer.';
};
$('voiceToggle').addEventListener('click', () => {
  commentator.toggle();
  showVoice();
});
showVoice();
$('addBot').addEventListener('click', () => send({ t: 'bot' }));
$('removeBot').addEventListener('click', () => send({ t: 'bot', remove: true }));
$('soloMode').addEventListener('click', () => send({ t: 'mode', mode: 'solo' }));
$('teamMode').addEventListener('click', () => send({ t: 'mode', mode: 'team' }));

new ResizeObserver(layout).observe(stage);
layout();
updateUI();
loadCars().then((image) => {
  sheet = image;
});
requestAnimationFrame(frame);
