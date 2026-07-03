/**
 * Static map geometry for the deterministic sim — collision + LOS.
 * One data structure drives BOTH sim rules and client rendering, so the
 * world you see is exactly the world the server simulates.
 */

export type ObstacleKind = "wall" | "stone" | "hay" | "tree" | "fence" | "shed";

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

export interface MapDef {
  w: number;
  h: number;
  obstacles: Obstacle[];
  /** fireteam anchor points per team, mm — used by server/offline spawning */
  spawns: [Array<[number, number]>, Array<[number, number]>];
}

export const SOLDIER_RADIUS = 350; // mm

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

  // === MAISON (north team building) — 26x14m at (62..88, 21..35) ===========
  obs.push(
    o(62, 20.8, 26, 0.4, 3, "wall"),               // north wall
    o(62, 34.8, 11, 0.4, 3, "wall"),               // south wall, door 73..77
    o(77, 34.8, 11, 0.4, 3, "wall"),
    o(61.8, 21, 0.4, 14, 3, "wall"),               // west wall
    o(87.8, 21, 0.4, 5, 3, "wall"),                // east wall, door 26..29
    o(87.8, 29, 0.4, 6, 3, "wall"),
    o(62, 27.8, 8, 0.4, 3, "wall"),                // interior, gap 70..74
    o(74, 27.8, 6, 0.4, 3, "wall"),
  );

  // === CHURCH (south team building) — cross: nave (70..80, 110..134), transept (63..87, 118..126)
  obs.push(
    o(70, 109.8, 3.5, 0.4, 3, "wall"),             // north face, door 73.5..76.5
    o(76.5, 109.8, 3.5, 0.4, 3, "wall"),
    o(70, 133.8, 3.5, 0.4, 3, "wall"),             // south face, door
    o(76.5, 133.8, 3.5, 0.4, 3, "wall"),
    o(69.8, 110, 0.4, 8, 3, "wall"),               // nave west (transept opening 118..126)
    o(69.8, 126, 0.4, 8, 3, "wall"),
    o(79.8, 110, 0.4, 8, 3, "wall"),               // nave east
    o(79.8, 126, 0.4, 8, 3, "wall"),
    o(63, 117.8, 7, 0.4, 3, "wall"),               // transept north
    o(80, 117.8, 7, 0.4, 3, "wall"),
    o(63, 125.8, 7, 0.4, 3, "wall"),               // transept south
    o(80, 125.8, 7, 0.4, 3, "wall"),
    o(62.8, 118, 0.4, 3, 3, "wall"),               // transept west end, door 121..123
    o(62.8, 123, 0.4, 3, 3, "wall"),
    o(86.8, 118, 0.4, 3, 3, "wall"),               // transept east end, door
    o(86.8, 123, 0.4, 3, 3, "wall"),
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

  // === WEST + EAST FIELDS (mirrored E/W and N/S) ============================
  for (const mx of [0, 1]) { // 0 = west, 1 = east (mirror x -> 150 - x - w)
    const fx = (x: number, w: number): number => (mx === 0 ? x : 150 - x - w);
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
