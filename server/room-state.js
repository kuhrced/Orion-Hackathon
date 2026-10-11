// Messages that describe a room to the host, players, and race renderer.

export function createRoomState({ geminiReady, answerMs, answerLockMs }) {
  function stateMessage(room) {
    const now = performance.now();
    const { question, reveal } = room;
    const showing = room.phase === 'question' || room.phase === 'reveal';
    return {
      t: 'state', code: room.code, phase: room.phase, laps: room.laps, mode: room.mode, topic: room.topic,
      bank: { topic: room.bank.topic, source: room.bank.source, count: room.bank.count, writing: room.writing, note: room.bankNote, gemini: geminiReady() },
      countdown: room.phase === 'countdown' ? Math.max(0, room.startAt - now) : 0,
      players: room.players.map((player) => ({
        id: player.id, name: player.name, color: player.color, type: player.type, bot: player.bot,
        connected: player.connected, correct: player.correct, score: player.score, level: player.level,
        back: player.past && { races: player.past.races, right: player.past.right, asked: player.past.asked, last: { topic: player.past.last.topic, right: player.past.last.right, asked: player.past.last.asked }, weak: player.past.here?.weak ?? [], sameTopic: !!player.past.here },
        q: showing && player.q ? { text: player.q.question, choices: player.q.choices, level: player.q.level, subtopic: player.q.subtopic } : null,
        answered: player.answer !== null, answer: reveal ? player.answer : null, right: reveal && player.q ? player.q.correct : null,
      })),
      question: question && {
        number: question.number, endsIn: Math.max(0, question.endsAt - now), seconds: answerMs / 1000,
        lockedFor: Math.max(0, question.askedAt + answerLockMs - now),
        readyIn: room.phase === 'question-countdown' ? Math.max(0, question.readyAt - now) : 0,
      },
      reveal: reveal && { endsIn: Math.max(0, reveal.until - now) }, results: room.results, summary: room.summary,
      leaderboard: [...room.players].sort((a, b) => b.score - a.score).slice(0, 3).map((player) => ({ id: player.id, name: player.bot ? `${player.name} (AI)` : player.name, bot: player.bot, score: player.score, correct: player.correct })),
    };
  }

  function snapshotMessage(room, moved = []) {
    return {
      t: 's', time: Math.round(room.raceTime),
      props: moved.map((prop) => [prop.id, Math.round(prop.x), Math.round(prop.y), Math.round(prop.a * 100) / 100, Math.round(prop.z)]),
      cars: room.players.filter((player) => player.car).map((player) => {
        const { car } = player;
        return [player.id, Math.round(car.x * 10) / 10, Math.round(car.y * 10) / 10, Math.round(car.a * 1000) / 1000, car.lap, car.place, car.done ? 1 : 0, Math.round(car.v), room.raceTime < player.boostUntil ? 1 : 0, car.offRoad ? 1 : 0];
      }),
    };
  }

  function propsMessage(room) {
    return { t: 'props', props: room.props.map((prop) => [prop.id, Math.round(prop.x), Math.round(prop.y), Math.round(prop.a * 100) / 100, prop.gone ? 1 : 0]) };
  }

  return { stateMessage, snapshotMessage, propsMessage };
}
