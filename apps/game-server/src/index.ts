/**
 * CoC authoritative match server — M2.
 * One process = one match. 30Hz fixed tick; all rules in @coc/sim.
 * Fog-culled snapshots per team; session tokens reclaim squads across
 * reconnects (I-001); every match records a verifiable replay.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import {
  ACTIVE_MAP, createState, hashState, losBetween, MM, spawnSoldier, tick,
  TICK_MS, TICK_RATE, type Boom, type Order, type ShotEvent, type Soldier, type WeaponId,
} from "@coc/sim";
import { ClientMsgSchema, type ServerMsg } from "@coc/protocol";
import { ARCHETYPE_KITS, DEFAULT_SERVER_PORT, type PlayableArchetype } from "@coc/shared";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const RECONNECT_GRACE_MS = 120_000;

const seed = Date.now() >>> 0;
const state = createState(seed, ACTIVE_MAP);
const pendingOrders: Order[] = [];
let pendingShots: ShotEvent[] = [];
let pendingBooms: Boom[] = [];

// ---- replay recording ------------------------------------------------------
interface ReplayEvent {
  t: number;
  orders?: Order[];
  spawns?: Array<{ team: 0 | 1; x: number; y: number; weapon: WeaponId; frags: number; smokes: number }>;
  reaps?: number[];
}
const replay = {
  version: 1,
  seed,
  map: "farmstead",
  startedAt: new Date().toISOString(),
  events: [] as ReplayEvent[],
};
const replayFile = `replays/match-${Date.now()}.json`;
try { mkdirSync("replays", { recursive: true }); } catch { /* ok */ }
function saveReplay(): void {
  try { writeFileSync(replayFile, JSON.stringify(replay)); } catch (e) { console.error("[coc] replay save failed", e); }
}
setInterval(saveReplay, 30_000);

// ---- players / sessions -----------------------------------------------------
interface Player {
  id: string;
  token: string;
  team: 0 | 1;
  soldierIds: number[];
  ws: WebSocket | null;
  reapTimer: NodeJS.Timeout | null;
}
const players = new Map<string, Player>(); // by token
const byWs = new Map<WebSocket, Player>();
let nextPlayerNum = 0;

const wss = new WebSocketServer({ port: PORT });
console.log(`[coc] match server on :${PORT}, tick ${TICK_RATE}Hz, replay -> ${replayFile}`);

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const parsed = ClientMsgSchema.safeParse(JSON.parse(String(data)));
    if (!parsed.success) return; // invalid input: drop silently (server-authoritative)
    const msg = parsed.data;
    if (msg.t === "join") {
      handleJoin(ws, msg.token ?? `anon-${nextPlayerNum}`, msg.archetype ?? "infantry");
    } else if (msg.t === "orders") {
      const player = byWs.get(ws);
      if (!player) return;
      for (const o of msg.orders) {
        // authorization: you may only command your own soldiers
        if (player.soldierIds.includes(o.soldierId)) pendingOrders.push(o);
      }
    } else if (msg.t === "ping") {
      send(ws, { t: "pong", n: msg.n });
    }
  });

  ws.on("close", () => {
    const player = byWs.get(ws);
    if (!player) return;
    byWs.delete(ws);
    player.ws = null;
    console.log(`[coc] ${player.id} disconnected — ${RECONNECT_GRACE_MS / 1000}s to reclaim`);
    player.reapTimer = setTimeout(() => reap(player), RECONNECT_GRACE_MS);
  });
});

function handleJoin(ws: WebSocket, token: string, archetype: PlayableArchetype): void {
  let player = players.get(token);
  if (player) {
    // session reclaim (I-001): same squad, fresh socket
    if (player.reapTimer) { clearTimeout(player.reapTimer); player.reapTimer = null; }
    if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) player.ws.close();
    if (player.ws) byWs.delete(player.ws);
    player.ws = ws;
    byWs.set(ws, player);
    console.log(`[coc] ${player.id} reclaimed squad ${player.soldierIds.join(",")}`);
  } else {
    const team = (nextPlayerNum % 2) as 0 | 1;
    const anchors = ACTIVE_MAP.spawns[team];
    const [ax, ay] = anchors[Math.floor(nextPlayerNum / 2) % anchors.length]!;
    const kit = ARCHETYPE_KITS[archetype];
    const spawns: NonNullable<ReplayEvent["spawns"]> = [];
    const soldierIds = kit.map((k, i) => {
      const x = ax + Math.round((i - 1.5) * 3 * MM);
      const weapon = k.weapon as WeaponId;
      spawns.push({ team, x, y: ay, weapon, frags: k.frags, smokes: k.smokes });
      return spawnSoldier(state, team, x, ay, weapon, k.frags, k.smokes).id;
    });
    replay.events.push({ t: state.tick, spawns });
    player = { id: `p${nextPlayerNum++}`, token, team, soldierIds, ws, reapTimer: null };
    players.set(token, player);
    byWs.set(ws, player);
    console.log(`[coc] ${player.id} joined team ${team} as ${archetype}, soldiers ${soldierIds.join(",")}`);
  }
  send(ws, {
    t: "welcome",
    playerId: player.id,
    team: player.team,
    yourSoldierIds: player.soldierIds,
    mapW: state.mapW,
    mapH: state.mapH,
    tickRate: TICK_RATE,
  });
}

function reap(player: Player): void {
  const ids: number[] = [];
  for (const sid of player.soldierIds) {
    const s = state.soldiers[sid];
    if (s && s.alive) {
      s.alive = false;
      s.down = false;
      ids.push(sid);
    }
  }
  if (ids.length > 0) replay.events.push({ t: state.tick, reaps: ids });
  players.delete(player.token);
  console.log(`[coc] ${player.id} reaped (soldiers ${ids.join(",") || "none"})`);
  if (players.size === 0) saveReplay();
}

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
    if (orders.length > 0) replay.events.push({ t: state.tick, orders });
    const ev = tick(state, orders);
    pendingShots.push(...ev.shots);
    pendingBooms.push(...ev.booms);
    if (state.tick % 3 === 0) broadcast(); // snapshots at 10Hz for M1/M2
  }
}, 4);

/** Fog rule: own team always; enemy soldiers only while some living ally sees them. */
function visibleTo(team: 0 | 1): Soldier[] {
  return state.soldiers.filter((s) => {
    if (s.team === team) return true;
    return state.soldiers.some(
      (a) => a.team === team && a.alive && losBetween(state.obstacles, a, s, state.smokes).visible,
    );
  });
}

function broadcast(): void {
  const shots = pendingShots;
  const booms = pendingBooms;
  pendingShots = [];
  pendingBooms = [];
  const hash = hashState(state);
  const grenades = state.grenades;
  const smokes = state.smokes;
  const byTeam: Record<0 | 1, string> = {
    0: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(0), shots, booms, grenades, smokes } satisfies ServerMsg),
    1: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(1), shots, booms, grenades, smokes } satisfies ServerMsg),
  };
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(byTeam[p.team]);
  }
}
