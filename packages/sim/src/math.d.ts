/**
 * Deterministic integer math. All world coordinates are integers in
 * MILLIMETERS. Integer arithmetic on float64 is exact below 2^53, and
 * Math.sqrt is IEEE-754 correctly rounded, so every operation here is
 * bit-identical across engines/platforms. NEVER introduce non-integer
 * intermediate values into sim state.
 */
export declare const MM = 1000;
export declare function dist(ax: number, ay: number, bx: number, by: number): number;
/** Move (x,y) toward (tx,ty) by `step` mm; clamps at target. Returns [x, y, arrived]. */
export declare function stepToward(x: number, y: number, tx: number, ty: number, step: number): [number, number, boolean];
export declare function clamp(v: number, lo: number, hi: number): number;
