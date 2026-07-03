import { computeShotPct } from "./combat.js";
import { GRENADES, type Boom } from "./grenades.js";
import { losBetweenEx } from "./los.js";
import { blocked } from "./map.js";
import { findPath } from "./path.js";
import { clamp, dist, stepToward } from "./math.js";
import type { Order } from "./orders.js";
import { rngInt } from "./rng.js";
import {
  AID_RANGE, AID_TICKS, BLEED_TICKS, MOVE_SPEED, PIN_THRESHOLD, REVIVE_HP,
  type SimState, type Soldier,
} from "./state.js";
import { WEAPONS } from "./weapons.js";

/** One resolved shot this tick — consumed by the server for tracer events. */
export interface ShotEvent {
  shooter: number;
  target: number;
  hit: boolean;
  kill: boolean; // target went down (or died) from this shot
  sx: number; sy: number; tx: number; ty: number;
}

export interface TickEvents {
  shots: ShotEvent[];
  booms: Boom[];
}

const MAX_QUEUE = 64; // waypoints (pathfinding legs included)

/** Route a move order: A* waypoints, falling back to a straight line. */
function route(state: SimState, fx: number, fy: number, tx: number, ty: number): Array<[number, number]> {
  return findPath(state.obstacles, state.mapW, state.mapH, fx, fy, tx, ty) ?? [[tx, ty]];
}

function dropSoldier(s: Soldier): void {
  s.tx = null;
  s.ty = null;
  s.queue = [];
  s.aidId = null;
  s.aidProgress = 0;
  s.targetId = null;
}

/**
 * Advance the world exactly one tick. Pure with respect to (state, orders):
 * mutates `state` in place (hot path) but reads nothing else — no clocks,
 * no Math.random, no iteration over unordered collections.
 */
