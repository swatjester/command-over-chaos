/**
 * Connection layer. Tries the local match server (lobby flow); if
 * unreachable, the menu offers OFFLINE modes running the same @coc/sim
 * code — practice skirmish and the bootcamp tutorial.
 * Offline mode has no fog: you see both teams.
 */
import {
  ACTIVE_MAP, botThink, createBotMemory, createState, MM, spawnSoldier, tick,
  TICK_MS, type BotPersonality, type Order, type SimState, type WeaponId,
} from "@coc/sim";
import { ARCHETYPE_KITS, type PlayableArchetype } from "@coc/shared";
import {
  ServerMsgSchema, type Boom, type ClientMsg, type GrenadeSnapshot,
  type LobbyPlayer, type MatchOptions, type MatchResult, type ShotEvent,
  type SmokeSnapshot, type SoldierSnapshot, type ZoneSnapshot,
} from "@coc/protocol";

export interface SnapshotData {
  soldiers: SoldierSnapshot[];
  tick: number;
  shots: ShotEvent[];
  booms: Boom[];
  grenades: GrenadeSnapshot[];
  smokes: SmokeSnapshot[];
  zones: ZoneSnapshot[];
  vp: [number, number];
  /** pre-match deploy ticks remaining (0 = live) */
  deploy: number;
  /** ticks left on the round clock; -1 = no limit */
  timeLeft: number;
  /** VP total that ends the round; 0 = off */
  vpTarget: number;
}
export type SnapshotCb = (data: SnapshotData) => void;

export interface LobbyData {
  phase: "lobby" | "starting" | "live";
  yourId: string;
  countdown?: number;
  players: LobbyPlayer[];
  options: MatchOptions;
  result?: MatchResult;
}

export interface LobbyAction {
  team?: 0 | 1;
  archetype?: PlayableArchetype;
  ready?: boolean;
  name?: string;
  start?: boolean;
  addBot?: { team: 0 | 1; personality: BotPersonality; archetype?: PlayableArchetype };
  removeBot?: string;
  endMatch?: boolean;
  options?: MatchOptions;
}

export interface Connection {
  mode: "online" | "offline";
  /** your side (welcome msg; offline = 0) */
  team: 0 | 1;
  /** empty while in the lobby; filled by the welcome (reclaim/late join) or start message */
  mySoldierIds: number[];
  sendOrders(orders: Order[]): void;
  sendLobby(action: LobbyAction): void;
  onSnapshot(cb: SnapshotCb): void;
  onLobby(cb: (l: LobbyData) => void): void;
  onStart(cb: (ids: number[]) => void): void;
  close(): void;
}

// sessionStorage (not localStorage): per-tab, so each window is its own
// player, but survives F5 so refresh still reclaims the squad (I-001).
function sessionToken(): string {
  let t = sessionStorage.getItem("coc-token");
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem("coc-token", t);
  }
  return t;
}

