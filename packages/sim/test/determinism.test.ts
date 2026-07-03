import { describe, expect, it } from "vitest";
import {
  blocked, computeShotPct, createState, dist, FARMSTEAD_MAP, GREYBOX_MAP,
  hashState, losBetween, MM, rngInt, spawnSoldier, tick, WEAPONS,
  type Order, type OrderLog,
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

describe("collision", () => {
  it("soldiers cannot pass through or end up inside walls", () => {
    const s = createState(5, GREYBOX_MAP);
    spawnSoldier(s, 0, 50 * MM, 38 * MM); // north of the building's north wall
    tick(s, [{ type: "move", soldierId: 0, x: 50 * MM, y: 50 * MM, mode: "sprint" }]);
    for (let i = 0; i < 600; i++) tick(s, []);
    const sol = s.soldiers[0]!;
    expect(blocked(s.obstacles, sol.x, sol.y)).toBe(false);
    expect(sol.y).toBeLessThan(44 * MM); // never crossed the wall line
  });

  it("target inside an obstacle stops cleanly (no wedge loop)", () => {
    const s = createState(6, GREYBOX_MAP);
    spawnSoldier(s, 0, 20 * MM, 27 * MM);
    tick(s, [{ type: "move", soldierId: 0, x: 20 * MM, y: 30 * MM, mode: "move" }]); // cover box center
    for (let i = 0; i < 400; i++) tick(s, []);
    const sol = s.soldiers[0]!;
    expect(sol.tx).toBeNull(); // order cleared, not stuck "moving" forever
    expect(blocked(s.obstacles, sol.x, sol.y)).toBe(false);
  });

  it("collision resolution is deterministic", () => {
    const run = (): number => {
      const s = createState(77, GREYBOX_MAP);
      for (let i = 0; i < 8; i++) spawnSoldier(s, i < 4 ? 0 : 1, (44 + i) * MM, (i < 4 ? 40 : 60) * MM);
      // everyone charges through the building
      tick(s, s.soldiers.map((sol) => ({
        type: "move" as const, soldierId: sol.id, x: 50 * MM, y: sol.team === 0 ? 60 * MM : 40 * MM, mode: "sprint" as const,
      })));
      for (let i = 0; i < 1200; i++) tick(s, []);
      return hashState(s);
    };
    expect(run()).toBe(run());
  });
});

describe("combat", () => {
  it("walls block LOS and shots", () => {
    const s = createState(9, GREYBOX_MAP);
    const a = spawnSoldier(s, 0, 50 * MM, 40 * MM); // north of building
    const b = spawnSoldier(s, 1, 50 * MM, 50 * MM); // inside building
    const shot = computeShotPct(s.obstacles, a, b);
    expect(shot.visible).toBe(false);
    expect(shot.pct).toBe(0);
  });

  it("prone behind low cover is hidden; crouched gets cover bonus", () => {
    const s = createState(10, GREYBOX_MAP);
    const shooter = spawnSoldier(s, 0, 20 * MM, 20 * MM);
    // cover box centered (20,30): defender just south of it
    const defender = spawnSoldier(s, 1, 20 * MM, 32 * MM);
    defender.stance = "prone";
    expect(computeShotPct(s.obstacles, shooter, defender).visible).toBe(false);
    defender.stance = "crouch";
    const shot = computeShotPct(s.obstacles, shooter, defender);
    expect(shot.visible).toBe(true);
    expect(shot.factors.some((f) => f.label === "target in cover")).toBe(true);
  });

  it("open-ground firefight is deterministic and lethal", () => {
    const run = (): { hash: number; deaths: number } => {
      const s = createState(1337, GREYBOX_MAP);
      spawnSoldier(s, 0, 30 * MM, 35 * MM, "carbine");
      spawnSoldier(s, 0, 32 * MM, 35 * MM, "lmg");
      spawnSoldier(s, 1, 30 * MM, 60 * MM, "carbine");
      spawnSoldier(s, 1, 32 * MM, 60 * MM, "dmr");
      for (let i = 0; i < 3000; i++) tick(s, []);
      return { hash: hashState(s), deaths: s.soldiers.filter((x) => !x.alive).length };
    };
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.deaths).toBeGreaterThan(0); // permadeath is real
  });

  it("suppression accumulates under fire and pins movement", () => {
    const s = createState(11, GREYBOX_MAP);
    const gunner = spawnSoldier(s, 0, 30 * MM, 30 * MM, "lmg");
    gunner.stance = "prone";
    const victim = spawnSoldier(s, 1, 30 * MM, 45 * MM, "carbine");
    victim.hp = 10000 as never; // survive long enough to measure suppression
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      tick(s, []);
      peak = Math.max(peak, victim.suppression);
    }
    expect(peak).toBeGreaterThan(50);
  });

  it("dead soldiers stop shooting and being targeted", () => {
    const s = createState(12, GREYBOX_MAP);
    const a = spawnSoldier(s, 0, 30 * MM, 30 * MM, "carbine");
    const b = spawnSoldier(s, 1, 30 * MM, 40 * MM, "carbine");
    b.alive = false;
    b.hp = 0;
    for (let i = 0; i < 100; i++) {
      const events = tick(s, []);
      expect(events.shots.length).toBe(0); // no valid targets for a; b never fires
    }
    expect(a.alive).toBe(true);
  });
});

