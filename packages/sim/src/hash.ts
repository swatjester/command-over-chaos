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
  mix(state.nextGrenadeId);
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
    mix(s.frags); mix(s.smokes);
    mix(s.holdFire ? 1 : 0);
    mix(s.leanX); mix(s.leanY);
    mix(s.down ? 1 : 0); mix(s.bleed);
    mix(s.aidId ?? -1); mix(s.aidProgress);
    mix(s.revived ? 1 : 0); mix(s.peekUp ? 1 : 0);
    mix(s.pips); mix(s.vaultT); mix(s.vaultX); mix(s.vaultY);
    mix(s.queue.length);
    for (const [qx, qy] of s.queue) { mix(qx); mix(qy); }
  }
  for (const g of state.grenades) {
    mix(g.id); mix(g.kind === "frag" ? 0 : 1); mix(g.gl ? 1 : 0); mix(g.thrower);
    mix(g.sx); mix(g.sy); mix(g.x); mix(g.y);
    mix(g.thrownTick); mix(g.landTick); mix(g.explodeTick);
  }
  for (const c of state.smokes) {
    mix(c.id); mix(c.x); mix(c.y); mix(c.r); mix(c.ttl);
  }
  return h >>> 0;
}
