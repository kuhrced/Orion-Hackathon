// Question lifecycle for a race. Car movement, respawning, and track physics stay in server.js.

const QUESTION_READY_MS = 3000;
const ANSWER_MS = 12000;
const ANSWER_LOCK_MS = 900;
const REVEAL_MS = 4500;
const BOOST_MS = 4000;
const LEVEL_WEIGHT = [0, 0.7, 1, 1.4];
const BOT_RIGHT_CHANCE = [0, 0.75, 0.55, 0.35];

export function createQuestionLifecycle({ crypto, clamp, send, sendState, speak, voiceReady }) {
  const answerLine = (question) => `The answer is: ${question.choices[question.correct]}.`;

  function say(room, text, cut = false) {
    if (!room.host) return;
    if (!voiceReady()) {
      send(room.host, { t: 'say', text, audio: null, cut });
      return;
    }
    room.voiceLine = room.voiceLine
      .then(() => speak(text))
      .then((id) => send(room.host, { t: 'say', text, audio: id && `/voice/${id}.mp3`, cut }));
  }

  function pickFrom(bank, level, seen, weak) {
    const { levels } = bank;
    let fresh = levels[level].filter((question) => !seen.has(question.id));
    if (!fresh.length) fresh = [1, 2, 3].flatMap((other) => levels[other]).filter((question) => !seen.has(question.id));
    if (!fresh.length) {
      seen.clear();
      fresh = levels[level].length ? levels[level] : bank.questions;
    }
    const weakQuestions = fresh.filter((question) => weak.has(question.subtopic));
    const choices = weakQuestions.length ? weakQuestions : fresh;
    const picked = choices[crypto.randomInt(choices.length)];
    seen.add(picked.id);
    return picked;
  }

  function askQuestion(room, now) {
    room.questionCount++;
    room.phase = 'question-countdown';
    room.question = { number: room.questionCount, readyAt: now + QUESTION_READY_MS, askedAt: now + QUESTION_READY_MS, endsAt: now + QUESTION_READY_MS + ANSWER_MS, closeAt: null };
    const shared = room.mode === 'team' ? pickFrom(room.bank, room.classLevel, room.classSeen, room.classWeak) : null;
    for (const player of room.players) {
      player.answer = null;
      player.answerAt = 0;
      player.q = shared ?? pickFrom(room.bank, player.level, player.seen, player.weak);
      if (shared) player.seen.add(shared.id);
      else room.classSeen.add(player.q.id);
      const right = Math.random() < BOT_RIGHT_CHANCE[player.q.level];
      player.botAnswer = player.bot ? { at: room.question.readyAt + 1500 + Math.random() * 6000, choice: right ? player.q.correct : (player.q.correct + 1 + crypto.randomInt(3)) % 4 } : null;
    }
    sendState(room);
    if (shared && room.host && voiceReady()) {
      speak(shared.question);
      speak(answerLine(shared));
    }
  }

  function stepQuestion(room, now) {
    const { question } = room;
    const humans = room.players.filter((player) => !player.bot && player.connected);
    const humansIn = humans.length > 0 && humans.every((player) => player.answer !== null);
    let changed = false;
    for (const player of room.players) {
      if (player.bot && player.answer === null && (humansIn || now >= player.botAnswer.at)) {
        player.answer = player.botAnswer.choice;
        player.answerAt = now;
        changed = true;
      }
    }
    if (changed) sendState(room);
    const waiting = room.players.filter((player) => (player.bot || player.connected) && player.answer === null);
    if (!waiting.length) question.closeAt ??= now + 700;
    if (now < question.endsAt && !(question.closeAt && now >= question.closeAt)) return;

    const voters = humans.length ? humans : room.players;
    for (const player of room.players) {
      const right = player.answer === player.q.correct;
      player.history.push({ subtopic: player.q.subtopic, level: player.q.level, right });
      if (right) {
        player.correct++;
        const elapsed = player.answerAt ? Math.max(0, player.answerAt - question.askedAt) : ANSWER_MS;
        player.score += Math.round(1000 * Math.max(0, 1 - elapsed / ANSWER_MS));
        player.boostUntil = room.raceTime + BOOST_MS * LEVEL_WEIGHT[player.q.level];
        player.weak.delete(player.q.subtopic);
      } else player.weak.add(player.q.subtopic);
      if (room.mode !== 'team') player.level = clamp(player.level + (right ? 1 : -1), 1, 3);
    }
    if (room.mode === 'team') {
      const { subtopic } = room.players[0].q;
      const share = voters.filter((player) => player.answer === player.q.correct).length / Math.max(1, voters.length);
      if (share >= 0.6) {
        room.classLevel = Math.min(3, room.classLevel + 1);
        room.classWeak.delete(subtopic);
      } else if (share <= 0.4) {
        room.classLevel = Math.max(1, room.classLevel - 1);
        room.classWeak.add(subtopic);
      }
      for (const player of room.players) player.level = room.classLevel;
    }
    room.reveal = { until: now + REVEAL_MS };
    room.phase = 'reveal';
    sendState(room);
    if (room.mode === 'team' && room.players[0]?.q) say(room, answerLine(room.players[0].q), true);
  }

  function resumeRace(room) {
    room.phase = 'race';
    room.question = null;
    room.reveal = null;
    room.nextQuestionAt = room.raceTime + room.questionEvery;
    for (const player of room.players) {
      player.answer = null;
      player.q = null;
    }
    sendState(room);
  }

  return { askQuestion, stepQuestion, resumeRace, say };
}

export function plainNote(history) {
  const score = new Map();
  for (const { subtopic, right } of history) score.set(subtopic, (score.get(subtopic) ?? 0) + (right ? 1 : -1));
  const sorted = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '';
  const best = sorted[0];
  const worst = sorted.at(-1);
  if (best[1] > 0 && worst[1] < 0) return `Strong on ${best[0].toLowerCase()}. Review ${worst[0].toLowerCase()} next.`;
  if (best[1] > 0) return `Strong on ${best[0].toLowerCase()}. Keep going!`;
  return `Review ${worst[0].toLowerCase()} and try again.`;
}

