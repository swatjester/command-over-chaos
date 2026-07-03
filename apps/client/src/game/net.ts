/**
 * Connection layer. Tries the local match server; if unreachable, falls back
 * to an OFFLINE local sim (same @coc/sim code — that's the point) so the
 * client is always demoable.
 */
import {
  createState, GREYBOX_MAP, MM, spawnSoldier, tick, TICK_MS, type Order, type SimState,
} from "@coc/sim";
import { ServerMsgSchema, type ClientMsg, type SoldierSnapshot } from "@coc/protocol";

export interface Connection {
  mode: "online" | "offline";
  mySoldierIds: number[];
  sendOrders(orders: Order[]): void;
  onSnapshot(cb: (soldiers: SoldierSnapshot[], tick: number) => void): void;
  close(): void;
}

export function connect(url = "ws://localhost:8787"): Promise<Connection> {
  return new Promise((resolve) => {
    let snapshotCb: ((s: SoldierSnapshot[], t: number) => void) | null = null;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); resolve(offline()); }, 1500);

    ws.onerror = () => { clearTimeout(timeout); resolve(offline()); };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "join", name: "player" } satisfies ClientMsg));
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
        snapshotCb?.(msg.soldiers, msg.tick);
      }
    };
  });
}

function offline(): Connection {
  const state: SimState = createState(20260702, GREYBOX_MAP);
  for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (40 + i * 3) * MM, 20 * MM);
  for (let i = 0; i < 4; i++) spawnSoldier(state, 1, (40 + i * 3) * MM, 80 * MM);
  let pending: Order[] = [];
  let snapshotCb: ((s: SoldierSnapshot[], t: number) => void) | null = null;

  const interval = setInterval(() => {
    tick(state, pending.splice(0));
    snapshotCb?.(structuredClone(state.soldiers), state.tick);
  }, TICK_MS);

  return {
    mode: "offline",
    mySoldierIds: [0, 1, 2, 3],
    sendOrders: (orders) => pending.push(...orders),
    onSnapshot: (cb) => { snapshotCb = cb; },
    close: () => clearInterval(interval),
  };
}
