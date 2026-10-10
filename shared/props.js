// Things standing on the road that cars can crash into: cones, tyres, crates and barrels.
// The server moves them with real physics; this file only says what they are and where they
// start. The server and the browsers both build the starting layout from the track's seed, so
// it never has to be sent.
import { seededRandom } from './track.js';

// radius: size for collisions. mass: how hard it is to shove (a car is about 5).
// friction: how quickly it stops sliding. breaks: smashes to pieces when hit hard.
export const PROP_KINDS = {
  cone: { radius: 11, mass: 0.3, friction: 2.4 },
  tyre: { radius: 15, mass: 0.8, friction: 2.0 },
  crate: { radius: 17, mass: 1, friction: 3, breaks: true },
  barrel: { radius: 15, mass: 1.6, friction: 1.2 },
};

// Groups of props along the road, each to one side so there is always a way past.
// `track` must have been through prepareTrack().
export function buildProps(track) {
  const random = seededRandom((track.seed ^ 0x9e3779b9) >>> 0);
  const props = [];
  const add = (kind, [x, y], a = 0) => props.push({ id: props.length, kind, x: Math.round(x), y: Math.round(y), a });
  let index = 70; // leave the start straight clear
  while (index < track.n - 45) {
    const [cx, cy] = track.points[index];
    const angle = track.angles[index];
    const side = (random() < 0.5 ? -1 : 1) * track.width * (0.14 + random() * 0.18);
    const choice = random();
    // u runs across the road, v runs along it.
    const at = (u, v) => [
      cx + Math.cos(angle + Math.PI / 2) * (side + u) + Math.cos(angle) * v,
      cy + Math.sin(angle + Math.PI / 2) * (side + u) + Math.sin(angle) * v,
    ];
    if (choice < 0.3) { // a stack of crates
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) add('crate', at((i - 1) * 36, (j - 0.5) * 36), angle);
    } else if (choice < 0.55) { // a slanted row of cones
      for (let i = 0; i < 6; i++) add('cone', at((i - 2.5) * 24, (i - 2.5) * 20));
    } else if (choice < 0.8) { // barrels in a diamond
      for (const [u, v] of [[0, -34], [-32, 0], [32, 0], [0, 34]]) add('barrel', at(u, v));
    } else { // a pile of tyres
      for (const [u, v] of [[-32, -18], [0, -18], [32, -18], [-16, 12], [16, 12], [0, 42]]) add('tyre', at(u, v));
    }
    index += Math.round(70 + random() * 50);
  }
  return props;
}
