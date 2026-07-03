import type { SimState } from "./state.js";
import { WEAPON_IDS } from "./weapons.js";

/** FNV-1a 32-bit over every numeric field of sim state, in fixed order.
 *  Used for desync detection and CI determinism tests. */
export function hashState(state: SimState): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    // fold the number in as 8 hex-ish bytes (integers only in sim state)
    let v = n < 0 ? ~n : n;
    for (let i = 0; i < 8; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      v = Math.floor(v / 256);
    }
    if (n < 0) {
      h ^= 0x5a;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mix(state.tick);
  mix(state.rng);
  for (const s of state.soldiers) {
    mix(s.id); mix(s.team); mix(s.x); mix(s.y);
    mix(s.tx ?? -1); mix(s.ty ?? -1);
    mix(s.hp); mix(s.suppression); mix(s.alive ? 1 : 0);
    mix(s.stance === "stand" ? 0 : s.stance === "crouch" ? 1 : 2);
    mix(s.moveMode === "sprint" ? 0 : s.moveMode === "move" ? 1 : s.moveMode === "sneak" ? 2 : 3);
    mix(WEAPON_IDS.indexOf(s.weapon));
    mix(s.cooldown);
    mix(s.targetId ?? -1);
    mix(s.aimId ?? -1);
    mix(s.settle);
  }
  return h >>> 0;
}