export function tick(state: SimState, orders: readonly Order[]): TickEvents {
  // 1. apply orders (sorted by soldierId for determinism regardless of arrival order)
  const sorted = [...orders].sort((a, b) => a.soldierId - b.soldierId);
  for (const o of sorted) {
    const s = state.soldiers[o.soldierId];
    if (!s || !s.alive || s.down) continue;
    switch (o.type) {
      case "move": {
        const mx = clamp(Math.floor(o.x), 0, state.mapW);
        const my = clamp(Math.floor(o.y), 0, state.mapH);
        if (o.queue && s.tx !== null) {
          const tail = s.queue.length > 0 ? s.queue[s.queue.length - 1]! : [s.tx, s.ty] as [number, number];
          const leg = route(state, tail[0], tail[1], mx, my);
          s.queue = [...s.queue, ...leg].slice(0, MAX_QUEUE);
        } else {
          const path = route(state, s.x, s.y, mx, my);
          const first = path[0]!;
          s.tx = first[0];
          s.ty = first[1];
          s.queue = path.slice(1, MAX_QUEUE + 1);
          if (o.mode) s.moveMode = o.mode;
        }
        s.aidId = null;
        s.aidProgress = 0;
        break;
      }
      case "mode":
        s.moveMode = o.mode;
        break;
      case "stance":
        s.stance = o.stance;
        break;
      case "target": {
        const t = o.targetId === null ? null : state.soldiers[o.targetId];
        s.targetId = t && t.alive && !t.down && t.team !== s.team ? t.id : null;
        break;
      }
      case "aid": {
        const t = state.soldiers[o.targetId];
        if (!t || !t.alive || !t.down || t.team !== s.team || t.id === s.id) break;
        s.aidId = t.id;
        s.aidProgress = 0;
        if (dist(s.x, s.y, t.x, t.y) > AID_RANGE) {
          const path = route(state, s.x, s.y, t.x, t.y);
          const first = path[0]!;
          s.tx = first[0];
          s.ty = first[1];
          s.queue = path.slice(1, MAX_QUEUE + 1);
        }
        break;
      }
      case "throw": {
        const def = GRENADES[o.kind];
        const have = o.kind === "frag" ? s.frags : s.smokes;
        if (have <= 0) break;
        let gx = clamp(Math.floor(o.x), 0, state.mapW);
        let gy = clamp(Math.floor(o.y), 0, state.mapH);
        const d = dist(s.x, s.y, gx, gy);
        if (d > def.throwRange) {
          gx = s.x + Math.floor(((gx - s.x) * def.throwRange) / d);
          gy = s.y + Math.floor(((gy - s.y) * def.throwRange) / d);
        }
        const flight = Math.max(10, Math.ceil(Math.min(d, def.throwRange) / def.flightSpeed));
        const landTick = state.tick + flight;
        state.grenades.push({
          id: state.nextGrenadeId++,
          kind: o.kind,
          thrower: s.id,
          sx: s.x, sy: s.y, x: gx, y: gy,
          thrownTick: state.tick,
          landTick,
          explodeTick: landTick + def.fuseAfterLand,
        });
        if (o.kind === "frag") s.frags -= 1; else s.smokes -= 1;
        break;
      }
      case "firemode":
        s.holdFire = o.hold;
        if (o.hold) s.targetId = null; // hold fire means STOP: clears fire orders
        break;
      case "halt":
        s.tx = null;
        s.ty = null;
        s.queue = [];
        s.aidId = null;
        s.aidProgress = 0;
        break;
    }
  }

  // 2. movement with AABB collision + wall slide over pathfound waypoints
  const prevPos = state.soldiers.map((s) => s.x * 0x40000000 + s.y); // cheap pos key
  for (const s of state.soldiers) {
    if (!s.alive || s.down || s.tx === null || s.ty === null) continue;
    // pinned soldiers can only crawl
    const speed = s.suppression > PIN_THRESHOLD ? MOVE_SPEED.crawl : MOVE_SPEED[s.moveMode];
    const [nx, ny, arrived] = stepToward(s.x, s.y, s.tx, s.ty, speed);
    if (!blocked(state.obstacles, nx, ny)) {
      s.x = nx;
      s.y = ny;
      if (arrived) {
        const next = s.queue.shift();
        if (next) {
          s.tx = next[0];
          s.ty = next[1];
        } else {
          s.tx = null;
          s.ty = null;
        }
      }
    } else if (nx !== s.x && !blocked(state.obstacles, nx, s.y)) {
      s.x = nx; // slide along y-facing wall
    } else if (ny !== s.y && !blocked(state.obstacles, s.x, ny)) {
      s.y = ny; // slide along x-facing wall
    } else {
      // fully wedged (pathfinding should prevent this; stop cleanly)
      s.tx = null;
      s.ty = null;
      s.queue = [];
    }
  }

  // settle: stillness accumulates, any movement resets (long-range gate)
  for (let i = 0; i < state.soldiers.length; i++) {
    const s = state.soldiers[i]!;
    if (!s.alive || s.down) continue;
    s.settle = s.x * 0x40000000 + s.y === prevPos[i] ? Math.min(s.settle + 1, 240) : 0;
  }

  // 3. grenades: flight, landing, detonation
  const booms: Boom[] = [];
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i]!;
    if (g.kind === "smoke" && state.tick >= g.landTick) {
      state.smokes.push({ id: g.id, x: g.x, y: g.y, r: GRENADES.smoke.cloudRadius, ttl: GRENADES.smoke.cloudTtl });
      booms.push({ x: g.x, y: g.y, kind: "smoke" });
      state.grenades.splice(i, 1);
    } else if (g.kind === "frag" && state.tick >= g.explodeTick) {
      const def = GRENADES.frag;
      for (const s of state.soldiers) {
        if (!s.alive) continue;
        const d = dist(s.x, s.y, g.x, g.y);
        let dmg = 0;
        if (d <= def.innerRadius) {
          dmg = def.innerMax - Math.floor(((def.innerMax - def.innerMin) * d) / def.innerRadius);
        } else if (d <= def.outerRadius) {
          dmg = def.outerMax - Math.floor(((def.outerMax - def.outerMin) * (d - def.innerRadius)) / (def.outerRadius - def.innerRadius));
        }
        if (dmg > 0 && s.down) {
          // frag finishing a downed soldier
          s.alive = false;
          s.down = false;
          continue;
        }
        s.hp -= dmg;
        if (s.hp <= 0) {
          s.hp = 0;
          if (d <= def.innerRadius) {
            s.alive = false; // adjacent detonation: no saving that
          } else {
            s.down = true;
            s.bleed = BLEED_TICKS;
          }
          dropSoldier(s);
          continue;
        }
        // stun: pegged suppression inside stunRadius, shaken falloff beyond
        if (d <= def.stunRadius) {
          s.suppression = 100;
        } else if (d <= def.suppressRadius) {
          const add = 70 - Math.floor((30 * (d - def.stunRadius)) / (def.suppressRadius - def.stunRadius));
          s.suppression = Math.min(100, s.suppression + add);
        }
      }
      booms.push({ x: g.x, y: g.y, kind: "frag" });
      state.grenades.splice(i, 1);
    }
  }
  // smoke clouds dissipate
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    const c = state.smokes[i]!;
    c.ttl -= 1;
    if (c.ttl <= 0) state.smokes.splice(i, 1);
  }

  // 4. bleed-out + buddy aid
  for (const s of state.soldiers) {
    if (s.alive && s.down) {
      s.bleed -= 1;
      if (s.bleed <= 0) {
        s.alive = false;
        s.down = false;
      }
    }
  }
  for (const s of state.soldiers) {
    if (!s.alive || s.down || s.aidId === null) continue;
    const t = state.soldiers[s.aidId];
    if (!t || !t.alive || !t.down) {
      s.aidId = null;
      s.aidProgress = 0;
      continue;
    }
    if (s.tx !== null || dist(s.x, s.y, t.x, t.y) > AID_RANGE) {
      s.aidProgress = 0; // still moving in / out of reach
      continue;
    }
    s.aidProgress += 1;
    if (s.aidProgress >= AID_TICKS) {
      t.down = false;
      t.hp = REVIVE_HP;
      t.bleed = 0;
      t.suppression = 60; // woozy
      s.aidId = null;
      s.aidProgress = 0;
    }
  }

  // 5. combat — two-phase resolution: all shots roll against PRE-damage state,
  // then effects apply. Fire within a tick is simultaneous — no id-order
  // advantage, and mutual kills are possible (as they should be).
  const shots: ShotEvent[] = [];
  const resolved: Array<{ shooter: Soldier; target: Soldier; hit: boolean }> = [];
  for (const s of state.soldiers) {
    if (!s.alive || s.down) {
      s.aimId = null;
      s.leanX = 0;
      s.leanY = 0;
      continue;
    }
    const acq = acquireTarget(state, s);
    const target = acq?.target ?? null;
    s.aimId = target ? target.id : null;
    s.leanX = acq?.leanX ?? 0;
    s.leanY = acq?.leanY ?? 0;
    if (s.cooldown > 0) {
      s.cooldown -= 1;
      continue;
    }
    if (!target) continue;
    const shot = computeShotPct(state.obstacles, s, target, state.smokes);
    if (shot.pct <= 0) continue;
    let roll: number;
    [roll, state.rng] = rngInt(state.rng, 100);
    s.cooldown = WEAPONS[s.weapon].cooldown;
    resolved.push({ shooter: s, target, hit: roll < shot.pct });
  }
  for (const { shooter, target, hit } of resolved) {
    const w = WEAPONS[shooter.weapon];
    let kill = false;
    if (hit && target.hp > 0 && !target.down) {
      target.hp -= w.damage;
      if (target.hp <= 0) {
        target.hp = 0;
        target.down = true; // small arms drop soldiers; bleed-out or aid decides
        target.bleed = BLEED_TICKS;
        dropSoldier(target);
        kill = true;
      }
    }
    if (target.alive && !target.down) {
      target.suppression = Math.min(100, target.suppression + w.suppression);
    }
    shots.push({ shooter: shooter.id, target: target.id, hit, kill, sx: shooter.x + shooter.leanX, sy: shooter.y + shooter.leanY, tx: target.x + target.leanX, ty: target.y + target.leanY });
  }

  // 6. suppression decay
  for (const s of state.soldiers) {
    if (s.suppression > 0) s.suppression -= 1;
  }

  state.tick += 1;
  return { shots, booms };
}

