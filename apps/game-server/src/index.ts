/**
 * CoC authoritative match server — M1.
 * One process = one match. ws transport (uWebSockets.js/WebTransport later).
 * Fixed 30Hz tick; all game rules live in @coc/sim. Snapshots are fog-culled
 * per team: the client never receives enemies its team cannot see.
 */
import { WebSocketServer, WebSocket } from "ws";
import {
  createState, GREYBOX_MAP, hashState, losBetween, MM, spawnSoldier, tick,
  TICK_MS, TICK_RATE, type Order, type ShotEvent, type Soldier, type WeaponId,
} from "@coc/sim";
import { ClientMsgSchema, type ServerMsg } from "@coc/protocol";
import { DEFAULT_SERVER_PORT } from "@coc/shared";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const FIRETEAM_WEAPONS: WeaponId[] = ["carbine", "lmg", "dmr", "smg"];

const state = createState(Date.now() >>> 0, GREYBOX_MAP);
const pendingOrders: Order[] = [];
let pendingEvents: ShotEvent[] = [];

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
  const soldierIds = FIRETEAM_WEAPONS.map((weapon, i) => {
    return spawnSoldier(state, team, baseX + i * (3 * MM), spawnY, weapon).id;
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
    pendingEvents.push(...tick(state, orders));
    if (state.tick % 3 === 0) broadcast(); // snapshots at 10Hz for M0/M1
  }
}, 4);

/** Fog rule: own team always; enemy soldiers only while some living ally sees them. */
function visibleTo(team: 0 | 1): Soldier[] {
  return state.soldiers.filter((s) => {
    if (s.team === team) return true;
    return state.soldiers.some(
      (a) => a.team === team && a.alive && losBetween(state.obstacles, a, s).visible,
    );
  });
}

function broadcast(): void {
  const events = pendingEvents;
  pendingEvents = [];
  const hash = hashState(state);
  const byTeam: Record<0 | 1, string> = {
    0: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(0), events } satisfies ServerMsg),
    1: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(1), events } satisfies ServerMsg),
  };
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(byTeam[p.team]);
  }
}
