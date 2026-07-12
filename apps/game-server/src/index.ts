/**
 * CoC authoritative match server — M2.1.
 * One process = one match. 30Hz fixed tick; all rules in @coc/sim.
 * LOBBY: players join, pick team/archetype, ready up; match spawns squads
 * when everyone is ready (auto when both teams are manned, or on an
 * explicit start request — solo testing stays one click away).
 * Fog-culled snapshots per team; session tokens reclaim squads across
 * reconnects (I-001); every match records a verifiable replay.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import {
  ACTIVE_MAP, botThink, createBotMemory, createState, DEPLOY_TICKS, hashState,
  losBetween, MM, spawnSoldier, tick, TICK_MS, TICK_RATE,
  type Boom, type BotMemory, type BotPersonality, type Order, type ShotEvent,
  type Soldier, type WeaponId,
} from "@coc/sim";
import { ClientMsgSchema, type MatchResult, type ServerMsg } from "@coc/protocol";
import { ARCHETYPE_KITS, DEFAULT_SERVER_PORT, type PlayableArchetype } from "@coc/shared";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
/** dev override: COC_DEPLOY=30 shortens the pre-match deploy window (ticks) */
const DEPLOY = Math.max(1, Number(process.env.COC_DEPLOY ?? DEPLOY_TICKS));
const RECONNECT_GRACE_MS = 120_000;
const COUNTDOWN_S = 3;

let seed = Date.now() >>> 0;
let state = createState(seed, ACTIVE_MAP);
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
function newReplay() {
  return {
    version: 1,
    seed,
    map: "farmstead",
    deploy: DEPLOY, // verify.mjs must arm the same countdown
    startedAt: new Date().toISOString(),
    events: [] as ReplayEvent[],
  };
}
let replay = newReplay();
let replayFile = `replays/match-${Date.now()}.json`;
try { mkdirSync("replays", { recursive: true }); } catch { /* ok */ }
function saveReplay(): void {
  try { writeFileSync(replayFile, JSON.stringify(replay)); } catch (e) { console.error("[coc] replay save failed", e); }
}
setInterval(saveReplay, 30_000);

// ---- players / sessions / lobby ---------------------------------------------
type Phase = "lobby" | "starting" | "live";
let phase: Phase = "lobby";
const options = { timeLimitMin: 15, vpTarget: 500 };
let lastResult: MatchResult | null = null;
let countdown = 0;
let countdownTimer: NodeJS.Timeout | null = null;

interface Player {
  id: string;
  token: string;
  name: string;
  team: 0 | 1;
  archetype: PlayableArchetype;
  ready: boolean;
  soldierIds: number[];
  ws: WebSocket | null;
  reapTimer: NodeJS.Timeout | null;
  /** AI squad: always ready, never reaped, thinks once a second */
  bot: boolean;
  personality?: BotPersonality;
  botMem?: BotMemory;
  botIdx?: number;
}
const players = new Map<string, Player>(); // by token
const byWs = new Map<WebSocket, Player>();
let nextPlayerNum = 0;
const nextAnchor: [number, number] = [0, 0]; // per-team spawn anchor cursor

