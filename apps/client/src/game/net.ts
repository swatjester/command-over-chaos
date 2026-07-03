/**
 * Connection layer. Tries the local match server; if unreachable, falls back
 * to an OFFLINE local sim (same @coc/sim code — that's the point) so the
 * client is always demoable. Offline mode has no fog: you see both teams.
 */
import {
  ACTIVE_MAP, createState, MM, spawnSoldier, tick, TICK_MS,
  type Order, type SimState, type WeaponId,
} from "@coc/sim";
import { ARCHETYPE_KITS, type PlayableArchetype } from "@coc/shared";
import {
  ServerMsgSchema, type Boom, type ClientMsg, type GrenadeSnapshot,
  type ShotEvent, type SmokeSnapshot, type SoldierSnapshot,
} from "@coc/protocol";

export interface SnapshotData {
  soldiers: SoldierSnapshot[];
  tick: number;
  shots: ShotEvent[];
  booms: Boom[];
  grenades: GrenadeSnapshot[];
  smokes: SmokeSnapshot[];
}
export type SnapshotCb = (data: SnapshotData) => void;

export interface Connection {
  mode: "online" | "offline";
  mySoldierIds: number[];
  sendOrders(orders: Order[]): void;
  onSnapshot(cb: SnapshotCb): void;
  close(): void;
}

function sessionToken(): string {
  let t = localStorage.getItem("coc-token");
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem("coc-token", t);
  }
  return t;
}

export function connect(
  archetype: PlayableArchetype = "infantry", url = "ws://localhost:8787",
): Promise<Connection> {
  return new Promise((resolve) => {
    let snapshotCb: SnapshotCb | null = null;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); resolve(offline(archetype)); }, 1500);

    ws.onerror = () => { clearTimeout(timeout); resolve(offline(archetype)); };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "join", name: "player", token: sessionToken(), archetype } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      const parsed = ServerMsgSchema.safeParse(JSON.parse(e.data as string));
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.t === "welcome") {
        clearTimeout(timeout);
        resolve({
          mode: "online",
          mySoldierIds: msg.yourSoldierIds,
          sendOrders: (orders) => {
            ws.send(JSON.stringify({ t: "orders", orders } satisfies ClientMsg));
          },
          onSnapshot: (cb) => { snapshotCb = cb; },
          close: () => ws.close(),
        });
      } else if (msg.t === "snapshot") {
        snapshotCb?.(msg);
      }
    };
  });
}

function offline(archetype: PlayableArchetype): Connection {
  const state: SimState = createState(20260702, ACTIVE_MAP);
  const mine = ARCHETYPE_KITS[archetype];
  const theirs = ARCHETYPE_KITS.rangers;
  // offline demo: two fireteams face off across the central courtyard
  for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (70 + i * 3) * MM, 55 * MM, mine[i]!.weapon as WeaponId, mine[i]!.frags, mine[i]!.smokes);
  for (let i = 0; i < 4; i++) spawnSoldier(state, 1, (70 + i * 3) * MM, 95 * MM, theirs[i]!.weapon as WeaponId, theirs[i]!.frags, theirs[i]!.smokes);
  let pending: Order[] = [];
  let snapshotCb: SnapshotCb | null = null;

  const interval = setInterval(() => {
    const ev = tick(state, pending.splice(0));
    snapshotCb?.({
      soldiers: structuredClone(state.soldiers),
      tick: state.tick,
      shots: ev.shots,
      booms: ev.booms,
      grenades: structuredClone(state.grenades),
      smokes: structuredClone(state.smokes),
    });
  }, TICK_MS);

  return {
    mode: "offline",
    mySoldierIds: [0, 1, 2, 3],
    sendOrders: (orders) => pending.push(...orders),
    onSnapshot: (cb) => { snapshotCb = cb; },
    close: () => clearInterval(interval),
  };
}
