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
  // green: how clean the map is now, in percent, or null if this question did not change it.
  reveal({ right, total, green }) {
    const clean = green === null ? '' : green >= 100 ? ' The map is one hundred percent clean!' : ` The map is ${green} percent clean.`;
    if (!right.length) return pick([`Nobody got that one. The map stays as it is.`, `Ouch. No right answers this time.`]);
    if (right.length === total && total > 1) return pick([`Everybody got it right! Boosts for all.${clean}`, `A full house of right answers!${clean}`]);
    if (right.length > 3) return `${right.length} right answers, and the boosts are on!${clean}`;
    return pick([`${all(right)} got it right. Boost time!${clean}`, `Right answer from ${all(right)}!${clean}`]);
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
  results({ winner, right, green }) {
    const clean = `Together you cleaned ${green} percent of the map.`;
    if (!winner) return `The race is over. ${clean}`;
    return pick([
      `But the real winner, with ${right} right ${right === 1 ? 'answer' : 'answers'}, is ${winner}! ${clean}`,
      `The race is over, but knowledge wins: ${winner}, with ${right} right ${right === 1 ? 'answer' : 'answers'}! ${clean}`,
    ]);
  },
};
