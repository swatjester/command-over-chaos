export declare const TICK_RATE = 30;
export declare const TICK_MS: number;
export type Stance = "stand" | "crouch" | "prone";
export type MoveMode = "sprint" | "move" | "sneak" | "crawl";
export interface Soldier {
    id: number;
    team: 0 | 1;
    /** millimeters */
    x: number;
    y: number;
    /** current move target, or null when holding position */
    tx: number | null;
    ty: number | null;
    stance: Stance;
    moveMode: MoveMode;
    hp: number;
    suppression: number;
    alive: boolean;
}
export interface SimState {
    tick: number;
    seed: number;
    rng: number;
    mapW: number;
    mapH: number;
    soldiers: Soldier[];
}
/** speed in mm per tick, by move mode (stance modifiers come later) */
export declare const MOVE_SPEED: Record<MoveMode, number>;
export declare function createState(seed: number, mapW?: number, mapH?: number): SimState;
export declare function spawnSoldier(s: SimState, team: 0 | 1, x: number, y: number): Soldier;
