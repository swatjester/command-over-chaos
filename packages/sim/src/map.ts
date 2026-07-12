/**
 * Static map geometry for the deterministic sim — collision + LOS.
 * One data structure drives BOTH sim rules and client rendering, so the
 * world you see is exactly the world the server simulates.
 */
import { dist } from "./math.js";

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

/**
 * Cover-seeking move assist: nearest free spot hugging a piece of cover
 * within `maxDist` mm of (x,y) — used by the client to snap multi-select
 * move orders onto cover. Samples points 800mm off every obstacle face at
 * 1m spacing; skips blocked points and anything within 900mm of a `taken`
 * position (other soldiers / spots already assigned this order).
 */
export function findCoverSpot(
  obstacles: readonly Obstacle[], x: number, y: number, maxDist: number,
  taken: ReadonlyArray<[number, number]>,
): [number, number] | null {
  const OFF = 800;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const o of obstacles) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    if (Math.abs(cx - x) > maxDist + o.w / 2 + OFF + 1000) continue;
    if (Math.abs(cy - y) > maxDist + o.h / 2 + OFF + 1000) continue;
    const pts: Array<[number, number]> = [];
    for (let px = o.x; px <= o.x + o.w; px += 1000) {
      pts.push([px, o.y - OFF], [px, o.y + o.h + OFF]);
    }
    for (let py = o.y; py <= o.y + o.h; py += 1000) {
      pts.push([o.x - OFF, py], [o.x + o.w + OFF, py]);
    }
    for (const [px, py] of pts) {
      const d = dist(x, y, px, py);
      if (d > maxDist || d >= bestD) continue;
      if (blocked(obstacles, px, py)) continue;
      let clash = false;
      for (const [ox2, oy2] of taken) {
        if (dist(px, py, ox2, oy2) < 900) { clash = true; break; }
      }
      if (!clash) { best = [px, py]; bestD = d; }
    }
  }
  return best;
}

/** How close (mm) a click must land to cover to read as "hug that cover". */
export const HUG_CLICK_RANGE = 1000;
/** Hugging distance from the cover face (mm) — inside corner-peek range. */
export const HUG_OFF = 600;

/**
 * Click-near-cover movement assist: clicking within HUG_CLICK_RANGE of an
 * obstacle (or on it) means "take cover THERE". Returns a spot tight
 * against the face on the soldier's side of the obstacle — approach from
 * the south and you stack on the south face; click a window from inside
 * the building and you hold the inside of the frame. If the smart side is
 * blocked, the opposite face is tried. `taken` positions push the spot
 * along the face so a squad spreads out along the wall.
 */
