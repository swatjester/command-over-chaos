# PROJECT PLAN — **Command over Chaos** (working title; CoC initialism locked, exact name may change)

*A Chain of Command / Call of Combat spiritual successor.*

A modern-warfare, browser-based, real-time squad tactics game where players micro 1–4 soldiers as part of a larger team, with visible shot percentages, deep cooperative play, and a regiment/esports system at its core.

---

## 1. Vision & Design Pillars

1. **Cooperative micro is the game.** Like CoC, one player commands only 1–4 soldiers; victory comes from team coordination up and down a chain of command. Individual micro skill matters enormously (esports ceiling), but no one carries alone.
2. **Deterministic, readable combat.** Every engagement is explainable: visible shot %, visible cover states, visible suppression. No hidden RNG modifiers. If you died, you can see why in the replay.
3. **Zero-friction access, esports-grade depth.** Browser client, join a match in <30 seconds, but with the ladder/regiment/stat infrastructure of a competitive title.
4. **Modern theme, timeless tactics.** Modern loadouts (optics, NVGs, drones-as-abilities, body armor) layered on CoC's core: LOS, stances, buildings, grenades, ambushes.

---

## 2. Core Gameplay (faithful to CoC, modernized)

### 2.1 Match model
- Two teams of **1–5 players per side**; each player controls a fireteam of **up to 4 soldiers** (map/mode defines totals).
- Real-time with a fixed simulation tick (see §8). Matches are objective rounds: capture zones, demolition, escort, elimination.
- **Chain of command:** each team elects/assigns a Commander who sets the team loadout pool, assigns special weapons/equipment, places rally points, and gets team-wide ping/draw tools. Default command seniority in pickup matches follows account rank (§6.2); teams can override by vote.
- **Permadeath is standard:** a soldier lost in a round is gone for that round. Respawn/reinforcement mechanics exist only as explicit features of specific game modes, never the default.
- **Shared vision per team, sourced per soldier** — true LOS fog of war; you see only what teammates' soldiers see (server-culled, anti-wallhack by construction).

### 2.2 Soldier control (the micro layer)
- Stances: **stand / crouch / prone**, each affecting speed, accuracy, exposure, and LOS height (e.g., prone behind a low wall = invisible + unhittable until flanked).
- Movement modes: **sprint / move / sneak / crawl**; sprinting spikes your visibility and blooms incoming shot % against you... but crossing a street slowly is its own death sentence. The CoC street-crossing tension is sacred.
- Facing matters: soldiers have a vision cone + peripheral awareness; flanking is rewarded.
- Orders queue (shift-click), formation drag for multi-select, and per-soldier fire modes: **hold fire / return fire / fire at will / suppress area**.
- Grenades (frag, smoke, flash, incendiary) with cook timer and throw-arc preview; window/door breach interactions.
- Buddy actions: bandage/revive (bleed-out timer), ammo share, drag wounded, boost over walls.

### 2.3 Shot percentage (the signature mechanic — kept and enhanced)
- Hovering/targeting an enemy shows a live **hit % per soldier**, computed server-side from: weapon accuracy profile at range, shooter stance + movement + suppression state, target stance/movement/exposure (% of body silhouette visible past cover), and shooter skill stat.
- **Enhanced UX vs. CoC:** the % breaks down on hover-hold (e.g., `62% = base 80 − moving 10 − target in cover 15 + elevation 7`), so the number teaches the game. Also show **time-to-kill estimate** and the *enemy's* % back at you (recon skill-gated — see fireteam abilities).
- Damage is locational (head/torso/limbs) with armor interaction; no HP sponges — 1–3 hits down a soldier, keeping CoC lethality.

