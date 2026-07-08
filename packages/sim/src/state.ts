import type { Grenade } from "./grenades.js";
import type { SmokeCloud } from "./los.js";
import type { MapDef, Obstacle } from "./map.js";
import { MM } from "./math.js";
import type { WeaponId } from "./weapons.js";

export const TICK_RATE = 30; // Hz
export const TICK_MS = 1000 / TICK_RATE;

/** Suppression above this pins a soldier: forced crawl-speed movement. */
export const PIN_THRESHOLD = 70;
/** Downed soldiers bleed out after this many ticks (60s) without aid. */
export const BLEED_TICKS = 1800;
/** Adjacent-ally revive channel length (3s) and reach (mm). */
export const AID_TICKS = 150; // 5s
export const AID_RANGE = 1600;
/** HP restored by a field revive. */
export const REVIVE_HP = 25;
/** Climbing thin low cover takes 1s: stationary, exposed, can't fire. */
export const VAULT_TICKS = 30;
/** How far past cover a vault can land (mm). */
export const VAULT_MAX = 2500;

export type Stance = "stand" | "crouch" | "prone";
export type MoveMode = "sprint" | "move" | "sneak" | "crawl";

export interface Soldier {
  id: number;
  team: 0 | 1;
  /** millimeters */
  x: number;
  y: number;
  /** current move target, or null when holding position */
  tx: number | null;
  ty: number | null;
  stance: Stance;
  moveMode: MoveMode;
  hp: number; // 0-100
  suppression: number; // 0-100
  alive: boolean;
  weapon: WeaponId;
  /** ticks until this soldier can fire again */
  cooldown: number;
  /** explicit fire order target; null = fire at will */
  targetId: number | null;
  /** who this soldier is currently aiming at (server-computed each tick) */
  aimId: number | null;
  /** consecutive stationary ticks (capped) — long-range shots need this */
  settle: number;
  /** queued movement waypoints (shift-click), consumed FIFO */
  queue: Array<[number, number]>;
  frags: number;
  smokes: number;
  /** hold fire: no auto-engagement; explicit target orders still fire */
  holdFire: boolean;
  /** current corner-peek lean offset (mm) — visual + shot origin */
  leanX: number;
  leanY: number;
  /** downed: incapacitated, bleeding out, revivable */
  down: boolean;
  /** ticks until a downed soldier dies (60s) */
  bleed: number;
  /** ally this soldier is trying to revive */
  aidId: number | null;
  /** aid channel progress (ticks, revive at AID_TICKS) */
  aidProgress: number;
  /** already field-revived once — the next downing is fatal */
  revived: boolean;
  /** currently peeking over adjacent low cover / through a window to aim */
  peekUp: boolean;
  /** in-match veterancy: pips earned per kill (max 3), +4% accuracy each.
   *  Resets every match by construction — no meta progression. */
  pips: number;
  /** ticks remaining in a vault over low cover (0 = not vaulting) */
  vaultT: number;
  /** vault landing point (valid while vaultT > 0) */
  vaultX: number;
  vaultY: number;
}

export interface SimState {
  tick: number;
  seed: number;
  rng: number; // PRNG state
  mapW: number; // mm
  mapH: number; // mm
  obstacles: Obstacle[]; // static collision + LOS geometry
  soldiers: Soldier[];
  grenades: Grenade[];
  smokes: SmokeCloud[];
  nextGrenadeId: number;
}

/** speed in mm per tick, by move mode (stance modifiers come later) */
export const MOVE_SPEED: Record<MoveMode, number> = {
  sprint: Math.floor((6.0 * MM) / TICK_RATE),
  move: Math.floor((3.2 * MM) / TICK_RATE),
  sneak: Math.floor((1.6 * MM) / TICK_RATE),
  crawl: Math.floor((0.7 * MM) / TICK_RATE),
};

export function createState(seed: number, map?: MapDef): SimState {
  return {
    tick: 0,
    seed,
    rng: seed >>> 0,
    mapW: map?.w ?? 100 * MM,
    mapH: map?.h ?? 100 * MM,
    obstacles: map?.obstacles ?? [],
    soldiers: [],
    grenades: [],
    smokes: [],
    nextGrenadeId: 0,
  };
}

export function spawnSoldier(
  s: SimState, team: 0 | 1, x: number, y: number, weapon: WeaponId = "carbine",
  frags = 2, smokes = 1,
): Soldier {
  const soldier: Soldier = {
    id: s.soldiers.length,
    team, x, y, tx: null, ty: null,
    stance: "stand", moveMode: "move",
    hp: 100, suppression: 0, alive: true,
    weapon, cooldown: 0, targetId: null, aimId: null, settle: 0,
    queue: [], frags, smokes, holdFire: false, leanX: 0, leanY: 0,
    down: false, bleed: 0, aidId: null, aidProgress: 0, revived: false, peekUp: false,
    pips: 0, vaultT: 0, vaultX: 0, vaultY: 0,
  };
  s.soldiers.push(soldier);
  return soldier;
}
