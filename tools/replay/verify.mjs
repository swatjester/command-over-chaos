/**
 * Replay verifier: re-simulates a recorded match and proves determinism.
 * Usage: node tools/replay/verify.mjs replays/match-XXXX.json
 * Exits nonzero if two runs of the same log diverge (desync bug).
 */
import { readFileSync } from "node:fs";
import { createState, FARMSTEAD_MAP, GREYBOX_MAP, hashState, spawnSoldier, tick } from "../../packages/sim/dist/index.js";

const file = process.argv[2];
if (!file) { console.error("usage: node verify.mjs <replay.json>"); process.exit(2); }
const replay = JSON.parse(readFileSync(file, "utf-8"));
const map = replay.map === "greybox" ? GREYBOX_MAP : FARMSTEAD_MAP;

function run() {
  const state = createState(replay.seed, map);
  const byTick = new Map();
  let maxTick = 0;
  for (const e of replay.events) {
    const list = byTick.get(e.t) ?? [];
    list.push(e);
    byTick.set(e.t, list);
    maxTick = Math.max(maxTick, e.t);
  }
  for (let t = 0; t <= maxTick + 60; t++) {
    const evs = byTick.get(t) ?? [];
    let orders = [];
    for (const e of evs) {
      if (e.spawns) for (const sp of e.spawns) spawnSoldier(state, sp.team, sp.x, sp.y, sp.weapon);
      if (e.reaps) for (const id of e.reaps) { const s = state.soldiers[id]; if (s) { s.alive = false; s.down = false; } }
      if (e.orders) orders = orders.concat(e.orders);
    }
    tick(state, orders);
  }
  return state;
}

const a = run();
const b = run();
const ha = hashState(a), hb = hashState(b);
console.log(`replay: ${file}`);
console.log(`ticks: ${a.tick} | soldiers: ${a.soldiers.length} | alive: ${a.soldiers.filter(s => s.alive).length} | hash: ${ha}`);
if (ha !== hb) { console.error("DESYNC: replay is not deterministic"); process.exit(1); }
console.log("deterministic ✓");
