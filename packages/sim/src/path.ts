/**
 * Deterministic grid pathfinding (the M2 "navmesh"): 1m cells, obstacles
 * inflated by soldier radius, 8-directional A* without corner cutting.
 * Stance-aware clearance and vault links come later; this replaces
 * wall-slide-only movement so soldiers route around buildings.
 */
import { blocked, type Obstacle } from "./map.js";

const CELL = 1000; // mm
const MAX_EXPANSIONS = 30000;

interface NavGrid { w: number; h: number; cells: Uint8Array; }

const gridCache = new WeakMap<readonly Obstacle[], NavGrid>();

export function getNavGrid(obstacles: readonly Obstacle[], mapW: number, mapH: number): NavGrid {
  let g = gridCache.get(obstacles);
  if (!g) {
    const w = Math.ceil(mapW / CELL);
    const h = Math.ceil(mapH / CELL);
    const cells = new Uint8Array(w * h);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        if (blocked(obstacles, cx * CELL + CELL / 2, cy * CELL + CELL / 2)) cells[cy * w + cx] = 1;
      }
    }
    g = { w, h, cells };
    gridCache.set(obstacles, g);
  }
  return g;
}

/** Binary min-heap over (f, tiebreak by push order) — fully deterministic. */
class Heap {
  private f: number[] = [];
  private seq: number[] = [];
  private node: number[] = [];
  private n = 0;
  private pushes = 0;
  push(node: number, f: number): void {
    let i = this.n++;
    this.f[i] = f; this.seq[i] = this.pushes++; this.node[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) { this.swap(i, p); i = p; } else break;
    }
  }
  pop(): number {
    const top = this.node[0]!;
    this.n--;
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!; this.seq[0] = this.seq[this.n]!; this.node[0] = this.node[this.n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  get size(): number { return this.n; }
  private less(a: number, b: number): boolean {
    return this.f[a]! < this.f[b]! || (this.f[a] === this.f[b] && this.seq[a]! < this.seq[b]!);
  }
  private swap(a: number, b: number): void {
    [this.f[a], this.f[b]] = [this.f[b]!, this.f[a]!];
    [this.seq[a], this.seq[b]] = [this.seq[b]!, this.seq[a]!];
    [this.node[a], this.node[b]] = [this.node[b]!, this.node[a]!];
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return ax > ay ? 100 * ax + 41 * ay : 100 * ay + 41 * ax;
}

/** Nearest unblocked cell to (cx,cy), spiraling out; null if none within r=4. */
function nearestFree(g: NavGrid, cx: number, cy: number): number | null {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        if (g.cells[y * g.w + x] === 0) return y * g.w + x;
      }
    }
  }
  return null;
}

/**
 * A* route from (sx,sy) to (tx,ty) in mm. Returns waypoints (mm, cell
 * centers, collinear-compressed, last point = exact target when reachable),
 * or null when no route exists — caller falls back to direct movement.
 */
export function findPath(
  obstacles: readonly Obstacle[], mapW: number, mapH: number,
  sx: number, sy: number, tx: number, ty: number,
): Array<[number, number]> | null {
  const g = getNavGrid(obstacles, mapW, mapH);
  const scx = Math.min(g.w - 1, Math.max(0, Math.floor(sx / CELL)));
  const scy = Math.min(g.h - 1, Math.max(0, Math.floor(sy / CELL)));
  const tcx = Math.min(g.w - 1, Math.max(0, Math.floor(tx / CELL)));
  const tcy = Math.min(g.h - 1, Math.max(0, Math.floor(ty / CELL)));
  const start = scy * g.w + scx;
  let goal = tcy * g.w + tcx;
  let exactGoal = true;
  if (g.cells[goal] === 1) {
    const nf = nearestFree(g, tcx, tcy);
    if (nf === null) return null;
    goal = nf;
    exactGoal = false;
  }
  if (start === goal) return [[tx, ty]];

  const dist = new Int32Array(g.w * g.h).fill(0x7fffffff);
  const came = new Int32Array(g.w * g.h).fill(-1);
  const closed = new Uint8Array(g.w * g.h);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(start, 0);
  const gx = goal % g.w, gy = Math.floor(goal / g.w);
  let expansions = 0;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    if (++expansions > MAX_EXPANSIONS) return null;
    const cx = cur % g.w, cy = Math.floor(cur / g.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const ni = ny * g.w + nx;
        if (g.cells[ni] === 1 || closed[ni]) continue;
        // no diagonal corner cutting
        if (dx !== 0 && dy !== 0 && (g.cells[cy * g.w + nx] === 1 || g.cells[ny * g.w + cx] === 1)) continue;
        const nd = dist[cur]! + (dx !== 0 && dy !== 0 ? 141 : 100);
        if (nd < dist[ni]!) {
          dist[ni] = nd;
          came[ni] = cur;
          heap.push(ni, nd + octile(nx - gx, ny - gy));
        }
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;

  // reconstruct + compress collinear runs
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  const pts: Array<[number, number]> = [];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i]!;
    const px = (c % g.w) * CELL + CELL / 2;
    const py = Math.floor(c / g.w) * CELL + CELL / 2;
    if (pts.length >= 2) {
      const [ax, ay] = pts[pts.length - 2]!;
      const [bx, by] = pts[pts.length - 1]!;
      if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) === 0) pts.pop(); // collinear
    }
    pts.push([px, py]);
  }
  if (exactGoal && pts.length > 0) pts[pts.length - 1] = [tx, ty];
  else if (exactGoal) pts.push([tx, ty]);
  if (pts.length === 0) return [[tx, ty]];
  return smooth(obstacles, sx, sy, pts);
}

/** Walkability of a straight segment: sample every 300mm. */
function segmentWalkable(
  obstacles: readonly Obstacle[], x1: number, y1: number, x2: number, y2: number,
): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.floor(Math.sqrt(dx * dx + dy * dy));
  const steps = Math.max(1, Math.ceil(len / 300));
  for (let i = 1; i <= steps; i++) {
    const px = x1 + Math.floor((dx * i) / steps);
    const py = y1 + Math.floor((dy * i) / steps);
    if (blocked(obstacles, px, py)) return false;
  }
  return true;
}

/**
 * String pulling: skip waypoints reachable by a straight walkable line.
 * Routes become geometric rather than grid artifacts — near-mirror paths
 * for mirrored orders (I-002).
 */
function smooth(
  obstacles: readonly Obstacle[], sx: number, sy: number, pts: Array<[number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cx = sx, cy = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    for (; j > i; j--) {
      if (segmentWalkable(obstacles, cx, cy, pts[j]![0], pts[j]![1])) break;
    }
    out.push(pts[j]!);
    [cx, cy] = pts[j]!;
    i = j + 1;
  }
  return out;
}
