/**
 * Bot AI — three test personalities that command a 4-soldier squad by
 * issuing ordinary Orders (recorded in replays like any player's).
 *
 *   "vp"       — pushes capture zones, fights only in self-defense
 *   "hunter"   — seeks and destroys: chases visible enemies, then last-known
 *                positions, sweeps zones when the trail goes cold
 *   "balanced" — fights whatever it can see, caps zones otherwise
 *
 * Pure over (state, mem): no RNG, no clocks, id-ordered iteration — calling
 * it at the same tick with the same state always yields the same orders.
 * Perception uses TEAM vision (same LOS rule as server fog culling): bots
 * cannot wallhack by construction. Runs about once per second per squad.
 */
import { losBetween } from "./los.js";
import { dist } from "./math.js";
import type { Order } from "./orders.js";
import type { SimState, Soldier, ZoneState } from "./state.js";
import { WEAPONS } from "./weapons.js";

export type BotPersonality = "vp" | "hunter" | "balanced";
export const BOT_PERSONALITIES: readonly BotPersonality[] = ["vp", "hunter", "balanced"];

export interface BotMemory {
  /** last-known enemy positions: [enemyId, x, y] */
  lastSeen: Array<[number, number, number]>;
  /** last goal issued per soldier id: [x, y] */
  goals: Record<number, [number, number]>;
}
export function createBotMemory(): BotMemory {
  return { lastSeen: [], goals: {} };
}

/** squad formation offsets around the goal point (mm) */
const FORMATION: ReadonlyArray<[number, number]> = [[0, 0], [2800, 0], [0, 2800], [2800, 2800]];
const SPRINT_DIST = 35000;
const GOAL_EPSILON = 2500;

function centroid(sq: Soldier[]): [number, number] {
  let x = 0, y = 0;
  for (const s of sq) { x += s.x; y += s.y; }
  return [Math.floor(x / sq.length), Math.floor(y / sq.length)];
}

/** Best zone to push: contested first, then highest value, then nearest. */
function pickZone(zones: ZoneState[], team: number, cx: number, cy: number): ZoneState | null {
  let best: ZoneState | null = null;
  let bestKey = -Infinity;
  for (const z of zones) {
    if (z.owner === team && !z.contested) continue; // already ours and safe
    const d = dist(cx, cy, z.x, z.y);
    const key = (z.contested ? 1_000_000 : 0) + z.value * 100_000 - d / 10;
    if (key > bestKey) { bestKey = key; best = z; }
  }
  return best;
}

export function botThink(
  state: SimState, team: 0 | 1, soldierIds: readonly number[],
  personality: BotPersonality, mem: BotMemory,
): Order[] {
  const orders: Order[] = [];
  const squad = soldierIds
    .map((id) => state.soldiers[id])
    .filter((s): s is Soldier => !!s && s.alive && !s.down);
  if (squad.length === 0) return orders;

  // --- perception: team vision, same rule as server fog culling -------------
  const allies = state.soldiers.filter((s) => s.team === team && s.alive && !s.down);
  const enemies = state.soldiers.filter((s) => s.team !== team && s.alive && !s.down);
  const visible = enemies.filter((e) =>
    allies.some((a) => losBetween(state.obstacles, a, e, state.smokes).visible),
  );

  // remember where we saw them; forget the dead and cleared positions
  for (const e of visible) {
    const i = mem.lastSeen.findIndex(([id]) => id === e.id);
    if (i >= 0) mem.lastSeen[i] = [e.id, e.x, e.y];
    else mem.lastSeen.push([e.id, e.x, e.y]);
  }
  const [cx, cy] = centroid(squad);
  mem.lastSeen = mem.lastSeen.filter(([id, x, y]) => {
    const e = state.soldiers[id];
    if (!e || !e.alive) return false;
    if (visible.some((v) => v.id === id)) return true;
    return dist(cx, cy, x, y) > 4000; // reached the spot, nobody home
  });

  // --- squad goal by personality ---------------------------------------------
  const nearestVisible = visible.length > 0
    ? visible.reduce((a, b) => (dist(cx, cy, a.x, a.y) <= dist(cx, cy, b.x, b.y) ? a : b))
    : null;
  let goal: [number, number] | null = null;
  if (personality === "hunter" || personality === "balanced") {
    if (nearestVisible) goal = [nearestVisible.x, nearestVisible.y];
    else if (personality === "hunter" && mem.lastSeen.length > 0) {
      const ls = mem.lastSeen.reduce((a, b) => (dist(cx, cy, a[1], a[2]) <= dist(cx, cy, b[1], b[2]) ? a : b));
      goal = [ls[1], ls[2]];
    }
  }
  if (!goal) {
    const z = pickZone(state.zones, team, cx, cy);
    if (z) goal = [z.x, z.y];
  }

  const far = goal ? dist(cx, cy, goal[0], goal[1]) > SPRINT_DIST : false;

  // --- per-soldier orders ------------------------------------------------------
  for (let i = 0; i < squad.length; i++) {
    const s = squad[i]!;
    const w = WEAPONS[s.weapon];
    const inRange = nearestVisible && dist(s.x, s.y, nearestVisible.x, nearestVisible.y) <= Math.floor(w.maxRange * 0.9);
    if (inRange) {
      // stand and fight: stop, take a knee, let fire-at-will work
      if (s.tx !== null) orders.push({ type: "halt", soldierId: s.id });
      if (s.stance === "stand") orders.push({ type: "stance", soldierId: s.id, stance: "crouch" });
      delete mem.goals[s.id];
      continue;
    }
    if (!goal) continue;
    const [ox, oy] = FORMATION[i % FORMATION.length]!;
    const gx = Math.min(Math.max(goal[0] + ox - 1400, 0), state.mapW);
    const gy = Math.min(Math.max(goal[1] + oy - 1400, 0), state.mapH);
    const prev = mem.goals[s.id];
    const needsOrder =
      (!prev || dist(prev[0], prev[1], gx, gy) > GOAL_EPSILON) ||
      (s.tx === null && dist(s.x, s.y, gx, gy) > 3500);
    if (needsOrder) {
      if (s.stance !== "stand") orders.push({ type: "stance", soldierId: s.id, stance: "stand" });
      orders.push({ type: "move", soldierId: s.id, x: gx, y: gy, mode: far ? "sprint" : "move" });
      mem.goals[s.id] = [gx, gy];
    }
  }

  // --- buddy aid when the area is quiet ---------------------------------------
  if (visible.length === 0) {
    const downed = soldierIds
      .map((id) => state.soldiers[id])
      .filter((s): s is Soldier => !!s && s.alive && s.down);
    for (const d of downed) {
      const medic = squad.find((s) => s.aidId === null && s.id !== d.id);
      if (medic) {
        orders.push({ type: "aid", soldierId: medic.id, targetId: d.id });
        break; // one aid order per think
      }
    }
  }

  return orders;
}
