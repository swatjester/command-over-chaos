/**
 * Static map geometry for the deterministic sim — collision now, LOS in M1.
 * One data structure drives BOTH sim collision and client rendering, so the
 * world you see is exactly the world the server simulates.
 */

export interface Obstacle {
  /** corner-based AABB, millimeters */
  x: number;
  y: number;
  w: number;
  h: number;
  /** height in mm — <=1200 reads as low cover; higher blocks sight fully (M1) */
  ht: number;
}

export interface MapDef {
  w: number;
  h: number;
  obstacles: Obstacle[];
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

function centered(cx: number, cy: number, w: number, h: number, ht: number): Obstacle {
  return { x: cx - w / 2, y: cy - h / 2, w, h, ht };
}

const M = 1000;

/** The M0 greybox map. */
export const GREYBOX_MAP: MapDef = {
  w: 100 * M,
  h: 100 * M,
  obstacles: [
    // scattered low cover (2.4m x 1.2m footprint, 1.1m high)
    ...([[20, 30], [25, 55], [40, 42], [55, 30], [62, 60], [75, 45], [35, 70], [70, 75], [50, 15], [50, 85]] as Array<[number, number]>)
      .map(([x, y]) => centered(x * M, y * M, 2400, 1200, 1100)),
    // central building shell (3m walls with a doorway gap on the west side)
    centered(50 * M, 44 * M, 12000, 400, 3000),
    centered(44.2 * M, 47.3 * M, 400, 5000, 3000),
    centered(56 * M, 50 * M, 400, 12000, 3000),
    centered(48.4 * M, 56 * M, 9000, 400, 3000),
  ],
};
