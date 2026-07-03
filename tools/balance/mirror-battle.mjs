/**
 * First balance harness: mirrored 4v4 firefights across N seeds.
 * A fair sim should produce ~50/50 — significant skew = engine bias bug.
 * Run after `pnpm build`:  node tools/balance/mirror-battle.mjs
 */
import { createState, FARMSTEAD_MAP, spawnSoldier, tick, MM } from "../../packages/sim/dist/index.js";

const W = ["carbine", "lmg", "dmr", "smg"];
let w0 = 0, w1 = 0, draw = 0;
const SEEDS = 100;
for (let seed = 1; seed <= SEEDS; seed++) {
  const s = createState(seed, FARMSTEAD_MAP);
  for (let i = 0; i < 4; i++) spawnSoldier(s, 0, (70 + i * 3) * MM, 55 * MM, W[i]);
  for (let i = 0; i < 4; i++) spawnSoldier(s, 1, (70 + i * 3) * MM, 95 * MM, W[i]);
  tick(s, s.soldiers.map((x) => ({ type: "move", soldierId: x.id, x: x.x, y: x.team === 0 ? 73 * MM : 77 * MM, mode: "sprint" })));
  for (let i = 0; i < 6000; i++) tick(s, []);
  const a = s.soldiers.filter((x) => x.team === 0 && x.alive).length;
  const b = s.soldiers.filter((x) => x.team === 1 && x.alive).length;
  if (a > b) w0++; else if (b > a) w1++; else draw++;
}
console.log(`${SEEDS} mirrored battles — team0: ${w0}, team1: ${w1}, draws: ${draw}`);
if (Math.abs(w0 - w1) > SEEDS * 0.2) {
  console.error("WARNING: >20% skew — possible engine bias");
  process.exit(1);
}
