import type { Obstacle } from "./map.js";
import type { Stance } from "./state.js";

/** Height (mm) above which an obstacle blocks sight entirely. */
export const WALL_HEIGHT = 1200;
/** A target within this distance (mm) of intervening low cover gets the cover bonus. */
export const COVER_NEAR = 2500;

/**
 * Exact integer 2D segment-vs-AABB test: bbox rejection + corner sign test.
 * All values integer mm; products stay < 2^53, so this is fully deterministic.
 */
export function segmentIntersectsBox(
  x1: number, y1: number, x2: number, y2: number, o: Obstacle,
): boolean {
  const bx1 = o.x, by1 = o.y, bx2 = o.x + o.w, by2 = o.y + o.h;
  if (Math.max(x1, x2) < bx1 || Math.min(x1, x2) > bx2) return false;
  if (Math.max(y1, y2) < by1 || Math.min(y1, y2) > by2) return false;
  const dx = x2 - x1, dy = y2 - y1;
  const c1 = dx * (by1 - y1) - dy * (bx1 - x1);
  const c2 = dx * (by1 - y1) - dy * (bx2 - x1);
  const c3 = dx * (by2 - y1) - dy * (bx2 - x1);
  const c4 = dx * (by2 - y1) - dy * (bx1 - x1);
  if (c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0) return false;
  if (c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0) return false;
  return true;
}

export interface LosSubject { x: number; y: number; stance: Stance; }
export interface LosResult { visible: boolean; targetInCover: boolean; }

/**
 * Line of sight with cover rules:
 * - walls (ht > WALL_HEIGHT) block sight completely
 * - low cover near the TARGET: prone target is hidden; crouch/stand gets a
 *   cover bonus against shots
 * - low cover near the SHOOTER is ignored (you can see/shoot over your own
 *   cover — the defender's peek advantage, intentional for now)
 */
export function losBetween(
  obstacles: readonly Obstacle[], shooter: LosSubject, target: LosSubject,
): LosResult {
  let targetInCover = false;
  for (const o of obstacles) {
    if (!segmentIntersectsBox(shooter.x, shooter.y, target.x, target.y, o)) continue;
    if (o.ht > WALL_HEIGHT) return { visible: false, targetInCover: false };
    const near =
      target.x > o.x - COVER_NEAR && target.x < o.x + o.w + COVER_NEAR &&
      target.y > o.y - COVER_NEAR && target.y < o.y + o.h + COVER_NEAR;
    if (near) {
      if (target.stance === "prone") return { visible: false, targetInCover: false };
      targetInCover = true;
    }
  }
  return { visible: true, targetInCover };
}
