/** Grenade definitions + entities. Deterministic integer data. */

export type GrenadeKind = "frag" | "smoke";

export const GRENADES = {
  frag: {
    throwRange: 25000,   // mm
    flightSpeed: 667,    // mm per tick (~20 m/s)
    fuseAfterLand: 45,   // ticks (1.5s) after landing
    radius: 6000,        // lethal radius, damage falloff to edge
    maxDamage: 90,
    minDamage: 20,
    suppression: 45,
    suppressRadius: 9000,
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
