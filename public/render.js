// Drawing code shared by the big screen and the phones.
import { gridSlot, seededRandom, WORLD } from '/shared/track.js';

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
export function drawCar(ctx, sheet, color, type, x, y, angle, length = CAR_LENGTH) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.roundRect(-length * 0.2 + 4, -length * 0.45 + 5, length * 0.4, length * 0.9, 8);
  ctx.fill();
  ctx.drawImage(sheet, color * CELL.width, type * CELL.height, CELL.width, CELL.height, -length / 4, -length / 2, length / 2, length);
  ctx.restore();
}

function mixColor(from, to, t) {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// Draws the whole map once into its own canvas. `green` runs from 0 (grey and polluted)
// to 1 (clean and green); the race starts at 0.
export function renderMap(track, scale, green = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WORLD.width * scale);
  canvas.height = Math.round(WORLD.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const random = seededRandom(track.seed);
  const between = (min, max) => min + random() * (max - min);
  const mix = (grey, lush) => mixColor(grey, lush, green);
  const { points, width } = track;

  const roadDistance = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i += 2) best = Math.min(best, Math.hypot(points[i][0] - x, points[i][1] - y));
    return best - width / 2;
  };
  // Finds a spot at least `clear` away from the road. Always uses the same number of random
  // draws, so every screen ends up with the same map.
  const place = (clear) => {
    let spot = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = between(40, WORLD.width - 40);
      const y = between(40, WORLD.height - 40);
      if (!spot && roadDistance(x, y) > clear) spot = [x, y];
    }
    return spot;
  };
  const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Ground.
  ctx.fillStyle = mix('#8b877f', '#7cc35e');
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = i % 2 ? mix('#7f7b74', '#6db552') : mix('#97938a', '#8bcf6c');
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(between(0, WORLD.width), between(0, WORLD.height), between(50, 210), between(40, 150), between(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Sludge ponds, which turn into blue water.
  for (let i = 0; i < 7; i++) {
    const spot = place(120);
    const blobs = Array.from({ length: 6 }, () => [between(-55, 55), between(-40, 40), between(34, 62)]);
    if (!spot) continue;
    ctx.fillStyle = mix('#5d5962', '#3f8fc4');
    for (const [dx, dy, r] of blobs) circle(spot[0] + dx, spot[1] + dy, r + 7);
    ctx.fillStyle = mix('#46424b', '#58b4ea');
    for (const [dx, dy, r] of blobs) circle(spot[0] + dx, spot[1] + dy, r);
  }

  // Rubbish.
  ctx.globalAlpha = 1 - green;
  for (let i = 0; i < 70; i++) {
    const spot = place(26);
    const bits = Array.from({ length: 6 }, () => [between(-20, 20), between(-20, 20), between(5, 11), random()]);
    if (!spot) continue;
    for (const [dx, dy, size, shade] of bits) {
      ctx.fillStyle = ['#5a5650', '#a39d92', '#6c6a72', '#7a6f60'][Math.floor(shade * 4)];
      ctx.fillRect(spot[0] + dx, spot[1] + dy, size, size * 0.8);
    }
  }
  ctx.globalAlpha = 1;

  // Trees: bare at first, with leaves as the map turns green.
  for (let i = 0; i < 150; i++) {
    const spot = place(46);
    const twigs = Array.from({ length: 6 }, (_, k) => [(k / 6) * Math.PI * 2 + between(-0.4, 0.4), between(14, 26)]);
    const crown = between(24, 38);
    if (!spot) continue;
    const [x, y] = spot;
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
    circle(x, y, 6);
    if (green > 0) {
      ctx.globalAlpha = green;
      ctx.fillStyle = '#2f8f43';
      circle(x + 3, y + 4, crown);
      ctx.fillStyle = '#48b257';
      circle(x - 3, y - 4, crown * 0.72);
      ctx.globalAlpha = 1;
    }
  }

  // Factories with smoking chimneys.
  for (let i = 0; i < 9; i++) {
    const spot = place(170);
    const w = between(130, 190);
    const h = between(90, 120);
    const turned = random() < 0.5;
    if (!spot) continue;
    const [x, y] = spot;
    const fw = turned ? h : w;
    const fh = turned ? w : h;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(x - fw / 2 + 10, y - fh / 2 + 12, fw, fh);
    ctx.fillStyle = '#5e5e66';
    ctx.fillRect(x - fw / 2, y - fh / 2, fw, fh);
    ctx.fillStyle = '#6f6f78';
    for (let k = 0; k < 4; k++) {
      if (turned) ctx.fillRect(x - fw / 2 + 6, y - fh / 2 + 8 + (k * fh) / 4, fw - 12, fh / 8);
      else ctx.fillRect(x - fw / 2 + 8 + (k * fw) / 4, y - fh / 2 + 6, fw / 8, fh - 12);
    }
    for (const side of [-1, 1]) {
      const cx = x + side * fw * 0.22;
      const cy = y - fh * 0.12;
      ctx.fillStyle = '#3b3b41';
      circle(cx, cy, 15);
      ctx.fillStyle = '#1f1f23';
      circle(cx, cy, 8);
      for (let puff = 1; puff <= 5; puff++) {
        ctx.fillStyle = `rgba(72, 70, 74, ${(0.34 - puff * 0.05) * (1 - green)})`;
        circle(cx + puff * 26, cy - puff * 20, 14 + puff * 9);
      }
    }
  }

  // Smog over everything except the road.
  ctx.fillStyle = `rgba(118, 114, 108, ${0.22 * (1 - green)})`;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  // Road.
  const road = new Path2D();
  road.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points) road.lineTo(x, y);
  road.closePath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const stroke = (lineWidth, color, dash = []) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke(road);
  };
  stroke(width + 44, mix('#746f67', '#62a44c')); // shoulder
  stroke(width + 16, '#dedede'); // kerb
  stroke(width + 16, mix('#74747a', '#d83a3a'), [42, 42]);
  stroke(width, '#3f4046'); // asphalt
  ctx.globalAlpha = 0.5;
  stroke(5, '#b4b4b8', [34, 50]);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Everything below is drawn across the road, in the road's own direction.
  const across = (index, draw) => {
    ctx.save();
    ctx.translate(points[index][0], points[index][1]);
    ctx.rotate(track.angles[index]);
    draw();
    ctx.restore();
  };
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
      ctx.fillStyle = mix('#b3ab8a', '#ffd34d');
      ctx.globalAlpha = 0.85;
      for (let k = 0; k < 8; k += 2) ctx.fillRect(-6, -width / 2 + (k * width) / 8, 12, width / 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2b2b30';
      circle(0, -width / 2 - 12, 9);
      circle(0, width / 2 + 12, 9);
    });
  }
  for (let slot = 0; slot < 6; slot++) {
    const spot = gridSlot(track, slot);
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
  across(0, () => { // start and finish line
    const squares = 10;
    const size = width / squares;
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < squares; k++) {
        ctx.fillStyle = (row + k) % 2 ? '#f2f2f2' : '#1c1c20';
        ctx.fillRect(row * size - size, -width / 2 + k * size, size, size);
      }
    }
  });
  return canvas;
}

// Keeps the last few server updates and blends between them, so cars move smoothly even
// though updates arrive only 30 times a second.
export function createSnapshots(delay = 80) {
  const buffer = [];
  return {
    push(message) {
      const cars = new Map(message.cars.map(([id, x, y, a, lap, place, done, v]) => [id, { x, y, a, lap, place, done: !!done, v }]));
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
