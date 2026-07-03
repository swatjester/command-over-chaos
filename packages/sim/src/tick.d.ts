import type { Order } from "./orders.js";
import { type SimState } from "./state.js";
/**
 * Advance the world exactly one tick. Pure with respect to (state, orders):
 * mutates `state` in place (hot path) but reads nothing else — no clocks,
 * no Math.random, no iteration over unordered collections.
 */
export declare function tick(state: SimState, orders: readonly Order[]): void;
