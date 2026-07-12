import { useEffect, useRef, useState } from "react";
import type { SoldierSnapshot } from "@coc/protocol";
import { ACTIVE_MAP, computeShotPct, dist, WEAPONS, type GrenadeKind, type Stance } from "@coc/sim";
import { ARCHETYPE_KITS, GAME_NAME, type PlayableArchetype } from "@coc/shared";
import type { BotPersonality } from "@coc/sim";
import {
  connectOnline, createOffline,
  type Connection, type LobbyData, type OfflineScenario, type SnapshotData,
} from "./game/net.js";
import { createScene, type SceneApi } from "./game/scene.js";

interface Hover { id: number; x: number; y: number; }
type Phase = "boot" | "menu" | "lobby" | "game";

function storedName(): string {
  return localStorage.getItem("coc-name") ?? `Player-${Math.floor(Math.random() * 900 + 100)}`;
}

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connRef = useRef<Connection | null>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [scenario, setScenario] = useState<OfflineScenario | null>(null);
  const [snap, setSnap] = useState<SnapshotData | null>(null);
  const [archetype, setArchetype] = useState<PlayableArchetype>(
    (localStorage.getItem("coc-archetype") as PlayableArchetype | null) ?? "infantry",
  );
  const [name, setName] = useState<string>(storedName());
  const [myIds, setMyIds] = useState<number[]>([]);
  const myIdsRef = useRef<number[]>([]);
  myIdsRef.current = myIds;
  const [selected, setSelected] = useState<number[]>([]);
  const [armed, setArmed] = useState<GrenadeKind | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const selectedRef = useRef<number[]>([]);
  selectedRef.current = selected;
  const armedRef = useRef<GrenadeKind | null>(null);
  armedRef.current = armed;
  const snapRef = useRef<SnapshotData | null>(null);
  snapRef.current = snap;
  /** last time each of my soldiers took incoming fire (I-004 readability) */
  const underFireRef = useRef<Map<number, number>>(new Map());

  // --- boot: try the match server; fall back to the offline menu -------------
  useEffect(() => {
    localStorage.setItem("coc-name", name);
    let alive = true;
    void connectOnline(name).then((conn) => {
      if (!alive) { conn?.close(); return; }
      if (!conn) { setPhase("menu"); return; }
      connRef.current = conn;
      conn.onLobby((l) => {
        setLobby(l);
        // a live match was ended: server dropped everyone back to the lobby
        if (l.phase === "lobby") {
          setSnap(null);
          setMyIds([]);
          setSelected([]);
          setArmed(null);
          setPhase((ph) => (ph === "game" ? "lobby" : ph));
        }
      });
      conn.onStart((ids) => {
        setMyIds([...ids]);
        setSelected(ids.slice(0, 1));
        setPhase("game");
      });
      if (conn.mySoldierIds.length > 0) {
        // reclaim or late join: the match is already live
        setMyIds([...conn.mySoldierIds]);
        setSelected(conn.mySoldierIds.slice(0, 1));
        setPhase("game");
      } else {
        setPhase("lobby");
      }
    });
    return () => { alive = false; connRef.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function leaveOffline(): void {
    connRef.current?.close();
    connRef.current = null;
    setScenario(null);
    setSnap(null);
    setMyIds([]);
    setSelected([]);
    setArmed(null);
    setPhase("menu");
  }

  function enterOffline(s: OfflineScenario): void {
    const conn = createOffline(archetype, s);
    connRef.current = conn;
    setScenario(s);
    setMyIds([...conn.mySoldierIds]);
    setSelected(conn.mySoldierIds.slice(0, 1));
    setPhase("game");
  }

  // --- game: scene + input wiring --------------------------------------------
  useEffect(() => {
    if (phase !== "game") return;
    const conn = connRef.current;
    if (!conn || !canvasRef.current) return;
    const scene = createScene(canvasRef.current);
    sceneRef.current = scene;

    const aliveSelected = (): SoldierSnapshot[] => {
      const byId = new Map((snapRef.current?.soldiers ?? []).map((s) => [s.id, s]));
      return selectedRef.current
        .map((id) => byId.get(id))
        .filter((s): s is SoldierSnapshot => !!s && s.alive && !s.down);
    };

    conn.onSnapshot((data) => {
      for (const sh of data.shots) {
        if (conn.mySoldierIds.includes(sh.target)) underFireRef.current.set(sh.target, Date.now());
      }
      setSnap(data);
      scene.updateSoldiers(data.soldiers, conn.mySoldierIds, selectedRef.current);
      scene.updateEffects({ grenades: data.grenades, smokes: data.smokes, booms: data.booms, tick: data.tick });
      scene.updateZones(data.zones);
      if (data.shots.length > 0) scene.addShotEvents(data.shots);
    });
    scene.onSoldierClick((id) => {
      setArmed(null);
      setSelected([id]);
    });
    scene.onGroundClick((x, y, shift) => {
      // right-click ground: move orders for all selected, formation-offset from centroid
      const sel = aliveSelected();
      if (sel.length === 0) return;
      const cx = Math.round(sel.reduce((a, s) => a + s.x, 0) / sel.length);
      const cy = Math.round(sel.reduce((a, s) => a + s.y, 0) / sel.length);
      conn.sendOrders(sel.map((s) => ({
        type: "move" as const,
        soldierId: s.id,
        x: x + (sel.length > 1 ? s.x - cx : 0),
        y: y + (sel.length > 1 ? s.y - cy : 0),
        queue: shift || undefined,
      })));
    });
    scene.onGroundLeftClick((x, y) => {
      const kind = armedRef.current;
      if (!kind) return;
      // multi-select throw doctrine: closest-to-target throws, but a
      // selected grenadier whose GL validly reaches the point takes over
      const canThrow = aliveSelected().filter(
        (s) => (kind === "frag" ? s.frags : s.smokes) > 0 && s.vaultT === 0,
      );
      const glValid = canThrow.filter(
        (s) => s.weapon === "carbine_gl" && dist(s.x, s.y, x, y) <= 45000,
      );
      const pool = glValid.length > 0 ? glValid : canThrow;
      const thrower = pool.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0];
      if (thrower) conn.sendOrders([{ type: "throw", soldierId: thrower.id, kind, x, y }]);
      setArmed(null);
    });
    scene.onAttack((targetId) => {
      setArmed(null);
      const sel = aliveSelected();
      conn.sendOrders(sel.map((s) => ({ type: "target" as const, soldierId: s.id, targetId })));
    });
    scene.onHover((id, x, y) => setHover(id === null ? null : { id, x, y }));
    scene.onMarquee((ids) => {
      setArmed(null);
      setSelected(ids);
    });
    scene.onAid((allyId) => {
      const sel = aliveSelected().filter((x) => x.id !== allyId && !x.down);
      const medic = sel[0];
      if (medic) conn.sendOrders([{ type: "aid", soldierId: medic.id, targetId: allyId }]);
    });

    const onKey = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      // shift+1-4: reassign the selected soldier's hotkey slot (swap)
      if (e.shiftKey) {
        const di = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
        if (di >= 0 && selectedRef.current.length === 1) {
          const sid = selectedRef.current[0]!;
          setMyIds((ids) => {
            const cur = ids.indexOf(sid);
            if (cur < 0 || di >= ids.length || cur === di) return ids;
            const next = [...ids];
            [next[cur], next[di]] = [next[di]!, next[cur]!];
            return next;
          });
          return;
        }
      }
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        const id = myIdsRef.current[idx];
        if (id !== undefined) setSelected([id]);
        return;
      }
      if (e.key === "`") { // select the whole squad
        setSelected([...myIdsRef.current]);
        return;
      }
      if (e.key === "Escape") {
        setArmed(null);
        return;
      }
      const sel = aliveSelected();
      if (sel.length === 0) return;
      if (key === "f") { // sprint toggle
        const allSprint = sel.every((s) => s.moveMode === "sprint");
        conn.sendOrders(sel.map((s) => ({ type: "mode" as const, soldierId: s.id, mode: allSprint ? "move" as const : "sprint" as const })));
        return;
      }
      if (key === "t") { // hold fire <-> fire at will
        const allHold = sel.every((x) => x.holdFire);
        conn.sendOrders(sel.map((x) => ({ type: "firemode" as const, soldierId: x.id, hold: !allHold })));
        return;
      }
      if (key === "q") { setArmed((a) => (a === "frag" ? null : "frag")); return; }
      if (key === "e") { setArmed((a) => (a === "smoke" ? null : "smoke")); return; }
      const stance: Stance | null =
        key === "z" ? "stand" : key === "x" ? "crouch" : key === "c" ? "prone" : null;
      if (stance) {
        conn.sendOrders(sel.map((s) => ({ type: "stance" as const, soldierId: s.id, stance })));
        return;
      }
      if (key === "h") conn.sendOrders(sel.map((s) => ({ type: "halt" as const, soldierId: s.id })));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    sceneRef.current?.setCursor(armed ? "cell" : null);
  }, [armed]);

  // --- screens ----------------------------------------------------------------
  if (phase === "boot") {
    return <Shell><div style={{ opacity: 0.6, fontSize: 13 }}>connecting…</div></Shell>;
  }

  if (phase === "menu") {
    return (
      <Shell>
        <div style={{ opacity: 0.6, fontSize: 13 }}>No match server found — offline modes</div>
        <ArchetypePicker archetype={archetype} onPick={(a) => {
          localStorage.setItem("coc-archetype", a);
          setArchetype(a);
        }} />
        <div style={{ display: "flex", gap: 12 }}>
          <MenuButton label="PRACTICE SKIRMISH" hint="fight a fireteam across the courtyard" onClick={() => enterOffline("skirmish")} />
          <MenuButton label="BOOTCAMP" hint="learn the controls step by step" onClick={() => enterOffline("bootcamp")} />
        </div>
        <div style={{ opacity: 0.4, fontSize: 11 }}>start the server (`pnpm dev:server`) and reload for multiplayer</div>
      </Shell>
    );
  }

  if (phase === "lobby") {
    return (
      <LobbyScreen
        lobby={lobby}
        name={name}
        archetype={archetype}
        onName={(n) => {
          setName(n);
          localStorage.setItem("coc-name", n);
          connRef.current?.sendLobby({ name: n });
        }}
        onArchetype={(a) => {
          localStorage.setItem("coc-archetype", a);
          setArchetype(a);
          connRef.current?.sendLobby({ archetype: a });
        }}
        onTeam={(t) => connRef.current?.sendLobby({ team: t })}
        onReady={(r) => connRef.current?.sendLobby({ ready: r })}
        onStart={() => connRef.current?.sendLobby({ start: true })}
        onAddBot={(team, personality) => connRef.current?.sendLobby({ addBot: { team, personality } })}
        onRemoveBot={(id) => connRef.current?.sendLobby({ removeBot: id })}
      />
    );
  }

  // --- game HUD -----------------------------------------------------------------
  const soldiers = snap?.soldiers ?? [];
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const mySoldiers = myIds.map((id) => byId.get(id)).filter((s): s is SoldierSnapshot => !!s);
  const selSet = new Set(selected);
  const shooters = selected
    .map((id) => byId.get(id))
    .filter((s): s is SoldierSnapshot => !!s && s.alive);
  const hoverTarget = hover ? byId.get(hover.id) : undefined;
  const mode = connRef.current?.mode ?? "offline";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {/* top bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, display: "flex",
        justifyContent: "space-between", padding: "10px 16px", pointerEvents: "none",
        fontFamily: "system-ui, sans-serif", color: "#dfe7ee",
      }}>
        <div style={{ fontWeight: 700, letterSpacing: 2, fontSize: 14 }}>
          {GAME_NAME.toUpperCase()} <span style={{ opacity: 0.45 }}>M2.1</span>
        </div>
        {snap && snap.zones.length > 0 && (
          <div style={{ display: "flex", gap: 10, alignSelf: "center", fontSize: 14, fontWeight: 800 }}>
            <span style={{ color: "#4da3ff" }}>{snap.vp[0]}</span>
            <span style={{ opacity: 0.4, fontWeight: 400, fontSize: 11, alignSelf: "center" }}>
              VP · {snap.zones.filter((z) => z.owner === 0).length}/{snap.zones.filter((z) => z.owner === 1).length} flags
            </span>
            <span style={{ color: "#ff9e4d" }}>{snap.vp[1]}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignSelf: "center" }}>
          {armed && (
            <div style={{
              fontSize: 12, padding: "2px 10px", borderRadius: 4,
              background: armed === "frag" ? "#3a1d12" : "#1d2a3a",
              color: armed === "frag" ? "#e6935a" : "#7db8e6", fontWeight: 700,
            }}>
              {armed.toUpperCase()} ARMED — click target · Esc cancels
            </div>
          )}
          <div style={{
            fontSize: 12, padding: "2px 10px", borderRadius: 4,
            background: mode === "online" ? "#12351f" : "#3a2d12",
            color: mode === "online" ? "#5fd68a" : "#e6b45a",
          }}>
            {mode === "online" ? "ONLINE" : scenario === "bootcamp" ? "BOOTCAMP" : "OFFLINE SIM"}
          </div>
          {mode === "online" ? (
            <button
              onClick={() => {
                if (window.confirm("End the round for everyone and return to the lobby?")) {
                  connRef.current?.sendLobby({ endMatch: true });
                }
              }}
              style={{
                pointerEvents: "auto", fontSize: 12, padding: "2px 10px", borderRadius: 4,
                background: "#3a1d12", color: "#e6935a", border: "1px solid #5a2d1a",
                cursor: "pointer", fontWeight: 700,
              }}
            >
              END ROUND
            </button>
          ) : (
            <button
              onClick={leaveOffline}
              style={{
                pointerEvents: "auto", fontSize: 12, padding: "2px 10px", borderRadius: 4,
                background: "#1d2a3a", color: "#7db8e6", border: "1px solid #2a3a4a",
                cursor: "pointer", fontWeight: 700,
              }}
            >
              MENU
            </button>
          )}
        </div>
      </div>

      {/* deploy countdown */}
      {snap && snap.deploy > 0 && (
        <div style={{
          position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)",
          background: "#0d1218ee", border: "1px solid #e6b45a", borderRadius: 10,
          padding: "12px 22px", fontFamily: "system-ui, sans-serif", color: "#dfe7ee",
          textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 800, fontSize: 22, color: "#e6b45a", letterSpacing: 2 }}>
            DEPLOY — {Math.ceil(snap.deploy / 30)}
          </div>
          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, lineHeight: 1.6 }}>
            give your opening orders — nothing moves until the countdown ends<br />
            select a soldier + shift+1–4 to reassign hotkeys
          </div>
        </div>
      )}

      {/* bootcamp overlay */}
      {scenario === "bootcamp" && <Bootcamp snap={snap} myIds={myIds} />}

      {/* hover shot % — one row per selected shooter */}
      {hoverTarget && shooters.length > 0 && hover && (
        <div style={{
          position: "fixed", left: hover.x + 18, top: hover.y - 10, zIndex: 10,
          background: "#0d1218ee", border: "1px solid #2a3138", borderRadius: 8,
          padding: "8px 12px", fontFamily: "system-ui, sans-serif", color: "#dfe7ee",
          pointerEvents: "none", minWidth: 140,
        }}>
          {shooters.map((sh) => {
            const shot = computeShotPct(ACTIVE_MAP.obstacles, sh, hoverTarget, snap?.smokes ?? []);
            const label = !shot.visible ? "NO LOS" : !shot.inRange ? "RANGE" : shot.settling ? "SETTLING…" : shot.vaulting ? "VAULTING" : shot.moving ? "MOVING" : `${shot.pct}%`;
            const color = !shot.visible || !shot.inRange ? "#8b98a5" : shot.settling || shot.vaulting || shot.moving ? "#e6b45a"
              : shot.pct >= 60 ? "#5fd68a" : shot.pct >= 30 ? "#e6b45a" : "#e66a5a";
            return (
              <div key={sh.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, lineHeight: 1.8 }}>
                <span style={{ opacity: 0.6 }}>{WEAPONS[sh.weapon].name} #{sh.id}</span>
                <span style={{ color, fontWeight: 800 }}>{label}</span>
              </div>
            );
          })}
          {shooters.length === 1 && (() => {
            const shot = computeShotPct(ACTIVE_MAP.obstacles, shooters[0]!, hoverTarget, snap?.smokes ?? []);
            if (!shot.visible || !shot.inRange || shot.settling || shot.vaulting || shot.moving) return null;
            return (
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4, lineHeight: 1.6 }}>
                <div>base ({WEAPONS[shooters[0]!.weapon].name.toLowerCase()} @ range): {shot.base}%</div>
                {shot.factors.map((f) => (
                  <div key={f.label}>{f.label}: ×{(f.mult / 100).toFixed(2)}</div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* soldier cards */}
      <div style={{
        position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 8, fontFamily: "system-ui, sans-serif",
      }}>
        {mySoldiers.map((s, i) => {
          const underFire = s.alive && !s.down &&
            Date.now() - (underFireRef.current.get(s.id) ?? 0) < 2000;
          return (
          <button
            key={s.id}
            onClick={() => s.alive && setSelected([s.id])}
            style={{
              width: 148, padding: "8px 10px", borderRadius: 8,
              cursor: s.alive ? "pointer" : "default",
              textAlign: "left", color: "#dfe7ee",
              background: !s.alive ? "#191214e6" : selSet.has(s.id) ? "#1d2a3a" : "#141a21e6",
              border: underFire ? "1px solid #e64a3a" : selSet.has(s.id) && s.alive ? "1px solid #4da3ff" : "1px solid #2a3138",
              opacity: s.alive ? 1 : 0.6,
              boxShadow: underFire ? "0 0 10px #e64a3a88" : undefined,
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.75, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ opacity: 0.8 }}>
                [{i + 1}] {WEAPONS[s.weapon].name.toUpperCase()}
                {s.alive && s.pips > 0 && (
                  <span style={{ color: "#ffd27d", letterSpacing: -1 }} title={`veteran: +${s.pips * 4}% accuracy (${s.pips} kill${s.pips > 1 ? "s" : ""})`}>
                    {" "}{"▲".repeat(s.pips)}
                  </span>
                )}
                {s.alive && s.holdFire && <span style={{ color: "#e6b45a", fontWeight: 700 }}> HOLD</span>}
                {s.alive && s.revived && <span style={{ color: "#e66a5a", fontWeight: 700 }} title="already revived — next down is fatal"> ✚</span>}
              </span>
              {!s.alive ? <span style={{ color: "#e66a5a", fontWeight: 700 }}>KIA</span>
                : s.down ? <span style={{ color: "#e6b45a", fontWeight: 700 }}>DOWN</span>
                : underFire ? <span style={{ color: "#ff5544", fontWeight: 800, fontSize: 10 }}>⚠ UNDER FIRE</span>
                : <StanceIcon stance={s.stance} />}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {s.down
                ? <>BLD <Bar value={Math.round((s.bleed / 1800) * 100)} color="#e6b45a" /></>
                : <>HP <Bar value={s.hp} color="#5fd68a" /></>}
            </div>
            <div style={{ fontSize: 12 }}>
              SUP <Bar value={s.suppression} color="#e66a5a" />
            </div>
            <AimLine s={s} byId={byId} smokes={snap?.smokes ?? []} />
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, display: "flex", justifyContent: "space-between" }}>
              <span>
                {!s.alive ? "—"
                  : s.down ? "bleeding out — right-click with an ally to revive"
                  : s.aidId !== null ? `aiding #${s.aidId} (${Math.round((s.aidProgress / 150) * 100)}%)`
                  : s.vaultT > 0 ? "vaulting…"
                  : `${s.moveMode}${s.tx !== null ? " · moving" : ""}${s.suppression > 70 ? " · PINNED" : ""}`}
              </span>
              {s.alive && <span style={{ opacity: 0.9 }}>Q×{s.frags} E×{s.smokes}</span>}
            </div>
          </button>
          );
        })}
      </div>

      {/* help */}
      <div style={{
        position: "absolute", bottom: 12, left: 12, fontSize: 11, color: "#8b98a5",
        fontFamily: "system-ui, sans-serif", lineHeight: 1.7,
      }}>
        left-click: select · drag: box select · right-click: move / fire / revive ally · shift+right-click: queue<br />
        `: select squad · 1–4: soldier · shift+1–4: reassign hotkey · F: sprint · T: hold fire · Q/E: frag/smoke · Z/X/C: stance · H: halt<br />
        WASD: pan · wheel: zoom · middle-drag: rotate
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// screens & widgets
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", height: "100%",
      fontFamily: "system-ui, sans-serif", color: "#dfe7ee", flexDirection: "column", gap: 24,
    }}>
      <div style={{ fontWeight: 800, letterSpacing: 3, fontSize: 22 }}>{GAME_NAME.toUpperCase()}</div>
      {children}
    </div>
  );
}

function MenuButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }): JSX.Element {
  return (
    <button onClick={onClick} style={{
      width: 220, padding: "16px 14px", borderRadius: 10, cursor: "pointer",
      background: "#141a21", border: "1px solid #2a3138", color: "#dfe7ee", textAlign: "left",
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 11, opacity: 0.65 }}>{hint}</div>
    </button>
  );
}

function ArchetypePicker({ archetype, onPick }: {
  archetype: PlayableArchetype;
  onPick: (a: PlayableArchetype) => void;
}): JSX.Element {
  return (
    <div style={{ display: "flex", gap: 14 }}>
      {(Object.keys(ARCHETYPE_KITS) as PlayableArchetype[]).map((a) => (
        <button
          key={a}
          onClick={() => onPick(a)}
          style={{
            width: 180, padding: "16px 14px", borderRadius: 10, cursor: "pointer",
            background: a === archetype ? "#1d2a3a" : "#141a21",
            border: a === archetype ? "1px solid #4da3ff" : "1px solid #2a3138",
            color: "#dfe7ee", textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, textTransform: "capitalize" }}>{a}</div>
          <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.8 }}>
            {ARCHETYPE_KITS[a].map((k, i) => (
              <div key={i}>{k.weapon.toUpperCase().replace("_GL", " (GL)")} · {k.frags}F {k.smokes}S</div>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function LobbyScreen({ lobby, name, archetype, onName, onArchetype, onTeam, onReady, onStart, onAddBot, onRemoveBot }: {
  lobby: LobbyData | null;
  name: string;
  archetype: PlayableArchetype;
  onName: (n: string) => void;
  onArchetype: (a: PlayableArchetype) => void;
  onTeam: (t: 0 | 1) => void;
  onReady: (r: boolean) => void;
  onStart: () => void;
  onAddBot: (team: 0 | 1, personality: BotPersonality) => void;
  onRemoveBot: (id: string) => void;
}): JSX.Element {
  const me = lobby?.players.find((p) => p.id === lobby.yourId);
  const allReady = (lobby?.players.length ?? 0) > 0 && (lobby?.players.every((p) => p.ready) ?? false);
  const teamNames = ["BLUE", "ORANGE"] as const;
  const teamColors = ["#4da3ff", "#ff9e4d"] as const;
  return (
    <Shell>
      {lobby?.phase === "starting" && (
        <div style={{ fontSize: 40, fontWeight: 800, color: "#5fd68a" }}>
          {lobby.countdown ?? 0}
        </div>
      )}
      <div style={{ opacity: 0.6, fontSize: 13 }}>
        LOBBY — pick a side, choose your fireteam, ready up
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span style={{ opacity: 0.6 }}>callsign</span>
        <input
          value={name}
          maxLength={24}
          onChange={(e) => e.target.value.trim().length > 0 && onName(e.target.value)}
          style={{
            background: "#141a21", border: "1px solid #2a3138", borderRadius: 6,
            color: "#dfe7ee", padding: "6px 10px", fontSize: 13, width: 160,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        {([0, 1] as const).map((t) => (
          <div key={t} style={{ width: 240 }}>
            <button
              onClick={() => onTeam(t)}
              style={{
                width: "100%", padding: "8px 0", marginBottom: 8, borderRadius: 8, cursor: "pointer",
                background: me?.team === t ? "#1d2a3a" : "#141a21",
                border: `1px solid ${me?.team === t ? teamColors[t] : "#2a3138"}`,
                color: teamColors[t], fontWeight: 800, letterSpacing: 2,
              }}
            >
              {teamNames[t]}{me?.team !== t ? " — join" : ""}
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
              {(lobby?.players ?? []).filter((p) => p.team === t).map((p) => (
                <div key={p.id} style={{
                  display: "flex", justifyContent: "space-between", padding: "8px 10px",
                  background: "#141a21", borderRadius: 8, fontSize: 12,
                  border: p.id === lobby?.yourId ? `1px solid ${teamColors[t]}55` : "1px solid #2a3138",
                  opacity: p.connected ? 1 : 0.45,
                }}>
                  <span>
                    {p.bot ? "🤖 " : ""}{p.name}{p.id === lobby?.yourId ? " (you)" : ""}
                    <span style={{ opacity: 0.5 }}> · {p.bot ? `${p.personality} · ` : ""}{p.archetype}</span>
                  </span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: p.ready ? "#5fd68a" : "#8b98a5", fontWeight: 700 }}>
                      {p.ready ? "READY" : "…"}
                    </span>
                    {p.bot && (
                      <button
                        onClick={() => onRemoveBot(p.id)}
                        title="remove bot"
                        style={{
                          background: "none", border: "none", color: "#e66a5a",
                          cursor: "pointer", fontWeight: 800, fontSize: 12, padding: 0,
                        }}
                      >✕</button>
                    )}
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 4 }}>
                {(["vp", "hunter", "balanced"] as BotPersonality[]).map((pers) => (
                  <button
                    key={pers}
                    onClick={() => onAddBot(t, pers)}
                    title={
                      pers === "vp" ? "bot that prioritizes capturing victory points"
                      : pers === "hunter" ? "bot that hunts the enemy team"
                      : "bot that balances objectives and hunting"
                    }
                    style={{
                      flex: 1, padding: "5px 0", borderRadius: 6, cursor: "pointer", fontSize: 10,
                      background: "#10151b", border: "1px dashed #2a3138", color: "#8b98a5",
                    }}
                  >
                    +🤖 {pers}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <ArchetypePicker archetype={archetype} onPick={onArchetype} />
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={() => onReady(!(me?.ready ?? false))}
          style={{
            padding: "12px 34px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 15,
            background: me?.ready ? "#12351f" : "#141a21",
            border: me?.ready ? "1px solid #5fd68a" : "1px solid #2a3138",
            color: me?.ready ? "#5fd68a" : "#dfe7ee",
          }}
        >
          {me?.ready ? "READY ✓" : "READY UP"}
        </button>
        {allReady && lobby?.phase === "lobby" && (
          <button
            onClick={onStart}
            style={{
              padding: "12px 34px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 15,
              background: "#1d2a3a", border: "1px solid #4da3ff", color: "#4da3ff",
            }}
          >
            START MATCH
          </button>
        )}
      </div>
      <div style={{ opacity: 0.4, fontSize: 11 }}>
        auto-starts when both sides are manned and everyone is ready · START forces it (solo testing)
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// bootcamp — step-gated tutorial over the offline sim
// ---------------------------------------------------------------------------

const BOOTCAMP_STEPS = [
  { title: "MOVE OUT", body: "Right-click the ground to move. Drag a box or press ` to grab the whole fireteam, then move them up the road." },
  { title: "STANCES", body: "Z stand · X crouch · C prone. Prone is slow but hard to hit — and invisible behind low cover. Put someone prone." },
  { title: "SPRINT", body: "F toggles sprint: fast, loud, and terrible for your aim. Sprint a soldier forward." },
  { title: "VAULT", body: "Thin low walls can be climbed: order a move across the courtyard wall and your soldier vaults it (1s, exposed — pick your moment)." },
  { title: "CONTACT", body: "An enemy stands near the well. Hover him: shot % changes with range, stance, cover. Right-click to engage and take him out." },
  { title: "FRAG OUT", body: "A second enemy is crouched behind the north wall. Q arms a frag — click to throw it over the wall (watch the deviation)." },
  { title: "SMOKE", body: "E arms smoke. Screen a sightline with it — smoke genuinely blocks LOS on the server, not just visually." },
  { title: "BOOTCAMP COMPLETE", body: "That's the core loop: move, cover, %, grenades. Reload the page with the server running to fight real people. Good hunting." },
] as const;

function Bootcamp({ snap, myIds }: { snap: SnapshotData | null; myIds: number[] }): JSX.Element {
  const [step, setStep] = useState(0);
  const startPos = useRef<Map<number, [number, number]> | null>(null);
  const sawFrag = useRef(false);

  useEffect(() => {
    if (!snap) return;
    const mine = snap.soldiers.filter((s) => myIds.includes(s.id));
    if (!startPos.current) {
      startPos.current = new Map(mine.map((s) => [s.id, [s.x, s.y]]));
    }
    if (snap.grenades.some((g) => g.kind === "frag") || snap.booms.some((b) => b.kind === "frag")) {
      sawFrag.current = true;
    }
    const enemy = (id: number): SoldierSnapshot | undefined => snap.soldiers.find((s) => s.id === id);
    const done: boolean =
      step === 0 ? mine.some((s) => {
        const p = startPos.current!.get(s.id);
        return p && dist(s.x, s.y, p[0], p[1]) > 5000;
      })
      : step === 1 ? mine.some((s) => s.stance === "prone")
      : step === 2 ? mine.some((s) => s.moveMode === "sprint" && s.tx !== null)
      : step === 3 ? mine.some((s) => s.vaultT > 0)
      : step === 4 ? (enemy(4) ? !enemy(4)!.alive || enemy(4)!.down : true)
      : step === 5 ? sawFrag.current
      : step === 6 ? snap.smokes.length > 0
      : false;
    if (done) setStep((v) => Math.min(v + 1, BOOTCAMP_STEPS.length - 1));
  }, [snap, step, myIds]);

  const s = BOOTCAMP_STEPS[step]!;
  const last = step === BOOTCAMP_STEPS.length - 1;
  return (
    <div style={{
      position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)",
      width: 460, background: "#0d1218ee", border: `1px solid ${last ? "#5fd68a" : "#2a3138"}`,
      borderRadius: 10, padding: "12px 16px", fontFamily: "system-ui, sans-serif",
      color: "#dfe7ee", pointerEvents: "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 13, color: last ? "#5fd68a" : "#e6b45a", letterSpacing: 1 }}>
          {s.title}
        </span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{Math.min(step + 1, BOOTCAMP_STEPS.length - 1)}/{BOOTCAMP_STEPS.length - 1}</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>{s.body}</div>
    </div>
  );
}

function AimLine({ s, byId, smokes }: {
  s: SoldierSnapshot;
  byId: Map<number, SoldierSnapshot>;
  smokes: SnapshotData["smokes"];
}): JSX.Element {
  if (!s.alive) return <div style={{ fontSize: 10, height: 14 }} />;
  const target = s.aimId !== null ? byId.get(s.aimId) : undefined;
  if (target) {
    const shot = computeShotPct(ACTIVE_MAP.obstacles, s, target, smokes);
    const color = shot.pct >= 60 ? "#5fd68a" : shot.pct >= 30 ? "#e6b45a" : "#e66a5a";
    return (
      <div style={{ fontSize: 11, marginTop: 3, height: 14 }}>
        <span style={{ opacity: 0.55 }}>aim </span>
        {shot.settling
          ? <span style={{ color: "#e6b45a", fontWeight: 700 }}>settling…</span>
          : shot.moving
          ? <span style={{ color: "#e6b45a", fontWeight: 700 }} title="this weapon can't fire on the move">moving</span>
          : <span style={{ color, fontWeight: 800 }}>{shot.pct}%</span>}
        <span style={{ opacity: 0.55 }}> → {WEAPONS[target.weapon].name} #{target.id}</span>
      </div>
    );
  }
  if (s.targetId !== null) {
    return <div style={{ fontSize: 10, marginTop: 3, height: 14, color: "#e6b45a" }}>target held · no LOS</div>;
  }
  if (s.holdFire) {
    return <div style={{ fontSize: 10, marginTop: 3, height: 14, color: "#e6b45a" }}>holding fire</div>;
  }
  return <div style={{ fontSize: 10, marginTop: 3, height: 14, opacity: 0.35 }}>no target</div>;
}

function StanceIcon({ stance }: { stance: Stance }): JSX.Element {
  const c = "#9fb4c8";
  if (stance === "prone") {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" aria-label="prone">
        <circle cx="2.8" cy="10.5" r="2" fill={c} />
        <path d="M5.5 10.5 H15" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (stance === "crouch") {
    return (
      <svg width="16" height="14" viewBox="0 0 16 14" aria-label="crouch">
        <circle cx="10.5" cy="2.8" r="2" fill={c} />
        <path d="M10 5 L6.5 8.5 L9.5 12 M6.5 8.5 L3.5 12" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-label="standing">
      <circle cx="8" cy="2.5" r="2" fill={c} />
      <path d="M8 4.5 V9 M8 9 L5.8 13.5 M8 9 L10.2 13.5 M8 5.5 L5.5 8 M8 5.5 L10.5 8" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Bar({ value, color }: { value: number; color: string }): JSX.Element {
  return (
    <span style={{
      display: "inline-block", width: 70, height: 6, background: "#0b0e11",
      borderRadius: 3, verticalAlign: "middle", marginLeft: 4,
    }}>
      <span style={{
        display: "block", width: `${value}%`, height: "100%",
        background: color, borderRadius: 3,
      }} />
    </span>
  );
}
