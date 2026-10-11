// Teacher screen: a second screen that only the host can open. It shows Gemini writing the
// questions, every question with its right answer, and how each player is doing in the race.
import { carIcon, connect } from '/render.js';

const $ = (id) => document.getElementById(id);
const LEVELS = [null, 'Easy', 'Medium', 'Hard'];
const RACING = ['countdown', 'race', 'question-countdown', 'question', 'reveal'];
const PHASES = { draw: 'Drawing the track', lobby: 'Waiting to start', countdown: 'Starting', race: 'Racing', results: 'Results' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The big screen opens this page with the room and the host's key after the #. They are kept
// for reloads and taken out of the address bar, so the key is not on show.
function loadSaved() {
  const [code, key] = location.hash.slice(1).split('.');
  try {
    if (code && key) {
      sessionStorage.setItem('race-teacher', JSON.stringify({ code, key }));
      history.replaceState(null, '', location.pathname);
      return { code, key };
    }
    return JSON.parse(sessionStorage.getItem('race-teacher')) ?? {};
  } catch {
    return code && key ? { code, key } : {};
  }
}

const saved = loadSaved();
let state = null;
let bank = null;
let writingSince = 0; // when Gemini started, on this screen's own clock
let uploading = false;
let formError = '';
let shownBank = ''; // which set of questions is on the page, so it is only rebuilt when it changes

function lock(reason) {
  $('page').hidden = true;
  $('locked').hidden = false;
  $('lockedNote').textContent = reason;
}

function paintStatus() {
  if (!state || !bank) return;
  const writing = uploading || bank.writing;
  const fromPdf = bank.wanted.startsWith('PDF: ');
  const about = fromPdf ? `from "${bank.wanted.slice(5)}"` : `about "${bank.wanted}"`;
  $('gemini').classList.toggle('busy', writing);
  if (writing) {
    $('statusLine').textContent = uploading ? 'Sending the PDF…' : `Gemini is writing questions ${about}`;
  } else if (bank.source === 'gemini') {
    $('statusLine').textContent = `Gemini wrote ${bank.questions.length} questions ${about}`;
    $('statusDetail').textContent = `It took ${bank.made.seconds} seconds. Model: ${bank.made.model}. Source: ${bank.made.from === 'pdf' ? 'your PDF' : 'the topic you typed'}.`;
  } else {
    $('statusLine').textContent = `${bank.questions.length} questions ready`;
    $('statusDetail').textContent = state.bank.note || 'Type a topic, upload a PDF, or add questions below.';
  }
  const done = !writing && bank.source === 'gemini';
  $('step1').className = (writing && !uploading) || done ? 'done' : '';
  $('step2').className = writing && !uploading ? 'now' : done ? 'done' : '';
  $('step3').className = done ? 'done' : '';

  const racing = RACING.includes(state.phase);
  const blocked = writing || racing || !state.bank.gemini;
  $('topic').disabled = $('pdf').disabled = blocked;
  $('topicForm').querySelector('button').disabled = blocked;
  $('pdfButton').classList.toggle('disabled', blocked);
  $('bank').classList.toggle('locked', racing); // the server takes no changes during a race
  $('formNote').textContent = formError
    || (racing ? 'A race is running. You can change the questions when it ends.'
      : !state.bank.gemini ? 'There is no Gemini key on the server, so Gemini cannot write questions. Add your own below.' : '');
  $('formNote').classList.toggle('error', !!formError);
}

// The seconds counter while Gemini is working.
setInterval(() => {
  if (bank?.writing && !uploading) $('statusDetail').textContent = `${((performance.now() - writingSince) / 1000).toFixed(1)} seconds so far. This usually takes 5 to 15 seconds.`;
}, 100);

function questionCard(q, index) {
  const card = element('li', 'card');
  card.style.animationDelay = `${index * 45}ms`;
  const questionInput = element('input'); questionInput.value = q.question; questionInput.className = 'edit-question';
  card.append(element('span', 'subtopic', q.subtopic), questionInput);
  const choices = element('ul');
  q.choices.forEach((choice, at) => {
    const row = element('li', at === q.correct ? 'right' : '');
    const input = element('input'); input.value = choice; input.className = 'edit-choice'; input.dataset.index = at;
    row.append(element('span', 'letter', 'ABCD'[at]), input);
    choices.append(row);
  });
  card.append(choices);
  const controls = element('div', 'question-controls');
  const level = element('select'); level.innerHTML = '<option value="1">Easy</option><option value="2">Medium</option><option value="3">Hard</option>'; level.value = q.level;
  const save = element('button', 'primary', 'Save');
  const remove = element('button', '', 'Remove');
  const correct = element('select'); correct.innerHTML = '<option value="0">Correct: A</option><option value="1">Correct: B</option><option value="2">Correct: C</option><option value="3">Correct: D</option>'; correct.value = q.correct;
  save.addEventListener('click', () => send({ t: 'editQuestion', question: { id: q.id, question: questionInput.value, choices: [...card.querySelectorAll('.edit-choice')].map((input) => input.value), correct: correct.value, level: level.value, subtopic: q.subtopic } }));
  remove.addEventListener('click', () => send({ t: 'removeQuestion', question: { id: q.id, question: q.question, choices: q.choices, correct: q.correct, level: q.level, subtopic: q.subtopic } }));
  controls.append(level, correct, save, remove); card.append(controls);
  return card;
}

function paintBank() {
  if (!bank) return;
  const writing = uploading || bank.writing;
  $('bank').classList.toggle('writing', writing);
  $('bankTitle').textContent = writing ? 'Questions (Gemini is writing them now)' : `Questions: ${bank.topic}`;
  const stamp = writing ? 'writing' : `${bank.topic}|${bank.source}|${bank.questions.length}|${bank.questions[0]?.question}`;
  if (stamp === shownBank) return;
  shownBank = stamp;
  for (const level of [1, 2, 3]) {
    const list = $(`level${level}`);
    if (writing) {
      // Empty cards hold the place of the questions that are on their way.
      list.replaceChildren(...Array.from({ length: 4 }, () => element('li', 'card ghost')));
    } else {
      list.replaceChildren(...bank.questions.filter((q) => q.level === level).map(questionCard));
    }
  }
}

function paintClass() {
  if (!state) return;
  const asking = state.phase === 'question' || state.phase === 'reveal';
  $('room').textContent = `Game ${state.code}`;
  $('phase').textContent = `${state.question ? `Question ${state.question.number}` : PHASES[state.phase] ?? ''} · ${state.mode === 'team' ? 'Team mode: same question for everyone' : 'Solo mode: a question each'}`;
  // The state hides the right answer until time is up. This screen may know it sooner.
  const answers = new Map((bank?.questions ?? []).map((q) => [q.question, q.choices[q.correct]]));
  const rows = state.players.map((player) => {
    const row = element('li', player.connected || player.bot ? '' : 'gone');
    const who = element('div', 'who');
    who.append(element('span', 'name', player.bot ? `${player.name} (bot)` : player.name), element('span', `level l${player.level}`, LEVELS[player.level]));
    const now = element('div', 'now');
    if (asking && player.q) {
      now.append(element('span', 'ask', player.q.text));
      const right = answers.get(player.q.text);
      if (right) now.append(element('span', 'key', `Answer: ${right}`));
    } else {
      // Between questions there is room to show what is remembered about this player.
      const { back } = player;
      const memory = back ? ` · played ${back.races} ${back.races === 1 ? 'race' : 'races'} before, ${back.right} of ${back.asked} right${back.weak.length ? ` · review: ${back.weak.join(', ')}` : ''}` : '';
      now.append(element('span', 'idle', `${RACING.includes(state.phase) ? 'Driving' : state.phase === 'results' ? 'Finished' : 'Waiting'}${memory}`));
    }
    let mark = '';
    let markClass = 'mark';
    if (state.phase === 'reveal' && player.q) {
      const good = player.answer !== null && player.answer === player.right;
      mark = player.answer === null ? 'No answer' : good ? 'Right' : 'Wrong';
      markClass += good ? ' good' : ' bad';
    } else if (state.phase === 'question') {
      mark = player.answered ? 'Answered' : 'Thinking…';
    }
    row.append(carIcon(player.color, player.type, 36), who, now, element('span', markClass, mark), element('span', 'score', `${player.score ?? 0} pts`));
    return row;
  });
  if (!rows.length) rows.push(element('li', 'empty', 'Nobody has joined yet. Players scan the QR code on the big screen.'));
  $('classRows').replaceChildren(...rows);
}

function paint() {
  paintStatus();
  paintBank();
  paintClass();
}

const send = connect({
  onOpen: () => send({ t: 'watch', code: saved.code, key: saved.key }),
  onMessage(message) {
    if (message.t === 'error') {
      lock(`${message.reason} Press "Teacher screen" on the big screen to open it again.`);
    } else if (message.t === 'state') {
      state = message;
      $('page').hidden = false;
      $('locked').hidden = true;
      if (document.activeElement !== $('topic') && !$('topic').value) $('topic').value = state.topic.startsWith('PDF: ') ? '' : state.topic;
      paint();
    } else if (message.t === 'bank') {
      bank = message;
      shownBank = '';
      writingSince = performance.now() - message.writingFor;
      paint();
    }
  },
});

if (!saved.code) lock('Open this screen with the "Teacher screen" button on the big screen.');

$('topicForm').addEventListener('submit', (event) => {
  event.preventDefault();
  formError = '';
  $('topic').blur();
  send({ t: 'topic', topic: $('topic').value });
});

const questionModal = $('questionModal');
$('addQuestion').addEventListener('click', () => {
  questionModal.hidden = false;
  $('newQuestion').focus();
});
$('cancelQuestion').addEventListener('click', () => { questionModal.hidden = true; });
$('addQuestionForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (RACING.includes(state?.phase)) return; // keep what was typed until the race ends
  send({ t: 'addQuestion', question: {
    question: $('newQuestion').value,
    choices: [...document.querySelectorAll('.new-choice')].map((input) => input.value),
    correct: $('newCorrect').value,
    level: $('newLevel').value,
    subtopic: $('newSubtopic').value,
  } });
  questionModal.hidden = true;
  event.target.reset();
  $('newSubtopic').value = 'General';
});

$('pdf').addEventListener('change', async () => {
  const [file] = $('pdf').files;
  $('pdf').value = '';
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { // the server's limit: say so at once and send nothing
    formError = 'That file is too big. The limit is 12 MB.';
    paint();
    return;
  }
  uploading = true;
  formError = '';
  paint();
  try {
    const response = await fetch('/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Room': saved.code, 'X-Key': encodeURIComponent(saved.key), 'X-Name': encodeURIComponent(file.name) },
      body: file,
    });
    if (!response.ok) formError = (await response.json()).error;
    else $('topic').value = '';
  } catch {
    formError = 'The PDF could not be sent. Is it bigger than 12 MB?';
  }
  uploading = false;
  paint();
});
