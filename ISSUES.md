# Known Issues

| ID | Sev | Area | Description | Status | Planned fix |
|---|---|---|---|---|---|
| I-001 | high | session/netcode | Refreshing the browser spawns a brand-new squad and orphans the old one (server treats every ws connection as a new player; orphaned soldiers are never reaped). | open | Session identity: client stores a session token (localStorage), server maps token -> player and returns the existing squad on reconnect; orphaned squads reaped after a disconnect grace period. Target **M2**; binds to real accounts in M3. |
| I-002 | low | balance | Farmstead courtyard-rush scenario shows a north-side positional advantage (~60/40 over 200 harness battles). Engine is TEAM-fair (105/95 post path-smoothing + trunc movement fix); the residual skew is scenario/route-level. Competitive side swaps neutralize it in matches. | open | Trace arrival times per side; consider symmetric A* tie-breaking; re-measure with tools/balance/mirror-battle.mjs before ranked. |
