/** Grenade definitions + entities. Deterministic integer data. */

export type GrenadeKind = "frag" | "smoke";

export const GRENADES = {
  frag: {
    throwRange: 25000,   // mm
    flightSpeed: 667,    // mm per tick (~20 m/s)
    fuseAfterLand: 45,   // ticks (1.5s) after landing
    // CoC rule: frags STUN more than they kill — unless direct/adjacent.
    innerRadius: 2000,   // adjacent = lethal
    innerMax: 130,       // direct hit overkills — guaranteed kill
    innerMin: 55,
    outerRadius: 6000,   // fragmentation zone: light damage
    outerMax: 25,
    outerMin: 5,
    stunRadius: 4500,    // hard stun: suppression pegged to 100 (pinned)
    suppressRadius: 9000, // shaken zone: 70 -> 40 falloff
  },
  smoke: {
    throwRange: 25000,
    flightSpeed: 667,
    fuseAfterLand: 0,    // deploys on landing
    cloudRadius: 5000,
    cloudTtl: 900,       // 30s
  },
} as const;

export interface Grenade {
  id: number;
  kind: GrenadeKind;
  thrower: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  thrownTick: number;
  landTick: number;
  explodeTick: number;
}

export interface Boom {
  x: number;
  y: number;
  kind: GrenadeKind;
}
