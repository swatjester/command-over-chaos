/**
 * The shot-percentage engine — THE signature mechanic. Pure integer math over
 * plain soldier-shaped objects, so the client can call it on snapshots to
 * render the exact number the server will roll against.
 */
import { losBetween } from "./los.js";
import type { Obstacle } from "./map.js";
import { dist } from "./math.js";
import type { MoveMode, Stance } from "./state.js";
import { WEAPONS, type WeaponId } from "./weapons.js";

/** Everything shot % needs — both sim Soldier and protocol snapshot satisfy this. */
export interface Combatant {
  x: number;
  y: number;
  stance: Stance;
  moveMode: MoveMode;
  /** moving iff tx !== null */
  tx: number | null;
  suppression: number;
  weapon: WeaponId;
}

export interface ShotFactor {
  label: string;
  /** percent multiplier applied (e.g. 55 = ×0.55) */
  mult: number;
}

export interface ShotPct {
  /** final hit chance 0-99; 0 means cannot engage (no LOS / out of range) */
  pct: number;
  /** base accuracy from weapon + range, before modifiers */
  base: number;
  visible: boolean;
  inRange: boolean;
  factors: ShotFactor[];
}

const NO_SHOT: Omit<ShotPct, "visible" | "inRange"> = { pct: 0, base: 0, factors: [] };

export function computeShotPct(
  obstacles: readonly Obstacle[], shooter: Combatant, target: Combatant,
): ShotPct {
  const w = WEAPONS[shooter.weapon];
  const d = dist(shooter.x, shooter.y, target.x, target.y);
  if (d > w.maxRange) {
    const los = losBetween(obstacles, shooter, target);
    return { ...NO_SHOT, visible: los.visible, inRange: false };
  }
  const los = losBetween(obstacles, shooter, target);
  if (!los.visible) return { ...NO_SHOT, visible: false, inRange: true };

  // base accuracy: flat to falloffStart, then linear to minAcc at maxRange
  const base = d <= w.falloffStart
    ? w.baseAcc
    : w.baseAcc - Math.floor(((w.baseAcc - w.minAcc) * (d - w.falloffStart)) / (w.maxRange - w.falloffStart));

  let pct = base;
  const factors: ShotFactor[] = [];
  const apply = (label: string, mult: number): void => {
    if (mult === 100) return;
    factors.push({ label, mult });
    pct = Math.floor((pct * mult) / 100);
  };

  apply("shooter stance", shooter.stance === "prone" ? 115 : shooter.stance === "crouch" ? 108 : 100);
  if (shooter.tx !== null) {
    apply("shooter moving", shooter.moveMode === "sprint" ? 35 : shooter.moveMode === "move" ? 60 : shooter.moveMode === "sneak" ? 75 : 65);
  }
  if (shooter.suppression > 0) apply("suppressed", 100 - Math.floor(shooter.suppression / 2));
  apply("target profile", target.stance === "prone" ? 55 : target.stance === "crouch" ? 80 : 100);
  if (target.tx !== null) apply("target moving", target.moveMode === "sprint" ? 75 : 90);
  if (los.targetInCover) apply("target in cover", 50);

  pct = pct < 1 ? 1 : pct > 99 ? 99 : pct;
  return { pct, base, visible: true, inRange: true, factors };
}
