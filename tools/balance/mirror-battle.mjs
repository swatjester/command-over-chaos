/**
 * Balance harness: mirrored 4v4 firefights, run in BOTH orientations per
 * seed (teams swap sides, like competitive side swaps). Reports:
 * - side balance (north vs south position winrate) -> map/scenario knowledge
 * - team balance (team0 vs team1 across orientations) -> ENGINE BIAS if skewed
 * Run after `pnpm build`:  node tools/balance/mirror-battle.mjs
 */
import { createState, FARMSTEAD_MAP, spawnSoldier, tick, MM } from "../../packages/sim/dist/index.js";

const W = ["carbine", "lmg", "dmr", "smg"];
const SEEDS = Number(process.env.SEEDS ?? 100);

function run(seed, flip) {
  const s = createState(seed, FARMSTEAD_MAP);
  const yA = flip ? 95 : 55, yB = flip ? 55 : 95;
  for (let i = 0; i < 4; i++) spawnSoldier(s, 0, (70 + i * 3) * MM, yA * MM, W[i]);
  for (let i = 0; i < 4; i++) spawnSoldier(s, 1, (70 + i * 3) * MM, yB * MM, W[i]);
  tick(s, s.soldiers.map((x) => ({
    type: "move", soldierId: x.id, x: x.x,
    y: ((x.team === 0) !== flip ? 73 : 77) * MM, mode: "sprint",
  })));
  for (let i = 0; i < 6000; i++) tick(s, []);
  const a = s.soldiers.filter((x) => x.team === 0 && x.alive).length;
  const b = s.soldiers.filter((x) => x.team === 1 && x.alive).length;
  return a > b ? 0 : b > a ? 1 : 2;
}

let team = [0, 0, 0];
let north = 0, south = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const r1 = run(seed, false); // t0 north
  const r2 = run(seed, true);  // t0 south
  team[r1]++; team[r2]++;
  if (r1 === 0) north++; else if (r1 === 1) south++;
  if (r2 === 0) south++; else if (r2 === 1) north++;
}
const games = SEEDS * 2;
console.log(`${games} battles (${SEEDS} seeds x both orientations)`);
console.log(`side balance:  north ${north}, south ${south}  (map/scenario asymmetry)`);
console.log(`team balance:  team0 ${team[0]}, team1 ${team[1]}, draws ${team[2]}  (engine bias if skewed)`);
// 3-sigma binomial bound on team skew
const sd = Math.sqrt(games * 0.25);
if (Math.abs(team[0] - team[1]) > 6 * sd) {
  console.error(`WARNING: team skew beyond 3σ (${(Math.abs(team[0] - team[1]) / 2 / sd).toFixed(1)}σ) — engine bias likely`);
  process.exit(1);
}
