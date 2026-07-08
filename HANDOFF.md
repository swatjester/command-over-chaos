# HANDOFF — Command over Chaos (CoC)

_Session handoff, written 2026-07-02, fully updated 2026-07-08 (M2.1 close-out session). Read this + PLAN.md + ISSUES.md before doing anything._

## What this project is

A browser-based, modern-warfare multiplayer squad-tactics game — spiritual successor to **Chain of Command / Call of Combat** (players micro 1–4 soldiers as part of a team; visible shot percentages; regiment/esports focus). Owner: Dan (swatjester@gmail.com), an ex-CoC player. He playtests every push and drives features from playtest feedback — expect rapid iterate-verify-push loops.

- **Working title:** Command over Chaos (Dan not sold; "CoC" initialism IS locked; alternates in PLAN §12)
- **Repo:** https://github.com/swatjester/command-over-chaos (private). GitHub = source of truth for code.
- **Dan's dev machine:** clones to `E:\COC\command-over-chaos` (NOT OneDrive). Runs `pnpm install`, `pnpm dev:server`, `pnpm dev:client` (no build step needed for dev — vite aliases + tsconfig.dev.json resolve workspace TS source).
- **Full design/tech plan:** PLAN.md. It has a **live "Milestone status" section — keep it current whenever anything is deferred or completed. Dan requires this.**

## Critical workflow facts (sandbox/session specifics)

