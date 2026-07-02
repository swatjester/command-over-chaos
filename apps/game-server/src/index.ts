/**
 * CoC authoritative match server — M0.
 * One process = one match. ws transport (uWebSockets.js/WebTransport later).
 * Fixed 30Hz tick; all game rules live in @coc/sim.
 */
import { WebSocketServer, WebSocket } from "ws";
import {
  createState, hashState, MM, spawnSoldier, tick, TICK_MS, TICK_RATE, type Order,
} from "@coc/sim";
import { ClientMsgSchema, type ServerMsg } from "@coc/protocol";
import { DEFAULT_SERVER_PORT } from "@coc/shared";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

const state = createState(Date.now() >>> 0);
const pendingOrders: Order[] = [];

interface Player {
  id: string;
  team: 0 | 1;
  soldierIds: number[];
  ws: WebSocket;
}
const players = new Map<WebSocket, Player>();
let nextPlayerNum = 0;

const wss = new WebSocketServer({ port: PORT });
console.log(`[coc] match server on :${PORT}, tick ${TICK_RATE}Hz`);

wss.on("connection", (ws) => {
  const team = (nextPlayerNum % 2) as 0 | 1;
  const spawnY = team === 0 ? 10 * MM : 90 * MM;
  const baseX = 30 * MM + Math.floor(nextPlayerNum / 2) * (15 * MM);
  const soldierIds = Array.from({ length: 4 }, (_, i) => {
    return spawnSoldier(state, team, baseX + i * (3 * MM), spawnY).id;
  });
  const player: Player = { id: `p${nextPlayerNum++}`, team, soldierIds, ws };
  players.set(ws, player);

  send(ws, {
    t: "welcome",
    playerId: player.id,
    team,
    yourSoldierIds: soldierIds,
    mapW: state.mapW,
    mapH: state.mapH,
    tickRate: TICK_RATE,
  });
  console.log(`[coc] ${player.id} joined team ${team}, soldiers ${soldierIds.join(",")}`);

  ws.on("message", (data) => {
    const parsed = ClientMsgSchema.safeParse(JSON.parse(String(data)));
    if (!parsed.success) return; // invalid input: drop silently (server-authoritative)
    const msg = parsed.data;
    if (msg.t === "orders") {
      for (const o of msg.orders) {
        // authorization: you may only command your own soldiers
        if (player.soldierIds.includes(o.soldierId)) pendingOrders.push(o);
      }
    } else if (msg.t === "ping") {
      send(ws, { t: "pong", n: msg.n });
    }
  });

  ws.on("close", () => {
    players.delete(ws);
    console.log(`[coc] ${player.id} left`);
  });
});

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// fixed-timestep loop with drift correction
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - last;
  last = now;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    const orders = pendingOrders.splice(0);
    tick(state, orders);
    if (state.tick % 3 === 0) broadcast(); // snapshots at 10Hz for M0
  }
}, 4);

function broadcast(): void {
  const msg: ServerMsg = {
    t: "snapshot",
    tick: state.tick,
    hash: hashState(state),
    soldiers: state.soldiers,
  };
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}
