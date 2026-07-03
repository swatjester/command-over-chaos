/** Grenade + delivery definitions. Deterministic integer data. */

export type GrenadeKind = "frag" | "smoke";

export interface DeliveryProfile {
  /** mm — max throw/launch range */
  range: number;
  /** deviation: max offset = distance * devPct / 100 (square cone) */
  devPct: number;
  /** mm per tick */
  flightSpeed: number;
}

/** Hand toss vs rifle-mounted GL (grenadier's carbine_gl). */
export const DELIVERY: Record<"hand" | "gl", DeliveryProfile> = {
  hand: { range: 15000, devPct: 10, flightSpeed: 667 },
  gl:   { range: 45000, devPct: 3,  flightSpeed: 1400 },
};

/** Hand frag (M67-class): lethal adjacent, stuns near. */
export const HAND_FRAG = {
  fuseAfterLand: 45,   // ticks (1.5s) after landing
  innerRadius: 2000,   // adjacent = lethal
  innerMax: 130,       // direct hit overkills — guaranteed kill
  innerMin: 55,
  outerRadius: 6000,   // fragmentation zone: light damage
  outerMax: 25,
  outerMin: 5,
  stunRadius: 4500,    // hard stun: suppression pegged (pinned)
  suppressRadius: 9000, // shaken zone: 70 -> 40 falloff
};

/** 40mm GL frag: ~6x less filler. Downs on a direct hit, stuns on a near
 *  miss — never an instant kill. Impact-fuzed. */
export const GL_FRAG = {
  directRadius: 1500,  // direct hit: target goes down
  nearDamage: 12,
  stunRadius: 3500,    // suppression pegged
  suppressRadius: 6000, // shaken
};

export const SMOKE = {
  cloudRadius: 5000,
  cloudTtl: 900, // 30s
};

export interface Grenade {
  id: number;
  kind: GrenadeKind;
  /** launched from a GL rather than hand-thrown */
  gl: boolean;
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
