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

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine_gl: { name: "Carbine (GL)", baseAcc: 80, falloffStart: 15000, maxRange: 60000, minAcc: 15, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20 },
  carbine: { name: "Carbine", baseAcc: 80, falloffStart: 15000, maxRange: 60000, minAcc: 15, cooldown: 37, damage: 45, suppression: 14, settleStart: 38000, settleTicks: 20 },
  smg:     { name: "SMG",     baseAcc: 85, falloffStart: 8000,  maxRange: 35000, minAcc: 8,  cooldown: 12, damage: 30, suppression: 10, settleStart: 22000, settleTicks: 15 },
  dmr:     { name: "DMR",     baseAcc: 90, falloffStart: 30000, maxRange: 90000, minAcc: 35, cooldown: 46, damage: 70, suppression: 20, settleStart: 56000, settleTicks: 60 },
  lmg:     { name: "LMG",     baseAcc: 65, falloffStart: 20000, maxRange: 70000, minAcc: 20, cooldown: 8,  damage: 35, suppression: 25, settleStart: 44000, settleTicks: 30 },
};
