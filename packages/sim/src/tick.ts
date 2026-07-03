import { blocked } from "./map.js";
import { clamp, stepToward } from "./math.js";
import type { Order } from "./orders.js";
import { MOVE_SPEED, type SimState } from "./state.js";

/**
 * Advance the world exactly one tick. Pure with respect to (state, orders):
 * mutates `state` in place (hot path) but reads nothing else — no clocks,
 * no Math.random, no iteration over unordered collections.
 */
export function tick(state: SimState, orders: readonly Order[]): void {
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
      case "halt":
        s.tx = null;
        s.ty = null;
        break;
    }
  }

  // 2. movement with AABB collision + wall slide
  //    (no pathfinding yet — soldiers slide along walls; navmesh lands in M2)
  for (const s of state.soldiers) {
    if (!s.alive || s.tx === null || s.ty === null) continue;
    const speed = MOVE_SPEED[s.moveMode];
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

  // 3. suppression decay (placeholder until combat lands in M1)
  for (const s of state.soldiers) {
    if (s.suppression > 0) s.suppression -= 1;
  }

  state.tick += 1;
}
