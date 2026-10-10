// Track building, shared by the server (physics) and the browser (drawing).
// World units are roughly pixels at 1:1. x grows right, y grows down, angles turn clockwise.

export const WORLD = { width: 9000, height: 5800 }; // sized so a lap takes about a minute
export const ROAD_WIDTH = 190;
export const SPACING = 20; // distance between centreline samples
export const MAX_PLAYERS = 6;
// The looks a map can have. What each one looks like is in public/worlds.js.
export const WORLD_IDS = ['forest', 'ocean', 'swamp', 'desert', 'ice'];
const MIN_CORNER_RADIUS = 120;

// Small seeded random generator, so every screen draws the same scenery.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p, epsilon) {
  return Math.abs(orientation(a, b, p)) <= epsilon
    && p[0] >= Math.min(a[0], b[0]) - epsilon
    && p[0] <= Math.max(a[0], b[0]) + epsilon
    && p[1] >= Math.min(a[1], b[1]) - epsilon
    && p[1] <= Math.max(a[1], b[1]) + epsilon;
}

function segmentsTouch(a, b, c, d, epsilon) {
  const ab = orientation(a, b, c);
  const ab2 = orientation(a, b, d);
  const cd = orientation(c, d, a);
  const cd2 = orientation(c, d, b);
  if (((ab > epsilon && ab2 < -epsilon) || (ab < -epsilon && ab2 > epsilon))
    && ((cd > epsilon && cd2 < -epsilon) || (cd < -epsilon && cd2 > epsilon))) return true;
  return onSegment(a, b, c, epsilon) || onSegment(a, b, d, epsilon)
    || onSegment(c, d, a, epsilon) || onSegment(c, d, b, epsilon);
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length, 0, 1) : 0;
  return dist(point, [a[0] + dx * t, a[1] + dy * t]);
}

function segmentsTooClose(a, b, c, d, gap) {
  return pointSegmentDistance(a, c, d) <= gap || pointSegmentDistance(b, c, d) <= gap
    || pointSegmentDistance(c, a, b) <= gap || pointSegmentDistance(d, a, b) <= gap;
}

// A track is a simple loop. Reject crossings and retracing before smoothing can hide them.
function selfIntersects(points, size) {
  const gap = Math.max(size * 0.025, 0.01);
  const last = points.length - 1;
  for (let i = 0; i <= last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j <= last; j++) {
      // Consecutive segments share an endpoint by design. The first and last
      // segments also meet at the intended loop closure.
      const separation = Math.min(j - i, points.length - (j - i));
      const nearClosure = (i === 0 || j === last) && separation <= 2;
      if (separation <= 1 || nearClosure) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (segmentsTouch(a, b, c, d, 1e-8) || segmentsTooClose(a, b, c, d, gap)) return true;
    }
  }
  return false;
}

function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// Walks a closed polygon and returns evenly spaced points, about `step` apart. The gap is
// adjusted a little so the last point is as far from the first as every other pair.
function resampleClosed(points, step) {
  const n = points.length;
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += dist(points[i], points[(i + 1) % n]);
  const count = Math.max(3, Math.round(perimeter / step));
  const gap = perimeter / count;
  const out = [];
  let walked = 0;
  for (let i = 0; i < n && out.length < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const length = dist(a, b);
    while (out.length < count && out.length * gap <= walked + length + 1e-9) {
      const t = length ? (out.length * gap - walked) / length : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    walked += length;
  }
  return out;
}

function smoothClosed(points, passes) {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const n = current.length;
    current = current.map((p, i) => {
      const prev = current[(i - 1 + n) % n];
      const next = current[(i + 1) % n];
      return [(prev[0] + 2 * p[0] + next[0]) / 4, (prev[1] + 2 * p[1] + next[1]) / 4];
    });
  }
  return current;
}

function splineClosed(points, perSegment) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * t
        + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
        + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  return out;
}

// How much the line turns at each point, in radians.
function turns(points) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    let d = Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  });
}

const tightestRadius = (points) => SPACING / Math.max(1e-6, ...turns(points));

// Keep the generated track faithful to the player's line. Artificial sinusoidal bends make
// a clean drawing turn into an unrelated squiggly track.
function addBends(outline) {
  return smoothClosed(outline, 2);
}