const wss = new WebSocketServer({ port: PORT });
console.log(`[coc] match server on :${PORT}, tick ${TICK_RATE}Hz, lobby open, replay -> ${replayFile}`);

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const parsed = ClientMsgSchema.safeParse(JSON.parse(String(data)));
    if (!parsed.success) return; // invalid input: drop silently (server-authoritative)
    const msg = parsed.data;
    const player = byWs.get(ws);
    if (msg.t === "join") {
      handleJoin(ws, msg.token ?? `anon-${nextPlayerNum}`, msg.name, msg.archetype ?? "infantry");
    } else if (msg.t === "orders") {
      if (!player) return;
      for (const o of msg.orders) {
        // authorization: you may only command your own soldiers
        if (player.soldierIds.includes(o.soldierId)) pendingOrders.push(o);
      }
    } else if (msg.t === "lobby") {
      if (!player) return;
      // end the round: save the replay, reset the world, back to the lobby
      if (msg.endMatch && phase === "live") {
        const [a, b] = state.vp;
        endMatch(`by ${player.id}`, { winner: a > b ? 0 : b > a ? 1 : -1, reason: "manual", vp: [a, b] });
        return;
      }
      if (msg.options && phase !== "live") {
        options.timeLimitMin = msg.options.timeLimitMin;
        options.vpTarget = msg.options.vpTarget;
      }
      // bot management works in any phase (live adds spawn straight in)
      if (msg.addBot) addBot(msg.addBot.team, msg.addBot.personality, msg.addBot.archetype);
      if (msg.removeBot && phase !== "live") {
        const b = [...players.values()].find((p) => p.id === msg.removeBot && p.bot);
        if (b) { players.delete(b.token); console.log(`[coc] ${b.id} (bot) removed`); }
      }
      if (phase !== "live") {
        if (msg.team !== undefined) { player.team = msg.team; player.ready = false; }
        if (msg.archetype !== undefined) player.archetype = msg.archetype;
        if (msg.name !== undefined) player.name = msg.name;
        if (msg.ready !== undefined) player.ready = msg.ready;
        if (phase === "starting" && !everyoneReady()) cancelCountdown();
        if (msg.start && everyoneReady()) beginCountdown(); // explicit start: any team layout (solo testing)
        else if (everyoneReady() && bothTeamsManned() && players.size >= 2) beginCountdown();
      }
      lobbyBroadcast();
    } else if (msg.t === "ping") {
      send(ws, { t: "pong", n: msg.n });
    }
  });

  ws.on("close", () => {
    const player = byWs.get(ws);
    if (!player) return;
    byWs.delete(ws);
    player.ws = null;
    if (phase !== "live" && player.soldierIds.length === 0) {
      // lobby-phase leave: drop the slot (a refresh rejoins in a second)
      players.delete(player.token);
      if (phase === "starting" && !everyoneReady()) cancelCountdown();
      lobbyBroadcast();
      console.log(`[coc] ${player.id} left the lobby`);
      return;
    }
    console.log(`[coc] ${player.id} disconnected — ${RECONNECT_GRACE_MS / 1000}s to reclaim`);
    player.reapTimer = setTimeout(() => reap(player), RECONNECT_GRACE_MS);
  });
});

function everyoneReady(): boolean {
  let humans = 0;
  for (const p of players.values()) {
    if (p.bot) continue; // bots are always ready
    humans += 1;
    if (!p.ready || !p.ws) return false;
  }
  return humans > 0;
}

let nextBotNum = 0;
const BOT_NAMES = ["Ajax", "Brick", "Cobra", "Dutch", "Echo", "Flint", "Gonzo", "Hawk"];
function addBot(team: 0 | 1, personality: BotPersonality, archetype?: PlayableArchetype): void {
  const n = nextBotNum++;
  const bot: Player = {
    id: `b${n}`,
    token: `bot-${n}`,
    name: `${BOT_NAMES[n % BOT_NAMES.length]} [BOT]`,
    team,
    archetype: archetype ?? (["infantry", "rangers", "recon"] as const)[n % 3]!,
    ready: true,
    soldierIds: [],
    ws: null,
    reapTimer: null,
    bot: true,
    personality,
    botMem: createBotMemory(),
    botIdx: n,
  };
  players.set(bot.token, bot);
  console.log(`[coc] ${bot.id} (${bot.name}, ${personality}) added to team ${team}`);
  if (phase === "live") spawnSquad(bot);
}
function bothTeamsManned(): boolean {
  let t0 = 0, t1 = 0;
  for (const p of players.values()) p.team === 0 ? t0++ : t1++;
  return t0 > 0 && t1 > 0;
}

