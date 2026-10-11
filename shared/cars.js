// How the car types in cars.json connect to the game. Used by the server (physics) and the
// phone (the car picker).

// The rows of public/cars.png, top to bottom. A player's `type` number is an index into this
// list, and each name is a key in cars.json.
export const CAR_TYPES = ['sports', 'hatch', 'pickup', 'formula'];

// How a car answers the steering. The server moves the cars with these two numbers, and a
// phone uses the same two to draw its own car without waiting for the server.
export const TURN = 2.7; // radians per second at full steer
export const STEER_EASE = 12; // how quickly the wheels follow the buttons, per second

// Where a car will be after it has followed `inputs` from the moment `from` on: the same two
// steps the server takes (turn, then move), at the car's present speed. `inputs` is a list of
// [time in ms, eased steering from -1 to 1], oldest first; `turnRate` is in radians per second.
// A phone uses this to draw its own car ahead of the news from the server.
export function rollAhead(car, inputs, from, turnRate) {
  let { x, y, a } = car;
  for (const [at, value] of inputs) {
    if (at <= from) continue;
    const span = (at - from) / 1000;
    a += value * turnRate * span;
    x += Math.cos(a) * car.v * span;
    y += Math.sin(a) * car.v * span;
    from = at;
  }
  return { x, y, a };
}

// Keeps a drawn car moving smoothly: `drawn` takes one step of its own (turn, then move), and
// is then pulled a little towards `target`, where the news says it should be. So late or
// bunched-up news bends the path gently instead of making the car stop and jump.
// `steer` is the eased steering, `dt` is in seconds. Changes and returns `drawn`.
export function glide(drawn, target, steer, turnRate, speed, dt) {
  const far = Math.hypot(target.x - drawn.x, target.y - drawn.y);
  if (!(far < 400)) return Object.assign(drawn, { x: target.x, y: target.y, a: target.a }); // put back on the road, or the first frame
  drawn.a += steer * turnRate * dt;
  drawn.x += Math.cos(drawn.a) * speed * dt;
  drawn.y += Math.sin(drawn.a) * speed * dt;
  const pull = 1 - Math.exp(-dt * 9);
  let turn = target.a - drawn.a;
  turn = ((((turn + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  drawn.x += (target.x - drawn.x) * pull;
  drawn.y += (target.y - drawn.y) * pull;
  drawn.a += turn * pull;
  return drawn;
}

export const STAT_LABELS = { topSpeed: 'Top speed', acceleration: 'Acceleration', handling: 'Handling', weight: 'Weight' };

// Turns one car's 1-5 stats into the numbers the physics multiplies by. A stat of 3 is average.
// The differences are deliberately visible: the vehicle choice should change how the race feels.
export function carTuning(stats) {
  const step = (value, size) => 1 + (value - 3) * size;
  return {
    topSpeed: step(stats.topSpeed, 0.05),
    accel: step(stats.acceleration, 0.22),
    turn: step(stats.handling, 0.12),
    cornerLoss: 0.28 - (stats.handling - 3) * 0.06, // share of speed lost while steering
    offRoad: step(stats.weight, 0.2), // heavy cars plough through the rough better
    mass: stats.weight * stats.weight, // weight has a strong, predictable collision advantage
  };
}
