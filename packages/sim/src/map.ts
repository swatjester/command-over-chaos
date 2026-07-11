/**
 * Static map geometry for the deterministic sim — collision + LOS.
 * One data structure drives BOTH sim rules and client rendering, so the
 * world you see is exactly the world the server simulates.
 */

export type ObstacleKind = "wall" | "stone" | "hay" | "tree" | "fence" | "shed" | "window";

export interface Obstacle {
  /** corner-based AABB, millimeters */
  x: number;
  y: number;
  w: number;
  h: number;
  /** height in mm — <=1200 reads as low cover; higher blocks sight fully */
  ht: number;
  /** rendering hint only — no sim meaning beyond ht */
  kind: ObstacleKind;
}

/** Named enterable-structure footprint (mm AABB) — rendering hint only
 *  (roof + cutaway); carries no sim meaning. */
export interface BuildingDef { name: string; x: number; y: number; w: number; h: number; }

/** Victory-point capture zone: circular, flagged. Occupy it solely for
 *  CAP_TICKS to take the flag; any enemy inside = contested. */
export interface ZoneDef {
  name: string;
  /** center, mm */
  x: number;
  y: number;
  /** radius, mm */
  r: number;
  /** VP per second while owned (uncontested) */
  value: number;
}

export interface MapDef {
  w: number;
  h: number;
  obstacles: Obstacle[];
  /** fireteam anchor points per team, mm — used by server/offline spawning */
  spawns: [Array<[number, number]>, Array<[number, number]>];
  /** enterable structures, for client roof/cutaway rendering */
  buildings?: BuildingDef[];
  /** victory-point capture zones */
  zones?: ZoneDef[];
}

export const SOLDIER_RADIUS = 350; // mm

/** Thin, low cover a standing/crouching soldier can climb over: low walls,
 *  fences, window sills. Bulky low cover (hay bales, tree trunks) cannot be
 *  vaulted. 1200 = WALL_HEIGHT (kept literal: los.ts imports this module). */
export function vaultable(o: Obstacle): boolean {
  return o.ht <= 1200 && o.kind !== "tree" && o.kind !== "hay" && Math.min(o.w, o.h) <= 700;
}

/** Collision class at (x,y): 0 = free, 1 = hard block, 2 = vaultable cover only. */
export function blockedEx(obstacles: readonly Obstacle[], x: number, y: number): 0 | 1 | 2 {
  let v: 0 | 1 | 2 = 0;
  for (const o of obstacles) {
    if (
      x > o.x - SOLDIER_RADIUS && x < o.x + o.w + SOLDIER_RADIUS &&
      y > o.y - SOLDIER_RADIUS && y < o.y + o.h + SOLDIER_RADIUS
    ) {
      if (!vaultable(o)) return 1;
      v = 2;
    }
  }
  return v;
}

