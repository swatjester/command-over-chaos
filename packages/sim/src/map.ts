/**
 * Static map geometry for the deterministic sim — collision + LOS.
 * One data structure drives BOTH sim rules and client rendering, so the
 * world you see is exactly the world the server simulates.
 */

export type ObstacleKind = "wall" | "stone" | "hay" | "tree" | "fence" | "shed" | "window" | "truck" | "car";

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
  /** ground decals (dirt/gravel) — rendering hint only */
  patches?: Array<{ x: number; y: number; w: number; h: number; kind: "dirt" | "gravel" }>;
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
// FARMSTEAD (300x300 — 2026-07-08 rebuild, 4x the old map area).
// Classic core in the center (maison N / church S / walled courtyard + well),
// barn + hay field west, vehicle parking east, four forests, and long open
// lanes between POIs so DMR/LMG overwatch and low-percentage potshot duels
// have room to breathe. Mirror-balanced across y=150 (maison<->church and
// barn<->hayfield trade equivalent footprints). All joints are butt-jointed
// — obstacles never overlap (enforced by a sim test).
// ---------------------------------------------------------------------------

function farmstead(): MapDef {
  const obs: Obstacle[] = [];
  const H = 300; // meters, for mirroring
  /** push an obstacle AND its north/south mirror */
  function mir(x: number, y: number, w: number, h: number, ht: number, kind: ObstacleKind): void {
    obs.push(o(x, y, w, h, ht, kind));
    obs.push(o(x, H - y - h, w, h, ht, kind));
  }

  // === THE MAISON (north-center) — 40x22m, 4-room, windows all around =====
  // exterior x 130..170, y 64..86; horizontal walls span the full width,
  // vertical walls sit between them (y 64.2..85.8): clean corners.
  obs.push(
    // north wall: windows at 137-140, 148-151, 159-162
    o(129.8, 63.8, 7.2, 0.4, 3, "wall"), o(137, 63.8, 3, 0.4, 1.1, "window"),
    o(140, 63.8, 8, 0.4, 3, "wall"), o(148, 63.8, 3, 0.4, 1.1, "window"),
    o(151, 63.8, 8, 0.4, 3, "wall"), o(159, 63.8, 3, 0.4, 1.1, "window"),
    o(162, 63.8, 8.2, 0.4, 3, "wall"),
    // south wall: door 148.5..151.5, windows 135-138 and 161-164
    o(129.8, 85.8, 5.2, 0.4, 3, "wall"), o(135, 85.8, 3, 0.4, 1.1, "window"),
    o(138, 85.8, 10.5, 0.4, 3, "wall"), o(151.5, 85.8, 9.5, 0.4, 3, "wall"),
    o(161, 85.8, 3, 0.4, 1.1, "window"), o(164, 85.8, 6.2, 0.4, 3, "wall"),
    // west wall: door 72..75, window 80-83
    o(129.8, 64.2, 0.4, 7.8, 3, "wall"), o(129.8, 75, 0.4, 5, 3, "wall"),
    o(129.8, 80, 0.4, 3, 1.1, "window"), o(129.8, 83, 0.4, 2.8, 3, "wall"),
    // east wall: window 68-71, door 78..81
    o(169.8, 64.2, 0.4, 3.8, 3, "wall"), o(169.8, 68, 0.4, 3, 1.1, "window"),
    o(169.8, 71, 0.4, 7, 3, "wall"), o(169.8, 81, 0.4, 4.8, 3, "wall"),
    // interior: E-W divider y=75 (door 139..142), N-S walls x=150 (north
    // half, door 68..71) and x=155 (south half, door 79..82)
    o(130.2, 74.8, 8.8, 0.4, 3, "wall"), o(142, 74.8, 7.8, 0.4, 3, "wall"),
    o(149.8, 64.2, 0.4, 3.8, 3, "wall"), o(149.8, 71, 0.4, 4.2, 3, "wall"),
    o(154.8, 75.2, 0.4, 3.8, 3, "wall"), o(154.8, 82, 0.4, 3.8, 3, "wall"),
  );

  // === THE CHURCH (south-center) — cross: nave 16.4x36.4, transept 40.4x12.4
  obs.push(
    // nave north face: door 148.5..151.5, windows flanking
    o(141.8, 206.8, 2.7, 0.4, 3, "wall"), o(144.5, 206.8, 3, 0.4, 1.1, "window"),
    o(147.5, 206.8, 1, 0.4, 3, "wall"), o(151.5, 206.8, 1, 0.4, 3, "wall"),
    o(152.5, 206.8, 3, 0.4, 1.1, "window"), o(155.5, 206.8, 2.7, 0.4, 3, "wall"),
    // nave south face: mirror pattern
    o(141.8, 242.8, 2.7, 0.4, 3, "wall"), o(144.5, 242.8, 3, 0.4, 1.1, "window"),
    o(147.5, 242.8, 1, 0.4, 3, "wall"), o(151.5, 242.8, 1, 0.4, 3, "wall"),
    o(152.5, 242.8, 3, 0.4, 1.1, "window"), o(155.5, 242.8, 2.7, 0.4, 3, "wall"),
    // nave west wall (transept opening 218.8..231.2), windows in each half
    o(141.8, 207.2, 0.4, 3.8, 3, "wall"), o(141.8, 211, 0.4, 3, 1.1, "window"), o(141.8, 214, 0.4, 4.8, 3, "wall"),
    o(141.8, 231.2, 0.4, 2.8, 3, "wall"), o(141.8, 234, 0.4, 3, 1.1, "window"), o(141.8, 237, 0.4, 5.8, 3, "wall"),
    // nave east wall: mirror
    o(157.8, 207.2, 0.4, 3.8, 3, "wall"), o(157.8, 211, 0.4, 3, 1.1, "window"), o(157.8, 214, 0.4, 4.8, 3, "wall"),
    o(157.8, 231.2, 0.4, 2.8, 3, "wall"), o(157.8, 234, 0.4, 3, 1.1, "window"), o(157.8, 237, 0.4, 5.8, 3, "wall"),
    // transept north wall (stops at the nave walls)
    o(129.8, 218.8, 4.2, 0.4, 3, "wall"), o(134, 218.8, 3, 0.4, 1.1, "window"), o(137, 218.8, 4.8, 0.4, 3, "wall"),
    o(158.2, 218.8, 4.8, 0.4, 3, "wall"), o(163, 218.8, 3, 0.4, 1.1, "window"), o(166, 218.8, 4.2, 0.4, 3, "wall"),
    // transept south wall
    o(129.8, 230.8, 4.2, 0.4, 3, "wall"), o(134, 230.8, 3, 0.4, 1.1, "window"), o(137, 230.8, 4.8, 0.4, 3, "wall"),
    o(158.2, 230.8, 4.8, 0.4, 3, "wall"), o(163, 230.8, 3, 0.4, 1.1, "window"), o(166, 230.8, 4.2, 0.4, 3, "wall"),
    // transept end walls with doors (223.5..226.5)
    o(129.8, 219.2, 0.4, 4.3, 3, "wall"), o(129.8, 226.5, 0.4, 4.3, 3, "wall"),
    o(169.8, 219.2, 0.4, 4.3, 3, "wall"), o(169.8, 226.5, 0.4, 4.3, 3, "wall"),
    // altar partition (door 147..153)
    o(142.2, 236.8, 4.8, 0.4, 3, "wall"), o(153, 236.8, 4.8, 0.4, 3, "wall"),
  );

  // === COURTYARD + WELL (dead center) — low walls, 4 gated entrances ======
  obs.push(
    o(136.25, 139.75, 11.75, 0.5, 1.1, "stone"), o(152, 139.75, 11.75, 0.5, 1.1, "stone"), // north, gap 148-152
    o(136.25, 159.75, 11.75, 0.5, 1.1, "stone"), o(152, 159.75, 11.75, 0.5, 1.1, "stone"), // south
    o(135.75, 139.75, 0.5, 8.25, 1.1, "stone"), o(135.75, 152, 0.5, 8.25, 1.1, "stone"),   // west, gap 148-152
    o(163.75, 139.75, 0.5, 8.25, 1.1, "stone"), o(163.75, 152, 0.5, 8.25, 1.1, "stone"),   // east
    o(149.25, 149.25, 1.5, 1.5, 1.1, "stone"), // the well
  );
  mir(139, 143, 2, 2, 1.1, "hay");
  mir(158, 144, 2, 2, 1.1, "hay");

  // === THE BARN (west, north half) — open interior, doors on N/S ends ======
  obs.push(
    o(51.25, 117.75, 4.75, 0.5, 3, "shed"), o(60, 117.75, 4.75, 0.5, 3, "shed"),  // north end, door 56..60
    o(51.25, 141.75, 4.75, 0.5, 3, "shed"), o(60, 141.75, 4.75, 0.5, 3, "shed"),  // south end, door 56..60
    o(50.75, 117.75, 0.5, 24.5, 3, "shed"),  // west long wall (full corners)
    o(64.75, 117.75, 0.5, 24.5, 3, "shed"),  // east long wall
    o(51.25, 129.75, 10.5, 0.5, 3, "shed"),  // interior LOS cut, passage on the east
  );

  // === HAY FIELD (west, south half — the barn's traded footprint) ==========
  obs.push(o(50, 157.75, 16, 0.5, 1.1, "stone")); // north edge low wall
  obs.push(o(50, 181.7, 16, 0.3, 0.9, "fence"));  // south edge fence
  for (const [hx, hy] of [[48, 162], [54, 160], [60, 163], [51, 168], [57, 169], [63, 167], [50, 175], [58, 176], [64, 174]] as Array<[number, number]>) {
    obs.push(o(hx, hy, 2, 2, 1.1, "hay"));
  }

  // === PARKING (east-center) — gravel lot, trucks + cars as cover ==========
  // (self-mirrored about y=150)
  obs.push(
    o(232, 140, 7, 2.5, 2.6, "truck"), o(232, 157.5, 7, 2.5, 2.6, "truck"),
    o(242, 144, 4.5, 2, 1.15, "car"), o(242, 154, 4.5, 2, 1.15, "car"),
    o(250, 149, 4.5, 2, 1.15, "car"),
  );

  // === FORESTS (N/S mirrored pair + self-mirrored W/E) ======================
  // north forest: 6x4 staggered grid; mir() plants the south forest
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 6; i++) {
      mir(135 + i * 6 + (j % 2 === 1 ? 3 : 0), 23 + j * 6, 0.8, 0.8, 1.1, "tree");
    }
  }
  // west + east forests: rows planted in the north half, mir() reflects them
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 5; i++) {
      mir(20 + i * 6 + (j % 2 === 1 ? 3 : 0), 135 + j * 6, 0.8, 0.8, 1.1, "tree");   // west
      mir(254 + i * 6 + (j % 2 === 1 ? 3 : 0), 135 + j * 6, 0.8, 0.8, 1.1, "tree");  // east
    }
  }

  // === CONNECTIVE COVER (all N/S mirrored) ==================================
  // mid-lane overwatch walls flanking the courtyard approaches
  mir(100, 119.75, 20, 0.5, 1.1, "stone");
  mir(180, 119.75, 20, 0.5, 1.1, "stone");
  // spawn-approach cover
  mir(140, 45.75, 20, 0.5, 1.1, "stone");
  mir(70, 99.7, 20, 0.3, 0.9, "fence");
  mir(210, 99.7, 20, 0.3, 0.9, "fence");
  // hay pairs in the open mid-fields
  mir(100, 130, 2, 2, 1.1, "hay");
  mir(104, 134, 2, 2, 1.1, "hay");
  mir(196, 130, 2, 2, 1.1, "hay");
  mir(192, 134, 2, 2, 1.1, "hay");
  // sheds in the spawn quarters
  mir(70, 38, 5, 4, 3, "shed");
  mir(225, 38, 5, 4, 3, "shed");
  // orchard decor west of the maison (and its church-side mirror)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      mir(105 + i * 5, 55 + j * 5, 0.8, 0.8, 1.1, "tree");
    }
  }
  // scattered lone trees
  mir(80, 70, 0.8, 0.8, 1.1, "tree");
  mir(220, 70, 0.8, 0.8, 1.1, "tree");
  mir(125, 95, 0.8, 0.8, 1.1, "tree");
  mir(175, 95, 0.8, 0.8, 1.1, "tree");
  mir(45, 55, 0.8, 0.8, 1.1, "tree");
  mir(255, 55, 0.8, 0.8, 1.1, "tree");

  return {
    w: 300000,
    h: 300000,
    obstacles: obs,
    buildings: [
      { name: "maison", x: 129800, y: 63800, w: 40400, h: 22400 },
      { name: "church-nave", x: 141800, y: 206800, w: 16400, h: 36400 },
      { name: "church-transept", x: 129800, y: 218800, w: 40400, h: 12400 },
      { name: "barn", x: 50750, y: 117750, w: 14500, h: 24500 },
    ],
    zones: [
      { name: "The Maison", x: 150000, y: 75000, r: 12500, value: 2 },
      { name: "The Church", x: 150000, y: 225000, r: 13000, value: 2 },
      { name: "Courtyard", x: 150000, y: 150000, r: 10000, value: 2 },
      { name: "The Barn", x: 58000, y: 130000, r: 10000, value: 1 },
      { name: "Hay Field", x: 56000, y: 170000, r: 10000, value: 1 },
      { name: "Parking", x: 243000, y: 150000, r: 10000, value: 1 },
      { name: "North Forest", x: 150000, y: 32000, r: 14000, value: 1 },
      { name: "South Forest", x: 150000, y: 268000, r: 14000, value: 1 },
      { name: "West Forest", x: 34000, y: 150000, r: 13000, value: 1 },
      { name: "East Forest", x: 268000, y: 150000, r: 13000, value: 1 },
    ],
    patches: [
      { x: 228000, y: 133000, w: 30000, h: 34000, kind: "gravel" },
    ],
    spawns: [
      [[75000, 10000], [150000, 10000], [225000, 10000]],
      [[75000, 290000], [150000, 290000], [225000, 290000]],
    ],
  };
}

export const FARMSTEAD_MAP: MapDef = farmstead();

/** The map currently in rotation. */
export const ACTIVE_MAP: MapDef = FARMSTEAD_MAP;
