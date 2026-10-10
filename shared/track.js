// Track building, shared by the server (physics) and the browser (drawing).
// World units are roughly pixels at 1:1. x grows right, y grows down, angles turn clockwise.

export const WORLD = { width: 3600, height: 2300 };
export const ROAD_WIDTH = 190;
export const SPACING = 20; // distance between centreline samples
export const MAX_PLAYERS = 6;
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

// Walks a closed polygon and returns points every `step` along it.
function resampleClosed(points, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = dist(a, b);
    let at = carry;
    while (at < length) {
      const t = at / length;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = at - length;
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

// Index where the longest straight begins, so the start grid sits on a straight.
function straightestStart(points) {
  const n = points.length;
  const turn = turns(points);
  const window = Math.min(34, Math.floor(n / 3));
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
export function buildTrack(raw, seed = 1) {
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

  // If the pen came back past the start, cut the overlap off.
  const closeEnough = size * 0.06;
  for (let i = Math.floor(points.length * 0.6); i < points.length; i++) {
    if (dist(points[i], points[0]) < closeEnough) {
      points = points.slice(0, i);
      break;
    }
  }

  points = points.map(([x, y]) => [(x - box.minX) / size, (y - box.minY) / size]);
  points = smoothClosed(resampleClosed(points, 0.04), 8);
  if (points.length < 12) return { ok: false, reason: 'Draw a bigger loop.' };

  // Fit the shape into the world, leaving room for the road at the edges.
  const margin = ROAD_WIDTH * 1.3;
  const shape = bounds(points);
  const scale = Math.min((WORLD.width - 2 * margin) / shape.width, (WORLD.height - 2 * margin) / shape.height);
  const offsetX = (WORLD.width - shape.width * scale) / 2 - shape.minX * scale;
  const offsetY = (WORLD.height - shape.height * scale) / 2 - shape.minY * scale;
  let outline = points.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]);

  // Round the corners more until a car at full steer can get round every one of them.
  for (let round = 0; ; round++) {
    points = resampleClosed(splineClosed(outline, 8), SPACING);
    if (round === 6 || tightestRadius(points) >= MIN_CORNER_RADIUS) break;
    outline = smoothClosed(outline, 5);
  }
  if (points.length * SPACING < 2600) return { ok: false, reason: 'Draw a bigger loop.' };

  const start = straightestStart(points);
  points = [...points.slice(start), ...points.slice(0, start)].map(([x, y]) => [Math.round(x), Math.round(y)]);

  const n = points.length;
  return {
    ok: true,
    track: {
      seed,
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
