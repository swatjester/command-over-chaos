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
}

/** Long-range doctrine (2026-07-08, for the 300x300 map): DMR keeps usable
 *  accuracy way out but fires slow; LMG throws volume + suppression at low
 *  per-shot odds. Both settle-gated. Carbine/SMG stay close-to-mid weapons.
 *  Extreme-range potshot duels (1-5%/shot, both sides in cover) are a
 *  FEATURE — classic CoC fights ran minutes before a kill. */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine_gl: { name: "Carbine (GL)", baseAcc: 80, falloffStart: 15000, maxRange: 60000, minAcc: 10, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20 },
  carbine: { name: "Carbine", baseAcc: 80, falloffStart: 15000, maxRange: 60000, minAcc: 10, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20 },
  smg:     { name: "SMG",     baseAcc: 85, falloffStart: 8000,  maxRange: 35000, minAcc: 8,  cooldown: 12, damage: 30, suppression: 10, settleStart: 22000, settleTicks: 15 },
  dmr:     { name: "DMR",     baseAcc: 90, falloffStart: 40000, maxRange: 130000, minAcc: 12, cooldown: 46, damage: 70, suppression: 22, settleStart: 82000, settleTicks: 60 },
  lmg:     { name: "LMG",     baseAcc: 65, falloffStart: 25000, maxRange: 110000, minAcc: 5,  cooldown: 8,  damage: 35, suppression: 30, settleStart: 70000, settleTicks: 30 },
};