interface Acquisition { target: Soldier; leanX: number; leanY: number; }

/** Explicit target if valid, else nearest visible enemy in weapon range (lowest id wins ties). */
function acquireTarget(state: SimState, s: Soldier): Acquisition | null {
  const w = WEAPONS[s.weapon];
  if (s.targetId !== null) {
    const t = state.soldiers[s.targetId];
    if (t && t.alive && !t.down) {
      if (dist(s.x, s.y, t.x, t.y) <= w.maxRange) {
        const los = losBetweenEx(state.obstacles, s, t, state.smokes);
        if (los.visible) return { target: t, leanX: los.leanX, leanY: los.leanY };
      }
      // keep the order; they may come back into view
    } else {
      s.targetId = null;
    }
    if (s.targetId !== null) return null; // holding for the ordered target only
  }
  if (s.holdFire) return null; // hold fire: only explicit target orders engage
  // fire at will
  let best: Acquisition | null = null;
  let bestD = Infinity;
  for (const t of state.soldiers) {
    if (!t.alive || t.down || t.team === s.team) continue;
    const d = dist(s.x, s.y, t.x, t.y);
    if (d > w.maxRange || d >= bestD) continue;
    const los = losBetweenEx(state.obstacles, s, t, state.smokes);
    if (!los.visible) continue;
    best = { target: t, leanX: los.leanX, leanY: los.leanY };
    bestD = d;
  }
  return best;
}
