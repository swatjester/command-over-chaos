import { useEffect, useRef, useState } from "react";
import type { SoldierSnapshot } from "@coc/protocol";
import { ACTIVE_MAP, computeShotPct, WEAPONS, type GrenadeKind, type Stance } from "@coc/sim";
import { ARCHETYPE_KITS, GAME_NAME, type PlayableArchetype } from "@coc/shared";
import { dist } from "@coc/sim";
import { connect, type Connection, type SnapshotData } from "./game/net.js";
import { createScene, type SceneApi } from "./game/scene.js";

interface Hover { id: number; x: number; y: number; }

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connRef = useRef<Connection | null>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const [snap, setSnap] = useState<SnapshotData | null>(null);
  const [mode, setMode] = useState<"connecting" | "online" | "offline">("connecting");
  const [archetype, setArchetype] = useState<PlayableArchetype | null>(
    (localStorage.getItem("coc-archetype") as PlayableArchetype | null) ?? null,
  );
  const [myIds, setMyIds] = useState<number[]>([]);
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

  useEffect(() => {
    if (!archetype) return;
    const scene = createScene(canvasRef.current!);
    sceneRef.current = scene;
    let alive = true;

    const aliveSelected = (): SoldierSnapshot[] => {
      const byId = new Map((snapRef.current?.soldiers ?? []).map((s) => [s.id, s]));
      return selectedRef.current
        .map((id) => byId.get(id))
        .filter((s): s is SoldierSnapshot => !!s && s.alive && !s.down);
    };

    void connect(archetype).then((conn) => {
      if (!alive) { conn.close(); return; }
      connRef.current = conn;
      setMode(conn.mode);
      setMyIds(conn.mySoldierIds);
      setSelected(conn.mySoldierIds.slice(0, 1));
      conn.onSnapshot((data) => {
        for (const sh of data.shots) {
          if (conn.mySoldierIds.includes(sh.target)) underFireRef.current.set(sh.target, Date.now());
        }
        setSnap(data);
        scene.updateSoldiers(data.soldiers, conn.mySoldierIds, selectedRef.current);
        scene.updateEffects({ grenades: data.grenades, smokes: data.smokes, booms: data.booms, tick: data.tick });
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
    });

    const onKey = (e: KeyboardEvent): void => {
      const conn = connRef.current;
      if (!conn) return;
      const key = e.key.toLowerCase();
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        const id = conn.mySoldierIds[idx];
        if (id !== undefined) setSelected([id]);
        return;
      }
      if (e.key === "`") { // select the whole squad
        setSelected([...conn.mySoldierIds]);
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
      alive = false;
      window.removeEventListener("keydown", onKey);
      connRef.current?.close();
      scene.dispose();
    };
  }, [archetype]);

  useEffect(() => {
    sceneRef.current?.setCursor(armed ? "cell" : null);
  }, [armed]);

  const soldiers = snap?.soldiers ?? [];
  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const mySoldiers = myIds.map((id) => byId.get(id)).filter((s): s is SoldierSnapshot => !!s);
  const selSet = new Set(selected);
  const shooters = selected
    .map((id) => byId.get(id))
    .filter((s): s is SoldierSnapshot => !!s && s.alive);
  const hoverTarget = hover ? byId.get(hover.id) : undefined;

  if (!archetype) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", height: "100%",
        fontFamily: "system-ui, sans-serif", color: "#dfe7ee", flexDirection: "column", gap: 24,
      }}>
        <div style={{ fontWeight: 800, letterSpacing: 3, fontSize: 22 }}>{GAME_NAME.toUpperCase()}</div>
        <div style={{ opacity: 0.6, fontSize: 13 }}>Select your fireteam</div>
        <div style={{ display: "flex", gap: 14 }}>
          {(Object.keys(ARCHETYPE_KITS) as PlayableArchetype[]).map((a) => (
            <button
              key={a}
              onClick={() => {
                localStorage.setItem("coc-archetype", a);
                setArchetype(a);
              }}
              style={{
                width: 180, padding: "16px 14px", borderRadius: 10, cursor: "pointer",
                background: "#141a21", border: "1px solid #2a3138", color: "#dfe7ee", textAlign: "left",
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
        <div style={{ opacity: 0.4, fontSize: 11 }}>abilities & stats arrive with the full archetype system (M3)</div>
      </div>
    );
  }

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
            {mode === "connecting" ? "connecting…" : mode === "online" ? "ONLINE" : "OFFLINE SIM"}
          </div>
        </div>
      </div>

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
            const label = !shot.visible ? "NO LOS" : !shot.inRange ? "RANGE" : shot.settling ? "SETTLING…" : shot.vaulting ? "VAULTING" : `${shot.pct}%`;
            const color = !shot.visible || !shot.inRange ? "#8b98a5" : shot.settling || shot.vaulting ? "#e6b45a"
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
            if (!shot.visible || !shot.inRange || shot.settling) return null;
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
        `: select squad · 1–4: soldier · F: sprint · T: hold fire · Q/E: frag/smoke · Z/X/C: stance · H: halt<br />
        WASD: pan · wheel: zoom · middle-drag: rotate
      </div>
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
