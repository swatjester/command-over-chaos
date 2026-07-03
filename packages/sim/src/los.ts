import type { Obstacle } from "./map.js";
import type { Stance } from "./state.js";

/** Height (mm) above which an obstacle blocks sight entirely. */
export const WALL_HEIGHT = 1200;
/** A target within this distance (mm) of intervening low cover gets the cover bonus. */
export const COVER_NEAR = 2500;
/** Corner peek lean distance (mm) — soldiers see around corners they hug.
 *  Also the exposure width: stand within this of a frame and you can be seen. */
export const PEEK_DIST = 950;

export interface SmokeCloud { id: number; x: number; y: number; r: number; ttl: number; }

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

/**
 * Smoke obscures, it doesn't wall off: a sightline is blocked only if it
 * travels MORE than one radius inside the cloud. From the edge you can see
 * to the center; a self-smoker at the center sees out (and is seen) — smoke
 * is concealment for crossing, not an invisibility bubble.
 * Deterministic: +,-,*,/ and sqrt are IEEE-754 correctly rounded everywhere.
 */
export function smokeBlocks(
  x1: number, y1: number, x2: number, y2: number, c: SmokeCloud,
): boolean {
  if (Math.max(x1, x2) < c.x - c.r || Math.min(x1, x2) > c.x + c.r) return false;
  if (Math.max(y1, y2) < c.y - c.r || Math.min(y1, y2) > c.y + c.r) return false;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const fx = c.x - x1, fy = c.y - y1;
  const cross = dx * fy - dy * fx;
  const R2 = c.r * c.r;
  // line-to-center distance² = cross²/len2 ; miss if >= R²
  if (cross * cross >= R2 * len2) return false;
  const L = Math.sqrt(len2);
  const proj = (fx * dx + fy * dy) / L; // distance along segment of closest approach
  const h = Math.sqrt(R2 - (cross * cross) / len2); // half-chord
  const entry = Math.max(0, proj - h);
  const exit = Math.min(L, proj + h);
  return exit - entry > c.r;
}

export interface LosSubject { x: number; y: number; stance: Stance; }
export interface LosResult { visible: boolean; targetInCover: boolean; }

const BLOCKED: LosResult = { visible: false, targetInCover: false };

function pointInBox(x: number, y: number, o: Obstacle): boolean {
  return x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h;
}

/**
 * Single-segment LOS with cover rules (relative to the target):
 * - walls (ht > WALL_HEIGHT) and thick smoke block
 * - low cover near the TARGET: prone target hidden; crouch/stand = cover bonus
 * - low cover near the SHOOTER is ignored (see/shoot over your own cover)
 */
function segmentLos(
  obstacles: readonly Obstacle[], smokes: readonly SmokeCloud[],
  x1: number, y1: number, x2: number, y2: number, target: LosSubject,
): LosResult {
  for (const c of smokes) {
    if (smokeBlocks(x1, y1, x2, y2, c)) return BLOCKED;
  }
  let targetInCover = false;
  for (const o of obstacles) {
    if (!segmentIntersectsBox(x1, y1, x2, y2, o)) continue;
    if (o.ht > WALL_HEIGHT) return BLOCKED;
    const near =
      target.x > o.x - COVER_NEAR && target.x < o.x + o.w + COVER_NEAR &&
      target.y > o.y - COVER_NEAR && target.y < o.y + o.h + COVER_NEAR;
    if (near) {
      if (target.stance === "prone") return BLOCKED;
      targetInCover = true;
    }
  }
  return { visible: true, targetInCover };
}

function peekPoints(s: LosSubject, obstacles: readonly Obstacle[]): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [s.x + PEEK_DIST, s.y], [s.x - PEEK_DIST, s.y],
    [s.x, s.y + PEEK_DIST], [s.x, s.y - PEEK_DIST],
  ];
  return pts.filter(([px, py]) => !obstacles.some((o) => pointInBox(px, py, o)));
}

export interface LosResultEx extends LosResult {
  /** shooter lean offset (mm) used to obtain this sightline; 0,0 = no lean */
  leanX: number;
  leanY: number;
}

const BLOCKED_EX: LosResultEx = { visible: false, targetInCover: false, leanX: 0, leanY: 0 };

/**
 * LOS with CORNER PEEK (the CoC doorway rule): if the direct line is blocked,
 * a soldier hugging a corner leans PEEK_DIST to see around it — and a target
 * hugging a corner (within a body width of the frame) is partially exposed:
 * seen, but in cover. Lean-vs-lean is included, so two soldiers hugging the
 * same side of facing doorways trade fire through both gaps.
 * Preference order minimizes shooter exposure: direct, then exposed target,
 * then own lean, then mutual lean. Symmetric: a lean that reveals also exposes.
 */
export function losBetweenEx(
  obstacles: readonly Obstacle[], shooter: LosSubject, target: LosSubject,
  smokes: readonly SmokeCloud[] = [],
): LosResultEx {
  const direct = segmentLos(obstacles, smokes, shooter.x, shooter.y, target.x, target.y, target);
  if (direct.visible) return { ...direct, leanX: 0, leanY: 0 };
  const tPeeks = peekPoints(target, obstacles);
  // target exposed at their frame — no lean needed
  for (const [px, py] of tPeeks) {
    const r = segmentLos(obstacles, smokes, shooter.x, shooter.y, px, py, target);
    if (r.visible) return { visible: true, targetInCover: true, leanX: 0, leanY: 0 };
  }
  // shooter leans
  for (const [px, py] of peekPoints(shooter, obstacles)) {
    const r = segmentLos(obstacles, smokes, px, py, target.x, target.y, target);
    if (r.visible) return { ...r, leanX: px - shooter.x, leanY: py - shooter.y };
    // mutual lean (same-side facing doorways)
    for (const [qx, qy] of tPeeks) {
      const d = segmentLos(obstacles, smokes, px, py, qx, qy, target);
      if (d.visible) return { visible: true, targetInCover: true, leanX: px - shooter.x, leanY: py - shooter.y };
    }
  }
  return BLOCKED_EX;
}

export function losBetween(
  obstacles: readonly Obstacle[], shooter: LosSubject, target: LosSubject,
  smokes: readonly SmokeCloud[] = [],
): LosResult {
  const r = losBetweenEx(obstacles, shooter, target, smokes);
  return { visible: r.visible, targetInCover: r.targetInCover };
}
