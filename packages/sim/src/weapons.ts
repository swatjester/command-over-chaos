/** Weapon definitions — deterministic integer data. Balance values are
 *  placeholders until the balance harness (tools/balance) sweeps them. */

export type WeaponId = "carbine" | "smg" | "dmr" | "lmg";

/** Stable ordering for hashing/serialization. Append only. */
export const WEAPON_IDS: readonly WeaponId[] = ["carbine", "smg", "dmr", "lmg"];

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
  /** suppression added to the target area per shot */
  suppression: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  carbine: { name: "Carbine", baseAcc: 80, falloffStart: 15000, maxRange: 60000, minAcc: 15, cooldown: 22, damage: 45, suppression: 14 },
  smg:     { name: "SMG",     baseAcc: 85, falloffStart: 8000,  maxRange: 35000, minAcc: 8,  cooldown: 12, damage: 30, suppression: 10 },
  dmr:     { name: "DMR",     baseAcc: 90, falloffStart: 30000, maxRange: 90000, minAcc: 35, cooldown: 38, damage: 70, suppression: 20 },
  lmg:     { name: "LMG",     baseAcc: 65, falloffStart: 20000, maxRange: 70000, minAcc: 20, cooldown: 8,  damage: 35, suppression: 25 },
};
