// Things standing on the road that cars can crash into: cones, tyres, crates, barrels and
// crash-test dummies. The server moves them with real physics; this file only says what they
// are and where they start. The server and the browsers both build the starting layout from
// the track's seed, so it never has to be sent.
import { seededRandom } from './track.js';

// radius: size for collisions. mass: how hard it is to shove (a car is about 5).
// friction: how quickly it stops sliding. lift: how high a hit throws it.
// bounce: how much of its fall it keeps when it lands. breaks: smashes when it hits hard.
export const PROP_KINDS = {
  cone: { radius: 11, mass: 0.3, friction: 1.6, lift: 1.2, bounce: 0.5 },
  tyre: { radius: 15, mass: 0.8, friction: 1.4, lift: 0.9, bounce: 0.7 },
  crate: { radius: 17, mass: 1, friction: 2.2, lift: 0.85, bounce: 0.35, breaks: true },
  barrel: { radius: 15, mass: 1.6, friction: 0.9, lift: 0.6, bounce: 0.45 },
  dummy: { radius: 15, mass: 0.6, friction: 1.8, lift: 1.5, bounce: 0.4 },
};

// Groups of props along the road, each to one side so there is always a way past.
// `track` must have been through prepareTrack().
export function buildProps(track) {
  const random = seededRandom((track.seed ^ 0x9e3779b9) >>> 0);
  const props = [];
  const add = (kind, [x, y], a = 0) => props.push({ id: props.length, kind, x: Math.round(x), y: Math.round(y), a });
  let index = 60; // leave the start straight clear
  while (index < track.n - 40) {
    const [cx, cy] = track.points[index];
    const angle = track.angles[index];
    const side = (random() < 0.5 ? -1 : 1) * track.width * (0.12 + random() * 0.16);
    const choice = random();
    // u runs across the road, v runs along it.
    const at = (u, v) => [
      cx + Math.cos(angle + Math.PI / 2) * (side + u) + Math.cos(angle) * v,
      cy + Math.sin(angle + Math.PI / 2) * (side + u) + Math.sin(angle) * v,
    ];
    if (choice < 0.22) { // a block of crates
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add('crate', at((i - 1) * 36, (j - 1) * 36), angle);
    } else if (choice < 0.42) { // a slanted row of cones
      for (let i = 0; i < 8; i++) add('cone', at((i - 3.5) * 22, (i - 3.5) * 20));
    } else if (choice < 0.6) { // two rows of barrels
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) add('barrel', at((i - 1) * 33, (j - 0.5) * 33));
    } else if (choice < 0.78) { // a pile of tyres
      for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) add('tyre', at((i - (3 - row) / 2) * 31, (row - 1.5) * 27));
    } else { // a line of crash-test dummies, facing the traffic
      for (let i = 0; i < 3; i++) add('dummy', at((i - 1) * 40, 0), angle + Math.PI / 2);
    }
    index += Math.round(55 + random() * 45);
  }
  return props;
}
