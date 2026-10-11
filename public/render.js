// Drawing code shared by the big screen and the phones: cars, the cached map, and what the
// cars leave behind. The map itself (the worlds) is in worlds.js.
import { buildProps, PROP_KINDS } from '/shared/props.js';
import { WORLD } from '/shared/track.js';
import { circle, paintScene, tint, TAU } from '/worlds.js';

export { createLife, createScene, WORLDS } from '/worlds.js';

// Phones that stopped at iOS 15 do not have these two. Without them the race view stays empty.
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, width, height) {
    this.rect(x, y, width, height); // square corners are fine there
  };
}
if (!Array.prototype.at) {
  Array.prototype.at = function (index) {
    return this[index < 0 ? this.length + index : index];
  };
}

export const CAR_LENGTH = 78;
const CELL = { width: 128, height: 256 }; // one car in cars.png; 6 colours across, 4 types down

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
export function createTiles(scene, { units = 512, pixels = 640, keep = 30, perFrame = 1 } = {}) {
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

// One road object, seen from above. (Dummies are drawn by drawDummy.)
function drawProp(ctx, kind, angle) {
  ctx.rotate(angle);
  if (kind === 'crate') {
    ctx.fillStyle = '#b98a4e';
    ctx.fillRect(-15, -15, 30, 30);
    ctx.strokeStyle = '#7a5a30';
    ctx.lineWidth = 3;
    ctx.strokeRect(-13.5, -13.5, 27, 27);
    ctx.beginPath();
    ctx.moveTo(-13, -13);
    ctx.lineTo(13, 13);
    ctx.moveTo(13, -13);
    ctx.lineTo(-13, 13);
    ctx.stroke();
  } else if (kind === 'barrel') {
    ctx.fillStyle = '#c8452f';
    circle(ctx, 0, 0, 15);
    ctx.strokeStyle = '#8e2c1d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = '#2d2824';
    circle(ctx, 5, -4, 3);
  } else if (kind === 'cone') {
    ctx.fillStyle = '#2b2b30';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.fillStyle = '#ff7a1a';
    circle(ctx, 0, 0, 10);
    ctx.fillStyle = '#ffffff';
    circle(ctx, 0, 0, 6.5);
    ctx.fillStyle = '#ff7a1a';
    circle(ctx, 0, 0, 3.5);
  } else { // tyre
    ctx.fillStyle = '#1f1f22';
    circle(ctx, 0, 0, 15);
    ctx.strokeStyle = '#3a3a3e';
    ctx.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(k * 0.785) * 10, Math.sin(k * 0.785) * 10);
      ctx.lineTo(Math.cos(k * 0.785) * 14.5, Math.sin(k * 0.785) * 14.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#5a5550';
    circle(ctx, 0, 0, 7.5);
  }
}

// A crash-test dummy is a rag doll: a body the server moves, with arms, legs and a head that
// this screen lets flop around behind it. Each limb is a short chain hanging off the body.
// [where it joins the body, the length of each piece]
const LIMBS = [
  { joint: [-10, -9], pieces: [11, 11] }, // left arm
  { joint: [10, -9], pieces: [11, 11] }, // right arm
  { joint: [-6, 14], pieces: [13, 13] }, // left leg
  { joint: [6, 14], pieces: [13, 13] }, // right leg
  { joint: [0, -15], pieces: [8] }, // neck and head
];
const HEAD = 4;
const DUMMY_YELLOW = '#f2c230';

function restDoll() { // every limb sticking straight out from the body
  return LIMBS.map(({ joint, pieces }) => {
    const reach = Math.hypot(...joint);
    let far = reach;
    return pieces.map((piece) => {
      far += piece;
      return { x: (joint[0] / reach) * far, y: (joint[1] / reach) * far, px: (joint[0] / reach) * far, py: (joint[1] / reach) * far };
    });
  });
}

// Moves the limbs one step. `shiftX/shiftY/turn` say how the body moved since last frame; the
// limbs do not get told, so they lag behind and whip around. That is what makes it floppy.
function flopDoll(doll, shiftX, shiftY, turn, loose) {
  const cos = Math.cos(-turn);
  const sin = Math.sin(-turn);
  LIMBS.forEach(({ joint, pieces }, limb) => {
    let [fromX, fromY] = joint;
    doll[limb].forEach((point, piece) => {
      // Seen from the body, the world just moved the other way.
      const x = (point.x - shiftX) * cos - (point.y - shiftY) * sin;
      const y = (point.x - shiftX) * sin + (point.y - shiftY) * cos;
      const vx = (point.x - point.px) * 0.86 + (Math.random() - 0.5) * loose;
      const vy = (point.y - point.py) * 0.86 + (Math.random() - 0.5) * loose;
      point.px = x;
      point.py = y;
      point.x = x + vx;
      point.y = y + vy;
      // Keep the piece the right length: it can swing, but it cannot stretch.
      const dx = point.x - fromX;
      const dy = point.y - fromY;
      const d = Math.hypot(dx, dy) || 0.01;
      point.x = fromX + (dx / d) * pieces[piece];
      point.y = fromY + (dy / d) * pieces[piece];
      fromX = point.x;
      fromY = point.y;
    });
  });
}

// Drawn in the dummy's own space: body at the middle, limbs wherever they have flopped to.
function drawDummy(ctx, prop) {
  if (!prop.fallen) { // still standing: all you see from above is head and shoulders
    ctx.fillStyle = DUMMY_YELLOW;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d9a91f';
    circle(ctx, 0, 0, 8.5);
  } else {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    LIMBS.forEach(({ joint }, limb) => {
      if (limb === HEAD || prop.lost.has(limb)) return;
      ctx.strokeStyle = DUMMY_YELLOW;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(...joint);
      for (const point of prop.doll[limb]) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.fillStyle = '#26262a'; // joints
      circle(ctx, ...joint, 3.4);
      circle(ctx, prop.doll[limb][0].x, prop.doll[limb][0].y, 3);
    });
    ctx.fillStyle = DUMMY_YELLOW;
    ctx.beginPath();
    ctx.roundRect(-11, -15, 22, 30, 7);
    ctx.fill();
    ctx.fillStyle = '#26262a';
    ctx.fillRect(-11, -4, 22, 6);
    if (prop.lost.has(HEAD)) return;
  }
  // The head, with the black and yellow target every crash-test dummy wears.
  const head = prop.fallen ? prop.doll[HEAD][0] : { x: 0, y: 0 };
  ctx.fillStyle = prop.fallen ? DUMMY_YELLOW : '#d9a91f';
  circle(ctx, head.x, head.y, 8.5);
  ctx.fillStyle = '#26262a';
  for (const quarter of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.arc(head.x, head.y, 5.5, quarter, quarter + Math.PI / 2);
    ctx.fill();
  }
}

// The road objects as this screen knows them. The server decides where they are; this only
// remembers the latest positions and slides each object smoothly toward them.
export function createProps() {
  let props = new Map();
  const fresh = (prop) => Object.assign(prop, { tx: prop.x, ty: prop.y, ta: prop.a, z: 0, tz: 0, gone: false, fallen: false, lost: new Set(), doll: restDoll() });
  return {
    load(track) {
      props = new Map(buildProps(track).map((prop) => [prop.id, fresh({ ...prop })]));
    },
    // The whole layout: [id, x, y, angle, gone]. Sent on joining and when a race is reset.
    reset(list) {
      for (const [id, x, y, a, gone] of list) {
        const prop = props.get(id);
        if (prop) Object.assign(fresh(Object.assign(prop, { x, y, a })), { gone: !!gone });
      }
    },
    // The objects that moved since the last update: [id, x, y, angle, height].
    move(list = []) {
      for (const [id, x, y, a, z] of list) Object.assign(props.get(id) ?? {}, { tx: x, ty: y, ta: a, tz: z, fallen: true });
    },
    // A crate was smashed. Returns it so the caller can throw the pieces.
    smash(id) {
      const prop = props.get(id);
      if (prop) prop.gone = true;
      return prop;
    },
    // A dummy was hit hard enough to lose a part. Returns which one, or null if none are left.
    loseLimb(id) {
      const prop = props.get(id);
      const left = prop ? LIMBS.map((_, limb) => limb).filter((limb) => !prop.lost.has(limb)) : [];
      if (!left.length) return null;
      const limb = left[Math.floor(Math.random() * left.length)];
      prop.lost.add(limb);
      return limb === HEAD ? 'head' : 'limb';
    },
    draw(ctx, region, scale = 1) {
      for (const prop of props.values()) {
        if (prop.gone) continue;
        const before = [prop.x, prop.y, prop.a];
        prop.x += (prop.tx - prop.x) * 0.4;
        prop.y += (prop.ty - prop.y) * 0.4;
        prop.a += (prop.ta - prop.a) * 0.4;
        prop.z += (prop.tz - prop.z) * 0.4;
        if (prop.kind === 'dummy' && prop.fallen) {
          // Tell the limbs how the body just moved, in the body's own space.
          const cos = Math.cos(-before[2]);
          const sin = Math.sin(-before[2]);
          const dx = prop.x - before[0];
          const dy = prop.y - before[1];
          flopDoll(prop.doll, dx * cos - dy * sin, dx * sin + dy * cos, prop.a - before[2], prop.z > 0 ? 2.2 : 0);
        }
        if (prop.x < region.x0 - 60 || prop.x > region.x1 + 60 || prop.y < region.y0 - 60 || prop.y > region.y1 + 60) continue;
        // Height: the shadow stays on the ground while the object rises away from it and
        // looks bigger, the way something thrown toward a camera overhead would.
        const radius = PROP_KINDS[prop.kind].radius;
        ctx.fillStyle = `rgba(0, 0, 0, ${0.26 * Math.max(0.3, 1 - prop.z / 500)})`;
        circle(ctx, prop.x + (4 + prop.z * 0.22) * scale, prop.y + (5 + prop.z * 0.3) * scale, radius * scale * (1 + prop.z / 450));
        ctx.save();
        ctx.translate(prop.x, prop.y - prop.z * 0.35 * scale);
        ctx.scale(scale * (1 + prop.z / 170), scale * (1 + prop.z / 170));
        if (prop.kind === 'dummy') {
          ctx.rotate(prop.a);
          drawDummy(ctx, prop);
        } else {
          drawProp(ctx, prop.kind, prop.a);
        }
        ctx.restore();
      }
    },
  };
}

// Smoke, dust, skid marks and confetti that the cars leave behind. Each screen makes its own
// from the car positions it is sent; none of it affects the race.
export function createEffects() {
  const puffs = [];
  const marks = [];
  const shards = []; // planks from smashed crates
  const seen = new Map(); // what each car was doing last frame

  const puff = (x, y, size, life, color, alpha, drift = 26) => {
    if (puffs.length > 420) puffs.shift();
    const turn = Math.random() * TAU;
    puffs.push({ x, y, vx: Math.cos(turn) * drift, vy: Math.sin(turn) * drift, age: 0, life, size, color, alpha });
  };

  return {
    clear() {
      puffs.length = marks.length = shards.length = 0;
      seen.clear();
    },
    // Something broke at (x, y) while moving at (vx, vy). The pieces carry on from there with
    // their own speed, spin and height, so no two crashes look the same.
    //   what: 'crate' throws planks; 'limb' and 'head' throw a part of a dummy.
    shatter(what, x, y, vx, vy, scale = 1) {
      const count = what === 'crate' ? 16 : 1;
      for (let i = 0; i < count; i++) {
        const turn = Math.random() * TAU;
        const kick = 60 + Math.random() * 260;
        const carry = 0.35 + Math.random() * 0.8;
        if (shards.length > 220) shards.shift();
        shards.push({
          what, x, y, z: 8, vx: vx * carry + Math.cos(turn) * kick, vy: vy * carry + Math.sin(turn) * kick,
          vz: 160 + Math.random() * 420, a: turn, spin: (Math.random() - 0.5) * 30, age: 0, life: 7 + Math.random() * 3,
          w: (what === 'crate' ? 11 + Math.random() * 13 : what === 'head' ? 17 : 24) * scale, h: (what === 'crate' ? 4 + Math.random() * 2 : what === 'head' ? 17 : 7) * scale,
          color: what === 'crate' ? ['#b98a4e', '#a37843', '#caa064', '#7a5a30'][i % 4] : '#f2c230',
        });
      }
      for (let i = 0; i < 6; i++) puff(x, y, 18 * scale, 0.8, '170, 150, 120', 0.4, 60);
    },
    // cars: Map of id -> { x, y, a, v, off, done }. length: how long a car is drawn, in world units.
    // spray: what a car throws up off the road in this world, as [polluted rgb, clean rgb].
    update(cars, { dt, now, green, racing, length, spray }) {
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
            puff(rearX, rearY, length * 0.3, 0.9, spray[0].map((value, c) => tint(value, spray[1][c], green)).join(', '), 0.5, 40);
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
      // Planks slide and spin to a stop, and get kicked again by any car that drives over them.
      for (let i = shards.length - 1; i >= 0; i--) {
        const shard = shards[i];
        shard.age += dt;
        if (shard.age >= shard.life) {
          shards.splice(i, 1);
          continue;
        }
        for (const car of cars.values()) {
          if (shard.z > 20 || car.v < 60 || Math.abs(car.x - shard.x) > length * 0.4 || Math.abs(car.y - shard.y) > length * 0.4) continue;
          shard.vx = Math.cos(car.a) * car.v * 0.8 + (Math.random() - 0.5) * 220;
          shard.vy = Math.sin(car.a) * car.v * 0.8 + (Math.random() - 0.5) * 220;
          shard.vz = 120 + Math.random() * 260;
          shard.spin = (Math.random() - 0.5) * 30;
        }
        // Up, over and down again, with a bounce; then it scrapes along the ground to a stop.
        if (shard.z > 0 || shard.vz > 0) {
          shard.vz -= 1100 * dt;
          shard.z += shard.vz * dt;
          if (shard.z <= 0) {
            shard.z = 0;
            shard.vz = shard.vz < -140 ? -shard.vz * 0.4 : 0;
          }
        }
        const drag = Math.exp(-(shard.z > 0 ? 0.3 : 2.6) * dt);
        shard.x += shard.vx * dt;
        shard.y += shard.vy * dt;
        shard.a += shard.spin * dt;
        shard.vx *= drag;
        shard.vy *= drag;
        shard.spin *= drag;
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
      for (const shard of shards) {
        const fade = Math.min(1, shard.life - shard.age); // fade out over the last second
        ctx.fillStyle = `rgba(0, 0, 0, ${0.2 * fade})`;
        circle(ctx, shard.x + shard.z * 0.22, shard.y + shard.z * 0.3, shard.w * 0.4);
        ctx.save();
        ctx.translate(shard.x, shard.y - shard.z * 0.35);
        ctx.rotate(shard.a);
        ctx.scale(1 + shard.z / 170, 1 + shard.z / 170);
        ctx.globalAlpha = fade;
        ctx.fillStyle = shard.color;
        if (shard.what === 'head') circle(ctx, 0, 0, shard.w / 2);
        else {
          ctx.beginPath();
          ctx.roundRect(-shard.w / 2, -shard.h / 2, shard.w, shard.h, shard.what === 'crate' ? 1 : shard.h / 2);
          ctx.fill();
        }
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
//
// The blending follows the server's race clock (`time` in each update), not the moment an
// update arrived. Over Wi-Fi, updates often arrive in bunches: nothing for a tenth of a second,
// then three at once. Going by arrival time would make every car stop and jump; going by the
// race clock keeps it smooth, as long as the bunching is shorter than `delay`.
export function createSnapshots(delay = 80) {
  const buffer = [];
  let offset = null; // this screen's clock minus the race clock, for the updates that arrived fastest
  let wasMoving = false;
  return {
    push(message) {
      const at = performance.now();
      const lag = at - message.time;
      const last = buffer.at(-1);
      // The race clock stands still on the grid and goes back to zero for a new race. Then
      // only the newest update matters: there is nothing to blend.
      const moving = !!last && message.time > last.time;
      if (!moving) buffer.length = 0;
      // A late update has a bigger lag. Trust the quickest ones at once and drift up only
      // slowly. After a stop (the grid, a question) the two clocks are matched up again.
      if (offset === null || !moving || !wasMoving || Math.abs(lag - offset) > 400) offset = lag;
      else offset = lag < offset ? lag : offset + (lag - offset) * 0.02;
      wasMoving = moving;
      const cars = new Map(message.cars.map(([id, x, y, a, lap, place, done, v, boost, off]) => [id, { x, y, a, lap, place, done: !!done, v, boost: !!boost, off: !!off }]));
      buffer.push({ at, time: message.time, cars });
      while (buffer.length > 20) buffer.shift();
    },
    latest: () => buffer.at(-1) ?? null,
    sample() {
      if (!buffer.length) return new Map();
      const when = performance.now() - offset - delay; // on the race clock
      let older = buffer.at(-1);
      let newer = buffer.at(-1);
      // Walk back from the newest update to the two that the wanted moment lies between.
      for (let i = buffer.length - 1; i >= 0; i--) {
        older = buffer[i];
        if (older.time <= when) break;
        newer = older;
      }
      const span = newer.time - older.time;
      const t = span > 0 ? Math.max(0, Math.min(1, (when - older.time) / span)) : 1;
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

// A connection to the server that looks after itself. `onOpen` runs on every (re)connect. The server sends a heartbeat every second
// and a half; if nothing is heard for a few seconds the connection is dead (a phone that
// changed Wi-Fi does not notice by itself), so it is dropped and opened again. While it is
// down, a banner says so: a frozen picture with no explanation looks like a broken game.
//
// send(message) returns true if the message went out.
export function connect({ onOpen, onMessage, onClose }) {
  let socket;
  let heard = 0;
  let wasOpen = false;
  const banner = Object.assign(document.createElement('div'), { id: 'offline', hidden: true, textContent: 'Connection lost. Reconnecting…' });
  document.body.append(banner);
  const open = () => {
    const mine = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket = mine;
    heard = performance.now();
    mine.onopen = () => {
      if (socket !== mine) return;
      heard = performance.now();
      wasOpen = true;
      banner.hidden = true;
      onOpen?.();
    };
    mine.onmessage = (event) => {
      if (socket !== mine) return;
      heard = performance.now();
      const message = JSON.parse(event.data);
      if (message.t !== 'hb') onMessage(message);
    };
    mine.onclose = () => {
      if (socket !== mine) return; // an old connection that was already replaced
      socket = null;
      banner.hidden = !wasOpen; // nothing to say before the first connection
      onClose?.();
      setTimeout(open, 1000);
    };
  };
  open();
  setInterval(() => {
    if (!socket || performance.now() - heard < 5000) return;
    const dead = socket;
    dead.onclose(); // do not wait for the browser to notice: that can take minutes
    dead.close();
  }, 1000);
  return (message) => {
    if (socket?.readyState !== 1) return false;
    socket.send(JSON.stringify(message));
    return true;
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