function handleJoin(ws: WebSocket, token: string, name: string, archetype: PlayableArchetype): void {
  let player = players.get(token);
  if (player) {
    // session reclaim (I-001): same slot/squad, fresh socket
    if (player.reapTimer) { clearTimeout(player.reapTimer); player.reapTimer = null; }
    if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) player.ws.close();
    if (player.ws) byWs.delete(player.ws);
    player.ws = ws;
    byWs.set(ws, player);
    console.log(`[coc] ${player.id} reclaimed ${player.soldierIds.length > 0 ? `squad ${player.soldierIds.join(",")}` : "lobby slot"}`);
  } else {
    // default team assignment balances headcount; player can switch in lobby
    let t0 = 0, t1 = 0;
    for (const p of players.values()) p.team === 0 ? t0++ : t1++;
    const team = (t0 <= t1 ? 0 : 1) as 0 | 1;
    player = {
      id: `p${nextPlayerNum++}`, token, name, team, archetype,
      ready: false, soldierIds: [], ws, reapTimer: null, bot: false,
    };
    players.set(token, player);
    byWs.set(ws, player);
    console.log(`[coc] ${player.id} (${name}) joined the ${phase}`);
    if (phase === "live") spawnSquad(player); // late join: straight into the match
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
  lobbyBroadcast();
}

function spawnSquad(player: Player): void {
  const anchors = ACTIVE_MAP.spawns[player.team];
  const [ax, ay] = anchors[nextAnchor[player.team] % anchors.length]!;
  nextAnchor[player.team] += 1;
  const kit = ARCHETYPE_KITS[player.archetype];
  const spawns: NonNullable<ReplayEvent["spawns"]> = [];
  player.soldierIds = kit.map((k, i) => {
    const x = ax + Math.round((i - 1.5) * 3 * MM);
    const weapon = k.weapon as WeaponId;
    spawns.push({ team: player.team, x, y: ay, weapon, frags: k.frags, smokes: k.smokes });
    return spawnSoldier(state, player.team, x, ay, weapon, k.frags, k.smokes).id;
  });
  replay.events.push({ t: state.tick, spawns });
  console.log(`[coc] ${player.id} fields team ${player.team} ${player.archetype}: soldiers ${player.soldierIds.join(",")}`);
}

function beginCountdown(): void {
  if (phase !== "lobby") return;
  phase = "starting";
  countdown = COUNTDOWN_S;
  countdownTimer = setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) {
      clearInterval(countdownTimer!);
      countdownTimer = null;
      startMatch();
    } else {
      lobbyBroadcast();
    }
  }, 1000);
  console.log(`[coc] all ready — starting in ${COUNTDOWN_S}s`);
}

function cancelCountdown(): void {
  if (phase !== "starting") return;
  phase = "lobby";
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  console.log("[coc] start cancelled");
}

function startMatch(): void {
  phase = "live";
  lastResult = null;
  state.deploy = DEPLOY; // default 15s: give initial orders, nothing moves
  for (const p of players.values()) spawnSquad(p); // join order = deterministic spawn order
  for (const p of players.values()) {
    if (p.ws) send(p.ws, { t: "start", yourSoldierIds: p.soldierIds });
  }
  lobbyBroadcast();
  console.log(`[coc] match live: ${players.size} players`);
}