### 2.4 Vision vs. engagement range (locked direction)
- **Vision is unrestricted by range** — gated only by LOS and fog. Information is symmetric and fair: if a sightline exists, both sides can use it, and scouting/positioning stays meaningful.
- **Shooting is hard-capped per weapon** (data-driven `maxRange` + accuracy falloff), so an open sightline is never a cross-map death trap — you can *see* across the map, not kill across it.
- **Long-range platforms pay in mobility, not information:** beyond a weapon's far band (~60–65% of maxRange), the shooter must **settle** — remain stationary for a short aim time before their shot % applies; moving resets it. Preserves overwatch/sniper roles while killing run-and-gun sniping at extreme range. (Settle mechanic: implement alongside remaining M1 polish.)
- **Role exceptions are data-driven per archetype** (post-M2): e.g., Recon snipers extend the settle band's reach; Weapons Team MGs project *suppression* (not accurate damage) beyond their accurate range as area denial.

### 2.5 Suppression & morale
- Incoming near-misses build **suppression**: accuracy debuff, screen-edge vignette on the victim's owner, forced flinch at high levels; pinned soldiers can only crawl. Replaces CoC's opaque morale with a visible per-soldier meter (readability pillar).

---

## 3. Preset Fireteams (the new layer)

Players pick a **fireteam archetype** pre-match (or per Commander's team-comp constraints in ranked). Each archetype = 4 soldier templates with fixed loadouts, 1 team ability, 1 passive, and a stat block. Presets keep balance tight for esports (no à-la-carte loadout soup); cosmetic customization only.

| Archetype | Composition (4 soldiers) | Signature ability | Passive | Stat identity |
|---|---|---|---|---|
| **Rifle Infantry** | TL (carbine), Rifleman (carbine+GL), Auto-rifleman (LMG), Rifleman (carbine) | *Fix Bayonets* — brief squad-wide suppression resistance + move speed | Extra ammo & grenades | Balanced; the baseline. Best sustained fire |
| **Rangers** | TL (carbine), Breacher (shotgun+charges), Marksman (DMR), Grenadier (GL) | *Door Charge* — breach walls/doors, stuns room | Faster building entry/clearing | CQB kings; weak at long open range |
| **Commandos (SOF)** | TL (suppressed SMG), 2× Operator (suppressed carbine), Saboteur (suppressed SMG + demo) | *Ghost* — 8s of near-invisibility while sneaking | Suppressed weapons don't reveal position on team fog | Stealth/flank; lowest armor, fragile if caught |
| **Airborne** | TL (carbine), 2× Paratrooper (carbine), AT specialist (rocket) | *Insertion* — one-time redeploy anywhere out of enemy LOS | Fastest sprint & vault; light armor | Map mobility, objective flips; thin on defense |
| **Recon / Marksmen** | TL (carbine), Sniper (bolt), Spotter (DMR + UAV), Scout (SMG) | *Micro-UAV* — 15s aerial vision cone (jammable) | See enemy shot-% against you; longer vision range | Information warfare; loses CQB hard |
| **Weapons Team** | TL (carbine), MG gunner (GPMG), Asst. gunner (carbine + ammo), AT gunner (rocket) | *Emplace* — deploy MG: huge arc of suppression | Suppression they cause is 50% stronger | Area denial; nearly immobile when emplaced |

- Per-soldier stats: **Accuracy, Toughness, Speed, Stealth, Awareness** (visible bars, no hidden math).
- Soldiers earn **in-match rank pips only** (accuracy/steadiness bump for surviving rounds — CoC's veteran feel) — resets every match; **no meta progression that affects power** (esports pillar).
- Launch with 6 archetypes; ~2 per year post-launch (e.g., Marines/amphib, Combat Engineers, National Guard/militia).

---

## 4. UX / UI (modern, sleek, micro-first)

- **Control scheme:** RTS-standard — left-click select / right-click contextual order, 1–4 hard-bound to soldiers, `Tab` cycles, `space` centers, ctrl-groups, shift-queue, `alt` shows all shot-% lines at once ("tactical overlay"). Full rebinding day one.
- **Soldier cards** (bottom bar): portrait, HP/limb state, suppression meter, stance, ammo, weapon, ability cooldown — one glance = full state (SC2/Door Kickers 2 conventions).
- **Order feedback:** ghost-path preview with exposure warning — the path glows red across sightlines the enemy is known to watch (this alone fixes CoC's #1 new-player killer).
- **Commander layer:** map drawing, pings (attack/defend/danger), sub-objective markers, loadout assignment screen pre-round.
- Diegetic minimal HUD; UI theme = modern military command-tablet aesthetic (dark, high-contrast, colorblind-safe palettes).
- **Spectator/caster mode is a first-class client:** free cam, per-player POV with their selections/orders visible, team fog toggle, live win-probability & stat overlays, instant replay of last engagement. Built early, not bolted on (esports pillar).
- Onboarding: interactive bootcamp (move → cover → shot % → suppression → team play) + co-op vs. AI mode.

---

## 5. Art Direction — 3D rendered isometric (Three.js)

- True 3D scene, **orthographic camera locked to classic isometric angle** (rotatable in 90° steps, tilt fixed) — modern lighting/shadows with CoC's readable perspective.
- Realistic-stylized modern military look: muted palette environments, slightly saturated team-readable soldier silhouettes (blue/orange trims for spectators).
- Dynamic time-of-day per map (NVG mechanics on night maps), volumetric smoke that genuinely blocks server-side LOS, tracers, impact decals, ragdoll deaths.
- Buildings: multi-floor with **auto-cutaway** when soldiers enter (roof/upper floors fade) — the modern answer to CoC's building play.
- Asset pipeline: glTF models, GPU-instanced foliage/props, texture atlases; target 60fps on integrated GPUs, gorgeous on discrete (quality tiers).
- Maps authored in-engine map editor (ships to community post-launch; UGC maps feed the casual pool).

### 5.1 Asset strategy (no prepared art — free/CC0 + procedural)
| Category | Source | Notes |
|---|---|---|
| UI | Code-only: React/CSS/SVG; **Lucide** + **game-icons.net** icons (CC0/CC-BY); Google Fonts | No art assets needed; polished from day one |
| Textures/materials | **ambientCG**, **Poly Haven** (CC0 PBR) | Makes even greybox maps read well under lighting |
| 3D models | **Kenney**, **Quaternius** CC0 low-poly packs (soldiers, weapons, buildings, props); procedural primitives where gaps exist | Stylized-consistent; capsule+box soldiers fine for M0–M1 readability |
| Animation | **Mixamo** (humanoid rigs) or programmatic posing on primitives | |
| Audio (later) | **Kenney audio**, **Sonniss GDC** royalty-free packs | M2+ |

All assets load through a single manifest/interface so placeholder → commissioned final art is a swap, not a rewrite. License ledger (`ASSETS.md`) tracks source + attribution for every imported asset from day one.

---

## 6. Regiment (clan) & Esports System

### 6.1 Regiments
- Create/join a **Regiment**: tag, insignia (editor with preset shapes — moderated), ranks (CO/XO/NCO/Trooper), MOTD, internal roster & stats.
- Regiment features: private scrims with custom rules, practice-room map instances, VOD/replay locker shared to the roster, recruitment page with stat-verified player cards.

### 6.2 Rank system (CoC-style PP ranks)
The visible progression is the classic CoC military rank ladder, driven by **Promotion Points (PP)** earned from match wins (scaled by opponent strength, mode, and margin) and lost on losses where applicable:

- **Enlisted ranks (PVT → SGM): upward-only.** Losses subtract PP, but you can never drop below the floor of your current rank — hit a threshold, the promotion is permanent. Grinding and improvement always feel rewarded.
- **Officer ranks (2LT → GEN): earned and defended.** Reaching 2LT is a one-way door (you can't fall back to enlisted), but every rank above 2LT can be lost by dropping below its PP floor. High ranks are a live claim, not a trophy — the top of the ladder stays meaningful.
- Rank confers in-game standing: default chain-of-command seniority in pickup matches, lobby insignia, and eligibility gates (e.g., officer rank required to found a regiment).
- **Hidden matchmaking MMR runs separately** (OpenSkill-style) so match quality doesn't depend on the visible grind; PP gain/loss is scaled by MMR delta to keep rank ≈ skill over time. Ranks persist across seasons; leaderboards and placement badges are seasonal.

### 6.3 Competitive structure
- **Regiment ladder:** scheduled challenge matches (CoC's classic clan-war flow: challenge → accept → scheduled war), seasonal regiment rating, promotion/relegation divisions.
- **Tournament mode:** in-client brackets (single/double elim, round robin), admin tools, ready-checks, pause/timeout protocol, coach slot in lobby.
- Match integrity: server-authoritative everything, replay files auto-saved for every ranked/regiment match, referee spectator slots, disconnect/rehost protocol with state restore.

### 6.4 Social (in-client baseline, Discord-native community)
- In-client: friends list, party-up + invite-to-lobby, global/team/match/regiment text chat, presence ("in match — spectate"), block/mute/report.
- No in-client voice at launch — Discord is where the community will live; ship deep Discord integration instead: OAuth link, regiment-server bot (match results, war scheduling, stat cards), rich presence.

### 6.5 Formats (competitive default)
- **Regiment War:** 4v4 players (16 soldiers/side), Bo3 maps, attack/defend rounds with side swaps, tactical timeouts. Casual pool keeps flexible 1–5/side CoC-style pickup.

---

## 7. Stat Tracking & Analytics (esports-heavy)

- **Event-sourced match log:** every order, shot (with its computed %), damage event, suppression tick, revive, and objective interaction is a timestamped event → the replay file *is* the analytics source (one pipeline, no drift).
- Player stats: K/D per soldier archetype, damage/round, avg shot % taken vs. hit-rate delta (**"discipline" metric** — do you take bad shots?), suppression uptime dealt/received, objective time, revives, survival rate, first-blood rate, clutch rounds, map/side winrates.
- Fireteam analytics: archetype pick/win/ban rates per patch (public balance dashboard — build trust with the comp scene).
- Regiment pages: head-to-head history, map pools, lineup stats, form graph.
- **Heatmaps & engagement review:** death/kill/vision heatmaps per map; per-round engagement timeline in the replay viewer.
- Public **read-only stats API** (JSON) from day one — let the community build the Liquipedia/tracker sites; that's how esports scenes bootstrap.
- Seasonal leaderboards (global/regional/regiment), profile badges from placements only (no pay-for-prestige).

---

## 8. Technical Architecture

### 8.1 Stack
| Layer | Choice | Why |
|---|---|---|
| Client rendering | **Three.js** + WebGL2/WebGPU-ready | User choice; ortho isometric 3D, mature ecosystem |
| Client app/UI | **TypeScript + React** (HUD/menus as DOM overlay), Zustand state | Sleek UI fast; DOM > canvas for text-heavy esports UI |
| Simulation core | **Shared deterministic TS package** (`@fireteam/sim`) — fixed-point/integer math, runs on server (authoritative) & client (prediction) | One codebase for rules; replays = seed + input log (tiny files) |
| Netcode | WebSocket (**uWebSockets.js**) + WebTransport/WebRTC-datachannel upgrade path; server tick **30Hz**, client interp/pred | Browser-compatible, low latency; RTS-with-micro tolerates 30Hz well |
| Game servers | Node processes, one per match, orchestrated on **Fly.io/Agones-on-K8s** by region | Cheap horizontal scale, region ping fairness for ranked |
| Backend services | Node (NestJS or Hono): auth, matchmaking, regiments, ladders, stats ingest | TS everywhere, shared types end-to-end |
| Data | **Postgres** (accounts/regiments/ladders) + **ClickHouse** (match events/analytics) + Redis (matchmaking queues, presence) + S3 (replays) | Event volume from §7 needs a columnar store |
| Auth | Email/OAuth (Discord first — where regiments live), JWT sessions | Community reality |
| Anti-cheat | Server-authoritative sim, **server-side fog culling** (client never receives unseen enemy data), input-rate sanity checks, replay-based review tools, stats-anomaly flags | Browser = no kernel AC; design it out instead |

### 8.2 Key technical decisions
- **Determinism first.** The sim package is deterministic from day 1 (seeded RNG, fixed tick, integer math). Buys: cheap replays, desync detection, server-verifiable outcomes, and a future lockstep option.
- Client-side **order prediction** (your soldier starts moving instantly) with server reconciliation; enemy entities are interpolated 2 ticks back.
- Pathfinding (lands in M2; M0–M1 ship direct movement with wall-slide collision): navmesh per map with stance-aware clearance (crawl-under gaps, vault links); flow-field fallback for grouped moves.
- LOS: precomputed visibility grid + runtime raycasts against dynamic occluders (smoke, opened doors, destroyed cover).
- Scale target: 10 players + 40 soldiers + projectiles per match ≈ small state; 1 vCPU per ~8 concurrent matches (validate in M1 benchmark).

### 8.3 Repo structure (monorepo — pnpm + Turborepo)
```
fireteam/
├── packages/
│   ├── sim/            # deterministic game core (no deps on render/net)
│   ├── protocol/       # message schemas (zod), codegen'd types
│   ├── shared/         # constants, fireteam/weapon data (JSON-driven balance)
│   └── ui/             # design system components
├── apps/
│   ├── client/         # Three.js + React game client
│   ├── game-server/    # authoritative match server
│   ├── api/            # accounts, regiments, ladders, stats API
│   ├── matchmaker/     # queues, lobbies, tournament engine
│   └── site/           # landing, leaderboards, regiment pages, replay viewer (web)
├── tools/
│   ├── map-editor/     # in-engine editor
│   └── balance/        # sim-vs-sim headless battle harness for balance testing
└── infra/              # IaC, server orchestration, CI/CD
```
- Balance data (weapons, archetypes, shot-% coefficients) lives in versioned JSON in `shared/` — patches are data PRs, and the headless `balance/` harness runs thousands of automated engagements per change.

---

## 9. Roadmap

| Milestone | Duration | Deliverable |
|---|---|---|
| **M0 — Foundation** | 2–3 wks | Repo, CI, deterministic sim skeleton (tick, movement, LOS grid), Three.js iso camera + placeholder map, single soldier moving with prediction against local server |
| **M1 — Combat vertical slice** | 4–6 wks | 4-soldier control, stances/movement modes, shot-% engine + UI, cover/suppression, one greybox map, 1v1 over the internet, replay capture. **Benchmark netcode + server density** |
| **M2 — Squad play** | 4–6 wks | **Navmesh pathfinding** (soldiers route around obstacles; stance-aware clearance + vault links — replaces the M0/M1 interim of direct movement with wall-slide collision), grenades/smoke (LOS-blocking), buildings + cutaway, buddy actions, 3 archetypes (Infantry/Rangers/Recon), 2v2–4v4, basic lobby, bootcamp tutorial |
| **M2.1 — Squad-play backlog** (deferred from M2) | 1–2 wks | Basic lobby, **1v1 over the internet verified** (deferred from M1 — needs a deployed server, not localhost; validate latency feel/interp/reconnect on real WAN), bootcamp tutorial, vault links + stance-aware nav clearance, multi-floor building cutaway, grenade-throw UX with multiple units selected — **locked 2026-07-08**: closest-to-target soldier with inventory throws; if a selected grenadier's GL validly reaches the point, the grenadier takes priority |
| **M3 — The meta** | 6–8 wks | All 6 archetypes, Commander layer, PP rank system + hidden MMR, accounts, in-client social (friends/party/chat), stat pipeline (ClickHouse), profile pages, 3 polished maps, closed alpha with ex-CoC community (NA servers) |
| **M4 — Regiments & esports** | 6–8 wks | Regiment system, regiment ladder + challenge flow, Discord integration/bot, spectator/caster client, tournament mode, replay viewer on web, public stats API, open beta (NA) |
| **M5 — Polish & launch** | ongoing | Art pass to final quality, map editor, seasonal system, monetization (cosmetics-only), launch tournament |

**De-risk order matters:** netcode feel + shot-% combat readability (M1) is the whole bet — playtest brutally there before building the meta on top.

### Effects, assets & fire-support backlog (added 2026-07-08, from playtest)

- **Free asset pass:** grab/generate textures, models, animations, particle effects from the §5.1 sources (ambientCG/Poly Haven PBR, Kenney/Quaternius models, Mixamo anims) — replace capsule soldiers and flat-color boxes; log everything in ASSETS.md.
- **Weapon/impact effects:** muzzle flash + lingering muzzle smoke; bullet impact effects by surface (dirt kick-up, stone chips, wood splinters, vehicle sparks); shell casings later.
- **Destructible walls** (eventually): obstacle HP + destroyed states; LOS/nav grid updates on destruction; deterministic (sim-side), replay-safe.
- **Off-map fire support archetypes** (JTAC / JFO / TACP / FSO / FIST): call-in airstrikes / artillery — targeting flow (map click + delay + danger-close), ammo/cooldown economy, counterplay (smoke, dispersion, overhead cover). New archetype slots per §3's ~2/year cadence.
- **UAV overwatch:** persistent/loiterable aerial vision distinct from Recon's Micro-UAV ability — jammable, shootable, information-warfare counterplay.

### Milestone status (live — keep current when deferring/completing)

_As of 2026-07-08:_

- **M0 — Foundation: ✓ complete**
- **M1 — Combat vertical slice: ✓ complete*** — shot-% engine with breakdown UI, LOS/cover/corner-peek/lean, suppression + pinning, settle mechanic, Farmstead map, squad controls, grenades, replay capture + verifier. *2-team netcode verified on localhost only — "1v1 over the internet" moved to M2.1 (needs a deployed server)
- **M2 — Squad play: core ✓ complete** — A* pathfinding (wall-slide fallback), hand vs GL grenade doctrine, buddy down/bleed-out/revive (once), session reclaim (I-001), 3 archetype kits, enlarged multi-room buildings with windows, over-the-top peeking
- **M2.1 — Squad-play backlog: ✓ complete except internet verification** — basic **lobby** (name/team/archetype/ready, 3s countdown, auto-start when both sides manned + all ready, force-start for solo testing, late join while live), **bootcamp** tutorial (7 gated steps over the offline sim), **vault links** (thin low cover — low walls/fences/window sills — is climbable: 1s frozen + exposed + weapon slung; prone/pinned can't; A* routes over it at a penalty; hay/trees not vaultable), **building roofs + interior cutaway** (roof/walls fade when anyone you can see is inside), multi-select **grenade UX locked**: closest-to-target throws, but a selected grenadier whose GL reaches the point takes priority. Remaining: **1v1 over the internet** (needs a deployed server — Fly.io per §8.1)
- **Pacing & map rework (2026-07-08):** move speeds halved (positioning is deliberate; re-judge TTK at this pace before touching damage). **Farmstead rebuilt at 300x300 (4x area)** — named VPs (The Maison/The Church/Courtyard v2; The Barn/Hay Field/Parking/N/S/E/W Forest v1), Parking is a gravel lot with truck/car cover, four forests, long overwatch lanes; DMR (130m) and LMG (110m) got long-range bands so extreme-range low-%% potshot duels work like classic CoC. **Obstacle clipping fixed structurally** — map-integrity test forbids overlapping obstacles and requires every zone A*-reachable from both spawns. **15s deploy phase** after lobby: give opening orders, nothing moves; **shift+1–4 reassigns soldier hotkeys**.
- **Fire-on-move doctrine + end round (2026-07-08):** only assault weapons (SMG/carbine) fire on the move, at heavy penalty; DMR/LMG must stop to shoot — corner engagements reward whoever set up first. Suppression decay halved + DMR suppression up: a settled DMR can pin. END ROUND button returns everyone to the lobby (replay saved); MENU exits offline modes.
- **M3 — The meta: started** — in-match **veterancy pips** (a kill grants a pip, max 3, +4% accuracy each, visible "veteran" factor in the % breakdown; in-match only, resets by construction). **Victory-point zones** (2026-07-08, locations from Dan's screenshot): 10 flagged capture zones on Farmstead — neutral → 3s sole occupancy captures; any enemy in radius = contested (split flag, progress+payout freeze); owned zones pay value/sec; VP + flag HUD. **Bot AI** for testing: three personalities (**vp** = pushes zones, **hunter** = seeks & destroys via last-known positions, **balanced** = fights what it sees, caps otherwise), addable to either team from the lobby (or mid-match), team-LOS perception (no wallhack), orders replay-recorded; offline practice enemy is a balanced bot. Next: win condition / match end on VP target, archetype abilities + stat blocks, PP ranks + hidden MMR, accounts, stats pipeline
- **I-004 fire readability: ✓ fixed** — (a) muzzle flash, fat zoom-independent tracers, victim damage flash, UNDER FIRE card chips; (b) cover-quality tiers: window ×0.40, masonry/timber ×0.50, hay/tree ×0.55, fence ×0.65 (strongest intervening cover near the target wins)

### Grenade doctrine (locked)
Hand frags: short range (~15m), toss deviation (~10% of distance), lethal only adjacent, stun near. Grenadiers (Carbine + GL): 40mm from the launcher — ~45m, tight (~3%) accuracy, impact-fuzed, **downs on direct hit, stuns on near miss, never insta-kills**; 6 frag + 4 smoke (others carry 2/1; Rangers +1 each). One grenadier per fireteam replaces a rifle/DMR slot.

## 10. Monetization (esports-compatible)
Free-to-play; cosmetics only (soldier gear skins, regiment insignia slots, spectator flair). No gameplay purchases, no loot boxes. Optional regiment "supporter" tier (extra VOD storage, custom server regions for scrims).

## 11. Decisions Locked
- **Rank system:** CoC-style PP ranks (enlisted upward-only, officer ranks defendable) + hidden matchmaking MMR (§6.2).
- **Permadeath** within rounds is standard; respawns are mode-specific only (§2.1).
- **Social:** in-client chat/friends/party baseline; Discord as the community home with deep integration (§6.4).
- **Factions: symmetric.** Differentiation comes from loadout and fireteam archetype choice only. Post-launch option: regiments may adopt a faction identity (cosmetic/flavor), not at launch.
- **Rollout: NA region first** (beta servers + first ranked season NA-only; EU when concurrency supports healthy queues).

## 12. Name Candidates (final pick pending domain/trademark check)
Keeping the **C.O.C.** initials:
| Name | Notes |
|---|---|
| **Chain of Contact** | Closest heir to the original; "contact" is the modern radio call for engaging the enemy — thematically perfect |
| **Circle of Control** | Evokes the micro/command loop; more abstract |
| **Command over Chaos** | Punchy, describes the actual player fantasy |
| **Cadence of Combat** | Rhythm-of-battle flavor; softer |
| **Code of Conduct** | Ironic/memorable, strong esports-tag energy ("CoC ladder") |
| **Crucible of Command** | Weighty, tournament-friendly |

Breaking initials (fallbacks): *Contact Front* (the infantry callout — strong), *Fireline*, *Direct Action*, *Danger Close*.

**Recommendation: Chain of Contact** — instantly signals the lineage to CoC/CoC veterans, reads modern, and the community shorthand stays "CoC". Verify trademark status of the original "Chain of Command" mark (2AM Games is defunct, but check for live registrations) before announcing.
