import type { SimState } from "./state.js";
/** FNV-1a 32-bit over every numeric field of sim state, in fixed order.
 *  Used for desync detection and CI determinism tests. */
export declare function hashState(state: SimState): number;
