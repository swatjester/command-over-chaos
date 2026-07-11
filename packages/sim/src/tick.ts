import { computeShotPct, effectiveSubject } from "./combat.js";
import { DELIVERY, GL_FRAG, HAND_FRAG, SMOKE, type Boom } from "./grenades.js";
import { losBetweenEx } from "./los.js";
import { blocked, blockedEx } from "./map.js";
import { findPath } from "./path.js";
import { clamp, dist, stepToward } from "./math.js";
import type { Order } from "./orders.js";
import { rngInt } from "./rng.js";
import {
  AID_RANGE, AID_TICKS, BLEED_TICKS, CAP_TICKS, MOVE_SPEED, PIN_THRESHOLD,
  REVIVE_HP, VAULT_MAX, VAULT_TICKS,
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

/** hp reached 0 from wounds: down once, dead the second time (revived). */
function woundOut(s: Soldier): void {
  s.hp = 0;
  if (s.revived) {
    s.alive = false;
    s.down = false;
  } else {
    s.down = true;
    s.bleed = BLEED_TICKS;
  }
  dropSoldier(s);
}

function dropSoldier(s: Soldier): void {
  s.tx = null;
  s.ty = null;
  s.queue = [];
  s.aidId = null;
  s.aidProgress = 0;
  s.targetId = null;
  s.vaultT = 0; // shot off the wall: stays on the takeoff side
}

/**
 * VAULT: the direct step is blocked by thin low cover only — climb it.
 * Scans along the line to the current waypoint for the first clear point
 * past the cover (within VAULT_MAX). Prone or pinned soldiers can't climb.
 * Returns true if the vault started (soldier freezes for VAULT_TICKS, fully
 * exposed and unable to fire, then lands across the obstacle).
 */
function tryVault(state: SimState, s: Soldier, nx: number, ny: number): boolean {
  if (s.stance === "prone" || s.suppression > PIN_THRESHOLD) return false;
  if (s.tx === null || s.ty === null) return false;
  if (blockedEx(state.obstacles, nx, ny) !== 2) return false;
  const dx = s.tx - s.x, dy = s.ty - s.y;
  const d = dist(s.x, s.y, s.tx, s.ty);
  if (d === 0) return false;
  let crossed = false;
  for (let step = 200; step <= VAULT_MAX; step += 100) {
    const px = s.x + Math.trunc((dx * step) / d);
    const py = s.y + Math.trunc((dy * step) / d);
    const b = blockedEx(state.obstacles, px, py);
    if (b === 1) return false; // hard cover behind the low wall — no landing
    if (b === 2) { crossed = true; continue; }
    if (crossed) {
      s.vaultT = VAULT_TICKS;
      s.vaultX = clamp(px, 0, state.mapW);
      s.vaultY = clamp(py, 0, state.mapH);
      s.settle = 0;
      return true;
    }
  }
  return false;
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
        const isGl = s.weapon === "carbine_gl";
        const dv = DELIVERY[isGl ? "gl" : "hand"];
        const have = o.kind === "frag" ? s.frags : s.smokes;
        if (have <= 0) break;
        let gx = clamp(Math.floor(o.x), 0, state.mapW);
        let gy = clamp(Math.floor(o.y), 0, state.mapH);
        const d = dist(s.x, s.y, gx, gy);
        if (d > dv.range) {
          gx = s.x + Math.floor(((gx - s.x) * dv.range) / d);
          gy = s.y + Math.floor(((gy - s.y) * dv.range) / d);
        }
        // toss inaccuracy: square cone scaled by distance (GL is much tighter)
        const maxDev = Math.floor((Math.min(d, dv.range) * dv.devPct) / 100);
        if (maxDev > 0) {
          let ox: number, oy: number;
          [ox, state.rng] = rngInt(state.rng, 2 * maxDev + 1);
          [oy, state.rng] = rngInt(state.rng, 2 * maxDev + 1);
          gx = clamp(gx + ox - maxDev, 0, state.mapW);
          gy = clamp(gy + oy - maxDev, 0, state.mapH);
        }
        const flight = Math.max(8, Math.ceil(Math.min(d, dv.range) / dv.flightSpeed));
        const landTick = state.tick + flight;
        state.grenades.push({
          id: state.nextGrenadeId++,
          kind: o.kind,
          gl: isGl,
          thrower: s.id,
          sx: s.x, sy: s.y, x: gx, y: gy,
          thrownTick: state.tick,
          landTick,
          explodeTick: landTick + (o.kind === "frag" && !isGl ? HAND_FRAG.fuseAfterLand : 0),
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
    if (!s.alive || s.down) continue;
    // mid-vault: frozen on the takeoff side, then land across the cover
    if (s.vaultT > 0) {
      s.vaultT -= 1;
      if (s.vaultT === 0) {
        s.x = s.vaultX;
        s.y = s.vaultY;
        // consume waypoint(s) the vault crossed or landed on (their cell
        // centers sit inside the cover — unreachable by walking)
        while (
          s.tx !== null && s.ty !== null &&
          (dist(s.x, s.y, s.tx, s.ty) <= 400 ||
            (blocked(state.obstacles, s.tx, s.ty) && dist(s.x, s.y, s.tx, s.ty) <= 1600))
        ) {
          const next = s.queue.shift();
          if (next) { s.tx = next[0]; s.ty = next[1]; } else { s.tx = null; s.ty = null; }
        }
      }
      continue;
    }
    if (s.tx === null || s.ty === null) continue;
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
    } else if (tryVault(state, s, nx, ny)) {
      // climbing — handled above next tick
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
    if (s.vaultT > 0) { s.settle = 0; continue; } // hands on the wall
    s.settle = s.x * 0x40000000 + s.y === prevPos[i] ? Math.min(s.settle + 1, 240) : 0;
  }

  // 3. grenades: flight, landing, detonation
  const booms: Boom[] = [];
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i]!;
    if (g.kind === "smoke" && state.tick >= g.landTick) {
      state.smokes.push({ id: g.id, x: g.x, y: g.y, r: SMOKE.cloudRadius, ttl: SMOKE.cloudTtl });
      booms.push({ x: g.x, y: g.y, kind: "smoke" });
      state.grenades.splice(i, 1);
    } else if (g.kind === "frag" && state.tick >= g.explodeTick) {
      for (const s of state.soldiers) {
        if (!s.alive) continue;
        const d = dist(s.x, s.y, g.x, g.y);
        if (g.gl) {
          // 40mm: downs on direct hit, stuns near — never an instant kill
          if (d <= GL_FRAG.directRadius) {
            if (s.down) { s.alive = false; s.down = false; continue; }
            s.hp = 0;
            woundOut(s);
          } else if (d <= GL_FRAG.stunRadius) {
            if (s.down) continue;
            s.suppression = 100;
            s.hp -= GL_FRAG.nearDamage;
            if (s.hp <= 0) woundOut(s);
          } else if (d <= GL_FRAG.suppressRadius && !s.down) {
            s.suppression = Math.min(100, s.suppression + 45);
          }
          continue;
        }
        const def = HAND_FRAG;
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
            s.down = false;
            dropSoldier(s);
          } else {
            woundOut(s);
          }
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
      t.revived = true; // one revive per soldier — the next downing is fatal
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
      s.peekUp = false;
      continue;
    }
    if (s.vaultT > 0) {
      // climbing: weapon slung — no aim, no fire, but cooldown still runs
      s.aimId = null;
      s.leanX = 0;
      s.leanY = 0;
      s.peekUp = false;
      if (s.cooldown > 0) s.cooldown -= 1;
      continue;
    }
    const acq = acquireTarget(state, s);
    const target = acq?.target ?? null;
    s.aimId = target ? target.id : null;
    s.leanX = acq?.leanX ?? 0;
    s.leanY = acq?.leanY ?? 0;
    s.peekUp = acq?.overTop ?? false;
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
        woundOut(target); // downs, or kills outright if already revived once
        kill = true;
        // veterancy: surviving fights makes you steadier (CoC rank pips)
        shooter.pips = Math.min(3, shooter.pips + 1);
      }
    }
    if (target.alive && !target.down) {
      target.suppression = Math.min(100, target.suppression + w.suppression);
    }
    // misses visibly miss: readable impact offset past/around the target
    let ix = target.x + target.leanX;
    let iy = target.y + target.leanY;
    if (!hit) {
      let ox: number, oy: number;
      [ox, state.rng] = rngInt(state.rng, 3001);
      [oy, state.rng] = rngInt(state.rng, 3001);
      ox -= 1500; oy -= 1500;
      if (ox > -700 && ox < 700) ox = ox < 0 ? -700 : 700;
      if (oy > -700 && oy < 700) oy = oy < 0 ? -700 : 700;
      ix += ox; iy += oy;
    }
    shots.push({ shooter: shooter.id, target: target.id, hit, kill, sx: shooter.x + shooter.leanX, sy: shooter.y + shooter.leanY, tx: ix, ty: iy });
  }

  // 6. suppression decay
  for (const s of state.soldiers) {
    if (s.suppression > 0) s.suppression -= 1;
  }

  // 7. victory-point zones: contest / capture / score
  for (const z of state.zones) {
    let c0 = 0, c1 = 0;
    for (const s of state.soldiers) {
      if (!s.alive || s.down) continue;
      if (dist(s.x, s.y, z.x, z.y) <= z.r) s.team === 0 ? c0++ : c1++;
    }
    z.contested = c0 > 0 && c1 > 0;
    if (z.contested) {
      // progress freezes while contested — push them out to finish the cap
    } else if (c0 > 0 || c1 > 0) {
      const t = c0 > 0 ? 0 : 1;
      if (z.owner === t) {
        z.capTeam = -1;
        z.capTicks = 0;
      } else {
        if (z.capTeam !== t) { z.capTeam = t; z.capTicks = 0; }
        z.capTicks += 1;
        if (z.capTicks >= CAP_TICKS) {
          z.owner = t;
          z.capTeam = -1;
          z.capTicks = 0;
        }
      }
    } else {
      z.capTeam = -1;
      z.capTicks = 0; // flag persists while empty
    }
    // owned + uncontested zones pay out once per second
    if (z.owner >= 0 && !z.contested && state.tick % 30 === 0) {
      state.vp[z.owner as 0 | 1] += z.value;
    }
  }

  state.tick += 1;
  return { shots, booms };
}

interface Acquisition { target: Soldier; leanX: number; leanY: number; overTop: boolean; }

/** Explicit target if valid, else nearest visible enemy in weapon range (lowest id wins ties). */
function acquireTarget(state: SimState, s: Soldier): Acquisition | null {
  const w = WEAPONS[s.weapon];
  if (s.targetId !== null) {
    const t = state.soldiers[s.targetId];
    if (t && t.alive && !t.down) {
      if (dist(s.x, s.y, t.x, t.y) <= w.maxRange) {
        const los = losBetweenEx(state.obstacles, s, effectiveSubject(t), state.smokes);
        if (los.visible) return { target: t, leanX: los.leanX, leanY: los.leanY, overTop: los.overTop };
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
    const los = losBetweenEx(state.obstacles, s, effectiveSubject(t), state.smokes);
    if (!los.visible) continue;
    best = { target: t, leanX: los.leanX, leanY: los.leanY, overTop: los.overTop };
    bestD = d;
  }
  return best;
}
