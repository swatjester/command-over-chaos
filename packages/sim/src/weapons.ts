/** Weapon definitions — deterministic integer data. Balance values are
 *  placeholders until the balance harness (tools/balance) sweeps them. */

export type WeaponId = "carbine" | "smg" | "dmr" | "lmg" | "carbine_gl";

/** Stable ordering for hashing/serialization. Append only. */
export const WEAPON_IDS: readonly WeaponId[] = ["carbine", "smg", "dmr", "lmg", "carbine_gl"];

export interface WeaponDef {
  name: string;
  /** hit % at ranges <= falloffStart, before modifiers */
  baseAcc: number;
  /** mm — full accuracy inside this range */
  falloffStart: number;
  /** mm — cannot engage beyond this */
  maxRange: number;
  /** hit % at maxRange */
  minAcc: number;
  /** ticks between shots (30Hz) */
  cooldown: number;
  /** hp damage per hit */
  damage: number;
  /** mm — beyond this, shooter must be settled (stationary settleTicks) to fire */
  settleStart: number;
  /** ticks of stillness required for long-range shots */
  settleTicks: number;
  /** suppression added to the target area per shot */
  suppression: number;
  /** can fire while moving (assault weapons only) — at a heavy penalty */
  fireOnMove: boolean;
}

/** Long-range doctrine (2026-07-08, for the 300x300 map): DMR keeps usable
 *  accuracy way out but fires slow; LMG throws volume + suppression at low
 *  per-shot odds. Both settle-gated. Carbine/SMG stay close-to-mid weapons.
 *  Extreme-range potshot duels (1-5%/shot, both sides in cover) are a
 *  FEATURE — classic CoC fights ran minutes before a kill. */
/** fireOnMove (2026-07-08, from Dan's flank-race playtest): only assault
 *  weapons (SMG/carbine) can shoot on the move, and badly. DMR/LMG hold
 *  fire until stationary — reaching a corner FIRST now means winning the
 *  exchange there, instead of racing equal fire rates. */
/** 2026-07-08: base accuracy cut ~33%% across the board (Dan: fights were
 *  resolving too fast even at the slower pace) — suppression per shot is
 *  untouched, so volume of fire still pins; it just kills slower. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine_gl: { name: "Carbine (GL)", baseAcc: 54, falloffStart: 15000, maxRange: 60000, minAcc: 7, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20, fireOnMove: true },
  carbine: { name: "Carbine", baseAcc: 54, falloffStart: 15000, maxRange: 60000, minAcc: 7, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20, fireOnMove: true },
  smg:     { name: "SMG",     baseAcc: 57, falloffStart: 8000,  maxRange: 35000, minAcc: 5,  cooldown: 12, damage: 30, suppression: 10, settleStart: 22000, settleTicks: 15, fireOnMove: true },
  dmr:     { name: "DMR",     baseAcc: 60, falloffStart: 40000, maxRange: 130000, minAcc: 8, cooldown: 46, damage: 70, suppression: 35, settleStart: 82000, settleTicks: 60, fireOnMove: false },
  lmg:     { name: "LMG",     baseAcc: 44, falloffStart: 25000, maxRange: 110000, minAcc: 3,  cooldown: 8,  damage: 35, suppression: 30, settleStart: 70000, settleTicks: 30, fireOnMove: false },
};
