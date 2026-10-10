// Drawing code shared by the big screen and the phones.
import { gridSlot, seededRandom, WORLD } from '/shared/track.js';

export const CAR_LENGTH = 78;
const CELL = { width: 128, height: 256 }; // one car in cars.png; 6 colours across, 4 types down
const BIN = 512; // the scenery is sorted into squares this big, so a phone only draws what is near
const MASK = 60; // cell size of the rough "is this road?" map

export function loadCars() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = '/cars.png';
  });
}

// angle 0 points right; the pictures point up, so they get a quarter turn.
export function drawCar(ctx, sheet, color, type, x, y, angle, length = CAR_LENGTH, boosted = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  if (boosted) { // flame out of the back
    for (const [size, shade] of [[0.5, 'rgba(255, 140, 40, 0.85)'], [0.3, 'rgba(255, 235, 150, 0.95)']]) {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(-length * 0.14, length * 0.44);
      ctx.lineTo(0, length * (0.44 + size * (0.8 + Math.random() * 0.4)));
      ctx.lineTo(length * 0.14, length * 0.44);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.roundRect(-length * 0.2 + 4, -length * 0.45 + 5, length * 0.4, length * 0.9, 8);
  ctx.fill();
  ctx.drawImage(sheet, color * CELL.width, type * CELL.height, CELL.width, CELL.height, -length / 4, -length / 2, length / 2, length);
  ctx.restore();
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function mixColor(from, to, t) {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const k = clamp01(t);
  const channel = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * k);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Every piece of scenery has its own moment to change, so the map turns green bit by bit
// instead of all at once. `when` is 0..1; the result goes 0 -> 1 as `green` passes it.
const grown = (green, when, span = 0.16) => clamp01((green - when * (1 - span)) / span);

const AREAS = ['factory', 'landfill', 'forest', 'wetland', 'wasteland', 'forest', 'wasteland'];
// How likely each kind of scenery is in each kind of area.
const CHANCE = {
  tree: { factory: 0.1, landfill: 0.12, forest: 1, wetland: 0.4, wasteland: 0.3 },
  sprout: { factory: 0.25, landfill: 0.3, forest: 0.9, wetland: 0.5, wasteland: 0.55 },
  rubbish: { factory: 0.5, landfill: 1, forest: 0.1, wetland: 0.15, wasteland: 0.3 },
  heap: { factory: 0.05, landfill: 0.9, forest: 0, wetland: 0, wasteland: 0.05 },
  barrel: { factory: 0.8, landfill: 0.5, forest: 0.03, wetland: 0.1, wasteland: 0.08 },
  factory: { factory: 0.9, landfill: 0.08, forest: 0, wetland: 0, wasteland: 0.06 },
  pond: { factory: 0.1, landfill: 0.1, forest: 0.12, wetland: 0.85, wasteland: 0.1 },
  flowers: { factory: 0.3, landfill: 0.4, forest: 0.5, wetland: 0.7, wasteland: 0.8 },
};

// Works out, once per track, where everything on the map goes. Uses the track's seed, so the
// big screen and every phone end up with exactly the same map.
export function createScene(track) {
  const random = seededRandom(track.seed);
  const between = (min, max) => min + random() * (max - min);
  const { points, width } = track;
  const items = [];
  const add = (layer, x, y, r, draw) => items.push({ layer, x, y, r, draw });
  const life = { factories: [], ponds: [], heaps: [] }; // what createLife() animates

  const roadDistance = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i += 3) best = Math.min(best, Math.hypot(points[i][0] - x, points[i][1] - y));
    return best - width / 2;
  };
  const centres = Array.from({ length: 16 }, (_, i) => ({ x: between(0, WORLD.width), y: between(0, WORLD.height), kind: AREAS[i % AREAS.length] }));
  const areaAt = (x, y) => {
    let best = centres[0];
    let bestD = Infinity;
    for (const centre of centres) {
      const d = Math.hypot(centre.x - x, centre.y - y);
      if (d < bestD) {
        bestD = d;
        best = centre;
      }
    }
    return best.kind;
  };
  let river = [];
  const riverGap = (x, y) => {
    let best = Infinity;
    for (const [rx, ry] of river) best = Math.min(best, Math.hypot(rx - x, ry - y));
    return best;
  };
  // Tries `count` random spots. Every try uses the same number of random numbers whether or not
  // it is kept, which is what keeps all screens in step.
  const scatter = (kind, count, clear, make) => {
    for (let i = 0; i < count; i++) {
      const x = between(30, WORLD.width - 30);
      const y = between(30, WORLD.height - 30);
      const roll = random();
      const build = make(x, y);
      if (roll < (CHANCE[kind]?.[areaAt(x, y)] ?? 1) && riverGap(x, y) > 150 && roadDistance(x, y) > clear) build();
    }
  };

  // Layer 0: patches on the ground. Stains at first, meadow later.
  for (let i = 0; i < 900; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const rx = between(60, 230);
    const ry = between(45, 160);
    const turn = between(0, 3);
    const [dirty, clean] = [['#7d7972', '#62ad4b'], ['#99958c', '#8fd272'], ['#857a6c', '#79c05c'], ['#6f6c68', '#58a544']][i % 4];
    add(0, x, y, rx, (ctx, green) => {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = mixColor(dirty, clean, green);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }
  // Cracks in the dry ground.
  for (let i = 0; i < 500; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const steps = Array.from({ length: 4 }, () => [between(-34, 34), between(-34, 34)]);
    add(0, x, y, 80, (ctx, green) => {
      if (green > 0.6) return;
      ctx.strokeStyle = `rgba(60, 56, 50, ${0.5 * (1 - green / 0.6)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (const [dx, dy] of steps) ctx.lineTo(px += dx, py += dy);
      ctx.stroke();
    });
  }

  // Layer 1: a river that crosses the whole map. The road is drawn on top, like a bridge.
  const riverY = between(0.25, 0.75) * WORLD.height;
  const riverWaves = [[between(500, 900), between(0.5, 0.9), between(0, 6)], [between(200, 380), between(1.6, 2.6), between(0, 6)]];
  river = [];
  for (let x = -200; x <= WORLD.width + 200; x += 150) {
    river.push([x, riverY + riverWaves.reduce((sum, [size, cycles, phase]) => sum + size * Math.sin((x / WORLD.width) * cycles * Math.PI * 2 + phase), 0)]);
  }
  const riverPath = new Path2D();
  river.forEach(([x, y], i) => (i ? riverPath.lineTo(x, y) : riverPath.moveTo(x, y)));
  add(1, WORLD.width / 2, WORLD.height / 2, Infinity, (ctx, green) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = mixColor('#5b564e', '#4f9d57', green); // bank
    ctx.lineWidth = 210;
    ctx.stroke(riverPath);
    ctx.strokeStyle = mixColor('#494540', '#3d92d1', green); // sludge, then water
    ctx.lineWidth = 160;
    ctx.stroke(riverPath);
    ctx.strokeStyle = mixColor('#57524b', '#63b6ee', green);
    ctx.lineWidth = 70;
    ctx.stroke(riverPath);
  });

  // Layer 1: ponds. Oily at first, blue with lily pads later.
  scatter('pond', 110, 130, (x, y) => {
    const blobs = Array.from({ length: 6 }, () => [between(-60, 60), between(-45, 45), between(36, 68)]);
    const spots = Array.from({ length: 5 }, () => [between(-55, 55), between(-40, 40), between(8, 16), random()]);
    const when = random();
    return () => life.ponds.push({ x, y, when }) && add(1, x, y, 150, (ctx, green) => {
      const clean = grown(green, when, 0.3);
      ctx.fillStyle = mixColor('#5d5962', '#4f9d57', clean);
      for (const [dx, dy, r] of blobs) circle(ctx, x + dx, y + dy, r + 8);
      ctx.fillStyle = mixColor('#46424b', '#4aa6e4', clean);
      for (const [dx, dy, r] of blobs) circle(ctx, x + dx, y + dy, r);
      for (const [dx, dy, r, shade] of spots) {
        // Oil film on dirty water, lily pads on clean water.
        ctx.fillStyle = clean < 0.5
          ? `rgba(${shade < 0.5 ? '150, 110, 170' : '110, 150, 120'}, ${0.5 * (1 - clean * 2)})`
          : `rgba(70, 160, 80, ${(clean - 0.5) * 2})`;
        circle(ctx, x + dx, y + dy, r);
      }
    });
  });

  // Layer 2: rubbish. It is picked up as the map turns green.
  scatter('rubbish', 1100, 26, (x, y) => {
    const bits = Array.from({ length: 6 }, () => [between(-22, 22), between(-22, 22), between(5, 12), random()]);
    const when = between(0.05, 0.75);
    return () => add(2, x, y, 40, (ctx, green) => {
      const left = 1 - grown(green, when);
      if (left <= 0) return;
      ctx.globalAlpha = left;
      for (const [dx, dy, size, shade] of bits) {
        ctx.fillStyle = ['#5a5650', '#a39d92', '#6c6a72', '#8a6f52', '#7d8a8f'][Math.floor(shade * 5)];
        ctx.fillRect(x + dx, y + dy, size, size * 0.8);
      }
      ctx.globalAlpha = 1;
    });
  });
  scatter('heap', 260, 110, (x, y) => {
    const lumps = Array.from({ length: 7 }, () => [between(-60, 60), between(-45, 45), between(28, 56)]);
    const specks = Array.from({ length: 16 }, () => [between(-70, 70), between(-55, 55), between(5, 11), random()]);
    const when = between(0.2, 0.9);
    return () => life.heaps.push({ x, y, when }) && add(2, x, y, 130, (ctx, green) => {
      const left = 1 - grown(green, when, 0.25);
      if (left <= 0) return;
      ctx.globalAlpha = left;
      ctx.fillStyle = '#5b5248';
      for (const [dx, dy, r] of lumps) circle(ctx, x + dx + 6, y + dy + 8, r);
      ctx.fillStyle = '#74695c';
      for (const [dx, dy, r] of lumps) circle(ctx, x + dx, y + dy, r);
      for (const [dx, dy, size, shade] of specks) {
        ctx.fillStyle = ['#b9b2a4', '#4b4f58', '#a4573f', '#c9c05a'][Math.floor(shade * 4)];
        ctx.fillRect(x + dx, y + dy, size, size * 0.7);
      }
      ctx.globalAlpha = 1;
    });
  });
  scatter('barrel', 420, 40, (x, y) => {
    const leaking = random() < 0.45;
    const lean = between(0, 6);
    const when = between(0.05, 0.6);
    return () => add(2, x, y, 50, (ctx, green) => {
      const left = 1 - grown(green, when);
      if (left <= 0) return;
      ctx.globalAlpha = left;
      if (leaking) {
        ctx.fillStyle = 'rgba(150, 165, 50, 0.7)';
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(lean) * 18, y + Math.sin(lean) * 18, 26, 16, lean, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#3b3430';
      circle(ctx, x + 3, y + 4, 14);
      ctx.fillStyle = leaking ? '#8a8f3a' : '#8a5a3a';
      circle(ctx, x, y, 13);
      ctx.fillStyle = '#2d2824';
      circle(ctx, x, y, 5);
      ctx.globalAlpha = 1;
    });
  });

  // Layer 3: flowers, which only come once an area is clean.
  scatter('flowers', 1500, 30, (x, y) => {
    const petals = Array.from({ length: 6 }, () => [between(-26, 26), between(-26, 26)]);
    const color = ['#fff7d6', '#ffd84d', '#ff9ec4', '#c9a0ff', '#ffffff'][Math.floor(random() * 5)];
    const when = between(0.35, 1);
    return () => add(3, x, y, 40, (ctx, green) => {
      const open = grown(green, when);
      if (open <= 0) return;
      ctx.fillStyle = color;
      for (const [dx, dy] of petals) circle(ctx, x + dx, y + dy, 5 * open);
    });
  });

  // Layer 4: trees. Bare at first; each one gets its leaves at its own moment.
  const tree = (x, y, bare) => {
    const twigs = Array.from({ length: 6 }, (_, k) => [(k / 6) * Math.PI * 2 + between(-0.4, 0.4), between(14, 26)]);
    const crown = bare ? between(26, 42) : between(18, 32);
    const leaf = [['#2f8f43', '#48b257'], ['#27803a', '#3fa04e'], ['#3d9a3a', '#63bd4f']][Math.floor(random() * 3)];
    const when = bare ? between(0, 0.8) : between(0.25, 1);
    return () => add(4, x, y, 60, (ctx, green) => {
      const leaves = grown(green, when, 0.2);
      if (bare && leaves < 1) {
        ctx.strokeStyle = '#4f4840';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const [turn, reach] of twigs) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(turn) * reach, y + Math.sin(turn) * reach);
        }
        ctx.stroke();
        ctx.fillStyle = '#3f3933';
        circle(ctx, x, y, 6);
      }
      if (leaves <= 0) return;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      circle(ctx, x + 8, y + 10, crown * leaves);
      ctx.fillStyle = leaf[0];
      circle(ctx, x + 2, y + 3, crown * leaves);
      ctx.fillStyle = leaf[1];
      circle(ctx, x - 4, y - 5, crown * 0.68 * leaves);
    });
  };
  scatter('tree', 2600, 46, (x, y) => tree(x, y, true));
  scatter('sprout', 2600, 40, (x, y) => tree(x, y, false)); // new trees that were never there

  // Layer 5: factories. The smoke stops and the roofs go green.
  scatter('factory', 300, 180, (x, y) => {
    const w = between(140, 210);
    const h = between(95, 130);
    const turned = random() < 0.5;
    const solar = random() < 0.5;
    const when = between(0.3, 0.9);
    const fw = turned ? h : w;
    const fh = turned ? w : h;
    const chimneys = [-1, 1].map((side) => [x + side * fw * 0.22, y - fh * 0.12]);
    return () => life.factories.push({ x, y, when, chimneys, reach: fw / 2 }) && add(5, x, y, 260, (ctx, green) => {
      const clean = grown(green, when, 0.25);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(x - fw / 2 + 10, y - fh / 2 + 12, fw, fh);
      ctx.fillStyle = mixColor('#5e5e66', '#5a9c4c', clean);
      ctx.fillRect(x - fw / 2, y - fh / 2, fw, fh);
      ctx.fillStyle = solar ? mixColor('#6f6f78', '#2f4f8f', clean) : mixColor('#6f6f78', '#74b862', clean);
      for (let k = 0; k < 4; k++) {
        if (turned) ctx.fillRect(x - fw / 2 + 6, y - fh / 2 + 8 + (k * fh) / 4, fw - 12, fh / 8);
        else ctx.fillRect(x - fw / 2 + 8 + (k * fw) / 4, y - fh / 2 + 6, fw / 8, fh - 12);
      }
      for (const [cx, cy] of chimneys) {
        ctx.fillStyle = '#3b3b41';
        circle(ctx, cx, cy, 15);
        ctx.fillStyle = '#1f1f23';
        circle(ctx, cx, cy, 8);
      }
    });
  });

  // Layer 6: clouds of smog hanging over the land.
  for (let i = 0; i < 260; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const rx = between(220, 520);
    const ry = between(140, 300);
    const when = random();
    add(6, x, y, rx, (ctx, green) => {
      const left = 1 - grown(green, when, 0.3);
      if (left <= 0) return;
      ctx.fillStyle = `rgba(96, 90, 82, ${0.13 * left})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Sort the scenery into squares, and remember the order it must be drawn in.
  const bins = new Map();
  const everywhere = [];
  items.forEach((item, order) => {
    item.order = order;
    if (item.r === Infinity) {
      everywhere.push(item);
      return;
    }
    const key = `${Math.floor(item.x / BIN)},${Math.floor(item.y / BIN)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(item);
  });

  const road = new Path2D();
  road.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points) road.lineTo(x, y);
  road.closePath();

  // Corners sharp enough to deserve tyre walls and skid marks.
  const corners = [];
  for (let i = 0; i < track.n; i += 2) {
    let turn = track.angles[(i + 6) % track.n] - track.angles[i];
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (Math.abs(turn) > 0.42) corners.push({ index: i, outside: turn > 0 ? -1 : 1 });
  }
  // A coarse map of where the road is, so moving things can stay off it cheaply.
  const mask = new Set();
  const reachCells = Math.ceil((width / 2 + 30) / MASK);
  for (const [px, py] of points) {
    for (let cx = -reachCells; cx <= reachCells; cx++) {
      for (let cy = -reachCells; cy <= reachCells; cy++) mask.add((Math.floor(px / MASK) + cx) * 4096 + Math.floor(py / MASK) + cy);
    }
  }
  life.onRoad = (x, y) => mask.has(Math.floor(x / MASK) * 4096 + Math.floor(y / MASK));
  life.river = river;
  const windAngle = between(-1.0, -0.35); // smoke and clouds drift up and to the right
  life.wind = [Math.cos(windAngle), Math.sin(windAngle)];
  return { track, bins, everywhere, road, corners, life };
}

// Draws one part of the map. `ctx` must already be set up in world units. `green` runs from
// 0 (grey and polluted) to 1 (clean and full of nature).
export function paintScene(ctx, scene, green, region = { x0: 0, y0: 0, x1: WORLD.width, y1: WORLD.height }) {
  const { track, bins, everywhere, road, corners } = scene;
  const { points, width } = track;
  const reach = 560; // the widest thing that can stick into this region from outside it
  const near = (x, y, pad = 220) => x > region.x0 - pad && x < region.x1 + pad && y > region.y0 - pad && y < region.y1 + pad;

  ctx.fillStyle = mixColor('#8b877f', '#6fbf55', green);
  ctx.fillRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);

  const shown = [...everywhere];
  for (let bx = Math.floor((region.x0 - reach) / BIN); bx <= Math.floor((region.x1 + reach) / BIN); bx++) {
    for (let by = Math.floor((region.y0 - reach) / BIN); by <= Math.floor((region.y1 + reach) / BIN); by++) {
      for (const item of bins.get(`${bx},${by}`) ?? []) if (near(item.x, item.y, item.r + 40)) shown.push(item);
    }
  }
  shown.sort((a, b) => a.layer - b.layer || a.order - b.order);
  for (const item of shown) item.draw(ctx, green);

  // A haze over the land that clears as the map turns green. The road stays crisp.
  ctx.fillStyle = `rgba(112, 106, 98, ${0.26 * (1 - green)})`;
  ctx.fillRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const stroke = (lineWidth, color, dash = []) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke(road);
  };
  stroke(width + 46, mixColor('#746f67', '#5d9d49', green)); // shoulder
  stroke(width + 16, '#dedede'); // kerb
  stroke(width + 16, mixColor('#74747a', '#d83a3a', green), [42, 42]);
  stroke(width, mixColor('#3f4046', '#45464c', green)); // asphalt
  ctx.globalAlpha = 0.5;
  stroke(5, '#b4b4b8', [34, 50]);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Everything below is drawn across the road, in the road's own direction.
  const across = (index, draw, pad) => {
    const [x, y] = points[index];
    if (!near(x, y, pad)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(track.angles[index]);
    draw();
    ctx.restore();
  };
  for (const corner of corners) {
    across(corner.index, () => {
      ctx.fillStyle = 'rgba(20, 20, 22, 0.16)'; // skid marks
      ctx.fillRect(-22, -corner.outside * 34 - 4, 44, 8);
      ctx.fillRect(-22, corner.outside * 22 - 4, 44, 8);
      ctx.fillStyle = '#26262a'; // tyre wall on the outside of the bend
      circle(ctx, 0, corner.outside * (width / 2 + 34), 13);
      ctx.fillStyle = mixColor('#5a5a60', '#e04a3a', green);
      circle(ctx, 0, corner.outside * (width / 2 + 34), 6);
    });
  }
  for (let i = 12; i < track.n; i += 14) {
    across(i, () => { // arrows that show which way to drive
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-14, -26);
      ctx.lineTo(14, 0);
      ctx.lineTo(-14, 26);
      ctx.stroke();
    });
  }
  for (const index of track.checkpoints) {
    across(index, () => {
      ctx.fillStyle = mixColor('#b3ab8a', '#ffd34d', green);
      ctx.globalAlpha = 0.85;
      for (let k = 0; k < 8; k += 2) ctx.fillRect(-6, -width / 2 + (k * width) / 8, 12, width / 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2b2b30';
      circle(ctx, 0, -width / 2 - 12, 9);
      circle(ctx, 0, width / 2 + 12, 9);
    });
  }
  for (let slot = 0; slot < 6; slot++) {
    const spot = gridSlot(track, slot);
    if (!near(spot.x, spot.y)) continue;
    ctx.save();
    ctx.translate(spot.x, spot.y);
    ctx.rotate(spot.angle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(28, -26);
    ctx.lineTo(46, -26);
    ctx.lineTo(46, 26);
    ctx.lineTo(28, 26);
    ctx.stroke();
    ctx.restore();
  }
  across(0, () => { // start and finish line, with a grandstand beside it
    const squares = 10;
    const size = width / squares;
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < squares; k++) {
        ctx.fillStyle = (row + k) % 2 ? '#f2f2f2' : '#1c1c20';
        ctx.fillRect(row * size - size, -width / 2 + k * size, size, size);
      }
    }
    ctx.fillStyle = '#2b2b30';
    ctx.fillRect(-340, -width / 2 - 150, 440, 96);
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = mixColor(['#77777d', '#8a8a90'][row % 2], ['#e04a3a', '#f2c230', '#3a86e0', '#3ab26a'][row], green);
      ctx.fillRect(-332, -width / 2 - 144 + row * 22, 424, 16);
    }
    ctx.fillStyle = '#1c1c20';
    circle(ctx, -size / 2, -width / 2 - 20, 12);
    circle(ctx, -size / 2, width / 2 + 20, 12);
  }, 520);
}

// The whole map in one picture, for the big screen.
export function renderMap(scene, scale, green) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WORLD.width * scale);
  canvas.height = Math.round(WORLD.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  paintScene(ctx, scene, green);
  return canvas;
}

// The map cut into squares that are drawn only when a phone gets near them. The whole map at
// phone sharpness would be far too big to keep in memory.
export function createTiles(scene, { units = 512, pixels = 640, keep = 30, perFrame = 2 } = {}) {
  const tiles = new Map();
  let frame = 0;
  return {
    // Draws the tiles that touch `region` into `ctx`, which is set up in world units.
    draw(ctx, green, region) {
      frame++;
      let budget = perFrame;
      for (let tx = Math.floor(region.x0 / units); tx <= Math.floor(region.x1 / units); tx++) {
        for (let ty = Math.floor(region.y0 / units); ty <= Math.floor(region.y1 / units); ty++) {
          if (tx < 0 || ty < 0 || tx * units >= WORLD.width || ty * units >= WORLD.height) continue;
          const key = `${tx},${ty}`;
          let tile = tiles.get(key);
          // A tile painted for an older shade of green is still shown until its turn comes.
          if ((!tile || tile.green !== green) && budget > 0) {
            budget--;
            tile ??= { canvas: Object.assign(document.createElement('canvas'), { width: pixels, height: pixels }) };
            const tileCtx = tile.canvas.getContext('2d');
            tileCtx.setTransform(pixels / units, 0, 0, pixels / units, (-tx * units * pixels) / units, (-ty * units * pixels) / units);
            paintScene(tileCtx, scene, green, { x0: tx * units, y0: ty * units, x1: (tx + 1) * units, y1: (ty + 1) * units });
            tile.green = green;
            tiles.set(key, tile);
          }
          if (!tile) continue;
          tile.used = frame;
          ctx.drawImage(tile.canvas, tx * units, ty * units, units + 0.6, units + 0.6); // tiny overlap hides seams
        }
      }
      if (tiles.size > keep) {
        const oldest = [...tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, tiles.size - keep);
        for (const [key] of oldest) tiles.delete(key);
      }
    },
  };
}

// ---------- Things that move ----------

const TAU = Math.PI * 2;
// A steady pseudo-random number for thing number `n`, the same on every screen.
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const wrap = (value, span) => ((value % span) + span) % span;

// A bird seen from above: two wings swept back from the nose. `flap` opens and closes them.
function drawBird(ctx, x, y, heading, size, flap, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.22;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, -size * flap);
  ctx.lineTo(0, 0);
  ctx.lineTo(-size * 0.5, size * flap);
  ctx.stroke();
  ctx.restore();
}

// Everything on the map that moves by itself. It is drawn every frame on top of the still
// picture, so it has to stay cheap: only things inside `region` are drawn.
//   ground(): under the cars. sky(): over the cars.
//   seconds: a clock. pixel: world units per screen pixel, so the big screen (which shows the
//   whole map very small) can draw birds and smoke large enough to see.
export function createLife(scene) {
  const { life, track } = scene;
  const [windX, windY] = life.wind;
  const inside = (region, x, y, pad) => x > region.x0 - pad && x < region.x1 + pad && y > region.y0 - pad && y < region.y1 + pad;

  // The river cut into short steps, so ripples can ride along it.
  const flow = [];
  for (let i = 0; i + 1 < life.river.length; i++) {
    const [ax, ay] = life.river[i];
    const [bx, by] = life.river[i + 1];
    for (const t of [0, 0.5]) flow.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) });
  }
  const span = Math.hypot(WORLD.width, WORLD.height) + 800;
  const flocks = Array.from({ length: 9 }, (_, i) => ({
    angle: hash(i + 1) * TAU, speed: 110 + hash(i + 7) * 70, offset: hash(i + 13) * span,
    lane: (hash(i + 19) - 0.5) * WORLD.height * 0.9, count: 3 + Math.floor(hash(i + 23) * 4),
  }));
  const clouds = Array.from({ length: 14 }, (_, i) => ({
    x: hash(i + 31) * WORLD.width, y: hash(i + 37) * WORLD.height,
    rx: 380 + hash(i + 41) * 420, ry: 220 + hash(i + 43) * 220, speed: 18 + hash(i + 47) * 24,
  }));

  return {
    ground(ctx, green, seconds, region, pixel) {
      // Ripples drifting down the river: dull on sludge, bright on clean water.
      const tone = (dirty, clean) => Math.round(dirty + (clean - dirty) * green);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, pixel * 0.8);
      flow.forEach((step, i) => {
        if (!inside(region, step.x, step.y, 180)) return;
        for (let k = 0; k < 2; k++) {
          const id = i * 2 + k;
          const phase = (seconds * 0.55 + hash(id)) % 1;
          const side = (hash(id + 0.37) - 0.5) * 118;
          const x = step.x + Math.cos(step.angle) * phase * 110 - Math.sin(step.angle) * side;
          const y = step.y + Math.sin(step.angle) * phase * 110 + Math.cos(step.angle) * side;
          if (life.onRoad(x, y)) continue; // the road crosses the river on a bridge
          ctx.strokeStyle = `rgba(${tone(128, 235)}, ${tone(120, 248)}, ${tone(106, 255)}, ${Math.sin(phase * Math.PI) * 0.55})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(step.angle) * 30, y + Math.sin(step.angle) * 30);
          ctx.stroke();
        }
      });

      // Ponds: bubbles rise through the sludge; ducks swim once the water is clean.
      life.ponds.forEach((pond, index) => {
        if (!inside(region, pond.x, pond.y, 140)) return;
        const clean = grown(green, pond.when, 0.3);
        if (clean > 0.85) {
          const size = Math.max(8, pixel * 2.2);
          for (let k = 0; k < 2; k++) {
            const turn = seconds * 0.45 + k * Math.PI + index;
            ctx.save();
            ctx.translate(pond.x + Math.cos(turn) * 36, pond.y + Math.sin(turn * 2) * 15);
            ctx.rotate(Math.atan2(Math.cos(turn * 2) * 30, -Math.sin(turn) * 36));
            ctx.fillStyle = '#fdfdf6';
            ctx.beginPath();
            ctx.ellipse(0, 0, size, size * 0.62, 0, 0, TAU);
            ctx.fill();
            circle(ctx, size * 0.8, 0, size * 0.42);
            ctx.fillStyle = '#f08a2b';
            circle(ctx, size * 1.22, 0, size * 0.2);
            ctx.restore();
          }
        } else {
          ctx.lineWidth = Math.max(2, pixel * 0.5);
          for (let k = 0; k < 3; k++) {
            const id = index * 3 + k;
            const phase = (seconds * 0.5 + hash(id + 0.2)) % 1;
            ctx.strokeStyle = `rgba(176, 186, 132, ${(1 - phase) * 0.8 * (1 - clean)})`;
            ctx.beginPath();
            ctx.arc(pond.x + (hash(id + 0.4) - 0.5) * 90, pond.y + (hash(id + 0.6) - 0.5) * 60, (3 + phase * 10) * Math.max(1, pixel / 2.5), 0, TAU);
            ctx.stroke();
          }
        }
      });

      // The crowd in the grandstand, jumping up and down. Too small to matter on the big screen.
      const [startX, startY] = track.points[0];
      if (pixel < 4 && inside(region, startX, startY, 520)) {
        ctx.save();
        ctx.translate(startX, startY);
        ctx.rotate(track.angles[0]);
        for (let i = 0; i < 88; i++) {
          const jump = Math.abs(Math.sin(seconds * 5 + hash(i) * TAU)) * 5;
          ctx.fillStyle = mixColor('#9a9a9f', ['#ffd9b3', '#f2c230', '#ffffff', '#ffb3c7'][i % 4], 0.3 + green * 0.7);
          circle(ctx, -322 + (i % 22) * 19.3, -track.width / 2 - 136 + Math.floor(i / 22) * 22 - jump, 5.5);
        }
        ctx.restore();
      }
    },

    sky(ctx, green, seconds, region, pixel) {
      // Factories: smoke pours out and drifts with the wind until the factory is cleaned up.
      // After that a wind turbine turns beside it.
      life.factories.forEach((factory, index) => {
        if (!inside(region, factory.x, factory.y, 420)) return;
        const clean = grown(green, factory.when, 0.25);
        if (clean < 1) {
          factory.chimneys.forEach(([cx, cy], c) => {
            for (let k = 0; k < 6; k++) {
              const phase = (seconds * 0.22 + k / 6 + hash(index * 2 + c)) % 1;
              const drift = phase * 250;
              const wobble = Math.sin(seconds * 1.3 + k * 2.1 + index) * 14 * phase;
              ctx.fillStyle = `rgba(58, 55, 58, ${0.46 * (1 - phase) * (1 - clean)})`;
              circle(ctx, cx + windX * drift - windY * wobble, cy + windY * drift + windX * wobble, 13 + phase * 52);
            }
          });
        } else {
          const hubX = factory.x + factory.reach + 50;
          const blade = Math.max(48, pixel * 7);
          ctx.lineCap = 'round';
          for (const [shade, shift, thick] of [['rgba(0, 0, 0, 0.16)', Math.max(8, pixel * 1.5), 1.2], ['#f4f6f8', 0, 1]]) {
            ctx.strokeStyle = shade;
            ctx.lineWidth = Math.max(7, pixel * 1.1) * thick;
            ctx.beginPath();
            for (let b = 0; b < 3; b++) {
              const turn = seconds * 2.4 + index + (b * TAU) / 3;
              ctx.moveTo(hubX + shift, factory.y + shift);
              ctx.lineTo(hubX + shift + Math.cos(turn) * blade, factory.y + shift + Math.sin(turn) * blade);
            }
            ctx.stroke();
          }
          ctx.fillStyle = '#cfd4da';
          circle(ctx, hubX, factory.y, Math.max(7, pixel * 1.2));
        }
      });

      // Crows circle over the rubbish heaps until the heaps are gone.
      life.heaps.forEach((heap, index) => {
        if (!inside(region, heap.x, heap.y, 220) || grown(green, heap.when, 0.25) > 0.5) return;
        const size = Math.max(15, pixel * 4);
        for (let k = 0; k < 2; k++) {
          const turn = seconds * 0.9 + k * Math.PI + index;
          const reach = 78 + Math.sin(seconds * 0.6 + index + k) * 22;
          drawBird(ctx, heap.x + Math.cos(turn) * reach, heap.y + Math.sin(turn) * reach, turn + Math.PI / 2, size, 0.55 + 0.3 * Math.sin(seconds * 8 + k), 'rgba(24, 22, 24, 0.9)');
        }
      });

      // Flocks of birds cross the map. More of them come back as it turns green.
      const flying = Math.round(flocks.length * clamp01((green - 0.15) / 0.6));
      for (let f = 0; f < flying; f++) {
        const flock = flocks[f];
        const dx = Math.cos(flock.angle);
        const dy = Math.sin(flock.angle);
        const along = ((seconds * flock.speed + flock.offset) % span) - span / 2;
        const leadX = WORLD.width / 2 + dx * along - dy * flock.lane;
        const leadY = WORLD.height / 2 + dy * along + dx * flock.lane;
        if (!inside(region, leadX, leadY, 420)) continue;
        const size = Math.max(15, pixel * 4.5);
        for (let k = 0; k < flock.count; k++) {
          const row = Math.ceil(k / 2);
          const side = k % 2 ? 1 : -1;
          const x = leadX - dx * row * size * 1.7 - dy * side * row * size * 1.2;
          const y = leadY - dy * row * size * 1.7 + dx * side * row * size * 1.2;
          const flap = 0.55 + 0.35 * Math.sin(seconds * 9 + k * 1.7 + f);
          drawBird(ctx, x + size * 0.6, y + size * 0.9, flock.angle, size, flap, 'rgba(0, 0, 0, 0.14)'); // its shadow
          drawBird(ctx, x, y, flock.angle, size, flap, 'rgba(38, 42, 50, 0.92)');
        }
      }

      // Drifting banks of smog. As the air clears they thin out into soft cloud shadows.
      for (const cloud of clouds) {
        const x = wrap(cloud.x + windX * cloud.speed * seconds, WORLD.width + cloud.rx * 2) - cloud.rx;
        const y = wrap(cloud.y + windY * cloud.speed * seconds, WORLD.height + cloud.ry * 2) - cloud.ry;
        if (!inside(region, x, y, cloud.rx)) continue;
        ctx.fillStyle = `rgba(${tint(74, 30, green)}, ${tint(68, 52, green)}, ${tint(60, 34, green)}, ${0.17 * (1 - green) + 0.06 * green})`;
        ctx.beginPath();
        ctx.ellipse(x, y, cloud.rx, cloud.ry, 0, 0, TAU);
        ctx.fill();
      }

      // Close up only: ash blowing past in the dirty air, butterflies once the flowers are back.
      if (pixel >= 3) return;
      const TILE = 800;
      const ash = clamp01(1 - green * 1.6);
      const flutter = clamp01((green - 0.55) / 0.45);
      for (let tx = Math.floor(region.x0 / TILE); tx <= Math.floor(region.x1 / TILE); tx++) {
        for (let ty = Math.floor(region.y0 / TILE); ty <= Math.floor(region.y1 / TILE); ty++) {
          for (let k = 0; k < 8; k++) {
            const id = (tx * 73 + ty * 151) * 8 + k;
            if (ash > 0) {
              ctx.fillStyle = `rgba(52, 48, 46, ${0.55 * ash})`;
              ctx.fillRect(tx * TILE + wrap(hash(id) * TILE + windX * seconds * 60, TILE), ty * TILE + wrap(hash(id + 0.5) * TILE + windY * seconds * 60, TILE), 5, 4);
            }
            if (flutter > 0 && k < 5) {
              ctx.fillStyle = ['#fff7d6', '#ffd84d', '#ff9ec4', '#ffffff', '#c9a0ff'][k];
              ctx.globalAlpha = flutter;
              const x = tx * TILE + hash(id + 0.2) * TILE + Math.sin(seconds * 1.7 + id) * 28;
              const y = ty * TILE + hash(id + 0.7) * TILE + Math.cos(seconds * 2.3 + id) * 22;
              const wing = 3 + Math.abs(Math.sin(seconds * 12 + id)) * 4; // wings opening and closing
              ctx.fillRect(x - wing, y - 2.5, wing * 2, 5);
              ctx.globalAlpha = 1;
            }
          }
        }
      }
    },
  };
}

const tint = (dirty, clean, green) => Math.round(dirty + (clean - dirty) * green);

// Smoke, dust, skid marks and confetti that the cars leave behind. Each screen makes its own
// from the car positions it is sent; none of it affects the race.
export function createEffects() {
  const puffs = [];
  const marks = [];
  const seen = new Map(); // what each car was doing last frame

  const puff = (x, y, size, life, color, alpha, drift = 26) => {
    if (puffs.length > 420) puffs.shift();
    const turn = Math.random() * TAU;
    puffs.push({ x, y, vx: Math.cos(turn) * drift, vy: Math.sin(turn) * drift, age: 0, life, size, color, alpha });
  };

  return {
    clear() {
      puffs.length = marks.length = 0;
      seen.clear();
    },
    // cars: Map of id -> { x, y, a, v, off, done }. length: how long a car is drawn, in world units.
    update(cars, { dt, now, green, racing, length }) {
      for (const [id, car] of cars) {
        const before = seen.get(id) ?? { a: car.a, done: car.done, exhaust: 0, dust: 0 };
        const spin = Math.atan2(Math.sin(car.a - before.a), Math.cos(car.a - before.a)) / Math.max(dt, 0.001);
        const rearX = car.x - Math.cos(car.a) * length * 0.45;
        const rearY = car.y - Math.sin(car.a) * length * 0.45;
        if (racing && car.v > 40) {
          // Exhaust: thick and dark in the polluted world, almost gone in the green one.
          before.exhaust += dt;
          if (before.exhaust > 0.075 && green < 0.92) {
            before.exhaust = 0;
            puff(rearX, rearY, length * 0.16, 0.7, '48, 45, 44', 0.36 * (1 - green * 0.85));
          }
          before.dust += dt;
          if (car.off && before.dust > 0.045) {
            before.dust = 0;
            puff(rearX, rearY, length * 0.3, 0.9, `${tint(142, 120, green)}, ${tint(128, 150, green)}, ${tint(104, 92, green)}`, 0.42, 40);
          }
          if (!car.off && Math.abs(spin) > 1.5 && car.v > 230) {
            for (const side of [-1, 1]) {
              if (marks.length > 520) marks.shift();
              marks.push({ x: rearX - Math.sin(car.a) * side * length * 0.17, y: rearY + Math.cos(car.a) * side * length * 0.17, a: car.a, born: now, w: length * 0.2, h: length * 0.07 });
            }
          }
        }
        if (car.done && !before.done) {
          for (let i = 0; i < 40; i++) puff(car.x, car.y, length * 0.09, 1.7, ['240, 80, 60', '250, 205, 60', '90, 160, 240', '185, 238, 79', '255, 255, 255'][i % 5], 1, length * 2.4);
        }
        Object.assign(before, { a: car.a, done: car.done });
        seen.set(id, before);
      }
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.age >= p.life) puffs.splice(i, 1);
      }
      while (marks.length && now - marks[0].born > 9000) marks.shift();
    },
    draw(ctx, now) {
      for (const mark of marks) {
        ctx.save();
        ctx.translate(mark.x, mark.y);
        ctx.rotate(mark.a);
        ctx.fillStyle = `rgba(18, 18, 20, ${0.34 * (1 - (now - mark.born) / 9000)})`;
        ctx.fillRect(-mark.w / 2, -mark.h / 2, mark.w, mark.h);
        ctx.restore();
      }
      for (const p of puffs) {
        const k = p.age / p.life;
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha * (1 - k)})`;
        circle(ctx, p.x, p.y, p.size * (0.5 + k * 0.9));
      }
    },
  };
}

// Keeps the last few server updates and blends between them, so cars move smoothly even
// though updates arrive only 30 times a second.
export function createSnapshots(delay = 80) {
  const buffer = [];
  return {
    push(message) {
      const cars = new Map(message.cars.map(([id, x, y, a, lap, place, done, v, boost, off]) => [id, { x, y, a, lap, place, done: !!done, v, boost: !!boost, off: !!off }]));
      buffer.push({ at: performance.now(), time: message.time, cars });
      while (buffer.length > 12) buffer.shift();
    },
    latest: () => buffer.at(-1) ?? null,
    sample() {
      if (!buffer.length) return new Map();
      const when = performance.now() - delay;
      let older = buffer[0];
      let newer = buffer[0];
      for (const snapshot of buffer) {
        newer = snapshot;
        if (snapshot.at >= when) break;
        older = snapshot;
      }
      const span = newer.at - older.at;
      const t = span > 0 ? Math.max(0, Math.min(1, (when - older.at) / span)) : 1;
      const out = new Map();
      for (const [id, to] of newer.cars) {
        const from = older.cars.get(id) ?? to;
        let turn = to.a - from.a;
        turn = ((((turn + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
        out.set(id, { ...to, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, a: from.a + turn * t });
      }
      return out;
    },
  };
}

// Reconnecting WebSocket. `onOpen` runs on every (re)connect.
export function connect({ onOpen, onMessage, onClose }) {
  let socket;
  const open = () => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = () => onOpen?.();
    socket.onmessage = (event) => onMessage(JSON.parse(event.data));
    socket.onclose = () => {
      onClose?.();
      setTimeout(open, 1000);
    };
  };
  open();
  return (message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };
}

export const ordinal = (place) => `${place}${['th', 'st', 'nd', 'rd'][place % 10 > 3 || Math.floor(place / 10) === 1 ? 0 : place % 10]}`;

export function formatTime(ms) {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

// A car picture as CSS, for lists and menus.
export function carIcon(color, type, height = 44) {
  const icon = document.createElement('span');
  icon.className = 'car-icon';
  const width = height / 2;
  Object.assign(icon.style, {
    width: `${width}px`,
    height: `${height}px`,
    backgroundImage: 'url(/cars.png)',
    backgroundSize: `${width * 6}px ${height * 4}px`,
    backgroundPosition: `${-color * width}px ${-type * height}px`,
  });
  return icon;
}
