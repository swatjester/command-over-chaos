import { MM } from "./math.js";
export const TICK_RATE = 30; // Hz
export const TICK_MS = 1000 / TICK_RATE;
/** speed in mm per tick, by move mode (stance modifiers come later) */
export const MOVE_SPEED = {
    sprint: Math.floor((6.0 * MM) / TICK_RATE),
    move: Math.floor((3.2 * MM) / TICK_RATE),
    sneak: Math.floor((1.6 * MM) / TICK_RATE),
    crawl: Math.floor((0.7 * MM) / TICK_RATE),
};
export function createState(seed, mapW = 100 * MM, mapH = 100 * MM) {
    return { tick: 0, seed, rng: seed >>> 0, mapW, mapH, soldiers: [] };
}
export function spawnSoldier(s, team, x, y) {
    const soldier = {
        id: s.soldiers.length,
        team, x, y, tx: null, ty: null,
        stance: "stand", moveMode: "move",
        hp: 100, suppression: 0, alive: true,
    };
    s.soldiers.push(soldier);
    return soldier;
}
//# sourceMappingURL=state.js.map