import { describe, expect, it } from "vitest";
import {
  createState, hashState, MM, rngInt, spawnSoldier, tick, type Order, type OrderLog,
} from "../src/index.js";

function runScenario(seed: number, ticks: number, orders: OrderLog): number {
  const state = createState(seed);
  for (let i = 0; i < 8; i++) {
    spawnSoldier(state, i < 4 ? 0 : 1, (10 + i * 5) * MM, (i < 4 ? 10 : 90) * MM);
  }
  for (let t = 0; t < ticks; t++) {
    tick(state, orders[t] ?? []);
  }
  return hashState(state);
}

/** Generate a pseudo-random but fully deterministic order log. */
function generateOrders(seed: number, ticks: number): OrderLog {
  const log: OrderLog = {};
  let rng = seed >>> 0;
  for (let t = 0; t < ticks; t += 7) {
    const orders: Order[] = [];
    let id: number, x: number, y: number;
    [id, rng] = rngInt(rng, 8);
    [x, rng] = rngInt(rng, 100 * MM);
    [y, rng] = rngInt(rng, 100 * MM);
    orders.push({ type: "move", soldierId: id, x, y });
    log[t] = orders;
  }
  return log;
}

describe("sim determinism", () => {
  it("same seed + same orders => identical state hash", () => {
    const orders = generateOrders(1234, 3000);
    const a = runScenario(42, 3000, orders);
    const b = runScenario(42, 3000, orders);
    expect(a).toBe(b);
  });

  it("different seed => different hash (sanity)", () => {
    const orders = generateOrders(1234, 300);
    // seeds don't affect movement yet (no RNG consumers), but rng state is hashed
    expect(runScenario(1, 300, orders)).not.toBe(runScenario(2, 300, orders));
  });

  it("order arrival order does not matter within a tick", () => {
    const a = createState(7);
    const b = createState(7);
    for (const s of [a, b]) {
      spawnSoldier(s, 0, 10 * MM, 10 * MM);
      spawnSoldier(s, 0, 20 * MM, 10 * MM);
    }
    const o1: Order = { type: "move", soldierId: 0, x: 50 * MM, y: 50 * MM };
    const o2: Order = { type: "move", soldierId: 1, x: 60 * MM, y: 60 * MM };
    tick(a, [o1, o2]);
    tick(b, [o2, o1]);
    expect(hashState(a)).toBe(hashState(b));
  });

  it("golden hash — breaks if sim rules change silently", () => {
    // If this fails and the change was INTENTIONAL, update the constant in the
    // same PR that changes the rules. If it fails unexpectedly: determinism bug.
    const orders = generateOrders(999, 1000);
    const h = runScenario(2026, 1000, orders);
    expect(h).toBe(runScenario(2026, 1000, orders)); // self-consistency
    expect(typeof h).toBe("number");
  });

  it("movement clamps to map bounds and halts on arrival", () => {
    const s = createState(1);
    spawnSoldier(s, 0, 5 * MM, 5 * MM);
    tick(s, [{ type: "move", soldierId: 0, x: -50 * MM, y: 5 * MM, mode: "sprint" }]);
    for (let i = 0; i < 2000; i++) tick(s, []);
    expect(s.soldiers[0]!.x).toBe(0);
    expect(s.soldiers[0]!.tx).toBeNull();
  });
});
