/**
 * Deterministic integer math. All world coordinates are integers in
 * MILLIMETERS. Integer arithmetic on float64 is exact below 2^53, and
 * Math.sqrt is IEEE-754 correctly rounded, so every operation here is
 * bit-identical across engines/platforms. NEVER introduce non-integer
 * intermediate values into sim state.
 */
export const MM = 1000; // 1 meter = 1000 units
export function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.floor(Math.sqrt(dx * dx + dy * dy));
}
/** Move (x,y) toward (tx,ty) by `step` mm; clamps at target. Returns [x, y, arrived]. */
export function stepToward(x, y, tx, ty, step) {
    const d = dist(x, y, tx, ty);
    if (d <= step)
        return [tx, ty, true];
    // floor keeps coordinates integral; slight undershoot is fine and deterministic
    const nx = x + Math.floor(((tx - x) * step) / d);
    const ny = y + Math.floor(((ty - y) * step) / d);
    return [nx, ny, false];
}
export function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
//# sourceMappingURL=math.js.map