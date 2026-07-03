# Known Issues

| ID | Sev | Area | Description | Status | Planned fix |
|---|---|---|---|---|---|
| I-001 | high | session/netcode | Refreshing the browser spawns a brand-new squad and orphans the old one (server treats every ws connection as a new player; orphaned soldiers are never reaped). | open | Session identity: client stores a session token (localStorage), server maps token -> player and returns the existing squad on reconnect; orphaned squads reaped after a disconnect grace period. Target **M2**; binds to real accounts in M3. |