export function findHugSpot(
  obstacles: readonly Obstacle[], clickX: number, clickY: number,
  fromX: number, fromY: number,
  taken: ReadonlyArray<[number, number]> = [],
): [number, number] | null {
  // nearest obstacle whose (unexpanded) box is within HUG_CLICK_RANGE of the click
  let target: Obstacle | null = null;
  let bestD = HUG_CLICK_RANGE + 1;
  for (const o of obstacles) {
    const dx = clickX < o.x ? o.x - clickX : clickX > o.x + o.w ? clickX - (o.x + o.w) : 0;
    const dy = clickY < o.y ? o.y - clickY : clickY > o.y + o.h ? clickY - (o.y + o.h) : 0;
    const d = Math.floor(Math.sqrt(dx * dx + dy * dy));
    if (d < bestD) { bestD = d; target = o; }
  }
  if (!target) return null;
  const o = target;

  // hug the broad face (thin axis) on the soldier's side; clamp along the face
  const alongX = o.w >= o.h; // wall runs east-west -> hug north or south face
  const tryFaces: Array<[number, number]> = [];
  if (alongX) {
    const px = Math.min(Math.max(clickX, o.x), o.x + o.w);
    const near = fromY <= o.y + o.h / 2 ? o.y - HUG_OFF : o.y + o.h + HUG_OFF;
    const far = fromY <= o.y + o.h / 2 ? o.y + o.h + HUG_OFF : o.y - HUG_OFF;
    tryFaces.push([px, near], [px, far]);
  } else {
    const py = Math.min(Math.max(clickY, o.y), o.y + o.h);
    const near = fromX <= o.x + o.w / 2 ? o.x - HUG_OFF : o.x + o.w + HUG_OFF;
    const far = fromX <= o.x + o.w / 2 ? o.x + o.w + HUG_OFF : o.x - HUG_OFF;
    tryFaces.push([near, py], [far, py]);
  }
  for (const [bx, by] of tryFaces) {
    // slide along the face to dodge blocked ground and taken spots
    for (const slide of [0, 900, -900, 1800, -1800, 2700, -2700]) {
      const px = alongX ? Math.min(Math.max(bx + slide, o.x), o.x + o.w) : bx;
      const py = alongX ? by : Math.min(Math.max(by + slide, o.y), o.y + o.h);
      if (blocked(obstacles, px, py)) continue;
      let clash = false;
      for (const [tx2, ty2] of taken) {
        if (dist(px, py, tx2, ty2) < 900) { clash = true; break; }
      }
      if (!clash) return [px, py];
    }
  }
  return null;
}

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

  // === THE CHURCH (south-center) — big cross: nave 20x44, transept 48x16 ==
  obs.push(
    // nave north face: door 148.5..151.5, windows flanking
    o(139.8, 202.8, 3.2, 0.4, 3, "wall"), o(143, 202.8, 3, 0.4, 1.1, "window"),
    o(146, 202.8, 2.5, 0.4, 3, "wall"), o(151.5, 202.8, 2.5, 0.4, 3, "wall"),
    o(154, 202.8, 3, 0.4, 1.1, "window"), o(157, 202.8, 3.2, 0.4, 3, "wall"),
    // nave south face: same pattern
    o(139.8, 246.8, 3.2, 0.4, 3, "wall"), o(143, 246.8, 3, 0.4, 1.1, "window"),
    o(146, 246.8, 2.5, 0.4, 3, "wall"), o(151.5, 246.8, 2.5, 0.4, 3, "wall"),
    o(154, 246.8, 3, 0.4, 1.1, "window"), o(157, 246.8, 3.2, 0.4, 3, "wall"),
    // nave west wall (transept opening 216.8..233.2), windows in each half
    o(139.8, 203.2, 0.4, 3.8, 3, "wall"), o(139.8, 207, 0.4, 3, 1.1, "window"), o(139.8, 210, 0.4, 6.8, 3, "wall"),
    o(139.8, 233.2, 0.4, 3.8, 3, "wall"), o(139.8, 237, 0.4, 3, 1.1, "window"), o(139.8, 240, 0.4, 6.8, 3, "wall"),
    // nave east wall: mirror
    o(159.8, 203.2, 0.4, 3.8, 3, "wall"), o(159.8, 207, 0.4, 3, 1.1, "window"), o(159.8, 210, 0.4, 6.8, 3, "wall"),
    o(159.8, 233.2, 0.4, 3.8, 3, "wall"), o(159.8, 237, 0.4, 3, 1.1, "window"), o(159.8, 240, 0.4, 6.8, 3, "wall"),
    // transept north wall (long cross arms, stop at the nave walls)
    o(125.8, 216.8, 3.2, 0.4, 3, "wall"), o(129, 216.8, 3, 0.4, 1.1, "window"),
    o(132, 216.8, 2.5, 0.4, 3, "wall"), o(134.5, 216.8, 3, 0.4, 1.1, "window"), o(137.5, 216.8, 2.3, 0.4, 3, "wall"),
    o(160.2, 216.8, 2.3, 0.4, 3, "wall"), o(162.5, 216.8, 3, 0.4, 1.1, "window"),
    o(165.5, 216.8, 2.5, 0.4, 3, "wall"), o(168, 216.8, 3, 0.4, 1.1, "window"), o(171, 216.8, 3.2, 0.4, 3, "wall"),
    // transept south wall
    o(125.8, 232.8, 3.2, 0.4, 3, "wall"), o(129, 232.8, 3, 0.4, 1.1, "window"),
    o(132, 232.8, 2.5, 0.4, 3, "wall"), o(134.5, 232.8, 3, 0.4, 1.1, "window"), o(137.5, 232.8, 2.3, 0.4, 3, "wall"),
    o(160.2, 232.8, 2.3, 0.4, 3, "wall"), o(162.5, 232.8, 3, 0.4, 1.1, "window"),
    o(165.5, 232.8, 2.5, 0.4, 3, "wall"), o(168, 232.8, 3, 0.4, 1.1, "window"), o(171, 232.8, 3.2, 0.4, 3, "wall"),
    // transept end walls with doors (223.5..226.5)
    o(125.8, 217.2, 0.4, 6.3, 3, "wall"), o(125.8, 226.5, 0.4, 6.3, 3, "wall"),
    o(173.8, 217.2, 0.4, 6.3, 3, "wall"), o(173.8, 226.5, 0.4, 6.3, 3, "wall"),
    // altar partition (door 146..154)
    o(140.2, 240.8, 5.8, 0.4, 3, "wall"), o(154, 240.8, 5.8, 0.4, 3, "wall"),
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

  // === THE BARN — recentered mid-west, between the two west hay pairs =====
  obs.push(
    o(96.25, 137.75, 4.75, 0.5, 3, "shed"), o(105, 137.75, 4.75, 0.5, 3, "shed"),  // north end, door 101..105
    o(96.25, 161.75, 4.75, 0.5, 3, "shed"), o(105, 161.75, 4.75, 0.5, 3, "shed"),  // south end, door 101..105
    o(95.75, 137.75, 0.5, 24.5, 3, "shed"),  // west long wall (full corners)
    o(109.75, 137.75, 0.5, 24.5, 3, "shed"), // east long wall
    o(96.25, 149.75, 10.5, 0.5, 3, "shed"),  // interior LOS cut, passage on the east
  );

  // === HAY FIELD — tucked under the barn, larger and looser ===============
  obs.push(o(60, 156.75, 18, 0.5, 1.1, "stone")); // north edge low wall
  obs.push(o(62, 185.7, 20, 0.3, 0.9, "fence"));  // south edge fence
  for (const [hx, hy] of [[62, 163], [68, 161], [75, 164], [65, 169], [72, 170], [79, 168], [63, 177], [70, 178], [78, 176], [84, 171]] as Array<[number, number]>) {
    obs.push(o(hx, hy, 2, 2, 1.1, "hay"));
  }

  // === PARKING (east-center) — gravel lot, trucks + cars as cover ==========
  // (self-mirrored about y=150)
  obs.push(
    o(232, 140, 7, 2.5, 2.6, "truck"), o(232, 157.5, 7, 2.5, 2.6, "truck"),
    o(242, 144, 4.5, 2, 1.15, "car"), o(242, 154, 4.5, 2, 1.15, "car"),
    o(250, 149, 4.5, 2, 1.15, "car"),
  );

  // === FORESTS — sparser, irregular stands (N/S pair mirrored; W/E loose) ==
  // north forest (mir() plants the south forest)
  for (const [tx, ty] of [[133, 21], [142, 25], [151, 20], [160, 24], [168, 21], [136, 31], [146, 34], [155, 30], [164, 33], [139, 41], [150, 43], [159, 39], [167, 42], [130, 38]] as Array<[number, number]>) {
    mir(tx, ty, 0.8, 0.8, 1.1, "tree");
  }
  // west forest
  for (const [tx, ty] of [[20, 136], [29, 140], [38, 135], [45, 142], [24, 148], [33, 151], [42, 147], [21, 158], [30, 156], [39, 160], [46, 155], [26, 164]] as Array<[number, number]>) {
    obs.push(o(tx, ty, 0.8, 0.8, 1.1, "tree"));
  }
  // east forest — kept well clear of the parking lot
  for (const [tx, ty] of [[262, 137], [271, 140], [280, 135], [287, 142], [265, 149], [274, 152], [283, 147], [261, 159], [270, 157], [279, 161], [286, 155], [267, 165]] as Array<[number, number]>) {
    obs.push(o(tx, ty, 0.8, 0.8, 1.1, "tree"));
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
      { name: "church-nave", x: 139800, y: 202800, w: 20400, h: 44400 },
      { name: "church-transept", x: 125800, y: 216800, w: 48400, h: 16400 },
      { name: "barn", x: 95750, y: 137750, w: 14500, h: 24500 },
    ],
    zones: [
      { name: "The Maison", x: 150000, y: 75000, r: 12500, value: 2 },
      { name: "The Church", x: 150000, y: 225000, r: 15000, value: 2 },
      { name: "Courtyard", x: 150000, y: 150000, r: 10000, value: 2 },
      { name: "The Barn", x: 103000, y: 150000, r: 10000, value: 1 },
      { name: "Hay Field", x: 72000, y: 172000, r: 13000, value: 1 },
      { name: "Parking", x: 243000, y: 150000, r: 10000, value: 1 },
      { name: "North Forest", x: 150000, y: 32000, r: 14000, value: 1 },
      { name: "South Forest", x: 150000, y: 268000, r: 14000, value: 1 },
      { name: "West Forest", x: 34000, y: 150000, r: 13000, value: 1 },
      { name: "East Forest", x: 273000, y: 150000, r: 13000, value: 1 },
    ],
    patches: [
      { x: 228000, y: 133000, w: 30000, h: 34000, kind: "gravel" }, // parking lot
      // roads: parking -> courtyard east gate, branching to maison + church
      { x: 174000, y: 146000, w: 54000, h: 8000, kind: "gravel" },
      { x: 168000, y: 88000, w: 8000, h: 58000, kind: "gravel" },   // to the maison
      { x: 168000, y: 154000, w: 8000, h: 60000, kind: "gravel" },  // to the church
      // worked ground around the farm structures
      { x: 92000, y: 134000, w: 22000, h: 32000, kind: "dirt" },    // barn yard
      { x: 58000, y: 155000, w: 32000, h: 34000, kind: "dirt" },    // hay field
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
