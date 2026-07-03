/** Mulberry32 — small, fast, deterministic PRNG. State is a uint32 kept in sim state. */
export declare function rngNext(state: number): [value: number, nextState: number];
/** Uniform int in [0, n) — deterministic. */
export declare function rngInt(state: number, n: number): [value: number, nextState: number];
