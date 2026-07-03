import { useEffect, useRef, useState } from "react";
import type { SoldierSnapshot } from "@coc/protocol";
import { ACTIVE_MAP, computeShotPct, WEAPONS, type Stance } from "@coc/sim";
import { GAME_NAME } from "@coc/shared";
import { connect, type Connection } from "./game/net.js";
import { createScene, type SceneApi } from "./game/scene.js";

interface Hover { id: number; x: number; y: number; }

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connRef = useRef<Connection | null>(null);
  const [soldiers, setSoldiers] = useState<SoldierSnapshot[]>([]);
  const [mode, setMode] = useState<"connecting" | "online" | "offline">("connecting");
  const [myIds, setMyIds] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const scene: SceneApi = createScene(canvasRef.current!);
    let alive = true;

    void connect().then((conn) => {
      if (!alive) { conn.close(); return; }
      connRef.current = conn;
      setMode(conn.mode);
      setMyIds(conn.mySoldierIds);
      setSelected(conn.mySoldierIds[0] ?? null);
      conn.onSnapshot((snap, _tick, events) => {
        setSoldiers(snap);
        scene.updateSoldiers(snap, conn.mySoldierIds, selectedRef.current);
        if (events.length > 0) scene.addShotEvents(events);
      });
      scene.onSoldierClick((id) => setSelected(id));
      scene.onGroundClick((x, y) => {
        const id = selectedRef.current;
        if (id !== null) conn.sendOrders([{ type: "move", soldierId: id, x, y }]);
      });
      scene.onAttack((targetId) => {
        const id = selectedRef.current;
        if (id !== null) conn.sendOrders([{ type: "target", soldierId: id, targetId }]);
      });
      scene.onHover((id, x, y) => setHover(id === null ? null : { id, x, y }));
    });

    const onKey = (e: KeyboardEvent): void => {
      const conn = connRef.current;
      if (!conn) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        setSelected(conn.mySoldierIds[idx] ?? null);
        return;
      }
      const stance: Stance | null =
        e.key === "z" ? "stand" : e.key === "x" ? "crouch" : e.key === "c" ? "prone" : null;
      const id = selectedRef.current;
      if (stance && id !== null) conn.sendOrders([{ type: "stance", soldierId: id, stance }]);
      if (e.key === "h" && id !== null) conn.sendOrders([{ type: "halt", soldierId: id }]);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      connRef.current?.close();
      scene.dispose();
    };
  }, []);

  const byId = new Map(soldiers.map((s) => [s.id, s]));
  const mySoldiers = myIds.map((id) => byId.get(id)).filter((s): s is SoldierSnapshot => !!s);
  const shooter = selected !== null ? byId.get(selected) : undefined;
  const hoverTarget = hover ? byId.get(hover.id) : undefined;
  const shot = shooter?.alive && hoverTarget
    ? computeShotPct(ACTIVE_MAP.obstacles, shooter, hoverTarget)
    : null;

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
          {GAME_NAME.toUpperCase()} <span style={{ opacity: 0.45 }}>M1</span>
        </div>
        <div style={{
          fontSize: 12, padding: "2px 10px", borderRadius: 4, alignSelf: "center",
          background: mode === "online" ? "#12351f" : "#3a2d12",
          color: mode === "online" ? "#5fd68a" : "#e6b45a",
        }}>
          {mode === "connecting" ? "connecting…" : mode === "online" ? "ONLINE" : "OFFLINE SIM"}
        </div>
      </div>

      {/* shot % readout — the signature mechanic */}
      {shot && hover && (
        <div style={{
          position: "fixed", left: hover.x + 18, top: hover.y - 10, zIndex: 10,
          background: "#0d1218ee", border: "1px solid #2a3138", borderRadius: 8,
          padding: "8px 12px", fontFamily: "system-ui, sans-serif", color: "#dfe7ee",
          pointerEvents: "none", minWidth: 130,
        }}>
          <div style={{
            fontSize: 22, fontWeight: 800,
            color: !shot.visible ? "#8b98a5" : !shot.inRange ? "#8b98a5" : shot.settling ? "#e6b45a"
              : shot.pct >= 60 ? "#5fd68a" : shot.pct >= 30 ? "#e6b45a" : "#e66a5a",
          }}>
            {!shot.visible ? "NO LOS" : !shot.inRange ? "OUT OF RANGE" : shot.settling ? "SETTLING…" : `${shot.pct}%`}
          </div>
          {shot.settling && (
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>
              long range — hold still to steady aim
            </div>
          )}
          {shot.visible && shot.inRange && !shot.settling && (
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4, lineHeight: 1.6 }}>
              <div>base ({WEAPONS[shooter!.weapon].name.toLowerCase()} @ range): {shot.base}%</div>
              {shot.factors.map((f) => (
                <div key={f.label}>{f.label}: ×{(f.mult / 100).toFixed(2)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* soldier cards */}
      <div style={{
        position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 8, fontFamily: "system-ui, sans-serif",
      }}>
        {mySoldiers.map((s, i) => (
          <button
            key={s.id}
            onClick={() => s.alive && setSelected(s.id)}
            style={{
              width: 140, padding: "8px 10px", borderRadius: 8,
              cursor: s.alive ? "pointer" : "default",
              textAlign: "left", color: "#dfe7ee",
              background: !s.alive ? "#191214e6" : selected === s.id ? "#1d2a3a" : "#141a21e6",
              border: selected === s.id && s.alive ? "1px solid #4da3ff" : "1px solid #2a3138",
              opacity: s.alive ? 1 : 0.6,
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.75, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ opacity: 0.8 }}>[{i + 1}] {WEAPONS[s.weapon].name.toUpperCase()}</span>
              {s.alive ? <StanceIcon stance={s.stance} /> : <span style={{ color: "#e66a5a", fontWeight: 700 }}>KIA</span>}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              HP <Bar value={s.hp} color="#5fd68a" />
            </div>
            <div style={{ fontSize: 12 }}>
              SUP <Bar value={s.suppression} color="#e66a5a" />
            </div>
            <AimLine s={s} byId={byId} />
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
              {s.alive
                ? `${s.moveMode}${s.tx !== null ? " · moving" : ""}${s.suppression > 70 ? " · PINNED" : ""}`
                : "—"}
            </div>
          </button>
        ))}
      </div>

      {/* help */}
      <div style={{
        position: "absolute", bottom: 12, left: 12, fontSize: 11, color: "#8b98a5",
        fontFamily: "system-ui, sans-serif", lineHeight: 1.7,
      }}>
        left-click: select · right-click ground: move · right-click enemy: fire<br />
        hover enemy: shot % · Z/X/C: stand/crouch/prone · H: halt<br />
        1–4: pick soldier · WASD: pan · wheel: zoom · middle-drag: rotate
      </div>
    </div>
  );
}

function AimLine({ s, byId }: { s: SoldierSnapshot; byId: Map<number, SoldierSnapshot> }): JSX.Element {
  if (!s.alive) return <div style={{ fontSize: 10, height: 14 }} />;
  const target = s.aimId !== null ? byId.get(s.aimId) : undefined;
  if (target) {
    const shot = computeShotPct(ACTIVE_MAP.obstacles, s, target);
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
