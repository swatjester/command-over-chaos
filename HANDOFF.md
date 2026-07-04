# HANDOFF — Command over Chaos (CoC)

_Session handoff, written 2026-07-02. Read this + PLAN.md + ISSUES.md before doing anything._

## What this project is

A browser-based, modern-warfare multiplayer squad-tactics game — spiritual successor to **Chain of Command / Call of Combat** (players micro 1–4 soldiers as part of a team; visible shot percentages; regiment/esports focus). Owner: Dan (swatjester@gmail.com), an ex-CoC player. He playtests every push and drives features from playtest feedback — expect rapid iterate-verify-push loops.

- **Working title:** Command over Chaos (Dan not sold; "CoC" initialism IS locked; alternates in PLAN §12)
- **Repo:** https://github.com/swatjester/command-over-chaos (private). GitHub = source of truth.
- **Dan's dev machine:** clones to `E:\COC\command-over-chaos` (NOT OneDrive). Runs `pnpm install`, `pnpm dev:server`, `pnpm dev:client` (no build step needed for dev — vite aliases + tsconfig.dev.json resolve workspace TS source).
- **Full design/tech plan:** PLAN.md (repo + Dan's OneDrive COC folder). It has a **live "Milestone status" section — keep it current whenever anything is deferred or completed. Dan requires this.**

## Critical workflow facts (sandbox/session specifics)

1. **The OneDrive mount (`/sessions/<name>/mnt/COC`) serves STALE/TRUNCATED reads of recently-edited files.** This corrupted a pushed commit once. NEVER `cp` from the mount into the git clone. Write files into the clone directly (heredoc/python), or `git checkout HEAD -- <file>` + re-apply patches. Only docs (PLAN.md, ISSUES.md, HANDOFF.md) are maintained in the mount, via the Write/Edit tools.
2. **Git workflow:** clone lives in `/tmp/build` (scratch — may vanish; re-clone freely). `api.github.com` is proxy-blocked; `git` over HTTPS to `github.com` works. Dan supplies a **PAT** in chat when needed (needs `repo` + `workflow` scopes); set remote URL with token for push, scrub after. Never init git in the OneDrive folder (also blocked deletions need `allow_cowork_file_delete`).
3. **Verify before every push:** `pnpm build`, `pnpm --filter @coc/sim test` (43 tests), `node tools/balance/mirror-battle.mjs` (fairness), live ws smoke when netcode changed.
4. Background processes die between bash calls — run server+client smokes in a single call.

## Architecture (monorepo, pnpm workspaces)

- `packages/sim` — THE deterministic core. Fixed 30Hz tick, integer-mm coordinates, seeded mulberry32 RNG (`state.rng` stream), FNV-1a `hashState` for desync detection. **Never introduce floats/clocks/unordered iteration into sim state. `Math.trunc` not `floor` for direction-symmetric movement. No `Math.cos/sin` (not IEEE-deterministic).** Key modules: `map.ts` (obstacles as corner AABBs mm + `FARMSTEAD_MAP`/`ACTIVE_MAP` + spawns), `los.ts` (exact-int segment tests, corner-peek/lean ladder, over-top peek, smoke chord rule), `combat.ts` (`computeShotPct` — pure over snapshot-shaped objects so client renders exact server numbers, with factor breakdown), `path.ts` (grid A* + string-pulling), `tick.ts` (orders→movement→grenades→bleed/aid→two-phase simultaneous combat→suppression decay), `weapons.ts`, `grenades.ts`.
- `packages/protocol` — zod schemas both directions. Snapshot soldiers carry ALL fields client UI needs (aim/lean/peekUp/down/bleed/revived/settle/inventory/queue).
- `packages/shared` — `ARCHETYPE_KITS` (weapon+grenade loadouts), constants.
- `apps/game-server` — one process = one match; ws (`ws` lib; uWS later); **fog-culled snapshots per team (never sends unseen enemies — anti-wallhack by construction)**; 10Hz snapshots (tick%3); session tokens → squad reclaim on refresh (I-001 fixed), 120s orphan reap; **records replays** (seed+spawns+orders+reaps per tick → `replays/*.json`).
- `apps/client` — Vite+React+Three.js. Ortho iso camera (middle-drag yaw), map rendered FROM sim data (single source of truth), archetype picker, marquee/multi-select, hover shot-% with factor breakdown, soldier cards (HP/SUP/bleed bars, aim %, stance icons, HOLD/DOWN/KIA/✚ revived), tracers (misses visibly offset), grenade arcs, smoke clouds, explosion rings, last-known-position red-diamond ghosts, lean/peek-up visual poses.
- `tools/balance/mirror-battle.mjs` — dual-orientation fairness harness. `tools/replay/verify.mjs` — replay determinism prover.

## Game rules implemented (the important semantics)

- **Shot %**: base by weapon+range → multiplicative factors (shooter stance ×1.15 prone; movement ×0.35–0.75; suppression; target profile ×0.55 prone/×0.8 crouch — peeking prone counts as crouch; target moving; target-in-cover ×0.50). Clamped 1–99. Same function client+server.
- **Vision**: unrestricted range, LOS-only fog (locked §2.4). Walls (ht>1200mm) block; low cover (≤1200: stone/hay/fence/tree-trunk/**window**) = cover bonus if target near it, prone-behind = hidden. **Corner peek**: blocked-direct → lean 950mm (`PEEK_DIST`), ladder: direct → exposed-target → own lean → mutual lean; leaning is visible+exposing (soldiers carry leanX/leanY; figures visibly lean). **Peek-over** (`peekUp`): aiming across adjacent low cover/window = crouch profile, not hidden. **Windows** block movement, low-cover LOS, render sill+lintel.
- **Smoke**: blocks sightline only if it travels >1 radius inside cloud (no self-smoke invisibility).
- **Settle**: beyond ~63% weapon maxRange shooter must be stationary settleTicks (carbine 20t, smg 15t, lmg 30t, dmr 60t=2s); movement resets; UI shows SETTLING….
- **Weapons** (cooldown ticks): carbine 37, smg 12, dmr 46, lmg 8, carbine_gl 37 (=carbine + GL delivery). LMG flagged "will need tweaking" by Dan.
- **Grenades (doctrine locked)**: hand = 15m, 10% deviation, lethal ≤2m (direct overkill), light dmg to 6m, stun (sup=100) ≤4.5m, shaken to 9m, 1.5s fuse after landing. GL (grenadier only) = 45m, 3% deviation, impact-fuzed, direct ≤1.5m → DOWN (never kill), stun ≤3.5m, shaken to 6m. Q=frag/E=smoke arm-then-click; thrower = first selected with inventory (**M2.1: multi-select throw UX undecided**).
- **Down/revive**: lethal small-arms/GL/outer-frag → DOWN (60s bleed); hand-frag-adjacent → dead; frag hits on downed → dead; aid order (right-click downed ally) walks medic in, 5s adjacent stationary channel → 25hp, woozy; **one revive per soldier — second downing fatal** (✚ mark).
- **Suppression**: pins >70 (crawl only); decays 1/tick. **Combat is two-phase simultaneous** (no id-order advantage; mutual kills possible).
- **Controls**: left-click select, drag box-select, ` squad, 1–4 singles, right-click move/fire/revive, shift+right queue (pathfound), F sprint toggle, T hold-fire toggle (hold clears fire orders — "hold means STOP"; explicit target overrides posture), Z/X/C stance, H halt, Q/E grenades, Esc cancel, WASD/wheel/middle-drag camera.

## Status (mirrors PLAN "Milestone status")

M0 ✓, M1 ✓ (except internet-verified netcode → M2.1), M2 core ✓. **M2.1 pending:** lobby, 1v1-over-internet verification (needs deployed server — Fly.io per plan), bootcamp tutorial, vault links/stance-aware clearance, multi-floor cutaway, multi-select grenade UX. **M3 next:** archetype abilities/stats, PP rank system (enlisted upward-only, officers losable; hidden MMR), accounts, stats pipeline (ClickHouse), profile pages, 3 polished maps, closed alpha with ex-CoC community (NA-first).

## Open issues / known quirks

- **I-002** (ISSUES.md): courtyard-rush harness scenario shows ~60/40 north-side skew. Engine is team-fair (105/95). Scenario/route-level; side swaps neutralize in real matches. Investigate before ranked.
- Offline mode (no server) = both fireteams visible, no fog; fights across courtyard.
- CI: GitHub Actions runs build+tests on push (pnpm version comes from packageManager field only).
- Balance values are all placeholder-tier; live in `weapons.ts`/`grenades.ts`/`combat.ts` + `shared/fireteams.json` (M3 data).

## Dan's preferences (learned)

Concise communication. Playtests immediately after every push — give him pull + test instructions. CoC fidelity is the north star (he supplies original screenshots as reference). Prefers mechanics that are fair/symmetric (a reveal that exposes), readable (visible %, visible misses, ghosts), and doctrinally grounded (GL vs hand grenade realism). Log bugs in ISSUES.md when deferring. Update PLAN status religiously.