/** Save the replay, rebuild the world, and drop everyone back into the lobby. */
function endMatch(why: string, result: MatchResult | null = null): void {
  lastResult = result;
  saveReplay();
  console.log(`[coc] match ended ${why} — replay saved to ${replayFile}, back to lobby`);
  seed = Date.now() >>> 0;
  state = createState(seed, ACTIVE_MAP);
  pendingOrders.length = 0;
  pendingShots = [];
  pendingBooms = [];
  nextAnchor[0] = 0;
  nextAnchor[1] = 0;
  replay = newReplay();
  replayFile = `replays/match-${Date.now()}.json`;
  phase = "lobby";
  countdown = 0;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  for (const p of players.values()) {
    p.soldierIds = [];
    p.ready = p.bot; // bots stay ready; humans re-ready
    if (p.bot) p.botMem = createBotMemory();
    // humans who closed their tab mid-match have nothing to reclaim now
    if (!p.bot && !p.ws) {
      if (p.reapTimer) clearTimeout(p.reapTimer);
      players.delete(p.token);
    }
  }
  lobbyBroadcast();
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

function lobbyBroadcast(): void {
  const roster = [...players.values()].map((p) => ({
    id: p.id, name: p.name, team: p.team, archetype: p.archetype,
    ready: p.ready, connected: p.bot || p.ws !== null,
    bot: p.bot || undefined, personality: p.personality,
  }));
  for (const p of players.values()) {
    if (!p.ws) continue;
    send(p.ws, {
      t: "lobby", phase, yourId: p.id, players: roster,
      countdown: phase === "starting" ? countdown : undefined,
      options: { ...options },
      result: lastResult ?? undefined,
    });
  }
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
    if (phase !== "live") continue; // sim starts with the match
    const orders = pendingOrders.splice(0);
    if (orders.length > 0) replay.events.push({ t: state.tick, orders });
    const ev = tick(state, orders);
    pendingShots.push(...ev.shots);
    pendingBooms.push(...ev.booms);
    // win conditions (once deployed, both sides fielded)
    if (checkVictory()) break;
    // bots think once a second (staggered), queueing orders for the next
    // tick exactly like a player would — replays record them identically
    for (const p of players.values()) {
      if (!p.bot || p.soldierIds.length === 0) continue;
      if ((state.tick + (p.botIdx ?? 0) * 7) % 30 !== 0) continue;
      pendingOrders.push(...botThink(state, p.team, p.soldierIds, p.personality!, p.botMem!));
    }
    if (state.tick % 3 === 0) broadcast(); // snapshots at 10Hz for M1/M2
  }
}, 4);

/** Wipe / VP-target / round-clock win checks. Returns true when the round ended. */
function checkVictory(): boolean {
  if (phase !== "live" || state.deploy > 0) return false;
  const [a, b] = state.vp;
  const spawned: [number, number] = [0, 0];
  const up: [number, number] = [0, 0];
  for (const s of state.soldiers) {
    spawned[s.team] += 1;
    if (s.alive && !s.down) up[s.team] += 1;
  }
  if (spawned[0] > 0 && spawned[1] > 0) {
    if (up[0] === 0 || up[1] === 0) {
      const winner = up[0] === 0 && up[1] === 0 ? -1 : up[0] === 0 ? 1 : 0;
      endMatch("— side wiped", { winner, reason: "wipe", vp: [a, b] });
      return true;
    }
  }
  if (options.vpTarget > 0 && (a >= options.vpTarget || b >= options.vpTarget)) {
    const winner = a >= options.vpTarget && b >= options.vpTarget ? (a > b ? 0 : b > a ? 1 : -1) : a >= options.vpTarget ? 0 : 1;
    endMatch("— VP target reached", { winner, reason: "vp", vp: [a, b] });
    return true;
  }
  if (options.timeLimitMin > 0 && state.tick - DEPLOY >= options.timeLimitMin * 1800) {
    endMatch("— time expired", { winner: a > b ? 0 : b > a ? 1 : -1, reason: "time", vp: [a, b] });
    return true;
  }
  return false;
}

/** Fog rule: own team always; enemy soldiers only while some living ally sees them. */
function visibleTo(team: 0 | 1): Soldier[] {
  return state.soldiers.filter((s) => {
    if (s.team === team) return true;
    return state.soldiers.some(
      (a) => a.team === team && a.alive && losBetween(state.obstacles, a, s, state.smokes).visible,
    );
  });
}

function timeLeft(): number {
  if (options.timeLimitMin <= 0) return -1;
  return Math.max(0, options.timeLimitMin * 1800 - Math.max(0, state.tick - DEPLOY));
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
    0: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(0), shots, booms, grenades, smokes, zones: state.zones, vp: state.vp, deploy: state.deploy, timeLeft: timeLeft(), vpTarget: options.vpTarget } satisfies ServerMsg),
    1: JSON.stringify({ t: "snapshot", tick: state.tick, hash, soldiers: visibleTo(1), shots, booms, grenades, smokes, zones: state.zones, vp: state.vp, deploy: state.deploy, timeLeft: timeLeft(), vpTarget: options.vpTarget } satisfies ServerMsg),
  };
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(byTeam[p.team]);
  }
}