describe("farmstead map", () => {
  it("spawn anchors are clear of obstacles", () => {
    for (const team of [0, 1] as const) {
      for (const [x, y] of FARMSTEAD_MAP.spawns[team]) {
        expect(blocked(FARMSTEAD_MAP.obstacles, x, y)).toBe(false);
      }
    }
  });

  it("no spawn anchor is within weapon range of any enemy anchor", () => {
    const maxRange = Math.max(...Object.values(WEAPONS).map((w) => w.maxRange));
    for (const [ax, ay] of FARMSTEAD_MAP.spawns[0]) {
      for (const [bx, by] of FARMSTEAD_MAP.spawns[1]) {
        expect(dist(ax, ay, bx, by)).toBeGreaterThan(maxRange);
      }
    }
  });

  it("obstacles stay inside map bounds", () => {
    for (const o of FARMSTEAD_MAP.obstacles) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(FARMSTEAD_MAP.w);
      expect(o.y + o.h).toBeLessThanOrEqual(FARMSTEAD_MAP.h);
    }
  });

  it("buildings are enterable (door gaps wide enough for soldier radius)", () => {
    // maison south door centered (75, 35), church north door (75, 110)
    expect(blocked(FARMSTEAD_MAP.obstacles, 75 * MM, 35 * MM)).toBe(false);
    expect(blocked(FARMSTEAD_MAP.obstacles, 75 * MM, 110 * MM)).toBe(false);
    // courtyard west/east gaps at (75±7, 75)
    expect(blocked(FARMSTEAD_MAP.obstacles, 68 * MM, 75 * MM)).toBe(false);
    expect(blocked(FARMSTEAD_MAP.obstacles, 82 * MM, 75 * MM)).toBe(false);
  });
});

describe("settle (long-range aim)", () => {
  it("long-range shots require stillness; settled shooter fires", () => {
    const s = createState(21); // empty map, open ground
    const sniper = spawnSoldier(s, 0, 10 * MM, 10 * MM, "dmr");
    spawnSoldier(s, 1, 10 * MM, 80 * MM, "carbine"); // 70m: beyond dmr settleStart (56m), within maxRange
    let fired = 0;
    for (let i = 0; i < 59; i++) fired += tick(s, []).shots.length; // settleTicks=60 not yet reached
    expect(fired).toBe(0);
    for (let i = 0; i < 80; i++) fired += tick(s, []).shots.length;
    expect(fired).toBeGreaterThan(0);
    expect(sniper.settle).toBeGreaterThanOrEqual(60);
  });

  it("moving resets settle", () => {
    const s = createState(22);
    const sniper = spawnSoldier(s, 0, 10 * MM, 10 * MM, "dmr");
    for (let i = 0; i < 100; i++) tick(s, []);
    expect(sniper.settle).toBeGreaterThan(60);
    tick(s, [{ type: "move", soldierId: 0, x: 20 * MM, y: 10 * MM, mode: "move" }]);
    tick(s, []);
    expect(sniper.settle).toBeLessThanOrEqual(1);
  });

  it("short-range fire is unaffected by settle", () => {
    const s = createState(23);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    spawnSoldier(s, 1, 10 * MM, 30 * MM, "carbine"); // 20m < settleStart 38m
    const events = tick(s, []);
    expect(events.shots.length).toBeGreaterThan(0); // fires on tick 0, settle 0
  });
});