/** Resolves null when no server is reachable — caller offers offline modes. */
export function connectOnline(
  name: string, url = "ws://localhost:8787",
): Promise<Connection | null> {
  return new Promise((resolve) => {
    let snapshotCb: SnapshotCb | null = null;
    let lobbyCb: ((l: LobbyData) => void) | null = null;
    let startCb: ((ids: number[]) => void) | null = null;
    let pendingLobby: LobbyData | null = null; // lobby msg can beat the cb registration
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); resolve(null); }, 1500);

    ws.onerror = () => { clearTimeout(timeout); resolve(null); };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "join", name, token: sessionToken() } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      const parsed = ServerMsgSchema.safeParse(JSON.parse(e.data as string));
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.t === "welcome") {
        clearTimeout(timeout);
        const conn: Connection = {
          mode: "online",
          team: msg.team,
          mySoldierIds: [...msg.yourSoldierIds],
          sendOrders: (orders) => {
            ws.send(JSON.stringify({ t: "orders", orders } satisfies ClientMsg));
          },
          sendLobby: (action) => {
            ws.send(JSON.stringify({ t: "lobby", ...action } satisfies ClientMsg));
          },
          onSnapshot: (cb) => { snapshotCb = cb; },
          onLobby: (cb) => {
            lobbyCb = cb;
            if (pendingLobby) { cb(pendingLobby); pendingLobby = null; }
          },
          onStart: (cb) => { startCb = cb; },
          close: () => ws.close(),
        };
        ws.onmessage = (ev) => {
          const p = ServerMsgSchema.safeParse(JSON.parse(ev.data as string));
          if (!p.success) return;
          const m = p.data;
          if (m.t === "snapshot") snapshotCb?.(m);
          else if (m.t === "lobby") {
            if (lobbyCb) lobbyCb(m);
            else pendingLobby = m;
          } else if (m.t === "start") {
            conn.mySoldierIds.length = 0;
            conn.mySoldierIds.push(...m.yourSoldierIds);
            startCb?.(m.yourSoldierIds);
          }
        };
        resolve(conn);
      }
    };
  });
}

export type OfflineScenario = "skirmish" | "bootcamp";

export function createOffline(
  archetype: PlayableArchetype, scenario: OfflineScenario = "skirmish",
): Connection {
  const state: SimState = createState(20260702, ACTIVE_MAP);
  const mine = ARCHETYPE_KITS[archetype];
  if (scenario === "bootcamp") {
    // your fireteam south of the courtyard; two hold-fire dummies to learn on
    for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (145 + i * 3) * MM, 170 * MM, mine[i]!.weapon as WeaponId, mine[i]!.frags, mine[i]!.smokes);
    spawnSoldier(state, 1, 151 * MM, 149 * MM, "carbine", 0, 0); // in the courtyard, near the well
    spawnSoldier(state, 1, 150 * MM, 143 * MM, "carbine", 0, 0); // behind the north courtyard wall
    state.soldiers[4]!.holdFire = true;
    state.soldiers[5]!.holdFire = true;
    state.soldiers[5]!.stance = "crouch";
  } else {
    const theirs = ARCHETYPE_KITS.rangers;
    // offline practice: a BALANCED bot squad fights you for the map
    for (let i = 0; i < 4; i++) spawnSoldier(state, 0, (145 + i * 3) * MM, 170 * MM, mine[i]!.weapon as WeaponId, mine[i]!.frags, mine[i]!.smokes);
    for (let i = 0; i < 4; i++) spawnSoldier(state, 1, (145 + i * 3) * MM, 130 * MM, theirs[i]!.weapon as WeaponId, theirs[i]!.frags, theirs[i]!.smokes);
  }
  let pending: Order[] = [];
  let snapshotCb: SnapshotCb | null = null;
  const botMem = createBotMemory();

  const interval = setInterval(() => {
    if (scenario === "skirmish" && state.tick % 30 === 0) {
      pending.push(...botThink(state, 1, [4, 5, 6, 7], "balanced", botMem));
    }
    const ev = tick(state, pending.splice(0));
    snapshotCb?.({
      soldiers: structuredClone(state.soldiers),
      tick: state.tick,
      shots: ev.shots,
      booms: ev.booms,
      grenades: structuredClone(state.grenades),
      smokes: structuredClone(state.smokes),
      zones: structuredClone(state.zones),
      vp: [state.vp[0], state.vp[1]],
      deploy: state.deploy,
      timeLeft: -1,
      vpTarget: 0,
    });
  }, TICK_MS);

  return {
    mode: "offline",
    team: 0,
    mySoldierIds: [0, 1, 2, 3],
    sendOrders: (orders) => pending.push(...orders),
    sendLobby: () => { /* no lobby offline */ },
    onSnapshot: (cb) => { snapshotCb = cb; },
    onLobby: () => { /* no lobby offline */ },
    onStart: () => { /* offline starts immediately */ },
    close: () => clearInterval(interval),
  };
}
