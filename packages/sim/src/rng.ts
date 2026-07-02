/** Mulberry32 — small, fast, deterministic PRNG. State is a uint32 kept in sim state. */

export function rngNext(state: number): [value: number, nextState: number] {
  let s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0);
  return [value, s];
}

/** Uniform int in [0, n) — deterministic. */
export function rngInt(state: number, n: number): [value: number, nextState: number] {
  const [v, next] = rngNext(state);
  return [v % n, next];
}