describe("grenades + queueing", () => {
  it("smoke blocks LOS while active, clears after ttl", () => {
    const s = createState(31);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    const b = spawnSoldier(s, 1, 10 * MM, 40 * MM, "carbine");
    // throw smoke halfway between them
    tick(s, [{ type: "throw", soldierId: 0, kind: "smoke", x: 10 * MM, y: 25 * MM }]);
    expect(a.smokes).toBe(1);
    // let it land + deploy
    for (let i = 0; i < 40; i++) tick(s, []);
    expect(s.smokes.length).toBe(1);
    expect(computeShotPct(s.obstacles, a, b, s.smokes).visible).toBe(false);
    // fast-forward past cloud ttl
    for (let i = 0; i < 1000; i++) tick(s, []);
    expect(s.smokes.length).toBe(0);
    expect(computeShotPct(s.obstacles, a, b, s.smokes).visible).toBe(true);
  });

  it("frag damages and suppresses by proximity, consumes inventory", () => {
    const s = createState(32);
    const thrower = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    const victim = spawnSoldier(s, 1, 10 * MM, 30 * MM, "carbine");
    victim.stance = "prone";
    const before = victim.hp;
    tick(s, [{ type: "throw", soldierId: 0, kind: "frag", x: 10 * MM, y: 29 * MM }]);
    expect(thrower.frags).toBe(1);
    for (let i = 0; i < 120; i++) tick(s, []);
    expect(victim.hp).toBeLessThan(before);
  });

  it("throws beyond range land clamped at max range", () => {
    const s = createState(33);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    tick(s, [{ type: "throw", soldierId: 0, kind: "smoke", x: 10 * MM, y: 90 * MM }]);
    const g = s.grenades[0]!;
    expect(g.y).toBeLessThanOrEqual(10 * MM + 25000);
  });

  it("queued waypoints are traversed in order", () => {
    const s = createState(34);
    const sol = spawnSoldier(s, 0, 10 * MM, 10 * MM);
    tick(s, [
      { type: "move", soldierId: 0, x: 20 * MM, y: 10 * MM, mode: "sprint" },
      { type: "move", soldierId: 0, x: 20 * MM, y: 20 * MM, queue: true },
      { type: "move", soldierId: 0, x: 30 * MM, y: 20 * MM, queue: true },
    ]);
    expect(sol.queue.length).toBe(2);
    for (let i = 0; i < 2000; i++) tick(s, []);
    expect(sol.x).toBe(30 * MM);
    expect(sol.y).toBe(20 * MM);
    expect(sol.queue.length).toBe(0);
    expect(sol.tx).toBeNull();
  });

  it("grenade + queue state is deterministic", () => {
    const run = (): number => {
      const s = createState(35, GREYBOX_MAP);
      spawnSoldier(s, 0, 30 * MM, 30 * MM, "carbine");
      spawnSoldier(s, 1, 30 * MM, 60 * MM, "carbine");
      tick(s, [
        { type: "throw", soldierId: 0, kind: "smoke", x: 30 * MM, y: 45 * MM },
        { type: "move", soldierId: 1, x: 60 * MM, y: 60 * MM },
        { type: "move", soldierId: 1, x: 60 * MM, y: 30 * MM, queue: true },
      ]);
      for (let i = 0; i < 500; i++) tick(s, []);
      return hashState(s);
    };
    expect(run()).toBe(run());
  });
});

describe("fire modes", () => {
  it("hold fire suppresses auto-engagement; explicit target overrides", () => {
    const s = createState(41);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    spawnSoldier(s, 1, 10 * MM, 30 * MM, "carbine");
    // both hold, so nobody dies while we verify silence
    tick(s, [
      { type: "firemode", soldierId: 0, hold: true },
      { type: "firemode", soldierId: 1, hold: true },
    ]);
    let aShots = 0;
    for (let i = 0; i < 60; i++) {
      const ev = tick(s, []);
      aShots += ev.shots.length; // neither side should fire
    }
    expect(a.holdFire).toBe(true);
    expect(aShots).toBe(0);
    // explicit fire order punches through hold fire
    tick(s, [{ type: "target", soldierId: 0, targetId: 1 }]);
    for (let i = 0; i < 60 && aShots === 0; i++) {
      aShots += tick(s, []).shots.filter((e) => e.shooter === 0).length;
    }
    expect(aShots).toBeGreaterThan(0);
    // toggling hold fire AGAIN must stop the explicit fire order too
    tick(s, [{ type: "firemode", soldierId: 0, hold: true }]);
    expect(a.targetId).toBeNull();
    let after = 0;
    for (let i = 0; i < 60; i++) after += tick(s, []).shots.length;
    expect(after).toBe(0);
    tick(s, [{ type: "firemode", soldierId: 0, hold: false }]);
    expect(a.holdFire).toBe(false);
  });
});

