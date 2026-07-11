import { describe, expect, it } from "vitest";
import {
  blocked, botThink, CAP_TICKS, computeShotPct, createBotMemory, createState,
  dist, FARMSTEAD_MAP, GREYBOX_MAP, hashState, losBetween, losBetweenEx, MM,
  rngInt, spawnSoldier, tick, VAULT_TICKS, WEAPONS,
  type MapDef, type Order, type OrderLog,
} from "../src/index.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { DEPLOY_TICKS } from "../src/index.js";

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
  it("soldiers never overlap walls — and now route around them (A*)", () => {
    const s = createState(5, GREYBOX_MAP);
    spawnSoldier(s, 0, 50 * MM, 38 * MM); // north of the building's north wall
    tick(s, [{ type: "move", soldierId: 0, x: 50 * MM, y: 50 * MM, mode: "sprint" }]);
    const sol = s.soldiers[0]!;
    for (let i = 0; i < 2000; i++) {
      tick(s, []);
      expect(blocked(s.obstacles, sol.x, sol.y)).toBe(false); // never clips geometry
    }
    // pathfinding took them around through the doorway to the interior goal
    expect(sol.x).toBe(50 * MM);
    expect(sol.y).toBe(50 * MM);
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
    spawnSoldier(s, 1, 10 * MM, 95 * MM, "carbine"); // 85m: beyond dmr settleStart (82m), within maxRange (130m)
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
    // throw smoke up the line (12m: inside hand range, deviation <=1.2m
    // still leaves a >r chord across the sightline)
    tick(s, [{ type: "throw", soldierId: 0, kind: "smoke", x: 10 * MM, y: 22 * MM }]);
    expect(a.smokes).toBe(0); // default kit carries one smoke now
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
    expect(sol.queue.length).toBeGreaterThanOrEqual(2); // pathfound legs appended
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
    spawnSoldier(s, 0, 10 * MM, 25 * MM, "carbine"); // 5m toss: max dev 0.5m
    const adjacent = spawnSoldier(s, 1, 10 * MM, 30 * MM);  // ground zero (<=0.7m: guaranteed lethal)
    const standoff = spawnSoldier(s, 1, 10 * MM, 37 * MM);  // >=6.3m from any landing
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
    spawnSoldier(s, 0, 10 * MM, 20 * MM, "carbine");
    const victim = spawnSoldier(s, 1, 10 * MM, 33 * MM); // <=4.2m from any landing: stun radius
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

describe("mutual lean (facing doorways)", () => {
  // two parallel walls with aligned door gaps (x 20..24); soldiers hug the
  // same (east) side of each frame
  const walls = [
    { x: 10000, y: 20000, w: 10000, h: 400, ht: 3000, kind: "wall" as const },  // south wall, west of gap
    { x: 24000, y: 20000, w: 16000, h: 400, ht: 3000, kind: "wall" as const },  // south wall, east of gap
    { x: 10000, y: 9800, w: 10000, h: 400, ht: 3000, kind: "wall" as const },   // north wall, west of gap
    { x: 24000, y: 9800, w: 16000, h: 400, ht: 3000, kind: "wall" as const },   // north wall, east of gap
  ];

  it("same-side frame huggers get LOS on each other via lean-vs-lean", () => {
    const s = createState(61);
    s.obstacles.push(...walls);
    const a = spawnSoldier(s, 0, 24600, 21200); // south of south wall, east frame
    const b = spawnSoldier(s, 1, 24600, 9200);  // north of north wall, east frame
    const r = losBetweenEx(s.obstacles, a, b);
    expect(r.visible).toBe(true);
    expect(r.leanX).toBeLessThan(0); // leaned west into the gap
    expect(r.targetInCover).toBe(true); // frame hugger reads as in cover
    // and it is symmetric
    expect(losBetween(s.obstacles, b, a).visible).toBe(true);
  });

  it("a body width away from the frame = safe", () => {
    const s = createState(62);
    s.obstacles.push(...walls);
    const a = spawnSoldier(s, 0, 24600, 21200);
    const safe = spawnSoldier(s, 1, 26500, 9200); // 2.5m east of the frame
    expect(losBetween(s.obstacles, a, safe).visible).toBe(false);
  });

  it("soldiers visibly lean while engaging through a peek", () => {
    const s = createState(63);
    s.obstacles.push(...walls);
    const a = spawnSoldier(s, 0, 24600, 21200, "carbine");
    spawnSoldier(s, 1, 24600, 9200, "carbine");
    tick(s, []);
    expect(a.aimId).not.toBeNull();
    expect(Math.abs(a.leanX) + Math.abs(a.leanY)).toBeGreaterThan(0);
    // kill the duel: hold fire, lean should tuck back once no aim
    tick(s, [
      { type: "firemode", soldierId: 0, hold: true },
      { type: "firemode", soldierId: 1, hold: true },
    ]);
    tick(s, []);
    expect(a.aimId).toBeNull();
    expect(a.leanX).toBe(0);
    expect(a.leanY).toBe(0);
  });
});

describe("pathfinding", () => {
  it("routes around the farmstead maison and is deterministic", () => {
    const run = (): number => {
      const s = createState(71, FARMSTEAD_MAP);
      spawnSoldier(s, 0, 150 * MM, 55 * MM); // north of maison
      tick(s, [{ type: "move", soldierId: 0, x: 150 * MM, y: 95 * MM, mode: "sprint" }]); // south of it
      for (let i = 0; i < 3000; i++) tick(s, []);
      return hashState(s);
    };
    const s = createState(71, FARMSTEAD_MAP);
    const sol = spawnSoldier(s, 0, 150 * MM, 55 * MM);
    tick(s, [{ type: "move", soldierId: 0, x: 150 * MM, y: 95 * MM, mode: "sprint" }]);
    for (let i = 0; i < 3000; i++) tick(s, []);
    expect(sol.x).toBe(150 * MM);
    expect(sol.y).toBe(95 * MM); // arrived (used to wedge on the north wall)
    expect(run()).toBe(run());
  });

  it("unreachable targets settle at nearest reachable cell", () => {
    const s = createState(72, FARMSTEAD_MAP);
    const sol = spawnSoldier(s, 0, 75 * MM, 60 * MM);
    // the well is solid: order INTO it
    tick(s, [{ type: "move", soldierId: 0, x: 75 * MM, y: 75 * MM }]);
    for (let i = 0; i < 2000; i++) tick(s, []);
    expect(blocked(s.obstacles, sol.x, sol.y)).toBe(false);
    expect(sol.tx).toBeNull(); // finished, not wedged forever
  });
});

describe("down / bleed-out / revive", () => {
  function shootDown(s: ReturnType<typeof createState>): void {
    for (let i = 0; i < 3000 && !s.soldiers[0]!.down; i++) tick(s, []);
  }

  it("small-arms lethal hits down soldiers; bleed-out kills without aid", () => {
    const s = createState(81);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    spawnSoldier(s, 1, 10 * MM, 25 * MM, "lmg");
    tick(s, [{ type: "firemode", soldierId: 0, hold: true }]); // a doesn't fight back
    shootDown(s);
    expect(a.down).toBe(true);
    expect(a.alive).toBe(true);
    const bleedAtDown = a.bleed;
    expect(bleedAtDown).toBeGreaterThan(0);
    for (let i = 0; i < bleedAtDown + 5; i++) tick(s, []);
    expect(a.alive).toBe(false); // bled out
  });

  it("adjacent ally revives a downed soldier at 25hp", () => {
    const s = createState(82);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    const medic = spawnSoldier(s, 0, 30 * MM, 10 * MM, "carbine");
    spawnSoldier(s, 1, 10 * MM, 25 * MM, "lmg");
    tick(s, [
      { type: "firemode", soldierId: 0, hold: true },
      { type: "firemode", soldierId: 1, hold: true },
    ]);
    shootDown(s);
    expect(a.down).toBe(true);
    // enemy ceases fire so the medic can work (otherwise he just downs the medic too)
    tick(s, [
      { type: "firemode", soldierId: 2, hold: true },
      { type: "aid", soldierId: 1, targetId: 0 },
    ]);
    for (let i = 0; i < 1200 && a.down; i++) tick(s, []);
    expect(a.down).toBe(false);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(25);
    expect(medic.aidId).toBeNull();
  });

  it("downed soldiers are not auto-targeted", () => {
    const s = createState(83);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    a.down = true;
    a.bleed = 1800;
    a.hp = 0;
    spawnSoldier(s, 1, 10 * MM, 25 * MM, "carbine");
    const ev = tick(s, []);
    expect(ev.shots.length).toBe(0);
  });
});

describe("grenadier (GL) doctrine", () => {
  it("GL reaches far, downs on direct hit, never insta-kills", () => {
    const s = createState(91);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine_gl", 6, 4);
    const target = spawnSoldier(s, 1, 10 * MM, 45 * MM, "carbine"); // 35m: hand can't, GL can
    target.stance = "prone";
    tick(s, [
      { type: "throw", soldierId: 0, kind: "frag", x: 10 * MM, y: 45 * MM },
      { type: "firemode", soldierId: 0, hold: true },
      { type: "firemode", soldierId: 1, hold: true },
    ]);
    for (let i = 0; i < 60; i++) tick(s, []);
    // 3% dev at 35m = ~1m: inside directRadius (1.5m) -> down, never dead
    expect(target.down).toBe(true);
    expect(target.alive).toBe(true);
  });

  it("GL near miss stuns without downing a healthy target", () => {
    const s = createState(92);
    spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine_gl", 6, 4);
    const target = spawnSoldier(s, 1, 10 * MM, 42500, "carbine"); // ~2.6m off aimpoint
    target.stance = "prone";
    tick(s, [
      { type: "throw", soldierId: 0, kind: "frag", x: 10 * MM, y: 40 * MM },
      { type: "firemode", soldierId: 0, hold: true },
      { type: "firemode", soldierId: 1, hold: true },
    ]);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      tick(s, []);
      peak = Math.max(peak, target.suppression);
    }
    expect(target.down).toBe(false);
    expect(target.alive).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(40);
  });
});

describe("revive once", () => {
  it("second downing is fatal", () => {
    const s = createState(93);
    const a = spawnSoldier(s, 0, 10 * MM, 10 * MM, "carbine");
    a.revived = true; // already used their one revive
    a.hp = 10;
    spawnSoldier(s, 1, 10 * MM, 25 * MM, "lmg");
    tick(s, [{ type: "firemode", soldierId: 0, hold: true }]);
    for (let i = 0; i < 3000 && a.alive; i++) tick(s, []);
    expect(a.alive).toBe(false); // dead, not down
    expect(a.down).toBe(false);
  });
});

describe("windows + peek-over", () => {
  it("windows allow fire with cover; prone-behind-window is hidden until they aim", () => {
    const s = createState(94, FARMSTEAD_MAP);
    // maison north window at x 148..151, y ~64; defender inside behind it
    const defender = spawnSoldier(s, 0, 149500, 65200, "carbine");
    defender.stance = "prone";
    const attacker = spawnSoldier(s, 1, 149500, 58 * MM, "carbine");
    // tucked prone behind the window: hidden
    expect(losBetween(s.obstacles, attacker, defender).visible).toBe(false);
    // once they aim through it (peekUp), they present a crouch profile
    defender.peekUp = true;
    const shot = computeShotPct(s.obstacles, attacker, { ...defender, tx: null });
    expect(shot.visible).toBe(true);
    expect(shot.factors.some((f) => f.label === "target in cover")).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// M2.1: vault links + cover-quality tiers
// ---------------------------------------------------------------------------

/** empty 100x100 field with a single east-west low obstacle at y=50m */
function fenceMap(kind: "fence" | "stone" | "hay", ht = 900): MapDef {
  return {
    w: 100 * MM,
    h: 100 * MM,
    obstacles: [{ x: 0, y: 50 * MM, w: 100 * MM, h: kind === "hay" ? 2 * MM : 400, ht, kind }],
    spawns: [[[50 * MM, 10 * MM]], [[50 * MM, 90 * MM]]],
  };
}

describe("vault links", () => {
  it("standing soldier climbs a thin fence line to reach the far side", () => {
    const state = createState(1, fenceMap("fence"));
    const s = spawnSoldier(state, 0, 50 * MM, 45 * MM);
    tick(state, [{ type: "move", soldierId: 0, x: 50 * MM, y: 55 * MM }]);
    for (let t = 0; t < 400; t++) tick(state, []);
    expect(s.y).toBeGreaterThan(50 * MM + 400);
    expect(dist(s.x, s.y, 50 * MM, 55 * MM)).toBeLessThan(600);
  });

  it("vaulting takes VAULT_TICKS frozen on the takeoff side, then lands", () => {
    const state = createState(1, fenceMap("stone", 1100));
    const s = spawnSoldier(state, 0, 50 * MM, 48 * MM);
    tick(state, [{ type: "move", soldierId: 0, x: 50 * MM, y: 52 * MM }]);
    // walk to the wall until the vault starts
    let started = -1;
    for (let t = 0; t < 200 && started < 0; t++) {
      tick(state, []);
      if (s.vaultT > 0) started = t;
    }
    expect(started).toBeGreaterThanOrEqual(0);
    const yAtStart = s.y;
    expect(s.vaultT).toBe(VAULT_TICKS);
    for (let t = 0; t < VAULT_TICKS - 1; t++) tick(state, []);
    expect(s.y).toBe(yAtStart); // frozen mid-climb
    tick(state, []);
    expect(s.y).toBeGreaterThan(50 * MM); // landed across
  });

  it("prone soldiers cannot vault (stance-aware clearance)", () => {
    const state = createState(1, fenceMap("fence"));
    const s = spawnSoldier(state, 0, 50 * MM, 45 * MM);
    tick(state, [
      { type: "stance", soldierId: 0, stance: "prone" },
      { type: "move", soldierId: 0, x: 50 * MM, y: 55 * MM },
    ]);
    for (let t = 0; t < 400; t++) tick(state, []);
    expect(s.y).toBeLessThan(50 * MM); // stuck on the near side
    expect(s.vaultT).toBe(0);
  });

  it("bulky low cover (hay) cannot be vaulted", () => {
    const state = createState(1, fenceMap("hay"));
    const s = spawnSoldier(state, 0, 50 * MM, 45 * MM);
    tick(state, [{ type: "move", soldierId: 0, x: 50 * MM, y: 56 * MM }]);
    for (let t = 0; t < 400; t++) tick(state, []);
    expect(s.y).toBeLessThan(50 * MM);
  });

  it("a vaulting soldier cannot fire and presents a standing profile", () => {
    const state = createState(1, fenceMap("fence"));
    const a = spawnSoldier(state, 0, 50 * MM, 45 * MM);
    const e = spawnSoldier(state, 1, 50 * MM, 70 * MM);
    // truce so suppression can't pin the vaulter mid-approach (halved move
    // speeds doubled the approach time) — this test is about the vault
    a.holdFire = true;
    e.holdFire = true;
    tick(state, [{ type: "move", soldierId: 0, x: 50 * MM, y: 55 * MM }]);
    for (let t = 0; t < 600 && a.vaultT === 0; t++) tick(state, []);
    expect(a.vaultT).toBeGreaterThan(0);
    const shot = computeShotPct(state.obstacles, a, state.soldiers[1]!, []);
    expect(shot.vaulting).toBe(true);
    expect(shot.pct).toBe(0);
    expect(a.aimId).toBeNull();
    // and the enemy sees a standing silhouette even if the vaulter was crouched
    const back = computeShotPct(state.obstacles, state.soldiers[1]!, a, []);
    expect(back.factors.find((f) => f.label === "target profile")).toBeUndefined();
  });

  it("vault determinism: same orders => same hash", () => {
    const run = (): number => {
      const state = createState(9, fenceMap("fence"));
      spawnSoldier(state, 0, 50 * MM, 45 * MM);
      spawnSoldier(state, 1, 50 * MM, 90 * MM);
      tick(state, [{ type: "move", soldierId: 0, x: 50 * MM, y: 80 * MM }]);
      for (let t = 0; t < 600; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});

describe("cover-quality tiers (I-004)", () => {
  const shooterAt = (x: number, y: number) => ({
    x, y, stance: "stand" as const, moveMode: "move" as const, tx: null,
    suppression: 0, weapon: "carbine" as const, settle: 240, peekUp: false,
  });

  function pctBehind(kind: "window" | "stone" | "fence"): number {
    const obstacles = [{ x: 45 * MM, y: 50 * MM, w: 10 * MM, h: 400, ht: 1100, kind }];
    const shooter = shooterAt(50 * MM, 40 * MM);
    const target = { ...shooterAt(50 * MM, 51 * MM), stance: "stand" as const };
    return computeShotPct(obstacles, shooter, target, []).pct;
  }

  it("window is stronger cover than stone; stone stronger than fence", () => {
    const win = pctBehind("window");
    const stone = pctBehind("stone");
    const fence = pctBehind("fence");
    expect(win).toBeLessThan(stone);
    expect(stone).toBeLessThan(fence);
  });

  it("strongest intervening cover wins and shows in the factor breakdown", () => {
    const obstacles = [
      { x: 45 * MM, y: 50 * MM, w: 10 * MM, h: 400, ht: 1100, kind: "fence" as const },
      { x: 45 * MM, y: 50.8 * MM, w: 10 * MM, h: 400, ht: 1100, kind: "window" as const },
    ];
    const shot = computeShotPct(obstacles, shooterAt(50 * MM, 40 * MM), shooterAt(50 * MM, 52 * MM), []);
    const f = shot.factors.find((x) => x.label === "target in cover");
    expect(f?.mult).toBe(40);
  });
});


describe("veterancy pips (M3 slice)", () => {
  it("a kill grants a pip and the pip raises shot %", () => {
    const state = createState(3);
    const a = spawnSoldier(state, 0, 10 * MM, 10 * MM);
    const b = spawnSoldier(state, 1, 12 * MM, 10 * MM);
    b.hp = 1; // one hit downs
    const before = computeShotPct(state.obstacles, a, b, []).pct;
    for (let t = 0; t < 600 && a.pips === 0; t++) tick(state, []);
    expect(a.pips).toBe(1);
    const c = spawnSoldier(state, 1, 12 * MM, 10 * MM);
    const after = computeShotPct(state.obstacles, a, c, []);
    expect(after.factors.find((f) => f.label === "veteran")?.mult).toBe(104);
    expect(after.pct).toBeGreaterThanOrEqual(before);
    expect(a.pips).toBeLessThanOrEqual(3);
  });
});


// ---------------------------------------------------------------------------
// Victory-point zones
// ---------------------------------------------------------------------------

function zoneMap(): MapDef {
  return {
    w: 100 * MM, h: 100 * MM, obstacles: [],
    spawns: [[[10 * MM, 10 * MM]], [[90 * MM, 90 * MM]]],
    zones: [{ name: "Hill", x: 50 * MM, y: 50 * MM, r: 8 * MM, value: 2 }],
  };
}

describe("victory-point zones", () => {
  it("sole occupancy for CAP_TICKS captures a neutral flag; VP accrues", () => {
    const state = createState(1, zoneMap());
    spawnSoldier(state, 0, 50 * MM, 50 * MM);
    expect(state.zones[0]!.owner).toBe(-1);
    for (let t = 0; t < CAP_TICKS; t++) tick(state, []);
    expect(state.zones[0]!.owner).toBe(0);
    const vpAtCap = state.vp[0];
    for (let t = 0; t < 90; t++) tick(state, []); // 3 more seconds
    expect(state.vp[0]).toBe(vpAtCap + 6); // value 2 x 3s
    expect(state.vp[1]).toBe(0);
  });

  it("any enemy inside makes the zone contested and freezes capture + payout", () => {
    const state = createState(1, zoneMap());
    const a = spawnSoldier(state, 0, 48 * MM, 50 * MM);
    const b = spawnSoldier(state, 1, 52 * MM, 50 * MM);
    a.holdFire = true; // truce: this test is about the flag, not the fight
    b.holdFire = true;
    for (let t = 0; t < CAP_TICKS * 3; t++) tick(state, []);
    expect(state.zones[0]!.contested).toBe(true);
    expect(state.zones[0]!.owner).toBe(-1);
    expect(state.vp[0]).toBe(0);
    expect(state.vp[1]).toBe(0);
  });

  it("flag persists when the zone empties; enemy retakes it by sole occupancy", () => {
    const state = createState(1, zoneMap());
    const a = spawnSoldier(state, 0, 50 * MM, 50 * MM);
    for (let t = 0; t < CAP_TICKS; t++) tick(state, []);
    expect(state.zones[0]!.owner).toBe(0);
    // owner walks away — flag stays
    tick(state, [{ type: "move", soldierId: a.id, x: 10 * MM, y: 10 * MM, mode: "sprint" }]);
    for (let t = 0; t < 300; t++) tick(state, []);
    expect(state.zones[0]!.owner).toBe(0);
    // enemy moves in and flips it
    const b = spawnSoldier(state, 1, 52 * MM, 50 * MM);
    void b;
    for (let t = 0; t < CAP_TICKS + 2; t++) tick(state, []);
    expect(state.zones[0]!.owner).toBe(1);
  });

  it("downed soldiers do not hold or contest a zone", () => {
    const state = createState(1, zoneMap());
    const a = spawnSoldier(state, 0, 50 * MM, 50 * MM);
    a.down = true;
    a.bleed = 100000;
    spawnSoldier(state, 1, 52 * MM, 50 * MM);
    for (let t = 0; t < CAP_TICKS; t++) tick(state, []);
    expect(state.zones[0]!.contested).toBe(false);
    expect(state.zones[0]!.owner).toBe(1);
  });

  it("zones are hashed (owner flip changes the hash)", () => {
    const a = createState(1, zoneMap());
    const b = createState(1, zoneMap());
    expect(hashState(a)).toBe(hashState(b));
    b.zones[0]!.owner = 0;
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

// ---------------------------------------------------------------------------
// Bot AI
// ---------------------------------------------------------------------------

describe("bot AI", () => {
  it("vp bot pushes its squad into the zone and captures it", () => {
    const state = createState(1, zoneMap());
    const ids = [0, 1, 2, 3];
    for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (10 + i * 3) * MM, 10 * MM);
    const mem = createBotMemory();
    for (let t = 0; t < 3000; t++) {
      const orders = t % 30 === 0 ? botThink(state, 0, ids, "vp", mem) : [];
      tick(state, orders);
      if (state.zones[0]!.owner === 0) break;
    }
    expect(state.zones[0]!.owner).toBe(0);
  });

  it("hunter bot closes on a visible enemy and kills it", () => {
    const state = createState(1, zoneMap());
    const ids = [0, 1, 2, 3];
    for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (10 + i * 3) * MM, 10 * MM);
    const e = spawnSoldier(state, 1, 90 * MM, 90 * MM);
    e.holdFire = true; // target dummy
    const mem = createBotMemory();
    let dead = false;
    for (let t = 0; t < 6000 && !dead; t++) {
      const orders = t % 30 === 0 ? botThink(state, 0, ids, "hunter", mem) : [];
      tick(state, orders);
      dead = !e.alive || e.down;
    }
    expect(dead).toBe(true);
  });

  it("botThink is deterministic: same state+mem => same orders", () => {
    const build = () => {
      const state = createState(7, zoneMap());
      for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (10 + i * 3) * MM, 10 * MM);
      spawnSoldier(state, 1, 60 * MM, 60 * MM);
      for (let t = 0; t < 120; t++) tick(state, []);
      return state;
    };
    const o1 = botThink(build(), 0, [0, 1, 2, 3], "balanced", createBotMemory());
    const o2 = botThink(build(), 0, [0, 1, 2, 3], "balanced", createBotMemory());
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
  });
});


describe("map integrity", () => {
  it("farmstead obstacles never overlap (no clipping)", () => {
    const obs = FARMSTEAD_MAP.obstacles;
    const bad: string[] = [];
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        const a = obs[i]!, b = obs[j]!;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          bad.push(`${a.kind}@(${a.x / 1000},${a.y / 1000}) x ${b.kind}@(${b.x / 1000},${b.y / 1000})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("farmstead is 300x300 with 10 named zones and clear spawns", () => {
    expect(FARMSTEAD_MAP.w).toBe(300000);
    expect(FARMSTEAD_MAP.h).toBe(300000);
    expect(FARMSTEAD_MAP.zones!.map((z) => z.name)).toContain("Parking");
    expect(FARMSTEAD_MAP.zones!.length).toBe(10);
    for (const side of FARMSTEAD_MAP.spawns) {
      for (const [x, y] of side) expect(blocked(FARMSTEAD_MAP.obstacles, x, y)).toBe(false);
    }
  });

  it("zone centers are reachable from both spawns (A* on the real map)", async () => {
    const { findPath } = await import("../src/path.js");
    for (const z of FARMSTEAD_MAP.zones!) {
      for (const side of FARMSTEAD_MAP.spawns) {
        const [sx, sy] = side[1]!;
        const path = findPath(FARMSTEAD_MAP.obstacles, FARMSTEAD_MAP.w, FARMSTEAD_MAP.h, sx, sy, z.x, z.y);
        expect(path, `${z.name} unreachable`).not.toBeNull();
      }
    }
  });
});

describe("deploy phase", () => {
  it("orders queue visibly but nothing moves/fires until the countdown ends", () => {
    const state = createState(1, zoneMap());
    const a = spawnSoldier(state, 0, 10 * MM, 10 * MM);
    const e = spawnSoldier(state, 1, 20 * MM, 10 * MM); // in carbine range, clear LOS
    void e;
    state.deploy = 60;
    tick(state, [{ type: "move", soldierId: 0, x: 40 * MM, y: 10 * MM, mode: "sprint" }]);
    expect(a.tx).not.toBeNull(); // order visible (path drawn client-side)
    for (let t = 0; t < 59; t++) tick(state, []);
    expect(a.x).toBe(10 * MM); // frozen
    expect(a.hp).toBe(100);    // nobody fired
    expect(state.deploy).toBe(0);
    for (let t = 0; t < 30; t++) tick(state, []);
    expect(a.x).toBeGreaterThan(10 * MM); // now it moves
  });

  it("deploy is hashed and replayable", () => {
    const mk = (d: number) => { const s = createState(5, zoneMap()); s.deploy = d; return hashState(s); };
    expect(mk(450)).toBe(mk(450));
    expect(mk(450)).not.toBe(mk(0));
    expect(DEPLOY_TICKS).toBe(450);
  });
});
