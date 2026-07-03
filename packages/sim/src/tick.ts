import { computeShotPct } from "./combat.js";
import { losBetween } from "./los.js";
import { blocked } from "./map.js";
import { clamp, dist, stepToward } from "./math.js";
import type { Order } from "./orders.js";
import { rngInt } from "./rng.js";
import { MOVE_SPEED, PIN_THRESHOLD, type SimState, type Soldier } from "./state.js";
import { WEAPONS } from "./weapons.js";

/** One resolved shot this tick — consumed by the server for tracer events. */
export interface ShotEvent {
  shooter: number;
  target: number;
  hit: boolean;
  kill: boolean;
  sx: number; sy: number; tx: number; ty: number;
}

/**
 * Advance the world exactly one tick. Pure with respect to (state, orders):
 * mutates `state` in place (hot path) but reads nothing else — no clocks,
 * no Math.random, no iteration over unordered collections.
 */
export function tick(state: SimState, orders: readonly Order[]): ShotEvent[] {
  // 1. apply orders (sorted by soldierId for determinism regardless of arrival order)
  const sorted = [...orders].sort((a, b) => a.soldierId - b.soldierId);
  for (const o of sorted) {
    const s = state.soldiers[o.soldierId];
    if (!s || !s.alive) continue;
    switch (o.type) {
      case "move":
        s.tx = clamp(Math.floor(o.x), 0, state.mapW);
        s.ty = clamp(Math.floor(o.y), 0, state.mapH);
        if (o.mode) s.moveMode = o.mode;
        break;
      case "stance":
        s.stance = o.stance;
        break;
      case "target": {
        const t = o.targetId === null ? null : state.soldiers[o.targetId];
        s.targetId = t && t.alive && t.team !== s.team ? t.id : null;
        break;
      }
      case "halt":
        s.tx = null;
        s.ty = null;
        break;
    }
  }

  // 2. movement with AABB collision + wall slide
  //    (no pathfinding yet — soldiers slide along walls; navmesh lands in M2)
  const prevPos = state.soldiers.map((s) => s.x * 0x40000000 + s.y); // cheap pos key
  for (const s of state.soldiers) {
    if (!s.alive || s.tx === null || s.ty === null) continue;
    // pinned soldiers can only crawl
    const speed = s.suppression > PIN_THRESHOLD ? MOVE_SPEED.crawl : MOVE_SPEED[s.moveMode];
    const [nx, ny, arrived] = stepToward(s.x, s.y, s.tx, s.ty, speed);
    if (!blocked(state.obstacles, nx, ny)) {
      s.x = nx;
      s.y = ny;
      if (arrived) {
        s.tx = null;
        s.ty = null;
      }
    } else if (nx !== s.x && !blocked(state.obstacles, nx, s.y)) {
      s.x = nx; // slide along y-facing wall
    } else if (ny !== s.y && !blocked(state.obstacles, s.x, ny)) {
      s.y = ny; // slide along x-facing wall
    } else {
      // fully wedged (e.g., target inside an obstacle): stop cleanly
      s.tx = null;
      s.ty = null;
    }
  }

  // 3. combat — id order for determinism; simultaneous within a tick
  //    (a soldier killed this tick may still get their queued shot off)
  // settle: stillness accumulates, any movement resets (long-range gate)
  for (let i = 0; i < state.soldiers.length; i++) {
    const s = state.soldiers[i]!;
    if (!s.alive) continue;
    s.settle = s.x * 0x40000000 + s.y === prevPos[i] ? Math.min(s.settle + 1, 240) : 0;
  }

  // Two-phase resolution: all shots roll against PRE-damage state, then
  // effects apply. Fire within a tick is simultaneous — no id-order advantage,
  // and mutual kills are possible (as they should be).
  const events: ShotEvent[] = [];
  const resolved: Array<{ shooter: Soldier; target: Soldier; hit: boolean }> = [];
  for (const s of state.soldiers) {
    if (!s.alive) {
      s.aimId = null;
      continue;
    }
    const target = acquireTarget(state, s);
    s.aimId = target ? target.id : null;
    if (s.cooldown > 0) {
      s.cooldown -= 1;
      continue;
    }
    if (!target) continue;
    const shot = computeShotPct(state.obstacles, s, target);
    if (shot.pct <= 0) continue;
    let roll: number;
    [roll, state.rng] = rngInt(state.rng, 100);
    s.cooldown = WEAPONS[s.weapon].cooldown;
    resolved.push({ shooter: s, target, hit: roll < shot.pct });
  }
  for (const { shooter, target, hit } of resolved) {
    const w = WEAPONS[shooter.weapon];
    let kill = false;
    if (hit && target.hp > 0) {
      target.hp -= w.damage;
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        target.tx = null;
        target.ty = null;
        kill = true;
      }
    }
    if (target.alive) {
      target.suppression = Math.min(100, target.suppression + w.suppression);
    }
    events.push({ shooter: shooter.id, target: target.id, hit, kill, sx: shooter.x, sy: shooter.y, tx: target.x, ty: target.y });
  }

  // 4. suppression decay
  for (const s of state.soldiers) {
    if (s.suppression > 0) s.suppression -= 1;
  }

  state.tick += 1;
  return events;
}

/** Explicit target if valid, else nearest visible enemy in weapon range (lowest id wins ties). */
function acquireTarget(state: SimState, s: Soldier): Soldier | null {
  const w = WEAPONS[s.weapon];
  if (s.targetId !== null) {
    const t = state.soldiers[s.targetId];
    if (t && t.alive) {
      if (dist(s.x, s.y, t.x, t.y) <= w.maxRange && losBetween(state.obstacles, s, t).visible) return t;
      // keep the order; they may come back into view
    } else {
      s.targetId = null;
    }
    if (s.targetId !== null) return null; // holding for the ordered target only
  }
  // fire at will
  let best: Soldier | null = null;
  let bestD = Infinity;
  for (const t of state.soldiers) {
    if (!t.alive || t.team === s.team) continue;
    const d = dist(s.x, s.y, t.x, t.y);
    if (d > w.maxRange || d >= bestD) continue;
    if (!losBetween(state.obstacles, s, t).visible) continue;
    best = t;
    bestD = d;
  }
  return best;
}