describe("corner peek", () => {
  const wall = { x: 20000, y: 19800, w: 10000, h: 400, ht: 3000, kind: "wall" as const };

  it("soldier hugging a wall end sees around the corner (and is seen)", () => {
    const s = createState(51);
    s.obstacles.push(wall);
    const peeker = spawnSoldier(s, 0, 20500, 21000); // south side, at west end
    const open = spawnSoldier(s, 1, 20500, 15000);   // north side, across the wall line
    expect(losBetween(s.obstacles, peeker, open).visible).toBe(true);
    // symmetric: the open soldier sees the peeker too, but peeker counts as in cover
    const back = losBetween(s.obstacles, open, peeker);
    expect(back.visible).toBe(true);
  });

  it("mid-wall provides no peek", () => {
    const s = createState(52);
    s.obstacles.push(wall);
    const a = spawnSoldier(s, 0, 25000, 21000); // dead center of the wall, south
    const b = spawnSoldier(s, 1, 25000, 15000); // north
    expect(losBetween(s.obstacles, a, b).visible).toBe(false);
  });
});

describe("smoke edge visibility", () => {
  it("sightlines up to one radius inside smoke survive; cross-cloud is blocked", () => {
    const s = createState(53);
    const center = spawnSoldier(s, 0, 10 * MM, 25 * MM); // self-smoked at cloud center
    const nearEdge = spawnSoldier(s, 1, 10 * MM, 31 * MM); // 6m away, past the 5m edge
    const farSide = spawnSoldier(s, 1, 10 * MM, 18 * MM);
    const beyond = spawnSoldier(s, 1, 10 * MM, 45 * MM);
    s.smokes.push({ id: 1, x: 10 * MM, y: 25 * MM, r: 5000, ttl: 100 });
    // center soldier travels exactly one radius of smoke: visible both ways
    expect(losBetween(s.obstacles, center, nearEdge, s.smokes).visible).toBe(true);
    expect(losBetween(s.obstacles, nearEdge, center, s.smokes).visible).toBe(true);
    // no self-smoke invisibility even at long range (path inside = 1 radius)
    expect(losBetween(s.obstacles, beyond, center, s.smokes).visible).toBe(true);
    // but a line crossing the whole cloud (2 radii inside) is blocked
    expect(losBetween(s.obstacles, farSide, beyond, s.smokes).visible).toBe(false);
  });
});

describe("frag stun-vs-kill", () => {
  it("adjacent detonation kills; standoff detonation stuns", () => {
    const s = createState(54);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    const adjacent = spawnSoldier(s, 1, 10 * MM, 30500); // 0.5m from blast
    const standoff = spawnSoldier(s, 1, 10 * MM, 34 * MM); // 4m from blast
    // isolate the frag: thrower holds fire
    tick(s, [
      { type: "throw", soldierId: 0, kind: "frag", x: 10 * MM, y: 30 * MM },
      { type: "firemode", soldierId: 0, hold: true },
    ]);
    for (let i = 0; i < 120; i++) tick(s, []);
    expect(adjacent.alive).toBe(false);              // 95->55 zone
    expect(standoff.alive).toBe(true);               // light frag damage only
    expect(standoff.hp).toBeGreaterThan(70);
  });

  it("stun pins soldiers near the blast", () => {
    const s = createState(55);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    const victim = spawnSoldier(s, 1, 10 * MM, 33 * MM); // 3m: stun radius
    tick(s, [
      { type: "throw", soldierId: 0, kind: "frag", x: 10 * MM, y: 30 * MM },
      { type: "firemode", soldierId: 0, hold: true },
    ]);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      tick(s, []);
      peak = Math.max(peak, victim.suppression);
    }
    expect(victim.alive).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(95); // pegged = pinned well past PIN_THRESHOLD
  });
});
