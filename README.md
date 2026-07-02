# Command over Chaos (CoC)

Modern-warfare multiplayer squad tactics in the browser. Spiritual successor to **Chain of Command** / **Call of Combat**: you command 1–4 soldiers as part of a team, with visible shot percentages, true line-of-sight fog of war, and a regiment/esports system at the core.

**Working title.** The "CoC" initialism is locked; the exact name may change.

See [PLAN.md](./PLAN.md) for the full design + technical plan.

## Structure (pnpm workspaces)

```
packages/
  sim/        deterministic game core — no render/net deps; runs on server & client
  protocol/   zod message schemas shared client<->server
  shared/     constants + data-driven balance (fireteams, weapons)
  ui/         design system components (stub)
apps/
  client/     Three.js + React game client (Vite)
  game-server/ authoritative ws match server, 30Hz tick
  api/        accounts/regiments/ladders/stats (stub)
  matchmaker/ queues/lobbies/tournaments (stub)
  site/       leaderboards/regiment pages/replay viewer (stub)
tools/
  balance/    headless sim-vs-sim balance harness (stub)
```

Turborepo will be added when the build graph warrants it.

## Dev

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # includes sim determinism tests
pnpm --filter @coc/game-server dev   # ws server on :8787
pnpm --filter @coc/client dev        # Vite on :5173
```

Open the client, and it connects to the local server; click ground to move soldiers.

## Core invariant

`@coc/sim` is **deterministic**: integer-scaled math, seeded RNG, fixed 30Hz tick, zero dependence on wall clock or float accumulation. Same seed + same input log ⇒ identical state hash on any machine. Replays, anti-cheat verification, and desync detection all depend on this — CI enforces it (`packages/sim/test/determinism.test.ts`).

## Licensing

Proprietary — all rights reserved (for now). Third-party assets tracked in [ASSETS.md](./ASSETS.md).