// Index where the longest straight begins, so the start grid sits on a straight.
function straightestStart(points) {
  const n = points.length;
  const turn = turns(points);
  const window = Math.min(40, Math.floor(n / 3));
  let sum = 0;
  for (let i = 0; i < window; i++) sum += turn[i];
  let best = 0;
  let bestSum = sum;
  for (let i = 1; i < n; i++) {
    sum += turn[(i + window - 1) % n] - turn[i - 1];
    if (sum < bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  return (best + Math.floor(window * 0.6)) % n; // grid behind the line, short run after it
}

// Turns a hand-drawn line (points in any units) into a closed race track.
// Returns { ok: true, track } or { ok: false, reason }.
export function buildTrack(raw, seed = 1, world = WORLD_IDS[0]) {
  let points = (Array.isArray(raw) ? raw : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice(0, 5000)
    .map((p) => [p[0], p[1]]);
  if (points.length < 8) return { ok: false, reason: 'Draw a longer line.' };

  const box = bounds(points);
  const size = Math.max(box.width, box.height);
  if (size < 1 || Math.min(box.width, box.height) / size < 0.18) {
    return { ok: false, reason: 'Draw a big loop, not a straight line.' };
  }

  // A short final approach to the start is the intended loop closure. Keep it,
  // but reject any other crossing or retracing instead of silently cutting it off.
  const closeEnough = size * 0.06;
  for (let i = Math.floor(points.length * 0.6); i < points.length; i++) {
    if (dist(points[i], points[0]) < closeEnough) {
      points = points.slice(0, i);
      break;
    }
  }
  points = points.map(([x, y]) => [(x - box.minX) / size, (y - box.minY) / size]);
  points = resampleClosed(points, 0.04);
  if (selfIntersects(points, 1)) return { ok: false, reason: 'Track lines cannot cross or overlap.' };
  points = smoothClosed(points, 3);
  if (points.length < 12) return { ok: false, reason: 'Draw a bigger loop.' };

  // Fit the shape into the world, leaving room for the bends and the road at the edges.
  const margin = ROAD_WIDTH * 1.3;
  const inset = margin + 380;
  const shape = bounds(points);
  const scale = Math.min((WORLD.width - 2 * inset) / shape.width, (WORLD.height - 2 * inset) / shape.height);
  const offsetX = (WORLD.width - shape.width * scale) / 2 - shape.minX * scale;
  const offsetY = (WORLD.height - shape.height * scale) / 2 - shape.minY * scale;
  let outline = points.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]);
  outline = addBends(outline);

  // Round the corners more until a car at full steer can get round every one of them.
  for (let round = 0; ; round++) {
    points = resampleClosed(splineClosed(outline, 4), SPACING);
    if (round === 8 || tightestRadius(points) >= MIN_CORNER_RADIUS) break;
    outline = smoothClosed(outline, 4);
  }
  if (points.length * SPACING < 6000) return { ok: false, reason: 'Draw a bigger loop.' };

  const start = straightestStart(points);
  points = [...points.slice(start), ...points.slice(0, start)].map(([x, y]) => [Math.round(x), Math.round(y)]);

  const n = points.length;
  return {
    ok: true,
    track: {
      seed,
      world,
      width: ROAD_WIDTH,
      points,
      checkpoints: [1, 2, 3].map((quarter) => Math.round((n * quarter) / 4)),
    },
  };
}

// Adds what the game needs every frame: the direction of the road at each sample.
export function prepareTrack(track) {
  const { points } = track;
  const n = points.length;
  const angles = points.map((p, i) => {
    const next = points[(i + 1) % n];
    return Math.atan2(next[1] - p[1], next[0] - p[0]);
  });
  return { ...track, n, angles, length: n * SPACING };
}

// Start grid: two columns behind the start line.
export function gridSlot(track, slot) {
  const back = 4 + Math.floor(slot / 2) * 6;
  const index = (track.n - back) % track.n;
  const [x, y] = track.points[index];
  const angle = track.angles[index];
  const side = (slot % 2 === 0 ? -1 : 1) * track.width * 0.22;
  return {
    index,
    back,
    angle,
    x: x + Math.cos(angle + Math.PI / 2) * side,
    y: y + Math.sin(angle + Math.PI / 2) * side,
  };
}
