// Car movement, respawning, collisions, and road-object physics.
// This module knows nothing about rooms, WebSockets, or questions beyond the data it receives.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carTuning, CAR_TYPES } from '../shared/cars.js';
import { PROP_KINDS } from '../shared/props.js';
import { WORLD } from '../shared/track.js';

export const MAX_SPEED = 430;
const OFFROAD_SPEED = 170;
const ACCEL = 320;
const BRAKE = 700;
const TURN = 2.7;
const CAR_RADIUS = 24;
const CAR_BUMPER = 21;
const SMASH_SPEED = 260;
const SMASH_LANDING = 300;
const GRAVITY = 1100;
const FLY_OVER = 26;
const BOOST_SPEED = 1.3;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CARS = JSON.parse(fs.readFileSync(path.join(ROOT, '../shared/cars.json'), 'utf8'));
const TUNING = CAR_TYPES.map((type) => carTuning(CARS.types[type].stats));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, n) => ((value % n) + n) % n;

export function createRacePhysics({ broadcast }) {
  function respawn(track, car) {
    [car.x, car.y] = track.points[car.index];
    car.a = track.angles[car.index];
    car.v = 0;
    car.steer = 0;
    car.lost = 0;
    car.wrong = 0;
  }

  function autoSteer(track, player) {
    const { car } = player;
    const ahead = mod(car.index + 9, track.n);
    const [x, y] = track.points[ahead];
    const side = track.angles[ahead] + Math.PI / 2;
    let turn = Math.atan2(y + Math.sin(side) * player.lane - car.y, x + Math.cos(side) * player.lane - car.x) - car.a;
    turn = mod(turn + Math.PI, 2 * Math.PI) - Math.PI;
    return clamp(turn * 2.5, -1, 1);
  }

  function stepCar(room, player, dt) {
    const { track } = room;
    const { car } = player;
    let best = 0;
    let off = Infinity;
    for (let k = -4; k <= 14; k++) {
      const [x, y] = track.points[mod(car.index + k, track.n)];
      const d = Math.hypot(car.x - x, car.y - y);
      if (d < off) {
        off = d;
        best = k;
      }
    }
    if (off < track.width * 0.9) {
      car.index = mod(car.index + best, track.n);
      car.progress += best;
      car.lost = 0;
    } else car.lost += dt;
    let facing = car.a - track.angles[car.index];
    facing = mod(facing + Math.PI, 2 * Math.PI) - Math.PI;
    car.wrong = Math.abs(facing) > 2.1 && car.v > 60 ? car.wrong + dt : 0;
    if (car.lost > 2.2 || car.wrong > 1.5) respawn(track, car);

    const input = player.bot || car.done || !player.connected ? autoSteer(track, player) : player.steer;
    car.steer += (input - car.steer) * Math.min(1, 12 * dt);
    const onRoad = off < track.width / 2 + 4;
    car.offRoad = !onRoad;
    const boosted = !car.done && room.raceTime < player.boostUntil;
    const tune = TUNING[player.type];
    let top = (onRoad ? MAX_SPEED * tune.topSpeed : OFFROAD_SPEED * tune.offRoad) * player.pace * (1 - tune.cornerLoss * Math.abs(car.steer));
    if (boosted) top *= BOOST_SPEED;
    if (car.done) top *= 0.45;
    car.v = car.v < top ? Math.min(top, car.v + ACCEL * tune.accel * (boosted ? 2.5 : 1) * dt) : Math.max(top, car.v - BRAKE * dt);
    car.a += car.steer * TURN * tune.turn * dt * Math.min(1, car.v / 160);
    car.x = clamp(car.x + Math.cos(car.a) * car.v * dt, 20, WORLD.width - 20);
    car.y = clamp(car.y + Math.sin(car.a) * car.v * dt, 20, WORLD.height - 20);
    car.lap = clamp(Math.floor(car.progress / track.n) + 1, 1, room.laps);
    if (!car.done && car.progress >= room.laps * track.n) {
      car.done = true;
      car.finishTime = room.raceTime;
      room.firstFinish ??= room.raceTime;
    }
  }

  function pushApart(players) {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i].car;
        const b = players[j].car;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.001) {
          dx = players[j].id >= players[i].id ? 1 : -1;
          dy = 0;
          d = 1;
        }
        const overlap = CAR_RADIUS * 2 - d;
        if (overlap <= 0) continue;
        const massA = TUNING[players[i].type].mass;
        const massB = TUNING[players[j].type].mass;
        const pushA = (overlap / d) * (massA === massB ? 0.5 : massA < massB ? 1 : 0);
        const pushB = (overlap / d) * (massA === massB ? 0.5 : massB < massA ? 1 : 0);
        a.x -= dx * pushA;
        a.y -= dy * pushA;
        b.x += dx * pushB;
        b.y += dy * pushB;
        const behind = a.progress < b.progress ? a : b;
        const heavier = a.progress < b.progress ? massA > massB : massB > massA;
        behind.v *= heavier ? 0.95 : 0.85;
      }
    }
  }

  function launch(prop, nx, ny, closing, share) {
    const kind = PROP_KINDS[prop.kind];
    const power = closing * (1.5 + Math.random() * 0.9) * share;
    const swerve = (Math.random() - 0.5) * 1.1;
    prop.vx += (nx * Math.cos(swerve) - ny * Math.sin(swerve)) * power;
    prop.vy += (nx * Math.sin(swerve) + ny * Math.cos(swerve)) * power;
    prop.vz = Math.max(prop.vz, closing * (0.7 + Math.random() * 0.7) * kind.lift);
    prop.spin = (Math.random() - 0.5) * 30;
    prop.moving = true;
  }

  function smash(room, prop, extra) {
    broadcast(room, { t: 'break', id: prop.id, x: Math.round(prop.x), y: Math.round(prop.y), vx: Math.round(prop.vx), vy: Math.round(prop.vy), ...extra });
  }

  function stepProps(room, dt) {
    const { props } = room;
    for (const player of room.players) {
      const { car } = player;
      if (car.v < 30) continue;
      const carMass = 2 + Math.sqrt(TUNING[player.type].mass);
      const headingX = Math.cos(car.a);
      const headingY = Math.sin(car.a);
      for (const prop of props) {
        if (prop.gone || prop.z > FLY_OVER) continue;
        const kind = PROP_KINDS[prop.kind];
        const reach = CAR_BUMPER + kind.radius;
        const dx = prop.x - car.x;
        const dy = prop.y - car.y;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const d = Math.hypot(dx, dy);
        if (d >= reach) continue;
        const nx = d ? dx / d : headingX;
        const ny = d ? dy / d : headingY;
        prop.x = car.x + nx * (reach + 0.5);
        prop.y = car.y + ny * (reach + 0.5);
        const closing = (headingX * car.v - prop.vx) * nx + (headingY * car.v - prop.vy) * ny;
        if (closing <= 0) continue;
        launch(prop, nx, ny, closing, carMass / (carMass + kind.mass));
        if (kind.breaks && closing > SMASH_SPEED && Math.random() < 0.45) {
          prop.gone = true;
          smash(room, prop);
        } else if (prop.kind === 'dummy' && closing > SMASH_SPEED) smash(room, prop, { limb: true });
      }
    }
    for (const prop of props) {
      if (prop.gone || !prop.moving) continue;
      const kind = PROP_KINDS[prop.kind];
      prop.x = clamp(prop.x + prop.vx * dt, 20, WORLD.width - 20);
      prop.y = clamp(prop.y + prop.vy * dt, 20, WORLD.height - 20);
      prop.a += prop.spin * dt;
      if (prop.z > 0 || prop.vz > 0) {
        prop.vz -= GRAVITY * dt;
        prop.z += prop.vz * dt;
        if (prop.z <= 0) {
          prop.z = 0;
          if (kind.breaks && prop.vz < -SMASH_LANDING) {
            prop.gone = true;
            smash(room, prop);
            continue;
          }
          prop.vz = prop.vz < -150 ? -prop.vz * kind.bounce : 0;
          prop.vx *= 0.8;
          prop.vy *= 0.8;
        }
      }
      const drag = Math.exp(-(prop.z > 0 ? 0.25 : kind.friction) * dt);
      prop.vx *= drag;
      prop.vy *= drag;
      prop.spin *= Math.exp(-(prop.z > 0 ? 0.3 : kind.friction) * dt);
      if (prop.z > FLY_OVER) continue;
      for (const other of props) {
        if (other === prop || other.gone || other.z > FLY_OVER) continue;
        const otherKind = PROP_KINDS[other.kind];
        const reach = kind.radius + otherKind.radius;
        const dx = other.x - prop.x;
        const dy = other.y - prop.y;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= reach) continue;
        const nx = dx / d;
        const ny = dy / d;
        const total = kind.mass + otherKind.mass;
        prop.x -= nx * (reach - d) * (otherKind.mass / total);
        prop.y -= ny * (reach - d) * (otherKind.mass / total);
        other.x += nx * (reach - d) * (kind.mass / total);
        other.y += ny * (reach - d) * (kind.mass / total);
        const closing = (prop.vx - other.vx) * nx + (prop.vy - other.vy) * ny;
        if (closing <= 0) continue;
        const impulse = (1.8 * closing) / (1 / kind.mass + 1 / otherKind.mass);
        prop.vx -= (impulse / kind.mass) * nx;
        prop.vy -= (impulse / kind.mass) * ny;
        other.vx += (impulse / otherKind.mass) * nx;
        other.vy += (impulse / otherKind.mass) * ny;
        other.spin += (Math.random() - 0.5) * 16;
        if (closing > 110) other.vz = Math.max(other.vz, closing * 0.4 * otherKind.lift);
        other.moving = true;
      }
      if (prop.z === 0 && prop.vz === 0 && Math.hypot(prop.vx, prop.vy) < 8) Object.assign(prop, { vx: 0, vy: 0, spin: 0, moving: false, settled: true });
    }
  }

  return { respawn, stepCar, pushApart, stepProps };
}