/** True if a soldier center at (x,y) would intersect any obstacle. */
export function blocked(obstacles: readonly Obstacle[], x: number, y: number): boolean {
  for (const o of obstacles) {
    if (
      x > o.x - SOLDIER_RADIUS && x < o.x + o.w + SOLDIER_RADIUS &&
      y > o.y - SOLDIER_RADIUS && y < o.y + o.h + SOLDIER_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

/** meters in, integer mm out */
function o(x: number, y: number, w: number, h: number, ht: number, kind: ObstacleKind): Obstacle {
  return {
    x: Math.round(x * 1000), y: Math.round(y * 1000),
    w: Math.round(w * 1000), h: Math.round(h * 1000),
    ht: Math.round(ht * 1000), kind,
  };
}

/** The original M0 test map — kept for tests and benchmarks. */
export const GREYBOX_MAP: MapDef = {
  w: 100000,
  h: 100000,
  obstacles: [
    ...([[20, 30], [25, 55], [40, 42], [55, 30], [62, 60], [75, 45], [35, 70], [70, 75], [50, 15], [50, 85]] as Array<[number, number]>)
      .map(([x, y]) => o(x - 1.2, y - 0.6, 2.4, 1.2, 1.1, "stone")),
    o(44, 43.8, 12, 0.4, 3, "wall"),
    o(44, 44.8, 0.4, 5, 3, "wall"),
    o(55.8, 44, 0.4, 12, 3, "wall"),
    o(43.9, 55.8, 9, 0.4, 3, "wall"),
  ],
  spawns: [
    [[30000, 10000], [50000, 10000], [70000, 10000]],
    [[30000, 90000], [50000, 90000], [70000, 90000]],
  ],
};

// ---------------------------------------------------------------------------
// FARMSTEAD — the first real map. Classic CoC layout: maison north, church
// south, walled courtyard center, orchards + open fields with hay/walls/
// sheds/fences east and west. Mirror-balanced across the center line
// (y=75) except maison vs church, which trade equivalent footprints.
// ---------------------------------------------------------------------------

function farmstead(): MapDef {
  const obs: Obstacle[] = [];

  // === MAISON (north building) — 40x22m, 4 rooms, windows all around ======
  // exterior x 55..95, y 14..36; doors: south (center 75), west, east; every
  // window is a firing position (blocks movement, low-cover LOS semantics)
  obs.push(
    // north wall: windows at 62-65, 73-76, 84-87
    o(55, 13.8, 7, 0.4, 3, "wall"), o(62, 13.8, 3, 0.4, 1.1, "window"),
    o(65, 13.8, 8, 0.4, 3, "wall"), o(73, 13.8, 3, 0.4, 1.1, "window"),
    o(76, 13.8, 8, 0.4, 3, "wall"), o(84, 13.8, 3, 0.4, 1.1, "window"),
    o(87, 13.8, 8, 0.4, 3, "wall"),
    // south wall: door 73.5..76.5, windows 60-63 and 86-89
    o(55, 35.8, 5, 0.4, 3, "wall"), o(60, 35.8, 3, 0.4, 1.1, "window"),
    o(63, 35.8, 10.5, 0.4, 3, "wall"), o(76.5, 35.8, 9.5, 0.4, 3, "wall"),
    o(86, 35.8, 3, 0.4, 1.1, "window"), o(89, 35.8, 6, 0.4, 3, "wall"),
    // west wall: door 22..25, window 30-33
    o(54.8, 14, 0.4, 8, 3, "wall"), o(54.8, 25, 0.4, 5, 3, "wall"),
    o(54.8, 30, 0.4, 3, 1.1, "window"), o(54.8, 33, 0.4, 3, 3, "wall"),
    // east wall: window 18-21, door 28..31
    o(94.8, 14, 0.4, 4, 3, "wall"), o(94.8, 18, 0.4, 3, 1.1, "window"),
    o(94.8, 21, 0.4, 7, 3, "wall"), o(94.8, 31, 0.4, 5, 3, "wall"),
    // interior: E-W wall y=25 (door 64..67), N-S walls x=75 (door 18..21)
    // and x=80 (door 29..32) => 4 rooms
    o(55, 24.8, 9, 0.4, 3, "wall"), o(67, 24.8, 8, 0.4, 3, "wall"),
    o(74.8, 14, 0.4, 4, 3, "wall"), o(74.8, 21, 0.4, 4, 3, "wall"),
    o(79.8, 25, 0.4, 4, 3, "wall"), o(79.8, 32, 0.4, 4, 3, "wall"),
  );

  // === CHURCH (south building) — big cross: nave 16x36, transept 40x12 ====
  // nave x 67..83, y 104..140; transept x 55..95, y 116..128
  obs.push(
    // nave north face: door 73.5..76.5, windows flanking
    o(67, 103.8, 2.5, 0.4, 3, "wall"), o(69.5, 103.8, 3, 0.4, 1.1, "window"),
    o(72.5, 103.8, 1, 0.4, 3, "wall"), o(76.5, 103.8, 1, 0.4, 3, "wall"),
    o(77.5, 103.8, 3, 0.4, 1.1, "window"), o(80.5, 103.8, 2.5, 0.4, 3, "wall"),
    // nave south face: mirror
    o(67, 139.8, 2.5, 0.4, 3, "wall"), o(69.5, 139.8, 3, 0.4, 1.1, "window"),
    o(72.5, 139.8, 1, 0.4, 3, "wall"), o(76.5, 139.8, 1, 0.4, 3, "wall"),
    o(77.5, 139.8, 3, 0.4, 1.1, "window"), o(80.5, 139.8, 2.5, 0.4, 3, "wall"),
    // nave west wall (transept opening 116..128), windows in each half
    o(66.8, 104, 0.4, 4, 3, "wall"), o(66.8, 108, 0.4, 3, 1.1, "window"), o(66.8, 111, 0.4, 5, 3, "wall"),
    o(66.8, 128, 0.4, 3, 3, "wall"), o(66.8, 131, 0.4, 3, 1.1, "window"), o(66.8, 134, 0.4, 6, 3, "wall"),
    // nave east wall: mirror
    o(82.8, 104, 0.4, 4, 3, "wall"), o(82.8, 108, 0.4, 3, 1.1, "window"), o(82.8, 111, 0.4, 5, 3, "wall"),
    o(82.8, 128, 0.4, 3, 3, "wall"), o(82.8, 131, 0.4, 3, 1.1, "window"), o(82.8, 134, 0.4, 6, 3, "wall"),
    // transept walls with windows
    o(55, 115.8, 3, 0.4, 3, "wall"), o(58, 115.8, 3, 0.4, 1.1, "window"), o(61, 115.8, 6, 0.4, 3, "wall"),
    o(83, 115.8, 6, 0.4, 3, "wall"), o(89, 115.8, 3, 0.4, 1.1, "window"), o(92, 115.8, 3, 0.4, 3, "wall"),
    o(55, 127.8, 3, 0.4, 3, "wall"), o(58, 127.8, 3, 0.4, 1.1, "window"), o(61, 127.8, 6, 0.4, 3, "wall"),
    o(83, 127.8, 6, 0.4, 3, "wall"), o(89, 127.8, 3, 0.4, 1.1, "window"), o(92, 127.8, 3, 0.4, 3, "wall"),
    // transept end walls with doors (120.5..123.5)
    o(54.8, 116, 0.4, 4.5, 3, "wall"), o(54.8, 123.5, 0.4, 4.5, 3, "wall"),
    o(94.8, 116, 0.4, 4.5, 3, "wall"), o(94.8, 123.5, 0.4, 4.5, 3, "wall"),
    // interior: altar partition (door 73..77)
    o(67, 131.8, 6, 0.4, 3, "wall"), o(77, 131.8, 6, 0.4, 3, "wall"),
  );

  // === CENTER POI: walled courtyard with well (68..82, 70..80) =============
  obs.push(
    o(68, 69.75, 14, 0.5, 1.1, "stone"),           // low walls — fightable over
    o(68, 79.75, 14, 0.5, 1.1, "stone"),
    o(67.75, 70, 0.5, 4, 1.1, "stone"),            // west, gap 74..76
    o(67.75, 76, 0.5, 4, 1.1, "stone"),
    o(81.75, 70, 0.5, 4, 1.1, "stone"),            // east, gap
    o(81.75, 76, 0.5, 4, 1.1, "stone"),
    o(74.25, 74.25, 1.5, 1.5, 1.1, "stone"),       // the well
    o(70, 71.5, 2, 2, 1.1, "hay"),
    o(78.5, 76.5, 2, 2, 1.1, "hay"),
  );
  // approach cover flanking the courtyard (mirrored)
  obs.push(
    o(52, 64.75, 12, 0.5, 1.1, "stone"), o(52, 84.75, 12, 0.5, 1.1, "stone"),
    o(86, 64.75, 12, 0.5, 1.1, "stone"), o(86, 84.75, 12, 0.5, 1.1, "stone"),
  );

  // === EAST FIELD (walls/hay/fences, mirrored N/S) ==========================
  {
    const fx = (x: number, w: number): number => 150 - x - w;
    obs.push(
      o(fx(20, 20), 54.75, 20, 0.5, 1.1, "stone"),
      o(fx(20, 20), 94.75, 20, 0.5, 1.1, "stone"),
      o(fx(29.75, 0.5), 65, 0.5, 20, 1.1, "stone"),
      o(fx(14, 5), 38, 5, 4, 3, "shed"),
      o(fx(14, 5), 108, 5, 4, 3, "shed"),
      o(fx(23, 2), 69, 2, 2, 1.1, "hay"),
      o(fx(23, 2), 79, 2, 2, 1.1, "hay"),
      o(fx(26.5, 2), 74, 2, 2, 1.1, "hay"),
      o(fx(8, 14), 55, 14, 0.3, 0.9, "fence"),
      o(fx(8, 14), 94.7, 14, 0.3, 0.9, "fence"),
    );
  }

  // === WEST FIELD ===========================================================
  // North half: THE BARN — 14x24m open interior, no windows, big doors on the
  // short N/S ends (facing the spawns), one offset interior wall cutting the
  // door-to-door sightline (passage stays open on the east side).
  obs.push(
    o(19, 49.75, 5, 0.5, 3, "shed"),   // north end, west of door (24..28)
    o(28, 49.75, 5, 0.5, 3, "shed"),
    o(19, 73.75, 5, 0.5, 3, "shed"),   // south end, west of door (24..28)
    o(28, 73.75, 5, 0.5, 3, "shed"),
    o(18.75, 50, 0.5, 24, 3, "shed"),  // west long wall
    o(32.75, 50, 0.5, 24, 3, "shed"),  // east long wall
    o(19, 61.75, 11, 0.5, 3, "shed"),  // interior LOS cut, gap 30..33
  );
  // South half: open hay field (the barn's counterpart stays field, more hay)
  obs.push(
    o(20, 94.75, 20, 0.5, 1.1, "stone"),
    o(14, 38, 5, 4, 3, "shed"),
    o(14, 108, 5, 4, 3, "shed"),
    o(23, 79, 2, 2, 1.1, "hay"),
    o(20, 82.5, 2, 2, 1.1, "hay"),
    o(26, 81, 2, 2, 1.1, "hay"),
    o(29.5, 85, 2, 2, 1.1, "hay"),
    o(22, 87.5, 2, 2, 1.1, "hay"),
    o(27, 90.5, 2, 2, 1.1, "hay"),
    o(24, 94, 2, 2, 1.1, "hay"),
    o(8, 94.7, 14, 0.3, 0.9, "fence"),
  );

  // === ORCHARDS (NW + SW, mirrored) =========================================
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      obs.push(o(36 + i * 5, 31 + j * 5, 0.8, 0.8, 1.1, "tree"));
      obs.push(o(36 + i * 5, 109 + j * 5, 0.8, 0.8, 1.1, "tree"));
    }
  }
  // scattered lone trees (mirrored pairs)
  for (const [x, y] of [[55, 50], [95, 50], [108, 35], [45, 62], [105, 62]] as Array<[number, number]>) {
    obs.push(o(x, y, 0.8, 0.8, 1.1, "tree"));
    obs.push(o(x, 150 - y - 0.8, 0.8, 0.8, 1.1, "tree"));
  }

  return {
    w: 150000,
    h: 150000,
    obstacles: obs,
    buildings: [
      { name: "maison", x: 54800, y: 13800, w: 40400, h: 22400 },
      { name: "church-nave", x: 66800, y: 103800, w: 16400, h: 36400 },
      { name: "church-transept", x: 54800, y: 115800, w: 40400, h: 12400 },
      { name: "barn", x: 18750, y: 49750, w: 14500, h: 24500 },
    ],
    // VP zones (locations circled by Dan on the 2026-07-08 screenshot).
    // N/S mirror-balanced: maison<->church, barn<->hayfield, orchard pair,
    // shed pair; courtyard + east field sit on the centerline.
    zones: [
      { name: "Maison", x: 75000, y: 25000, r: 12500, value: 2 },
      { name: "Church", x: 75000, y: 122000, r: 13000, value: 2 },
      { name: "Courtyard", x: 75000, y: 75000, r: 8000, value: 2 },
      { name: "Barn", x: 26000, y: 62000, r: 10000, value: 1 },
      { name: "Hayfield", x: 25500, y: 87500, r: 9000, value: 1 },
      { name: "East Field", x: 124500, y: 75000, r: 9000, value: 1 },
      { name: "North Orchard", x: 44000, y: 36500, r: 9000, value: 1 },
      { name: "South Orchard", x: 44000, y: 114500, r: 9000, value: 1 },
      { name: "North Shed", x: 133500, y: 40000, r: 4500, value: 1 },
      { name: "South Shed", x: 133500, y: 110000, r: 4500, value: 1 },
    ],
    // out of weapon range (max 90m) and behind own building
    spawns: [
      [[40000, 8000], [75000, 8000], [110000, 8000]],
      [[40000, 142000], [75000, 142000], [110000, 142000]],
    ],
  };
}

export const FARMSTEAD_MAP: MapDef = farmstead();

/** The map currently in rotation. */
export const ACTIVE_MAP: MapDef = FARMSTEAD_MAP;
