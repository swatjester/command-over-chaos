/**
 * The shot-percentage engine — THE signature mechanic. Pure integer math over
 * plain soldier-shaped objects, so the client can call it on snapshots to
 * render the exact number the server will roll against.
 */
import { losBetween, type SmokeCloud } from "./los.js";
import type { Obstacle } from "./map.js";
import { dist } from "./math.js";
import type { Stance } from "./state.js";
import type { MoveMode } from "./state.js";
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
  /** consecutive stationary ticks */
  settle: number;
  /** aiming over adjacent low cover / through a window (prone counts as crouch) */
  peekUp: boolean;
  /** mid-vault over low cover: can't fire, fully exposed (optional: old snapshots) */
  vaultT?: number;
  /** in-match veterancy pips (0-3), +4% accuracy each */
  pips?: number;
}

/** A peeking-over prone soldier presents a crouch-sized profile and is not hidden. */
export function effectiveSubject(c: Combatant): { x: number; y: number; stance: Combatant["stance"] } {
  if ((c.vaultT ?? 0) > 0) return { x: c.x, y: c.y, stance: "stand" }; // silhouetted on the cover
  return { x: c.x, y: c.y, stance: c.peekUp && c.stance === "prone" ? "crouch" : c.stance };
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
  /** true when the only blocker is the long-range settle requirement */
  settling: boolean;
  /** true when the only blocker is the shooter being mid-vault */
  vaulting: boolean;
  /** true when the only blocker is moving with a weapon that can't fire on the move */
  moving: boolean;
  factors: ShotFactor[];
}

const NO_SHOT: Omit<ShotPct, "visible" | "inRange"> = { pct: 0, base: 0, settling: false, vaulting: false, moving: false, factors: [] };

export function computeShotPct(
  obstacles: readonly Obstacle[], shooter: Combatant, target: Combatant,
  smokes: readonly SmokeCloud[] = [],
): ShotPct {
  const w = WEAPONS[shooter.weapon];
  const tEff = effectiveSubject(target);
  const d = dist(shooter.x, shooter.y, target.x, target.y);
  if (d > w.maxRange) {
    const los = losBetween(obstacles, shooter, tEff, smokes);
    return { ...NO_SHOT, visible: los.visible, inRange: false };
  }
  const los = losBetween(obstacles, shooter, tEff, smokes);
  if (!los.visible) return { ...NO_SHOT, visible: false, inRange: true };

  // hands on the wall, not the weapon
  if ((shooter.vaultT ?? 0) > 0) {
    return { pct: 0, base: 0, visible: true, inRange: true, settling: false, vaulting: true, moving: false, factors: [] };
  }

  // heavy weapons don't fire on the move — stop to shoot (assault weapons
  // may, at a stiff penalty below)
  if (shooter.tx !== null && !w.fireOnMove) {
    return { pct: 0, base: 0, visible: true, inRange: true, settling: false, vaulting: false, moving: true, factors: [] };
  }

  // long-range shots require a settled (stationary) shooter
  if (d > w.settleStart && shooter.settle < w.settleTicks) {
    return { pct: 0, base: 0, visible: true, inRange: true, settling: true, vaulting: false, moving: false, factors: [] };
  }

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
  if ((shooter.pips ?? 0) > 0) apply("veteran", 100 + 4 * Math.min(3, shooter.pips!));
  if (shooter.tx !== null) {
    // firing on the move is a spray-and-pray act, even for assault weapons
    apply("shooter moving", shooter.moveMode === "sprint" ? 20 : shooter.moveMode === "move" ? 40 : shooter.moveMode === "sneak" ? 55 : 45);
  }
  if (shooter.suppression > 0) apply("suppressed", 100 - Math.floor(shooter.suppression / 2));
  apply("target profile", tEff.stance === "prone" ? 55 : tEff.stance === "crouch" ? 80 : 100);
  if (target.tx !== null) apply("target moving", target.moveMode === "sprint" ? 75 : 90);
  if (los.coverMult < 100) apply("target in cover", los.coverMult);

  pct = pct < 1 ? 1 : pct > 99 ? 99 : pct;
  return { pct, base, visible: true, inRange: true, settling: false, vaulting: false, moving: false, factors };
}
