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
  return [];
}