1. **The OneDrive mount (`/sessions/<name>/mnt/COC`) serves STALE/TRUNCATED reads of recently-edited files.** This corrupted a pushed commit once. NEVER `cp` from the mount into the git clone. Write files into the clone directly (heredoc/python), or `git checkout HEAD -- <file>` + re-apply patches. Clone→mount copies are FINE (that's how docs sync back after a push).
2. **Docs (PLAN.md, ISSUES.md, HANDOFF.md) are maintained in the mount AND the repo — the repo copies can LAG the mount** (found 2026-07-08: repo ISSUES.md was two fixes behind). Before editing a doc in the clone, `diff` it against the mount and reconcile from the mount version, then push and copy back to the mount so both match.
3. **Git workflow:** clone lives in `/tmp/build` (scratch — may vanish; re-clone freely). `api.github.com` is proxy-blocked; `git` over HTTPS to `github.com` works. Dan supplies a **PAT** in chat when needed (needs `repo` + `workflow` scopes); set remote URL with token to clone/push, scrub after (`git remote set-url origin https://github.com/swatjester/command-over-chaos`). Never init git in the OneDrive folder.
4. **pnpm is NOT preinstalled in the sandbox** and global npm installs are permission-blocked. Do: `npm config set prefix ~/.npm-global && npm i -g pnpm@9` then `export PATH=~/.npm-global/bin:$PATH` (re-export in every bash call — no env carryover).
5. **Verify before every push:** `pnpm build`, `pnpm --filter @coc/sim test` (52 tests), `node tools/balance/mirror-battle.mjs` (fairness; `SEEDS=400` env scales the run), live ws smoke when netcode changed.
6. Background processes die between bash calls — run server+client smokes in a single call. Working pattern: a `.mjs` script that `spawn`s the server, connects `ws` clients (import from `/tmp/build/node_modules/.pnpm/ws@<version>/node_modules/ws/index.js` — check the version dir), validates messages with `ServerMsgSchema` from `packages/protocol/dist`, then kills the server. Lobby flow needs ~6s (join → ready → 3s countdown → snapshots).

## Architecture (monorepo, pnpm workspaces)

- `packages/sim` — THE deterministic core. Fixed 30Hz tick, integer-mm coordinates, seeded mulberry32 RNG (`state.rng` stream), FNV-1a `hashState` for desync detection. **Never introduce floats/clocks/unordered iteration into sim state. `Math.trunc` not `floor` for direction-symmetric movement. No `Math.cos/sin` (not IEEE-deterministic).** Key modules: `map.ts` (obstacles as corner AABBs mm, `vaultable()`/`blockedEx()` 0/1/2 collision classes, `FARMSTEAD_MAP`/`ACTIVE_MAP`, spawns, `buildings` footprints for client cutaway), `los.ts` (exact-int segment tests, corner-peek/lean ladder, over-top peek, smoke chord rule, `coverQuality()` tiers), `combat.ts` (`computeShotPct` — pure over snapshot-shaped objects so client renders exact server numbers, factor breakdown, `settling`/`vaulting` flags), `path.ts` (grid A* + string-pulling; vault cells crossable at +350 cost; diagonals blocked past ANY cover), `tick.ts` (orders→movement+vaulting→grenades→bleed/aid→two-phase simultaneous combat→suppression decay; `tryVault()` and vault-landing waypoint consumption live here), `weapons.ts`, `grenades.ts`, `state.ts` (Soldier fields incl. vaultT/vaultX/vaultY/pips, VAULT_TICKS=30, VAULT_MAX=2500).
- `packages/protocol` — zod schemas both directions. Snapshot soldiers carry ALL fields client UI needs (aim/lean/peekUp/down/bleed/revived/settle/inventory/queue/vaultT/vaultX/vaultY/pips). **Adding a Soldier field = add it to `SoldierSnapshotSchema` too, or zod strips it client-side.** Lobby msgs: client `{t:"lobby", team?/archetype?/ready?/name?/start?}`; server `{t:"lobby", phase, yourId, countdown?, players[]}` roster broadcast + `{t:"start", yourSoldierIds}`.
- `packages/shared` — `ARCHETYPE_KITS` (weapon+grenade loadouts), `fireteams.json` (M3 stat blocks, not yet wired), constants.
- `apps/game-server` — one process = one match; ws (`ws` lib; uWS later). **Lobby phase machine** (`lobby → starting → live`): join lands in lobby; auto-start (3s countdown) when both sides manned + everyone ready; `start:true` msg force-starts any layout (solo testing); countdown cancels if someone un-readies/leaves; late join while live spawns immediately; **sim ticks only once live**; squads spawn at match start in join order (deterministic). **Fog-culled snapshots per team** (never sends unseen enemies — anti-wallhack by construction); 10Hz snapshots (tick%3); session tokens (sessionStorage — per-tab, so multiple windows = multiple players; I-003) → squad/lobby-slot reclaim on refresh in every phase (I-001), 120s orphan reap (lobby-phase leavers are dropped immediately); **records replays** (seed+spawns+orders+reaps per tick → `replays/*.json`).
- `apps/client` — Vite+React+Three.js. **App.tsx state machine:** `boot` (try ws) → `lobby` (team columns/archetype cards/ready/force-start/countdown) → `game`; no server → `menu` offering PRACTICE SKIRMISH and BOOTCAMP (both offline, same sim). `net.ts`: `connectOnline(name)` resolves null if unreachable; `createOffline(archetype, "skirmish"|"bootcamp")`. Scene (`scene.ts`): ortho iso camera (middle-drag yaw), map rendered FROM sim data, marquee/multi-select, hover shot-% with factor breakdown + SETTLING/VAULTING labels, soldier cards (HP/SUP/bleed bars, aim %, stance icons, HOLD/DOWN/KIA/✚, ⚠ UNDER FIRE chip, veteran ▲ pips, vaulting…), **fat beam tracers** (stretched boxes, zoom-independent; hits linger, misses visibly offset), **muzzle flashes**, **red damage flash on victims**, grenade arcs, smoke clouds, explosion rings, red-diamond last-known ghosts, lean/peek-up poses, **vault hop animation**, **building roofs + interior cutaway** (roof/walls fade when anyone you can see is inside a `buildings` footprint). Bootcamp overlay: 7 steps gated on snapshot predicates (move 5m → prone → sprint → vault → kill well dummy → frag → smoke).
- `tools/balance/mirror-battle.mjs` — dual-orientation fairness harness (`SEEDS` env). `tools/replay/verify.mjs` — replay determinism prover.

## Game rules implemented (the important semantics)

- **Shot %**: base by weapon+range → multiplicative factors (shooter stance ×1.15 prone/×1.08 crouch; veteran pips +4%/pip; movement ×0.35–0.75; suppression; target profile ×0.55 prone/×0.8 crouch — peeking prone counts as crouch; target moving; target-in-cover by tier). Clamped 1–99. Same function client+server.
- **Cover tiers** (I-004b): target-in-cover multiplier by kind — **window ×0.40, wall/stone/shed ×0.50, hay/tree ×0.55, fence ×0.65**; strongest intervening cover near the target wins; corner-hug exposure stays ×0.50.
- **Vision**: unrestricted range, LOS-only fog (locked §2.4). Walls (ht>1200mm) block; low cover (≤1200) = cover bonus if target near it, prone-behind = hidden. **Corner peek**: blocked-direct → lean 950mm (`PEEK_DIST`), ladder: direct → exposed-target → own lean → mutual lean; leaning is visible+exposing. **Peek-over** (`peekUp`): aiming across adjacent low cover/window = crouch profile, not hidden. **Windows** block movement, low-cover LOS, render sill+lintel.
- **Vault** (M2.1): thin low cover (≤1200mm high, ≤700mm thick, not hay/tree — so courtyard walls, fences, window sills) is climbable — soldier freezes VAULT_TICKS (1s), weapon slung (can't fire, `vaulting` in UI), **standing profile regardless of stance**, then lands ≤2.5m across. Prone or pinned soldiers can't vault. A* crosses vault cells at +350 cost so routes prefer gaps/doors but climb when much shorter. Landing consumes path waypoints whose cell centers sit inside the cover (see `tick.ts` — dist ≤400, or blocked ≤1600).
- **Smoke**: blocks sightline only if it travels >1 radius inside cloud (no self-smoke invisibility).
- **Settle**: beyond ~63% weapon maxRange shooter must be stationary settleTicks (carbine 20t, smg 15t, lmg 30t, dmr 60t=2s); movement (and vaulting) resets; UI shows SETTLING….
- **Weapons** (cooldown ticks): carbine 37, smg 12, dmr 46, lmg 8, carbine_gl 37 (=carbine + GL delivery). LMG flagged "will need tweaking" by Dan.
- **Grenades (doctrine locked)**: hand = 15m, 10% deviation, lethal ≤2m (direct overkill), light dmg to 6m, stun (sup=100) ≤4.5m, shaken to 9m, 1.5s fuse after landing. GL (grenadier only) = 45m, 3% deviation, impact-fuzed, direct ≤1.5m → DOWN (never kill), stun ≤3.5m, shaken to 6m. Q=frag/E=smoke arm-then-click.
- **Grenade UX (LOCKED by Dan 2026-07-08)**: multi-select throw = closest-to-target soldier with inventory throws; **a selected grenadier whose GL validly reaches the click point takes priority**. Mid-vault soldiers excluded. (Client-side selection in App.tsx `onGroundLeftClick`.)
- **Down/revive**: lethal small-arms/GL/outer-frag → DOWN (60s bleed); hand-frag-adjacent → dead; frag hits on downed → dead; aid order walks medic in, 5s adjacent stationary channel → 25hp, woozy; **one revive per soldier — second downing fatal** (✚ mark).
- **Suppression**: pins >70 (crawl only); decays 1/tick. **Combat is two-phase simultaneous** (no id-order advantage; mutual kills possible).
- **Veterancy pips** (M3 slice): a kill grants the shooter a pip (max 3), +4% accuracy each — visible "veteran" factor in the % breakdown, gold ▲ chevrons on the card. In-match only; resets every match by construction (no meta power — esports pillar).
- **Controls**: left-click select, drag box-select, ` squad, 1–4 singles, right-click move/fire/revive, shift+right queue (pathfound), F sprint toggle, T hold-fire toggle (hold clears fire orders — "hold means STOP"; explicit target overrides posture), Z/X/C stance, H halt, Q/E grenades, Esc cancel, WASD/wheel/middle-drag camera.

## 2026-07-08 session log (commits f392539..3e626b4)

1. `998d6e4` **sim: vault links + cover-quality tiers** — state/hash/protocol carry vaultT/vaultX/vaultY; `tryVault` in tick.ts; A* vault cells; `coverQuality()` in los.ts; 8 new tests.
2. `783c464` **client: fire readability (I-004a), roofs+cutaway, grenadier throw priority** — fat tracers/muzzle flash/damage flash/UNDER FIRE chips; `MapDef.buildings` + roof slabs + fade; vault hop animation; top bar says M2.1.
3. `a8da86e` **M2.1: lobby + bootcamp** — server phase machine + lobby protocol; client boot→menu/lobby→game state machine; 7-step bootcamp over offline sim with hold-fire dummies.
4. `b2f5e06` **M3 slice: veterancy pips** — kill→pip (max 3), +4%/pip visible factor; card chevrons; test.
5. `3e626b4` **docs** — PLAN milestone status, ISSUES (I-004 fixed, I-002 re-measured 56/44 over 800 battles), HANDOFF.

All verified: clean rebuild, 52/52 sim tests, mirror-battle team-fair (391/409 over 800), lobby + solo-force-start ws smokes green. Docs copied back to the OneDrive mount after push.

## Status (mirrors PLAN "Milestone status")

M0 ✓, M1 ✓, M2 core ✓, **M2.1 ✓ except 1v1-over-internet verification** (the ONLY remaining M2.1 item — needs a deployed server, Fly.io per PLAN §8.1; requires Dan's Fly.io account/token, plus client support for a `?server=wss://…` URL param or similar, which does NOT exist yet — `connectOnline` is hardcoded to `ws://localhost:8787`). **M3 started:** veterancy pips done. M3 next: archetype abilities + stat blocks (`shared/fireteams.json` has the data, sim wiring absent), PP rank system (enlisted upward-only, officers losable; hidden MMR), accounts, stats pipeline (ClickHouse), profile pages, 3 polished maps, closed alpha with ex-CoC community (NA-first).

## Open issues / known quirks

- **I-002** (ISSUES.md): Farmstead courtyard scenario ~56/44 north-side skew (was 58/42; vault links helped). Engine team-fair. Side swaps neutralize in matches; revisit before ranked.
- Offline modes = no fog (both teams visible). Bootcamp dummy kills count toward pips (harmless).
- Roof/cutaway is purely visual — sim LOS is still 2D; roofs never block sim sightlines (nothing shoots over a roof today anyway).
- Vault landing waypoint-consumption is heuristic (see tick.ts); if soldiers ever ping-pong at a wall, look there first.
- Lobby has no chat and no kick; name changes are lobby-phase only. Fine for playtests.
- CI: GitHub Actions runs build+tests on push (pnpm version comes from packageManager field only).
- Balance values are all placeholder-tier; live in `weapons.ts`/`grenades.ts`/`combat.ts` (cover tiers in `los.ts`) + `shared/fireteams.json` (M3 data).

## Dan's preferences (learned)

Concise communication. Playtests immediately after every push — give him pull + test instructions (two browser windows = two players; kill the server + reload for the offline menu/bootcamp). CoC fidelity is the north star (he supplies original screenshots as reference). Prefers mechanics that are fair/symmetric (a reveal that exposes), readable (visible %, visible misses, ghosts, UNDER FIRE), and doctrinally grounded (GL vs hand grenade realism; grenadier priority on throws was his call). Log bugs in ISSUES.md when deferring. Update PLAN status religiously.
