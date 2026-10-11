// What the commentator says. Each kind of moment has a few lines, and one is picked at random.
// Lines are short on purpose: a short line is spoken before the moment has passed, and every
// letter costs ElevenLabs credits.

const WORLD_NAMES = {
  forest: 'the Dead Forest', ocean: 'the Plastic Sea', swamp: 'the Glow Swamp', desert: 'the Oil Desert', ice: 'the Melting Ice',
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const all = (names) => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

export const LINES = {
  start: ({ count, laps, world }) => pick([
    `Lights out, and away we go! ${count} ${count === 1 ? 'racer' : 'racers'}, ${laps} ${laps === 1 ? 'lap' : 'laps'} of ${WORLD_NAMES[world] ?? 'the track'}.`,
    `And they are off! Welcome to ${WORLD_NAMES[world] ?? 'the track'}.`,
    `Green light! Go, go, go!`,
  ]),
  lead: ({ name }) => pick([
    `${name} takes the lead!`,
    `${name} is out in front now!`,
    `A new leader: ${name}!`,
    `Look at ${name} go! Into first place.`,
  ]),
  question: ({ number }) => pick([
    `Question time! Hands off the wheel.`,
    `Brakes on. Time to use your brain.`,
    `Here comes question ${number}. Think fast!`,
    `Stop the cars. A right answer means a boost.`,
  ]),
  reveal({ right, total }) {
    if (!right.length) return pick([`Nobody got that one. No boosts this time.`, `Ouch. No right answers this time.`]);
    if (right.length === total && total > 1) return pick([`Everybody got it right! Boosts for all.`, `A full house of right answers!`]);
    if (right.length > 3) return `${right.length} right answers, and the boosts are on!`;
    return pick([`${all(right)} got it right. Boost time!`, `Right answer from ${all(right)}!`, `Points and a boost for ${all(right)}!`]);
  },
  smash: ({ name, what }) => pick(what === 'dummy' ? [
    `Ouch! ${name} sends a dummy flying!`,
    `${name} did not see that dummy. Or did not care.`,
  ] : [
    `${name} smashes through the crates!`,
    `Boxes everywhere! That was ${name}.`,
  ]),
  lastLap: ({ name }) => pick([`Final lap for ${name}!`, `${name} starts the last lap!`, `One lap to go, and ${name} leads.`]),
  finish: ({ name }) => pick([`${name} takes the chequered flag!`, `${name} crosses the line first!`, `And ${name} wins the race!`]),
  results({ winner, right }) {
    if (!winner) return pick([`The race is over. Thanks for playing!`, `And that is the race. Well driven, everyone.`]);
    return pick([
      `But the real winner, with ${right} right ${right === 1 ? 'answer' : 'answers'}, is ${winner}!`,
      `The race is over, but knowledge wins: ${winner}, with ${right} right ${right === 1 ? 'answer' : 'answers'}!`,
    ]);
  },
};
