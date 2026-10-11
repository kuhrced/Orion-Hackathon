// How the car types in cars.json connect to the game. Used by the server (physics) and the
// phone (the car picker).

// The rows of public/cars.png, top to bottom. A player's `type` number is an index into this
// list, and each name is a key in cars.json.
export const CAR_TYPES = ['sports', 'hatch', 'pickup', 'formula'];

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
