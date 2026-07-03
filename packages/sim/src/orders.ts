import type { GrenadeKind } from "./grenades.js";
import type { MoveMode, Stance } from "./state.js";

export type Order =
  | { type: "move"; soldierId: number; x: number; y: number; mode?: MoveMode; queue?: boolean }
  | { type: "mode"; soldierId: number; mode: MoveMode }
  | { type: "stance"; soldierId: number; stance: Stance }
  | { type: "target"; soldierId: number; targetId: number | null }
  | { type: "throw"; soldierId: number; kind: GrenadeKind; x: number; y: number }
  | { type: "halt"; soldierId: number };

/** Orders scheduled for a given tick. The replay format is simply { seed, orders }. */
export type OrderLog = Record<number, Order[]>;
