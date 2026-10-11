// The worlds: what the map looks like, and how each one changes from polluted to clean.
//
// A world is a recipe (see WORLDS at the bottom): colours, plus lists of the plants, polluting
// machines, rubbish and strange landmarks to scatter. createScene() follows the recipe once per
// track. paintScene() draws the still picture. createLife() draws what moves, every frame.
//
// `green` always runs from 0 (polluted) to 1 (clean), in every world.
import { gridSlot, seededRandom, WORLD } from '/shared/track.js';

export const TAU = Math.PI * 2;
const BIN = 512; // scenery is sorted into squares this big, so a phone only draws what is near
const MASK = 60; // cell size of the rough "is this road?" map

export const clamp01 = (value) => Math.max(0, Math.min(1, value));
const channels = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
// Blends two "#rrggbb" colours. t = 0 gives `from`, t = 1 gives `to`.
export function mixColor(from, to, t, alpha = 1) {
  const a = channels(from);
  const b = channels(to);
  const k = clamp01(t);
  const c = a.map((value, i) => Math.round(value + (b[i] - value) * k));
  return alpha === 1 ? `rgb(${c})` : `rgba(${c}, ${alpha})`;
}
export const tint = (dirty, clean, green) => Math.round(dirty + (clean - dirty) * green);
const paint = (rgb, alpha) => `rgba(${rgb}, ${alpha})`;

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}
function oval(ctx, x, y, rx, ry, turn = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, turn, 0, TAU);
  ctx.fill();
}
function star(ctx, x, y, points, outer, inner, turn = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = turn + (i * Math.PI) / points;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

// Every piece of scenery has its own moment to change, so the map heals bit by bit instead of
// all at once. `when` is 0..1; the result goes 0 -> 1 as `green` passes it.
export const grown = (green, when, span = 0.16) => clamp01((green - when * (1 - span)) / span);

// A steady pseudo-random number for thing number `n`, the same on every screen.
export const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const wrap = (value, span) => ((value % span) + span) % span;

// ---------- Plants ----------
// Each returns { crown, draw(ctx, x, y, life, wasThere) }. `life` is 0 (dead) to 1 (in full
// leaf). `wasThere` is true for plants that stand dead at the start, false for new growth.

const PLANTS = {
  leafy(r) {
    const twigs = Array.from({ length: 6 }, (_, k) => [(k / 6) * TAU + r.between(-0.4, 0.4), r.between(14, 26)]);
    const crown = r.between(24, 40);
    const leaf = r.pick([['#2f8f43', '#48b257'], ['#27803a', '#3fa04e'], ['#3d9a3a', '#63bd4f']]);
    return {
      crown,
      draw(ctx, x, y, life, wasThere) {
        if (wasThere && life < 1) {
          ctx.strokeStyle = '#4f4840';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          for (const [turn, reach] of twigs) line(ctx, x, y, x + Math.cos(turn) * reach, y + Math.sin(turn) * reach);
          ctx.fillStyle = '#3f3933';
          circle(ctx, x, y, 6);
        }
        if (life <= 0) return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        circle(ctx, x + 8, y + 10, crown * life);
        ctx.fillStyle = leaf[0];
        circle(ctx, x + 2, y + 3, crown * life);
        ctx.fillStyle = leaf[1];
        circle(ctx, x - 4, y - 5, crown * 0.68 * life);
      },
    };
  },
  pine(r) {
    const crown = r.between(24, 40);
    const turn = r.between(0, 1);
    return {
      crown,
      draw(ctx, x, y, life, wasThere) {
        if (wasThere && life < 1) { // a burnt trunk with a few stubs
          ctx.strokeStyle = '#3d3a3c';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          for (let k = 0; k < 5; k++) line(ctx, x, y, x + Math.cos(turn + k * 1.26) * 15, y + Math.sin(turn + k * 1.26) * 15);
          ctx.fillStyle = '#2c2a2c';
          circle(ctx, x, y, 6);
        }
        if (life <= 0) return;
        ctx.fillStyle = 'rgba(20, 40, 60, 0.18)';
        circle(ctx, x + 8, y + 10, crown * life);
        [['#1f5a3a', 1], ['#2c7a4b', 0.72], ['#3f9a5f', 0.46]].forEach(([shade, size], i) => {
          ctx.fillStyle = shade;
          star(ctx, x, y, 9, crown * size * life, crown * size * life * 0.7, turn + i * 0.3);
        });
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // snow on the tip
        star(ctx, x, y, 6, crown * 0.24 * life, crown * 0.12 * life, turn);
      },
    };
  },
  palm(r) {
    const crown = r.between(30, 46);
    const fronds = Array.from({ length: 7 }, (_, k) => (k / 7) * TAU + r.between(-0.25, 0.25));
    return {
      crown,
      draw(ctx, x, y, life, wasThere) {
        if (wasThere && life < 1) { // dry fronds hanging from a stump
          ctx.strokeStyle = '#6b5a45';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          for (const turn of fronds) line(ctx, x, y, x + Math.cos(turn) * crown * 0.6, y + Math.sin(turn) * crown * 0.6);
          ctx.fillStyle = '#4d4033';
          circle(ctx, x, y, 7);
        }
        if (life <= 0) return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        circle(ctx, x + 9, y + 11, crown * 0.8 * life);
        fronds.forEach((turn, k) => {
          ctx.fillStyle = k % 2 ? '#3fa653' : '#2f8f46';
          oval(ctx, x + Math.cos(turn) * crown * 0.5 * life, y + Math.sin(turn) * crown * 0.5 * life, crown * 0.56 * life, crown * 0.17 * life, turn);
        });
        ctx.fillStyle = '#7a5a36';
        circle(ctx, x, y, 7 * life);
      },
    };
  },
  cactus(r) {
    const crown = r.between(16, 26);
    const arms = [r.between(0, TAU), r.between(0, TAU)];
    const flower = r.pick(['#ff7fb0', '#ffd84d', '#ff9a4a']);
    return {
      crown,
      draw(ctx, x, y, life, wasThere) {
        if (wasThere && life < 1) {
          ctx.fillStyle = '#7b7362';
          circle(ctx, x, y, crown * 0.55);
          ctx.fillStyle = '#5e5749';
          circle(ctx, x - 3, y - 3, crown * 0.25);
        }
        if (life <= 0) return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        circle(ctx, x + 6, y + 8, crown * life);
        ctx.fillStyle = '#3f9a55';
        for (const turn of arms) circle(ctx, x + Math.cos(turn) * crown * 0.8 * life, y + Math.sin(turn) * crown * 0.8 * life, crown * 0.45 * life);
        circle(ctx, x, y, crown * life);
        ctx.strokeStyle = '#2c7a41';
        ctx.lineWidth = 2;
        for (let k = 0; k < 4; k++) line(ctx, x - Math.cos(k * 0.79) * crown * life, y - Math.sin(k * 0.79) * crown * life, x + Math.cos(k * 0.79) * crown * life, y + Math.sin(k * 0.79) * crown * life);
        ctx.fillStyle = flower;
        circle(ctx, x, y, crown * 0.28 * life);
      },
    };
  },
  mushroom(r) {
    const giant = r.random() < 0.12;
    const crown = giant ? r.between(70, 110) : r.between(22, 46);
    const cap = r.pick(['#4a7dff', '#ff6fb5', '#9b6bff', '#35d6c8']);
    const spots = Array.from({ length: 6 }, () => [r.between(-0.55, 0.55), r.between(-0.55, 0.55), r.between(0.08, 0.17)]);
    return {
      crown,
      glow: giant ? cap : null,
      draw(ctx, x, y, life, wasThere) {
        if (!wasThere && life <= 0) return;
        const size = crown * (wasThere ? 0.62 + 0.38 * life : life); // sick mushrooms are shrunken
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        circle(ctx, x + size * 0.18, y + size * 0.22, size);
        ctx.fillStyle = mixColor('#6d6a3e', cap, life);
        circle(ctx, x, y, size);
        ctx.fillStyle = mixColor('#8a8450', '#ffffff', life, 0.28);
        circle(ctx, x - size * 0.2, y - size * 0.22, size * 0.62);
        ctx.fillStyle = mixColor('#3d3b22', '#fdf6ff', life, 0.85);
        for (const [dx, dy, s] of spots) circle(ctx, x + dx * size, y + dy * size, s * size);
      },
    };
  },
  coral(r) {
    const crown = r.between(18, 34);
    const color = r.pick(['#ff6f91', '#ff9a4a', '#c77dff', '#ffd166', '#ff5fa2']);
    const lobes = Array.from({ length: 7 }, (_, k) => [(k / 7) * TAU + r.between(-0.3, 0.3), r.between(0.45, 0.8), r.between(0.3, 0.46)]);
    return {
      crown,
      draw(ctx, x, y, life, wasThere) {
        if (!wasThere && life <= 0) return;
        const scale = crown * (wasThere ? 1 : life);
        // Bleached and grey when the sea is sick; full of colour when it is clean.
        ctx.fillStyle = mixColor('#a7a493', color, life);
        for (const [turn, reach, size] of lobes) circle(ctx, x + Math.cos(turn) * scale * reach, y + Math.sin(turn) * scale * reach, scale * size);
        ctx.fillStyle = mixColor('#8f8c7c', '#ffffff', life, 0.35 + life * 0.3);
        for (const [turn, reach, size] of lobes) circle(ctx, x + Math.cos(turn) * scale * reach - 2, y + Math.sin(turn) * scale * reach - 2, scale * size * 0.45);
      },
    };
  },
};

// ---------- Polluting machines ----------
// Each returns { reach, draw(ctx, clean), ...notes for the animation }. `clean` is 0..1.

const POLLUTERS = {
  factory(r, x, y, look) {
    const w = r.between(140, 210);
    const h = r.between(95, 130);
    const turned = r.random() < 0.5;
    const solar = r.random() < 0.5;
    const fw = turned ? h : w;
    const fh = turned ? w : h;
    const vents = [-1, 1].map((side) => [x + side * fw * 0.22, y - fh * 0.12]);
    return {
      reach: 260, half: fw / 2, vents, top: 'turbine',
      draw(ctx, clean) {
        if (look.soot) { // soot on the snow around it
          ctx.fillStyle = `rgba(40, 38, 40, ${0.3 * (1 - clean)})`;
          oval(ctx, x + 20, y - 10, fw * 1.2, fh * 1.1);
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(x - fw / 2 + 10, y - fh / 2 + 12, fw, fh);
        ctx.fillStyle = mixColor('#5e5e66', '#5a9c4c', clean);
        ctx.fillRect(x - fw / 2, y - fh / 2, fw, fh);
        ctx.fillStyle = solar ? mixColor('#6f6f78', '#2f4f8f', clean) : mixColor('#6f6f78', '#74b862', clean);
        for (let k = 0; k < 4; k++) {
          if (turned) ctx.fillRect(x - fw / 2 + 6, y - fh / 2 + 8 + (k * fh) / 4, fw - 12, fh / 8);
          else ctx.fillRect(x - fw / 2 + 8 + (k * fw) / 4, y - fh / 2 + 6, fw / 8, fh - 12);
        }
        for (const [cx, cy] of vents) {
          ctx.fillStyle = '#3b3b41';
          circle(ctx, cx, cy, 15);
          ctx.fillStyle = '#1f1f23';
          circle(ctx, cx, cy, 8);
        }
      },
    };
  },
  // An oil pump. Its arm (drawn by the animation) nods while the land is polluted.
  pumpjack(r, x, y) {
    const flip = r.random() < 0.5 ? 1 : -1;
    return {
      reach: 200, half: 80, vents: [], flip,
      draw(ctx, clean) {
        ctx.fillStyle = `rgba(30, 26, 24, ${0.5 * (1 - clean)})`; // spilled oil
        oval(ctx, x + flip * 30, y + 8, 120, 74);
        ctx.fillStyle = mixColor('#6a5f52', '#cdb98a', clean);
        ctx.fillRect(x - 74, y - 24, 148, 48);
        ctx.fillStyle = '#3a3634';
        ctx.fillRect(x - flip * 62 - 16, y - 16, 32, 32);
        if (clean <= 0) return;
        ctx.globalAlpha = clean; // solar panels take over
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = '#2f4f8f';
          ctx.fillRect(x - 70 + k * 50, y + 40, 42, 30);
          ctx.fillStyle = '#6f8fd0';
          ctx.fillRect(x - 70 + k * 50, y + 54, 42, 2);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  // A stack that burns off gas. The flame is drawn by the animation.
  flare(r, x, y) {
    return {
      reach: 220, half: 30, vents: [[x, y]], flame: true,
      draw(ctx, clean) {
        ctx.fillStyle = `rgba(34, 28, 24, ${0.45 * (1 - clean)})`;
        oval(ctx, x, y, 90, 70);
        ctx.fillStyle = mixColor('#55504a', '#b9ad8f', clean);
        circle(ctx, x, y, 28);
        ctx.fillStyle = '#2a2622';
        circle(ctx, x, y, 14);
      },
    };
  },
  // An oil platform standing in the sea, in the middle of its own slick.
  rig(r, x, y) {
    const slick = Array.from({ length: 5 }, () => [r.between(-110, 110), r.between(-90, 90), r.between(80, 150), r.between(50, 100), r.between(0, 3)]);
    return {
      reach: 320, half: 75, vents: [[x + 96, y - 96]], flame: true, top: 'turbine',
      draw(ctx, clean) {
        if (clean < 1) {
          for (const [dx, dy, rx, ry, turn] of slick) {
            ctx.fillStyle = `rgba(26, 22, 28, ${0.42 * (1 - clean)})`;
            oval(ctx, x + dx, y + dy, rx, ry, turn);
            ctx.strokeStyle = `rgba(190, 140, 210, ${0.3 * (1 - clean)})`; // rainbow film on the oil
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.ellipse(x + dx, y + dy, rx * 0.7, ry * 0.7, turn, 0, TAU);
            ctx.stroke();
          }
        }
        ctx.fillStyle = '#26262a';
        for (const [sx, sy] of [[-62, -62], [62, -62], [-62, 62], [62, 62]]) circle(ctx, x + sx, y + sy, 17);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(x - 65, y - 61, 150, 150);
        ctx.fillStyle = mixColor('#6d6a63', '#dcd9cf', clean);
        ctx.fillRect(x - 75, y - 75, 150, 150);
        ctx.strokeStyle = mixColor('#a88a2a', '#f2c230', clean);
        ctx.lineWidth = 7;
        ctx.setLineDash([14, 14]);
        ctx.strokeRect(x - 70, y - 70, 140, 140);
        ctx.setLineDash([]);
        ctx.fillStyle = mixColor('#4a4a50', '#3fae6a', clean); // helicopter pad
        circle(ctx, x - 26, y + 26, 32);
        ctx.strokeStyle = '#f2f2f2';
        ctx.lineWidth = 5;
        line(ctx, x - 37, y + 14, x - 37, y + 38);
        line(ctx, x - 15, y + 14, x - 15, y + 38);
        line(ctx, x - 37, y + 26, x - 15, y + 26);
        ctx.strokeStyle = '#3a3a3f';
        ctx.lineWidth = 11;
        line(ctx, x + 40, y - 40, x + 96, y - 96);
      },
    };
  },
  // A round tank of glowing goo, leaking into puddles.
  vat(r, x, y) {
    const puddles = Array.from({ length: 3 }, (_, k) => [(k / 3) * TAU + r.between(-0.5, 0.5), r.between(90, 140), r.between(24, 44)]);
    return {
      reach: 220, half: 58, vents: [[x, y]], goo: true,
      draw(ctx, clean) {
        for (const [turn, reach, size] of puddles) {
          const px = x + Math.cos(turn) * reach;
          const py = y + Math.sin(turn) * reach;
          ctx.strokeStyle = '#353a30';
          ctx.lineWidth = 9;
          line(ctx, x, y, px, py);
          ctx.fillStyle = mixColor('#a8d43a', '#4aa6e4', clean, 0.85);
          oval(ctx, px, py, size * 1.3, size, turn);
          ctx.fillStyle = mixColor('#dcf57a', '#bfe8ff', clean, 0.7);
          oval(ctx, px - 4, py - 4, size * 0.6, size * 0.45, turn);
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        circle(ctx, x + 8, y + 10, 60);
        ctx.fillStyle = '#2f342c';
        circle(ctx, x, y, 60);
        ctx.fillStyle = mixColor('#b7e23a', '#3fa6d8', clean);
        circle(ctx, x, y, 48);
        ctx.fillStyle = mixColor('#e6ff8a', '#a9e0ff', clean, 0.7);
        circle(ctx, x - 12, y - 14, 20);
        if (clean >= 1) { // a water lily where the goo was
          ctx.fillStyle = '#3f9a55';
          circle(ctx, x + 14, y + 12, 15);
          ctx.fillStyle = '#ff9ec4';
          star(ctx, x + 14, y + 12, 6, 9, 4);
        }
      },
    };
  },
};

// ---------- Rubbish ----------
// Each returns { reach, draw(ctx, x, y, left) }. `left` goes from 1 down to 0 as it is cleared.

const CLUTTER = {
  rubbish(r) {
    const bits = Array.from({ length: 6 }, () => [r.between(-22, 22), r.between(-22, 22), r.between(5, 12), r.random()]);
    return {
      reach: 40,
      draw(ctx, x, y, left) {
        ctx.globalAlpha = left;
        for (const [dx, dy, size, shade] of bits) {
          ctx.fillStyle = ['#5a5650', '#a39d92', '#6c6a72', '#8a6f52', '#7d8a8f'][Math.floor(shade * 5)];
          ctx.fillRect(x + dx, y + dy, size, size * 0.8);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  heap(r) {
    const lumps = Array.from({ length: 7 }, () => [r.between(-60, 60), r.between(-45, 45), r.between(28, 56)]);
    const specks = Array.from({ length: 16 }, () => [r.between(-70, 70), r.between(-55, 55), r.between(5, 11), r.random()]);
    return {
      reach: 130, fade: [0.2, 0.9], span: 0.25, scavenged: true,
      draw(ctx, x, y, left) {
        ctx.globalAlpha = left;
        ctx.fillStyle = '#5b5248';
        for (const [dx, dy, size] of lumps) circle(ctx, x + dx + 6, y + dy + 8, size);
        ctx.fillStyle = '#74695c';
        for (const [dx, dy, size] of lumps) circle(ctx, x + dx, y + dy, size);
        for (const [dx, dy, size, shade] of specks) {
          ctx.fillStyle = ['#b9b2a4', '#4b4f58', '#a4573f', '#c9c05a'][Math.floor(shade * 4)];
          ctx.fillRect(x + dx, y + dy, size, size * 0.7);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  barrel(r) {
    const leaking = r.random() < 0.45;
    const lean = r.between(0, 6);
    return {
      reach: 50, fade: [0.05, 0.6],
      draw(ctx, x, y, left) {
        ctx.globalAlpha = left;
        if (leaking) {
          ctx.fillStyle = 'rgba(150, 165, 50, 0.7)';
          oval(ctx, x + Math.cos(lean) * 18, y + Math.sin(lean) * 18, 26, 16, lean);
        }
        ctx.fillStyle = '#3b3430';
        circle(ctx, x + 3, y + 4, 14);
        ctx.fillStyle = leaking ? '#8a8f3a' : '#8a5a3a';
        circle(ctx, x, y, 13);
        ctx.fillStyle = '#2d2824';
        circle(ctx, x, y, 5);
        ctx.globalAlpha = 1;
      },
    };
  },
  // Old tyres and a rusty panel, half buried.
  scrap(r) {
    const tyres = Array.from({ length: 3 }, () => [r.between(-30, 30), r.between(-26, 26), r.between(11, 16)]);
    const turn = r.between(0, 3);
    return {
      reach: 60, fade: [0.1, 0.8],
      draw(ctx, x, y, left) {
        ctx.globalAlpha = left;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(turn);
        ctx.fillStyle = '#8a5a3a';
        ctx.fillRect(-26, -9, 52, 18);
        ctx.fillStyle = '#6b422a';
        ctx.fillRect(-26, -2, 52, 4);
        ctx.restore();
        for (const [dx, dy, size] of tyres) {
          ctx.fillStyle = '#242326';
          circle(ctx, x + dx, y + dy, size);
          ctx.fillStyle = '#56504a';
          circle(ctx, x + dx, y + dy, size * 0.45);
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  // A patch of oil floating on the sea.
  slick(r) {
    const blobs = Array.from({ length: 4 }, () => [r.between(-50, 50), r.between(-40, 40), r.between(40, 80), r.between(26, 50), r.between(0, 3)]);
    return {
      reach: 150, fade: [0.1, 0.85], span: 0.25,
      draw(ctx, x, y, left) {
        for (const [dx, dy, rx, ry, turn] of blobs) {
          ctx.fillStyle = `rgba(24, 20, 26, ${0.5 * left})`;
          oval(ctx, x + dx, y + dy, rx, ry, turn);
          ctx.strokeStyle = `rgba(120, 200, 190, ${0.3 * left})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, rx * 0.6, ry * 0.6, turn, 0, TAU);
          ctx.stroke();
        }
      },
    };
  },
  // Bottles, bags and nets drifting on the water.
  plastic(r) {
    const bits = Array.from({ length: 10 }, () => [r.between(-44, 44), r.between(-36, 36), r.between(6, 15), r.between(0, 3), r.random()]);
    return {
      reach: 70, fade: [0.05, 0.7], scavenged: true,
      draw(ctx, x, y, left) {
        ctx.globalAlpha = left;
        ctx.strokeStyle = 'rgba(210, 215, 205, 0.5)'; // a torn net holding it together
        ctx.lineWidth = 2;
        for (let k = 0; k + 1 < bits.length; k += 2) line(ctx, x + bits[k][0], y + bits[k][1], x + bits[k + 1][0], y + bits[k + 1][1]);
        for (const [dx, dy, size, turn, shade] of bits) {
          ctx.save();
          ctx.translate(x + dx, y + dy);
          ctx.rotate(turn);
          ctx.fillStyle = ['#f2f2ee', '#cfe7f5', '#e86a5a', '#f2d24a', '#7fc7e8', '#9fd87a'][Math.floor(shade * 6)];
          ctx.fillRect(-size / 2, -size / 4, size, size / 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      },
    };
  },
  // Soot lying on the snow.
  soot(r) {
    const blots = Array.from({ length: 5 }, () => [r.between(-70, 70), r.between(-50, 50), r.between(40, 90), r.between(26, 56), r.between(0, 3)]);
    return {
      reach: 170, fade: [0, 0.8], span: 0.3,
      draw(ctx, x, y, left) {
        ctx.fillStyle = `rgba(48, 46, 50, ${0.26 * left})`;
        for (const [dx, dy, rx, ry, turn] of blots) oval(ctx, x + dx, y + dy, rx, ry, turn);
      },
    };
  },
  // A puddle of glowing goo.
  goo(r) {
    const blobs = Array.from({ length: 4 }, () => [r.between(-26, 26), r.between(-20, 20), r.between(16, 34)]);
    return {
      reach: 80, fade: [0.05, 0.75],
      draw(ctx, x, y, left) {
        ctx.fillStyle = `rgba(150, 200, 50, ${0.75 * left})`;
        for (const [dx, dy, size] of blobs) circle(ctx, x + dx, y + dy, size);
        ctx.fillStyle = `rgba(225, 255, 130, ${0.7 * left})`;
        for (const [dx, dy, size] of blobs) circle(ctx, x + dx - 3, y + dy - 3, size * 0.45);
      },
    };
  },
};

// ---------- Strange landmarks ----------
// A few per map. Each returns { reach, draw(ctx, green), glow?, blink? }.

const WEIRD = {
  // The skeleton of something enormous.
  bones(r, x, y) {
    const turn = r.between(0, TAU);
    const length = r.between(210, 290);
    return {
      reach: 340,
      draw(ctx, green) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(turn);
        for (const [shade, shift] of [['rgba(0, 0, 0, 0.2)', 9], [mixColor('#9b958a', '#f4efe1', green), 0]]) {
          ctx.strokeStyle = shade;
          ctx.fillStyle = shade;
          ctx.lineCap = 'round';
          ctx.lineWidth = 13;
          line(ctx, -length / 2, shift, length / 2, shift);
          ctx.lineWidth = 8;
          for (let i = 0; i < 7; i++) {
            const px = -length * 0.36 + i * length * 0.11;
            const reach = 84 - Math.abs(i - 2.5) * 11;
            for (const side of [-1, 1]) {
              ctx.beginPath();
              ctx.moveTo(px, shift);
              ctx.quadraticCurveTo(px + 30, side * reach * 0.7 + shift, px - 8, side * reach + shift);
              ctx.stroke();
            }
          }
          oval(ctx, length / 2 + 40, shift, 50, 34);
        }
        ctx.fillStyle = '#2b2a2c';
        circle(ctx, length / 2 + 52, -13, 9);
        circle(ctx, length / 2 + 52, 13, 9);
        ctx.fillStyle = `rgba(74, 170, 90, ${green})`; // moss creeping over it
        for (let i = 0; i < 9; i++) circle(ctx, -length / 2 + hash(i + x) * length, (hash(i + y) - 0.5) * 20, 6 + hash(i) * 6);
        ctx.restore();
      },
    };
  },
  // A satellite that fell out of the sky. One light is still blinking.
  satellite(r, x, y) {
    const turn = r.between(0, TAU);
    return {
      reach: 240, blink: [x + Math.cos(turn) * 20, y + Math.sin(turn) * 20],
      draw(ctx, green) {
        ctx.fillStyle = `rgba(30, 26, 24, ${0.5 * (1 - green)})`; // scorched ground
        oval(ctx, x, y, 170, 110, turn);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(turn);
        for (const [side, bend] of [[-1, 0], [1, 0.45]]) {
          ctx.save();
          ctx.translate(side * 44, 0);
          ctx.rotate(side * bend);
          ctx.fillStyle = '#243f7a';
          ctx.fillRect(side > 0 ? 0 : -110, -22, 110, 44);
          ctx.strokeStyle = '#7f9bd8';
          ctx.lineWidth = 2;
          for (let k = 1; k < 5; k++) line(ctx, (side > 0 ? 0 : -110) + k * 22, -22, (side > 0 ? 0 : -110) + k * 22, 22);
          line(ctx, side > 0 ? 0 : -110, 0, side > 0 ? 110 : 0, 0);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(-36, -22, 84, 56);
        ctx.fillStyle = mixColor('#8a7d5a', '#d9b84a', green);
        ctx.fillRect(-42, -28, 84, 56);
        ctx.fillStyle = '#d9dde2';
        circle(ctx, -8, 0, 20);
        ctx.fillStyle = '#9aa0a8';
        circle(ctx, -8, 0, 8);
        ctx.restore();
        ctx.fillStyle = `rgba(70, 165, 85, ${green})`; // plants growing over it
        for (let i = 0; i < 8; i++) circle(ctx, x + (hash(i + x) - 0.5) * 220, y + (hash(i + y) - 0.5) * 130, 8 + hash(i) * 8);
      },
    };
  },
  // Crystals pushing up out of the ground. They glow, sickly at first.
  crystals(r, x, y) {
    const color = r.pick(['#59d9ff', '#ff8fd0', '#b08cff']);
    const shards = Array.from({ length: 7 }, (_, k) => [(k / 7) * TAU + r.between(-0.3, 0.3), r.between(60, 130), r.between(16, 28)]);
    return {
      reach: 220, glow: ['#a6c93a', color, 190],
      draw(ctx, green) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        oval(ctx, x + 10, y + 14, 80, 60);
        for (const [turn, reach, thick] of shards) {
          const tipX = x + Math.cos(turn) * reach;
          const tipY = y + Math.sin(turn) * reach;
          const sideX = -Math.sin(turn) * thick;
          const sideY = Math.cos(turn) * thick;
          const midX = x + Math.cos(turn) * reach * 0.35;
          const midY = y + Math.sin(turn) * reach * 0.35;
          for (const [side, shade] of [[1, mixColor('#8fae3a', color, green)], [-1, mixColor('#b9d45a', '#ffffff', green * 0.6)]]) {
            ctx.fillStyle = shade;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(midX + sideX * side, midY + sideY * side);
            ctx.lineTo(tipX, tipY);
            ctx.closePath();
            ctx.fill();
          }
        }
      },
    };
  },
  // A ring of standing stones. Something in the middle wakes up when the land is healed.
  stones(r, x, y) {
    const turn = r.between(0, TAU);
    return {
      reach: 200, ring: true,
      draw(ctx, green) {
        ctx.strokeStyle = mixColor('#6a665e', '#bfe3a0', green);
        ctx.lineWidth = 5;
        for (const size of [38, 62]) {
          ctx.beginPath();
          ctx.arc(x, y, size, 0, TAU);
          ctx.stroke();
        }
        for (let k = 0; k < 9; k++) {
          const a = turn + (k / 9) * TAU;
          ctx.save();
          ctx.translate(x + Math.cos(a) * 104, y + Math.sin(a) * 104);
          ctx.rotate(a);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.fillRect(-12, -15, 34, 40);
          ctx.fillStyle = mixColor('#77746f', '#aeaaa2', green);
          ctx.fillRect(-16, -20, 32, 40);
          ctx.fillStyle = `rgba(80, 160, 90, ${green * 0.8})`;
          ctx.fillRect(-16, -20, 12, 40);
          ctx.restore();
        }
      },
    };
  },
  // A ship that sank, or froze in, long ago.
  wreck(r, x, y) {
    const turn = r.between(0, TAU);
    const grow = r.pick(['#ff6f91', '#ffd166', '#c77dff']);
    return {
      reach: 260,
      draw(ctx, green) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(turn);
        const hull = (inset) => {
          ctx.beginPath();
          ctx.moveTo(-170 + inset, 0);
          ctx.quadraticCurveTo(-60, -66 + inset, 150 - inset, -38 + inset * 0.6);
          ctx.lineTo(150 - inset, 38 - inset * 0.6);
          ctx.quadraticCurveTo(-60, 66 - inset, -170 + inset, 0);
          ctx.fill();
        };
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.translate(10, 12);
        hull(0);
        ctx.translate(-10, -12);
        ctx.fillStyle = mixColor('#3f332b', '#6b5646', green);
        hull(0);
        ctx.fillStyle = mixColor('#2c2420', '#8a7460', green);
        hull(16);
        ctx.strokeStyle = '#2a211c';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        line(ctx, -20, 0, 70, -70); // the broken mast
        ctx.fillStyle = '#17120f';
        oval(ctx, 60, 8, 26, 14, 0.4); // a hole in the deck
        ctx.fillStyle = grow; // life taking it over
        ctx.globalAlpha = green;
        for (let i = 0; i < 10; i++) circle(ctx, -150 + hash(i + x) * 290, (hash(i + y) - 0.5) * 70, 7 + hash(i) * 8);
        ctx.globalAlpha = 1;
        ctx.restore();
      },
    };
  },
};

// ---------- Building the map ----------

// Works out, once per track, where everything goes. It uses the track's seed, so the big screen
// and every phone end up with exactly the same map.
export function createScene(track) {
  const theme = WORLDS[track.world] ?? WORLDS.forest;
  const random = seededRandom(track.seed);
  const r = { random, between: (min, max) => min + random() * (max - min), pick: (list) => list[Math.floor(random() * list.length)] };
  const { between } = r;
  const { points, width } = track;
  const items = [];
  const add = (layer, x, y, reach, draw) => items.push({ layer, x, y, r: reach, draw });
  // What createLife() animates.
  const life = { polluters: [], ponds: [], heaps: [], plants: [], glows: [], rings: [], blinks: [] };

  const roadDistance = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < points.length; i += 3) best = Math.min(best, Math.hypot(points[i][0] - x, points[i][1] - y));
    return best - width / 2;
  };
  // The map is split into zones (0 industrial, 1 dump, 2 wild, 3 wet, 4 bare), so that factories
  // cluster in one place and forests in another instead of everything being mixed evenly.
  const centres = Array.from({ length: 16 }, (_, i) => ({ x: between(0, WORLD.width), y: between(0, WORLD.height), zone: [0, 1, 2, 3, 4, 2, 4][i % 7] }));
  const zoneAt = (x, y) => {
    let best = centres[0];
    let bestD = Infinity;
    for (const centre of centres) {
      const d = Math.hypot(centre.x - x, centre.y - y);
      if (d < bestD) {
        bestD = d;
        best = centre;
      }
    }
    return best.zone;
  };
  let river = [];
  const riverGap = (x, y) => {
    let best = Infinity;
    for (const [rx, ry] of river) best = Math.min(best, Math.hypot(rx - x, ry - y));
    return best;
  };
  // Tries `count` random spots. Every try uses the same number of random numbers whether or not
  // it is kept, which is what keeps all screens in step. `zones` is the chance in each zone.
  const scatter = (count, clear, zones, make) => {
    for (let i = 0; i < count; i++) {
      const x = between(30, WORLD.width - 30);
      const y = between(30, WORLD.height - 30);
      const roll = random();
      const build = make(x, y);
      if (roll < (zones ? zones[zoneAt(x, y)] : 1) && riverGap(x, y) > 150 && roadDistance(x, y) > clear) build();
    }
  };
  // Big things (machines, landmarks) keep their distance from each other.
  const big = [];
  const roomFor = (x, y, gap) => {
    if (big.some(([bx, by]) => Math.hypot(bx - x, by - y) < gap)) return false;
    big.push([x, y]);
    return true;
  };
  const plant = (kind, x, y, wasThere) => {
    const made = PLANTS[kind](r);
    const when = wasThere ? between(0, 0.8) : between(0.25, 1);
    return () => {
      life.plants.push({ x, y, when, crown: made.crown, kind });
      if (made.glow) life.glows.push({ x, y, when, reach: made.crown * 1.9, colors: ['#9aa63a', made.glow] });
      add(4, x, y, made.crown * 1.3 + 20, (ctx, green) => made.draw(ctx, x, y, grown(green, when, 0.2), wasThere));
    };
  };

  // Layer 0: patches on the ground, and cracks where it has dried out.
  for (let i = 0; i < 900; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const rx = between(60, 230);
    const ry = between(45, 160);
    const turn = between(0, 3);
    const [dirty, clean] = theme.patches[i % theme.patches.length];
    add(0, x, y, rx, (ctx, green) => {
      ctx.fillStyle = mixColor(dirty, clean, green, 0.4);
      oval(ctx, x, y, rx, ry, turn);
    });
  }
  for (let i = 0; i < 500; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const steps = Array.from({ length: 4 }, () => [between(-34, 34), between(-34, 34)]);
    if (!theme.cracks) continue;
    add(0, x, y, 80, (ctx, green) => {
      if (green > 0.6) return;
      ctx.strokeStyle = paint(theme.cracks, 0.5 * (1 - green / 0.6));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x;
      let py = y;
      for (const [dx, dy] of steps) ctx.lineTo(px += dx, py += dy);
      ctx.stroke();
    });
  }

  // Layer 1: a river (or, at sea, a deep channel) crossing the whole map. The road is drawn on
  // top of it, like a bridge.
  if (theme.river) {
    const riverY = between(0.25, 0.75) * WORLD.height;
    const waves = [[between(500, 900), between(0.5, 0.9), between(0, 6)], [between(200, 380), between(1.6, 2.6), between(0, 6)]];
    for (let x = -200; x <= WORLD.width + 200; x += 150) {
      river.push([x, riverY + waves.reduce((sum, [size, cycles, phase]) => sum + size * Math.sin((x / WORLD.width) * cycles * TAU + phase), 0)]);
    }
    const path = new Path2D();
    river.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    const { bank, water, shine } = theme.river;
    add(1, WORLD.width / 2, WORLD.height / 2, Infinity, (ctx, green) => {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      [[210, bank], [160, water], [70, shine]].forEach(([lineWidth, [dirty, clean]]) => {
        ctx.strokeStyle = mixColor(dirty, clean, green);
        ctx.lineWidth = lineWidth;
        ctx.stroke(path);
      });
    });
  }

  // Layer 1: islands of sand in the sea, each with a few palms.
  if (theme.islands) {
    scatter(theme.islands.count, 190, null, (x, y) => {
      const blobs = Array.from({ length: 6 }, () => [between(-80, 80), between(-60, 60), between(60, 110)]);
      const palms = Array.from({ length: 3 }, () => plant('palm', x + between(-70, 70), y + between(-50, 50), true));
      const [dirty, clean] = theme.islands.sand;
      const [shallowDirty, shallowClean] = theme.islands.shallows;
      return () => {
        add(1, x, y, 230, (ctx, green) => {
          ctx.fillStyle = mixColor(shallowDirty, shallowClean, green, 0.6);
          for (const [dx, dy, size] of blobs) circle(ctx, x + dx, y + dy, size + 26);
          ctx.fillStyle = mixColor(dirty, clean, green);
          for (const [dx, dy, size] of blobs) circle(ctx, x + dx, y + dy, size);
        });
        for (const build of palms) build();
      };
    });
  }

  // Layer 1: ponds.
  if (theme.pond) {
    const { rim, water } = theme.pond;
    scatter(theme.pond.count, 130, theme.pond.zones, (x, y) => {
      const blobs = Array.from({ length: 6 }, () => [between(-60, 60), between(-45, 45), between(36, 68)]);
      const spots = Array.from({ length: 5 }, () => [between(-55, 55), between(-40, 40), between(8, 16), random()]);
      const when = random();
      return () => life.ponds.push({ x, y, when }) && add(1, x, y, 150, (ctx, green) => {
        const clean = grown(green, when, 0.3);
        ctx.fillStyle = mixColor(rim[0], rim[1], clean);
        for (const [dx, dy, size] of blobs) circle(ctx, x + dx, y + dy, size + 8);
        ctx.fillStyle = mixColor(water[0], water[1], clean);
        for (const [dx, dy, size] of blobs) circle(ctx, x + dx, y + dy, size);
        for (const [dx, dy, size, shade] of spots) {
          // A film of oil on dirty water; something growing on clean water.
          ctx.fillStyle = clean < 0.5
            ? `rgba(${shade < 0.5 ? '150, 110, 170' : '110, 150, 120'}, ${0.5 * (1 - clean * 2)})`
            : paint(theme.pond.pads, (clean - 0.5) * 2);
          circle(ctx, x + dx, y + dy, size);
        }
      });
    });
  }

  // Layer 2: rubbish. It goes away as the map is cleaned.
  for (const spec of theme.clutter) {
    scatter(spec.count, spec.clear, spec.zones, (x, y) => {
      const made = CLUTTER[spec.kind](r);
      const when = between(...(made.fade ?? [0.05, 0.75]));
      return () => {
        if (made.scavenged) life.heaps.push({ x, y, when, span: made.span ?? 0.16 });
        add(2, x, y, made.reach, (ctx, green) => {
          const left = 1 - grown(green, when, made.span ?? 0.16);
          if (left > 0) made.draw(ctx, x, y, left);
        });
      };
    });
  }

  // Layer 3: small bright things that only appear once an area is clean.
  scatter(theme.blooms.count, 30, theme.blooms.zones, (x, y) => {
    const dots = Array.from({ length: 6 }, () => [between(-26, 26), between(-26, 26)]);
    const color = r.pick(theme.blooms.colors);
    const when = between(0.35, 1);
    return () => add(3, x, y, 40, (ctx, green) => {
      const open = grown(green, when);
      if (open <= 0) return;
      ctx.fillStyle = color;
      for (const [dx, dy] of dots) {
        if (theme.blooms.shape === 'star') star(ctx, x + dx, y + dy, 5, 8 * open, 3.5 * open, dx);
        else circle(ctx, x + dx, y + dy, 5 * open);
      }
    });
  });

  // Layer 3: a few strange landmarks.
  for (const [kind, wanted] of theme.weird) {
    let placed = 0;
    scatter(wanted * 8, 250, [0.15, 0.3, 1, 0.6, 1], (x, y) => {
      const made = WEIRD[kind](r, x, y);
      return () => {
        if (placed >= wanted || !roomFor(x, y, 560)) return;
        placed++;
        if (made.glow) life.glows.push({ x, y, when: 0, reach: made.glow[2], colors: made.glow, always: true });
        if (made.ring) life.rings.push({ x, y });
        if (made.blink) life.blinks.push(made.blink);
        add(3, x, y, made.reach, made.draw);
      };
    });
  }

  // Layer 4: plants. Dead at first; each one comes back at its own moment.
  for (const spec of theme.plants) scatter(spec.count, spec.clear, spec.zones, (x, y) => plant(spec.kind, x, y, spec.wasThere));

  // Layer 5: the machines that are doing the polluting.
  for (const spec of theme.polluters) {
    scatter(spec.count, spec.clear, spec.zones, (x, y) => {
      const made = POLLUTERS[spec.kind](r, x, y, spec);
      const when = between(0.3, 0.9);
      return () => {
        if (!roomFor(x, y, spec.gap ?? 300)) return;
        life.polluters.push({ x, y, when, kind: spec.kind, vents: made.vents, half: made.half, flame: made.flame, top: made.top, goo: made.goo, flip: made.flip });
        add(5, x, y, made.reach, (ctx, green) => made.draw(ctx, grown(green, when, 0.25)));
      };
    });
  }

  // Layer 6: clouds of smog hanging over everything.
  for (let i = 0; i < 260; i++) {
    const x = between(0, WORLD.width);
    const y = between(0, WORLD.height);
    const rx = between(220, 520);
    const ry = between(140, 300);
    const when = random();
    add(6, x, y, rx, (ctx, green) => {
      const left = 1 - grown(green, when, 0.3);
      if (left <= 0) return;
      ctx.fillStyle = paint(theme.life.smog, 0.13 * left);
      oval(ctx, x, y, rx, ry);
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
  life.plantBins = new Map();
  for (const one of life.plants) {
    const key = `${Math.floor(one.x / BIN)},${Math.floor(one.y / BIN)}`;
    if (!life.plantBins.has(key)) life.plantBins.set(key, []);
    life.plantBins.get(key).push(one);
  }

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
  const cells = Math.ceil((width / 2 + 30) / MASK);
  for (const [px, py] of points) {
    for (let cx = -cells; cx <= cells; cx++) {
      for (let cy = -cells; cy <= cells; cy++) mask.add((Math.floor(px / MASK) + cx) * 4096 + Math.floor(py / MASK) + cy);
    }
  }
  life.onRoad = (x, y) => mask.has(Math.floor(x / MASK) * 4096 + Math.floor(y / MASK));
  life.river = river;
  const windAngle = between(-1.0, -0.35); // smoke and clouds drift up and to the right
  life.wind = [Math.cos(windAngle), Math.sin(windAngle)];
  return { track, theme, bins, everywhere, road, corners, life };
}

// Draws one part of the still map. `ctx` must already be set up in world units.
export function paintScene(ctx, scene, green, region = { x0: 0, y0: 0, x1: WORLD.width, y1: WORLD.height }) {
  const { track, theme, bins, everywhere, road, corners } = scene;
  const { points, width } = track;
  const reach = 560; // the widest thing that can stick into this region from outside it
  const near = (x, y, pad = 220) => x > region.x0 - pad && x < region.x1 + pad && y > region.y0 - pad && y < region.y1 + pad;

  ctx.fillStyle = mixColor(theme.ground[0], theme.ground[1], green);
  ctx.fillRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);

  const shown = [...everywhere];
  for (let bx = Math.floor((region.x0 - reach) / BIN); bx <= Math.floor((region.x1 + reach) / BIN); bx++) {
    for (let by = Math.floor((region.y0 - reach) / BIN); by <= Math.floor((region.y1 + reach) / BIN); by++) {
      for (const item of bins.get(`${bx},${by}`) ?? []) if (near(item.x, item.y, item.r + 40)) shown.push(item);
    }
  }
  shown.sort((a, b) => a.layer - b.layer || a.order - b.order);
  for (const item of shown) item.draw(ctx, green);

  // A haze over the land that clears as the map heals. The road stays crisp.
  ctx.fillStyle = paint(theme.haze.slice(0, 3), theme.haze[3] * (1 - green));
  ctx.fillRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const stroke = (lineWidth, color, dash = []) => {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke(road);
  };
  if (theme.road.shadow) stroke(width + 120, theme.road.shadow); // a raised road throws a shadow
  stroke(width + 46, mixColor(theme.road.shoulder[0], theme.road.shoulder[1], green));
  if (theme.road.planks) stroke(width + 46, theme.road.planks, [10, 22]); // boards along the edge
  stroke(width + 16, '#dedede'); // kerb
  stroke(width + 16, mixColor('#74747a', '#d83a3a', green), [42, 42]);
  stroke(width, mixColor(theme.road.asphalt[0], theme.road.asphalt[1], green));
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

// ---------- Things that move ----------

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

// A fish, a duck or a whale: a body pointing along `heading` with a tail that wags.
function drawSwimmer(ctx, x, y, heading, size, wag, body, tail) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(-size * 0.8, 0);
  ctx.lineTo(-size * 1.6, -size * 0.55 + wag * size * 0.4);
  ctx.lineTo(-size * 1.6, size * 0.55 + wag * size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = body;
  oval(ctx, 0, 0, size, size * 0.45);
  ctx.restore();
}

function softGlow(ctx, x, y, reach, rgb, alpha) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
  glow.addColorStop(0, paint(rgb, alpha));
  glow.addColorStop(1, paint(rgb, 0));
  ctx.fillStyle = glow;
  circle(ctx, x, y, reach);
}

// Everything on the map that moves by itself. It is drawn every frame on top of the still
// picture, so it has to stay cheap: only things inside `region` are drawn.
//   ground(): under the cars. sky(): over the cars.
//   seconds: a clock. pixel: world units per screen pixel, so the big screen (which shows the
//   whole map very small) can draw birds and smoke large enough to see.
//   lite: true on a phone that is struggling; the small decorative things are skipped.
export function createLife(scene) {
  const { life, track, theme } = scene;
  const look = theme.life;
  const [windX, windY] = life.wind;
  const inside = (region, x, y, pad) => x > region.x0 - pad && x < region.x1 + pad && y > region.y0 - pad && y < region.y1 + pad;
  // Runs `draw(tileX, tileY, k, id)` for a fixed number of slots in every square of the world
  // that touches the region. Used for things that are everywhere: waves, ash, butterflies.
  const perTile = (region, size, slots, draw) => {
    for (let tx = Math.floor(region.x0 / size); tx <= Math.floor(region.x1 / size); tx++) {
      for (let ty = Math.floor(region.y0 / size); ty <= Math.floor(region.y1 / size); ty++) {
        for (let k = 0; k < slots; k++) draw(tx * size, ty * size, k, (tx * 73 + ty * 151) * slots + k);
      }
    }
  };

  const flow = []; // the river cut into short steps, so ripples can ride along it
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
  // Things that wander in big slow circles: schools of fish, whales, dust devils.
  const rovers = Array.from({ length: 12 }, (_, i) => ({
    x: WORLD.width * (0.12 + hash(i + 61) * 0.76), y: WORLD.height * (0.12 + hash(i + 67) * 0.76),
    reach: 260 + hash(i + 71) * 420, speed: (0.05 + hash(i + 73) * 0.07) * (i % 2 ? 1 : -1), start: hash(i + 79) * TAU,
  }));
  const roverAt = (rover, seconds) => {
    const turn = rover.start + seconds * rover.speed;
    return { x: rover.x + Math.cos(turn) * rover.reach, y: rover.y + Math.sin(turn) * rover.reach * 0.7, heading: Math.atan2(Math.cos(turn) * 0.7 * Math.sign(rover.speed), -Math.sin(turn) * Math.sign(rover.speed)) };
  };

  return {
    ground(ctx, green, seconds, region, pixel, lite = false) {
      const close = pixel < 3 && !lite;

      // Ripples drifting down the river: dull on sludge, bright on clean water.
      if (theme.river) {
        const [dirty, clean] = theme.river.ripple;
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
            if (life.onRoad(x, y)) continue; // the road crosses on a bridge
            ctx.strokeStyle = paint(dirty.map((value, c) => tint(value, clean[c], green)), Math.sin(phase * Math.PI) * 0.55);
            line(ctx, x, y, x + Math.cos(step.angle) * 30, y + Math.sin(step.angle) * 30);
          }
        });
      }

      // Waves rolling across open water.
      if (look.waves) {
        const size = pixel < 3 ? 420 : 900;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(3.5, pixel * 0.7);
        perTile(region, size, pixel < 3 ? 3 : 2, (tx, ty, k, id) => {
          const phase = (seconds * 0.25 + hash(id)) % 1;
          const x = tx + hash(id + 0.3) * size + windX * phase * 150;
          const y = ty + hash(id + 0.6) * size + windY * phase * 150;
          if (life.onRoad(x, y)) return;
          const reach = Math.max(26, pixel * 5);
          ctx.strokeStyle = paint([tint(150, 255, green), tint(142, 255, green), tint(120, 255, green)], Math.sin(phase * Math.PI) * (0.22 + 0.33 * green));
          ctx.beginPath();
          ctx.moveTo(x - reach, y);
          ctx.quadraticCurveTo(x - reach / 2, y - reach * 0.35, x, y);
          ctx.quadraticCurveTo(x + reach / 2, y + reach * 0.35, x + reach, y);
          ctx.stroke();
        });
      }

      // Schools of fish and slow whales, once the water can hold them.
      if (look.sea) {
        const swimming = Math.round(8 * clamp01((green - 0.3) / 0.5));
        for (let i = 0; i < swimming; i++) {
          const lead = roverAt(rovers[i], seconds * 2.2);
          if (!inside(region, lead.x, lead.y, 300)) continue;
          const size = Math.max(9, pixel * 2.4);
          for (let k = 0; k < 8; k++) {
            const x = lead.x - Math.cos(lead.heading) * (k % 4) * size * 2.6 + Math.sin(lead.heading) * (Math.floor(k / 4) - 0.5) * size * 3 + Math.sin(seconds * 2 + k) * 4;
            const y = lead.y - Math.sin(lead.heading) * (k % 4) * size * 2.6 - Math.cos(lead.heading) * (Math.floor(k / 4) - 0.5) * size * 3 + Math.cos(seconds * 2 + k) * 4;
            if (life.onRoad(x, y)) continue;
            drawSwimmer(ctx, x, y, lead.heading, size, Math.sin(seconds * 9 + k), ['#ff9a3a', '#ffd84d', '#f4f6f8', '#ff6f91'][i % 4], 'rgba(255, 255, 255, 0.7)');
          }
        }
        const whales = green > 0.55 ? 3 : 0;
        for (let i = 0; i < whales; i++) {
          const whale = roverAt(rovers[8 + i], seconds * 0.5);
          if (!inside(region, whale.x, whale.y, 400) || life.onRoad(whale.x, whale.y)) continue;
          const size = Math.max(95, pixel * 13);
          drawSwimmer(ctx, whale.x, whale.y, whale.heading, size, Math.sin(seconds * 1.4 + i) * 0.6, 'rgba(38, 66, 96, 0.8)', 'rgba(38, 66, 96, 0.8)');
          const blow = (seconds * 0.25 + hash(i + 5)) % 1; // it comes up to breathe now and then
          if (blow < 0.25) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - blow * 4)})`;
            ctx.lineWidth = Math.max(4, pixel);
            ctx.beginPath();
            ctx.arc(whale.x + Math.cos(whale.heading) * size * 0.6, whale.y + Math.sin(whale.heading) * size * 0.6, size * (0.15 + blow * 1.6), 0, TAU);
            ctx.stroke();
          }
        }
      }

      // Ponds: bubbles rise through dirty water; something swims once it is clean.
      life.ponds.forEach((pond, index) => {
        if (!inside(region, pond.x, pond.y, 160)) return;
        const clean = grown(green, pond.when, 0.3);
        if (clean <= 0.85) {
          ctx.lineWidth = Math.max(2, pixel * 0.5);
          for (let k = 0; k < 3; k++) {
            const id = index * 3 + k;
            const phase = (seconds * 0.5 + hash(id + 0.2)) % 1;
            ctx.strokeStyle = paint(look.bubbles, (1 - phase) * 0.8 * (1 - clean));
            ctx.beginPath();
            ctx.arc(pond.x + (hash(id + 0.4) - 0.5) * 90, pond.y + (hash(id + 0.6) - 0.5) * 60, (3 + phase * 10) * Math.max(1, pixel / 2.5), 0, TAU);
            ctx.stroke();
          }
          return;
        }
        const size = Math.max(8, pixel * 2.2);
        for (let k = 0; k < 2; k++) {
          const turn = seconds * 0.45 + k * Math.PI + index;
          const x = pond.x + Math.cos(turn) * 36;
          const y = pond.y + Math.sin(turn * 2) * 15;
          const heading = Math.atan2(Math.cos(turn * 2) * 30, -Math.sin(turn) * 36);
          if (theme.pond.swimmer === 'wisp') { // a little floating light
            softGlow(ctx, x, y, size * 3.2, '170, 255, 225', 0.5 + 0.3 * Math.sin(seconds * 3 + k));
            ctx.fillStyle = '#f2fff9';
            circle(ctx, x, y, size * 0.4);
          } else if (theme.pond.swimmer === 'penguin') { // waddling round the edge of the hole
            const px = pond.x + Math.cos(turn * 0.6) * 84;
            const py = pond.y + Math.sin(turn * 0.6) * 62;
            const lean = Math.sin(seconds * 7 + k) * 0.25;
            ctx.fillStyle = '#1d2026';
            oval(ctx, px, py, size * 0.8, size, lean);
            ctx.fillStyle = '#f7f7f2';
            oval(ctx, px, py + size * 0.15, size * 0.45, size * 0.62, lean);
            ctx.fillStyle = '#f2a23a';
            circle(ctx, px, py - size * 0.75, size * 0.2);
          } else if (theme.pond.swimmer === 'fish') {
            drawSwimmer(ctx, x, y, heading, size * 0.9, Math.sin(seconds * 9 + k), '#ff9a3a', '#ffd9a8');
          } else { // a duck (or, in the desert, a flamingo)
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(heading);
            ctx.fillStyle = theme.pond.swimmer === 'flamingo' ? '#ff8fb3' : '#fdfdf6';
            oval(ctx, 0, 0, size, size * 0.62);
            circle(ctx, size * 0.8, 0, size * 0.42);
            ctx.fillStyle = '#f08a2b';
            circle(ctx, size * 1.22, 0, size * 0.2);
            ctx.restore();
          }
        }
        if (close) { // a glint of sunlight on the water
          const flash = (seconds * 0.7 + hash(index)) % 1;
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.sin(flash * Math.PI) * 0.9})`;
          ctx.lineWidth = 2.5;
          const gx = pond.x + (hash(index + Math.floor(seconds * 0.7 + hash(index))) - 0.5) * 80;
          const gy = pond.y + (hash(index + 0.5 + Math.floor(seconds * 0.7 + hash(index))) - 0.5) * 50;
          line(ctx, gx - 9, gy, gx + 9, gy);
          line(ctx, gx, gy - 9, gx, gy + 9);
        }
      });

      // Machines that move on the ground: oil pumps nod, goo bubbles.
      life.polluters.forEach((machine, index) => {
        if (!inside(region, machine.x, machine.y, 260)) return;
        const clean = grown(green, machine.when, 0.25);
        if (machine.kind === 'pumpjack') {
          const nod = clean < 1 ? Math.sin(seconds * 1.7 + index) * 16 * (1 - clean) : 0;
          ctx.lineCap = 'round';
          ctx.strokeStyle = mixColor('#3c3a3a', '#8f8770', clean);
          ctx.lineWidth = 13;
          line(ctx, machine.x - machine.flip * 52, machine.y, machine.x + machine.flip * (64 + nod), machine.y);
          ctx.fillStyle = mixColor('#9a2f22', '#b9ad8f', clean);
          circle(ctx, machine.x + machine.flip * (64 + nod), machine.y, 17);
        }
        if (machine.goo && clean < 1) {
          ctx.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            const phase = (seconds * 0.8 + hash(index * 3 + k)) % 1;
            ctx.strokeStyle = `rgba(240, 255, 170, ${(1 - phase) * (1 - clean)})`;
            ctx.beginPath();
            ctx.arc(machine.x + (hash(index + k) - 0.5) * 60, machine.y + (hash(index + k + 0.5) - 0.5) * 60, 4 + phase * 12, 0, TAU);
            ctx.stroke();
          }
        }
      });

      // Light breathing in and out of crystals and giant mushrooms.
      life.glows.forEach((one, index) => {
        if (!inside(region, one.x, one.y, one.reach)) return;
        const alive = one.always ? green : grown(green, one.when, 0.2);
        const pulse = 0.2 + 0.12 * Math.sin(seconds * 1.8 + index);
        const dirty = channels(one.colors[0]);
        const clean = channels(one.colors[1]);
        softGlow(ctx, one.x, one.y, one.reach * (1 + 0.06 * Math.sin(seconds * 1.8 + index)), dirty.map((value, c) => tint(value, clean[c], alive)), pulse * (0.5 + alive * 0.8));
      });
      // The stone circles: a ring of light turns inside once the land is healed.
      life.rings.forEach((ring, index) => {
        if (green <= 0.5 || !inside(region, ring.x, ring.y, 160)) return;
        const strength = clamp01((green - 0.5) / 0.4);
        softGlow(ctx, ring.x, ring.y, 120, '190, 255, 190', 0.3 * strength);
        ctx.strokeStyle = `rgba(215, 255, 205, ${0.8 * strength})`;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const turn = seconds * 0.8 + index + (k * TAU) / 3;
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, 50, turn, turn + 1.1);
          ctx.stroke();
        }
      });

      // Plants never hold quite still: light slides across the leaves. Close up only.
      if (close) {
        ctx.fillStyle = look.glint;
        for (let bx = Math.floor(region.x0 / BIN); bx <= Math.floor(region.x1 / BIN); bx++) {
          for (let by = Math.floor(region.y0 / BIN); by <= Math.floor(region.y1 / BIN); by++) {
            for (const one of life.plantBins.get(`${bx},${by}`) ?? []) {
              if (grown(green, one.when, 0.2) < 0.7) continue;
              circle(ctx, one.x - one.crown * 0.2 + Math.sin(seconds * 1.5 + one.x * 0.013) * one.crown * 0.16, one.y - one.crown * 0.22 + Math.cos(seconds * 1.2 + one.y * 0.011) * one.crown * 0.12, one.crown * 0.42);
            }
          }
        }
      }

      // The crowd in the grandstand, jumping up and down.
      const [startX, startY] = track.points[0];
      if (close && inside(region, startX, startY, 520)) {
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

    sky(ctx, green, seconds, region, pixel, lite = false) {
      const close = pixel < 3 && !lite;

      // Machines: smoke pours out and drifts with the wind, and some burn off gas, until they
      // are cleaned up. After that a wind turbine turns where the smoke was.
      life.polluters.forEach((machine, index) => {
        if (!inside(region, machine.x, machine.y, 440)) return;
        const clean = grown(green, machine.when, 0.25);
        if (clean < 1) {
          machine.vents.forEach(([cx, cy], c) => {
            for (let k = 0; k < 6; k++) {
              const phase = (seconds * 0.22 + k / 6 + hash(index * 2 + c)) % 1;
              const drift = phase * 250;
              const wobble = Math.sin(seconds * 1.3 + k * 2.1 + index) * 14 * phase;
              ctx.fillStyle = paint(look.smoke, 0.46 * (1 - phase) * (1 - clean));
              circle(ctx, cx + windX * drift - windY * wobble, cy + windY * drift + windX * wobble, 13 + phase * 52);
            }
            if (!machine.flame) return;
            const flicker = Math.sin(seconds * 17 + index) * 0.5 + Math.sin(seconds * 29 + index * 3) * 0.5;
            const size = Math.max(22, pixel * 4) * (1 - clean * 0.7);
            softGlow(ctx, cx, cy, size * 3.4, '255, 150, 40', 0.4 * (1 - clean));
            ctx.fillStyle = `rgba(255, 120, 30, ${0.95 * (1 - clean)})`;
            circle(ctx, cx + flicker * 3, cy - flicker * 2, size * (1 + flicker * 0.18));
            ctx.fillStyle = `rgba(255, 232, 130, ${0.95 * (1 - clean)})`;
            circle(ctx, cx - flicker * 2, cy + flicker, size * 0.55);
          });
        } else if (machine.top === 'turbine') {
          const hubX = machine.x + machine.half + 50;
          const blade = Math.max(48, pixel * 7);
          ctx.lineCap = 'round';
          for (const [shade, shift, thick] of [['rgba(0, 0, 0, 0.16)', Math.max(8, pixel * 1.5), 1.2], ['#f4f6f8', 0, 1]]) {
            ctx.strokeStyle = shade;
            ctx.lineWidth = Math.max(7, pixel * 1.1) * thick;
            ctx.beginPath();
            for (let b = 0; b < 3; b++) {
              const turn = seconds * 2.4 + index + (b * TAU) / 3;
              ctx.moveTo(hubX + shift, machine.y + shift);
              ctx.lineTo(hubX + shift + Math.cos(turn) * blade, machine.y + shift + Math.sin(turn) * blade);
            }
            ctx.stroke();
          }
          ctx.fillStyle = '#cfd4da';
          circle(ctx, hubX, machine.y, Math.max(7, pixel * 1.2));
        }
      });

      // A light still blinking on the fallen satellites.
      life.blinks.forEach(([x, y], index) => {
        if (!inside(region, x, y, 60) || Math.sin(seconds * 4 + index * 2) < 0.5) return;
        softGlow(ctx, x, y, Math.max(26, pixel * 5), '255, 60, 50', 0.8);
        ctx.fillStyle = '#ffd9d2';
        circle(ctx, x, y, Math.max(4, pixel));
      });

      // Scavengers circle over the rubbish until it is gone.
      if (look.scavenger) {
        life.heaps.forEach((heap, index) => {
          if (!inside(region, heap.x, heap.y, 220) || grown(green, heap.when, heap.span) > 0.5) return;
          const size = Math.max(15, pixel * 4);
          for (let k = 0; k < 2; k++) {
            const turn = seconds * 0.9 + k * Math.PI + index;
            const reach = 78 + Math.sin(seconds * 0.6 + index + k) * 22;
            drawBird(ctx, heap.x + Math.cos(turn) * reach, heap.y + Math.sin(turn) * reach, turn + Math.PI / 2, size, 0.55 + 0.3 * Math.sin(seconds * 8 + k), look.scavenger);
          }
        });
      }

      // Flocks cross the map. More of them come back as it heals.
      if (look.flock) {
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
            drawBird(ctx, x, y, flock.angle, size, flap, look.flock);
          }
        }
      }

      // Whirlwinds of dust wander the dry land.
      if (look.devils && green < 0.7) {
        for (let i = 0; i < 6; i++) {
          const devil = roverAt(rovers[i], seconds * 1.5);
          if (!inside(region, devil.x, devil.y, 200)) continue;
          const scale = Math.max(1, pixel / 2.2);
          for (let k = 0; k < 11; k++) {
            const turn = seconds * 6 + k * 0.9 + i;
            ctx.fillStyle = paint(look.devils, 0.3 * (1 - green / 0.7));
            circle(ctx, devil.x + Math.cos(turn) * (8 + k * 6) * scale, devil.y + Math.sin(turn) * (8 + k * 6) * scale, (7 + k * 1.3) * scale);
          }
        }
      }

      // Drifting banks of smog. As the air clears they thin out into soft cloud shadows.
      for (const cloud of clouds) {
        const x = wrap(cloud.x + windX * cloud.speed * seconds, WORLD.width + cloud.rx * 2) - cloud.rx;
        const y = wrap(cloud.y + windY * cloud.speed * seconds, WORLD.height + cloud.ry * 2) - cloud.ry;
        if (!inside(region, x, y, cloud.rx)) continue;
        ctx.fillStyle = paint(look.smog.map((value, c) => tint(value, look.shade[c], green)), 0.17 * (1 - green) + 0.06 * green);
        oval(ctx, x, y, cloud.rx, cloud.ry);
      }

      // Northern lights: ribbons of colour that sway over the snow once the sky is clear.
      if (look.aurora && green > 0.4) {
        const strength = clamp01((green - 0.4) / 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        look.aurora.forEach((rgb, band) => {
          const base = WORLD.height * (0.2 + band * 0.3);
          const at = (x) => base + 420 * Math.sin(x / 1100 + seconds * 0.16 + band * 2) + 170 * Math.sin(x / 390 - seconds * 0.23 + band);
          const from = Math.floor((region.x0 - 300) / 160) * 160;
          for (const [thick, alpha] of [[300, 0.07], [150, 0.09]]) {
            ctx.strokeStyle = paint(rgb, alpha * strength * (0.75 + 0.25 * Math.sin(seconds * 0.9 + band)));
            ctx.lineWidth = thick;
            ctx.beginPath();
            for (let x = from; x <= region.x1 + 300; x += 160) ctx.lineTo(x, at(x));
            ctx.stroke();
          }
        });
      }

      // A rainbow over the whole map, for a world that has been fully healed. Big screen only.
      if (pixel >= 3 && green > 0.94) {
        const strength = clamp01((green - 0.94) / 0.06) * 0.26;
        ctx.lineCap = 'butt';
        ctx.lineWidth = 52;
        ['255, 70, 70', '255, 160, 50', '255, 230, 70', '90, 210, 110', '80, 160, 255', '120, 100, 230', '190, 110, 220'].forEach((rgb, band) => {
          ctx.strokeStyle = paint(rgb, strength);
          ctx.beginPath();
          ctx.arc(WORLD.width / 2, WORLD.height * 1.32, WORLD.height * 1.02 - band * 52, Math.PI * 1.13, Math.PI * 1.87);
          ctx.stroke();
        });
      }

      if (!close) return;
      // Close up only: what hangs in the dirty air, and what comes back to the clean air.
      const dirty = clamp01(1 - green * 1.6);
      const fresh = clamp01((green - 0.55) / 0.45);
      const TILE = 800;
      perTile(region, TILE, 8, (tx, ty, k, id) => {
        if (dirty > 0) {
          const x = tx + wrap(hash(id) * TILE + windX * seconds * look.motes.speed, TILE);
          const y = ty + wrap(hash(id + 0.5) * TILE + windY * seconds * look.motes.speed + (look.motes.fall ?? 0) * seconds, TILE);
          ctx.fillStyle = paint(look.motes.rgb, 0.55 * dirty);
          if (look.motes.streak) ctx.fillRect(x, y, 18, 2.5);
          else circle(ctx, x + Math.sin(seconds * 1.4 + id) * 6, y, look.motes.size);
        }
        if (fresh <= 0 || k >= 5) return;
        const x = tx + hash(id + 0.2) * TILE + Math.sin(seconds * 1.7 + id) * 28;
        const y = ty + hash(id + 0.7) * TILE + Math.cos(seconds * 2.3 + id) * 22;
        if (look.fresh === 'firefly') {
          const blink = 0.5 + 0.5 * Math.sin(seconds * 3 + id);
          softGlow(ctx, x, y, 20, '200, 255, 120', 0.7 * fresh * blink);
          ctx.fillStyle = `rgba(245, 255, 200, ${fresh * blink})`;
          circle(ctx, x, y, 2.6);
        } else if (look.fresh === 'sparkle') { // sun glittering on snow or water
          const flash = Math.max(0, Math.sin(seconds * 2.2 + id * 1.7));
          ctx.strokeStyle = `rgba(255, 255, 255, ${fresh * flash})`;
          ctx.lineWidth = 2;
          line(ctx, x - 7, y, x + 7, y);
          line(ctx, x, y - 7, x, y + 7);
        } else { // a butterfly: wings opening and closing
          const wing = 3 + Math.abs(Math.sin(seconds * 12 + id)) * 4;
          ctx.globalAlpha = fresh;
          ctx.fillStyle = ['#fff7d6', '#ffd84d', '#ff9ec4', '#ffffff', '#c9a0ff'][k];
          ctx.fillRect(x - wing, y - 2.5, wing * 2, 5);
          ctx.globalAlpha = 1;
        }
      });
    },
  };
}

// ---------- The worlds ----------
// Colours come in pairs: [polluted, clean]. `zones` lists how likely something is in each kind
// of zone: [industrial, dump, wild, wet, bare].

export const WORLDS = {
  forest: {
    label: 'Dead Forest',
    ground: ['#8b877f', '#6fbf55'],
    patches: [['#7d7972', '#62ad4b'], ['#99958c', '#8fd272'], ['#857a6c', '#79c05c'], ['#6f6c68', '#58a544']],
    cracks: '60, 56, 50',
    haze: [112, 106, 98, 0.26],
    road: { shoulder: ['#746f67', '#5d9d49'], asphalt: ['#3f4046', '#45464c'] },
    river: { bank: ['#5b564e', '#4f9d57'], water: ['#494540', '#3d92d1'], shine: ['#57524b', '#63b6ee'], ripple: [[128, 120, 106], [235, 248, 255]] },
    pond: { count: 110, zones: [0.1, 0.1, 0.12, 0.85, 0.1], rim: ['#5d5962', '#4f9d57'], water: ['#46424b', '#4aa6e4'], pads: '70, 160, 80', swimmer: 'duck' },
    plants: [
      { kind: 'leafy', count: 2600, clear: 46, zones: [0.1, 0.12, 1, 0.4, 0.3], wasThere: true },
      { kind: 'leafy', count: 2600, clear: 40, zones: [0.25, 0.3, 0.9, 0.5, 0.55], wasThere: false },
    ],
    polluters: [{ kind: 'factory', count: 300, clear: 180, zones: [0.9, 0.08, 0, 0, 0.06] }],
    clutter: [
      { kind: 'rubbish', count: 1100, clear: 26, zones: [0.5, 1, 0.1, 0.15, 0.3] },
      { kind: 'heap', count: 260, clear: 110, zones: [0.05, 0.9, 0, 0, 0.05] },
      { kind: 'barrel', count: 420, clear: 40, zones: [0.8, 0.5, 0.03, 0.1, 0.08] },
    ],
    blooms: { count: 1500, zones: [0.3, 0.4, 0.5, 0.7, 0.8], colors: ['#fff7d6', '#ffd84d', '#ff9ec4', '#c9a0ff', '#ffffff'] },
    weird: [['bones', 3], ['satellite', 2], ['stones', 2]],
    life: {
      smoke: [58, 55, 58], smog: [74, 68, 60], shade: [30, 52, 34], bubbles: [176, 186, 132],
      flock: 'rgba(38, 42, 50, 0.92)', scavenger: 'rgba(24, 22, 24, 0.9)', glint: 'rgba(255, 255, 255, 0.1)',
      motes: { rgb: [52, 48, 46], speed: 60, size: 2.6 }, fresh: 'butterfly',
    },
    spray: [[142, 128, 104], [120, 150, 92]],
  },

  ocean: {
    label: 'Plastic Sea',
    ground: ['#6f7062', '#35b3c6'],
    patches: [['#63645a', '#2aa3bb'], ['#7b7c6c', '#5fcfd6'], ['#5c5d55', '#2392ad'], ['#727360', '#4bc4cf']],
    haze: [104, 100, 86, 0.22],
    road: { shadow: 'rgba(10, 30, 40, 0.2)', shoulder: ['#9a968a', '#d9d6cc'], asphalt: ['#3f4046', '#45464c'] },
    river: { bank: ['#5d5e54', '#2796b3'], water: ['#4b4c46', '#1c7a9c'], shine: ['#55564e', '#2a8fb0'], ripple: [[120, 118, 100], [200, 245, 255]] },
    islands: { count: 46, sand: ['#8c8672', '#f0deaa'], shallows: ['#7f8576', '#8fe6da'] },
    plants: [
      { kind: 'coral', count: 2400, clear: 40, zones: [0.2, 0.3, 1, 0.8, 0.5], wasThere: true },
      { kind: 'coral', count: 1800, clear: 40, zones: [0.4, 0.4, 0.8, 0.8, 0.6], wasThere: false },
    ],
    polluters: [{ kind: 'rig', count: 150, clear: 230, zones: [0.9, 0.1, 0, 0, 0.08], gap: 520 }],
    clutter: [
      { kind: 'plastic', count: 1300, clear: 30, zones: [0.5, 1, 0.3, 0.3, 0.5] },
      { kind: 'slick', count: 420, clear: 60, zones: [0.9, 0.5, 0.1, 0.1, 0.25] },
      { kind: 'barrel', count: 300, clear: 40, zones: [0.8, 0.6, 0.05, 0.05, 0.1] },
    ],
    blooms: { count: 1300, zones: [0.3, 0.4, 0.8, 0.8, 0.6], colors: ['#ff8a5c', '#ffd166', '#ff6f91', '#f4f6f8', '#c77dff'], shape: 'star' },
    weird: [['wreck', 3], ['bones', 2], ['crystals', 2]],
    life: {
      smoke: [34, 32, 36], smog: [70, 68, 58], shade: [240, 255, 255], bubbles: [150, 150, 120],
      flock: 'rgba(250, 250, 246, 0.95)', scavenger: 'rgba(236, 236, 228, 0.9)', glint: 'rgba(255, 255, 255, 0.16)',
      waves: true, sea: true, motes: { rgb: [60, 56, 50], speed: 50, size: 2.6 }, fresh: 'sparkle',
    },
    spray: [[156, 154, 132], [236, 250, 255]],
  },

  swamp: {
    label: 'Glow Swamp',
    ground: ['#5c6050', '#2f7f66'],
    patches: [['#525646', '#27705a'], ['#676b56', '#3c9478'], ['#4b4f42', '#226552'], ['#62664e', '#35886c']],
    haze: [96, 108, 70, 0.28],
    road: { shoulder: ['#5a4a38', '#7a5f3f'], planks: 'rgba(40, 30, 20, 0.35)', asphalt: ['#3a3b3f', '#404248'] },
    river: { bank: ['#4c5040', '#2a6f5a'], water: ['#70803a', '#2f8fb8'], shine: ['#9cb040', '#59c2e6'], ripple: [[190, 215, 90], [210, 250, 255]] },
    pond: { count: 300, zones: [0.3, 0.3, 0.5, 0.95, 0.4], rim: ['#474b3c', '#2a6f5a'], water: ['#7d9433', '#2f93c4'], pads: '90, 200, 130', swimmer: 'wisp' },
    plants: [
      { kind: 'mushroom', count: 2600, clear: 60, zones: [0.3, 0.3, 1, 0.7, 0.5], wasThere: true },
      { kind: 'leafy', count: 1500, clear: 46, zones: [0.1, 0.1, 0.7, 0.5, 0.3], wasThere: true },
      { kind: 'mushroom', count: 1200, clear: 50, zones: [0.3, 0.3, 0.8, 0.6, 0.5], wasThere: false },
    ],
    polluters: [{ kind: 'vat', count: 260, clear: 200, zones: [0.9, 0.2, 0, 0.05, 0.08], gap: 380 }],
    clutter: [
      { kind: 'goo', count: 1300, clear: 30, zones: [0.8, 0.9, 0.2, 0.4, 0.4] },
      { kind: 'barrel', count: 700, clear: 40, zones: [0.9, 0.7, 0.05, 0.1, 0.15] },
      { kind: 'heap', count: 200, clear: 110, zones: [0.05, 0.9, 0, 0, 0.05] },
    ],
    blooms: { count: 1700, zones: [0.4, 0.4, 0.8, 0.8, 0.7], colors: ['#7df9ff', '#ff9ef0', '#c8ff8a', '#ffffff', '#b89bff'] },
    weird: [['crystals', 4], ['stones', 3], ['bones', 2]],
    life: {
      smoke: [150, 180, 60], smog: [92, 104, 62], shade: [20, 60, 60], bubbles: [220, 245, 130],
      flock: null, scavenger: 'rgba(24, 26, 20, 0.9)', glint: 'rgba(210, 255, 250, 0.16)',
      motes: { rgb: [190, 205, 90], speed: 22, size: 3.2 }, fresh: 'firefly',
    },
    spray: [[110, 122, 66], [120, 205, 160]],
  },

  desert: {
    label: 'Oil Desert',
    ground: ['#8e8272', '#e3c98d'],
    patches: [['#817566', '#d8bb7c'], ['#9a8e7c', '#ecd6a0'], ['#786c5e', '#cfae6e'], ['#877b68', '#bfd08a']],
    cracks: '70, 58, 46',
    haze: [128, 110, 84, 0.26],
    road: { shoulder: ['#7a6d5c', '#c9ad74'], asphalt: ['#3f4046', '#45464c'] },
    river: { bank: ['#6e6252', '#6fb35a'], water: ['#4a3f36', '#3f9fd8'], shine: ['#5a4c40', '#74c4ee'], ripple: [[110, 96, 80], [235, 248, 255]] },
    pond: { count: 90, zones: [0.1, 0.1, 0.15, 0.9, 0.06], rim: ['#5e5346', '#6fb35a'], water: ['#3b322c', '#45aee0'], pads: '90, 180, 100', swimmer: 'flamingo' },
    plants: [
      { kind: 'cactus', count: 1900, clear: 40, zones: [0.2, 0.2, 0.9, 0.3, 0.6], wasThere: true },
      { kind: 'palm', count: 1500, clear: 50, zones: [0.05, 0.05, 0.4, 1, 0.1], wasThere: true },
      { kind: 'palm', count: 1200, clear: 50, zones: [0.1, 0.1, 0.5, 0.9, 0.2], wasThere: false },
      { kind: 'cactus', count: 1000, clear: 40, zones: [0.3, 0.3, 0.7, 0.3, 0.6], wasThere: false },
    ],
    polluters: [
      { kind: 'pumpjack', count: 300, clear: 150, zones: [0.9, 0.15, 0.02, 0, 0.12] },
      { kind: 'flare', count: 130, clear: 150, zones: [0.8, 0.1, 0, 0, 0.06] },
    ],
    clutter: [
      { kind: 'scrap', count: 1000, clear: 30, zones: [0.5, 1, 0.1, 0.1, 0.35] },
      { kind: 'barrel', count: 700, clear: 40, zones: [0.9, 0.6, 0.03, 0.05, 0.12] },
      { kind: 'heap', count: 220, clear: 110, zones: [0.05, 0.9, 0, 0, 0.06] },
    ],
    blooms: { count: 1400, zones: [0.2, 0.3, 0.6, 0.9, 0.6], colors: ['#ff7fb0', '#ffd84d', '#ff9a4a', '#ffffff', '#c77dff'] },
    weird: [['bones', 4], ['satellite', 2], ['stones', 2]],
    life: {
      smoke: [30, 28, 28], smog: [120, 100, 74], shade: [120, 90, 50], bubbles: [120, 100, 80],
      flock: 'rgba(50, 44, 40, 0.92)', scavenger: 'rgba(30, 24, 22, 0.9)', glint: 'rgba(255, 255, 240, 0.12)',
      devils: [176, 150, 112], motes: { rgb: [178, 152, 112], speed: 190, size: 2.4, streak: true }, fresh: 'butterfly',
    },
    spray: [[150, 132, 104], [230, 206, 150]],
  },

  ice: {
    label: 'Melting Ice',
    ground: ['#8b9096', '#eef4f8'],
    patches: [['#7e848a', '#dfeaf2'], ['#989da2', '#ffffff'], ['#767b82', '#cfe2ee'], ['#878c92', '#e6f0f6']],
    cracks: '56, 62, 70',
    haze: [104, 108, 112, 0.24],
    road: { shoulder: ['#6f7378', '#c9d6de'], asphalt: ['#3c3f46', '#444a52'] },
    river: { bank: ['#6c7076', '#bfe0f0'], water: ['#4a4d52', '#5fb8e6'], shine: ['#5a5d62', '#a9e0fa'], ripple: [[110, 112, 116], [255, 255, 255]] },
    pond: { count: 150, zones: [0.1, 0.1, 0.3, 0.9, 0.3], rim: ['#6a6e74', '#bfe0f0'], water: ['#3f4248', '#3f9fd8'], pads: '235, 248, 255', swimmer: 'penguin' },
    plants: [
      { kind: 'pine', count: 2400, clear: 46, zones: [0.1, 0.1, 1, 0.4, 0.3], wasThere: true },
      { kind: 'pine', count: 2000, clear: 40, zones: [0.2, 0.25, 0.9, 0.5, 0.45], wasThere: false },
    ],
    polluters: [{ kind: 'factory', count: 300, clear: 180, zones: [0.9, 0.08, 0, 0, 0.06], soot: true }],
    clutter: [
      { kind: 'soot', count: 900, clear: 30, zones: [1, 0.8, 0.2, 0.2, 0.5] },
      { kind: 'rubbish', count: 900, clear: 26, zones: [0.5, 1, 0.1, 0.15, 0.3] },
      { kind: 'barrel', count: 500, clear: 40, zones: [0.8, 0.5, 0.03, 0.1, 0.08] },
      { kind: 'heap', count: 200, clear: 110, zones: [0.05, 0.9, 0, 0, 0.05] },
    ],
    blooms: { count: 1300, zones: [0.3, 0.4, 0.6, 0.8, 0.8], colors: ['#bfe8ff', '#ffffff', '#d6c8ff', '#a9f0ff'], shape: 'star' },
    weird: [['wreck', 2], ['bones', 3], ['crystals', 3], ['satellite', 1]],
    life: {
      smoke: [40, 40, 44], smog: [84, 86, 92], shade: [150, 175, 200], bubbles: [150, 160, 170],
      flock: 'rgba(252, 252, 255, 0.95)', scavenger: 'rgba(28, 28, 32, 0.9)', glint: 'rgba(255, 255, 255, 0.22)',
      aurora: ['80, 255, 170', '170, 110, 255', '90, 220, 255'],
      motes: { rgb: [80, 80, 86], speed: 26, size: 3, fall: 55 }, fresh: 'sparkle',
    },
    spray: [[150, 156, 162], [255, 255, 255]],
  },
};
