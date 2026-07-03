import { useEffect, useRef, useState } from "react";
import type { SoldierSnapshot } from "@coc/protocol";
import { GAME_NAME } from "@coc/shared";
import { connect, type Connection } from "./game/net.js";
import { createScene, type SceneApi } from "./game/scene.js";

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const connRef = useRef<Connection | null>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const [soldiers, setSoldiers] = useState<SoldierSnapshot[]>([]);
  const [mode, setMode] = useState<"connecting" | "online" | "offline">("connecting");
  const [myIds, setMyIds] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const scene = createScene(canvasRef.current!);
    sceneRef.current = scene;
    let alive = true;

    void connect().then((conn) => {
      if (!alive) { conn.close(); return; }
      connRef.current = conn;
      setMode(conn.mode);
      setMyIds(conn.mySoldierIds);
      setSelected(conn.mySoldierIds[0] ?? null);
      conn.onSnapshot((snap) => {
        setSoldiers(snap);
        scene.updateSoldiers(snap, conn.mySoldierIds, selectedRef.current);
      });
      scene.onSoldierClick((id) => {
        if (conn.mySoldierIds.includes(id)) setSelected(id);
      });
      scene.onGroundClick((x, y) => {
        const id = selectedRef.current;
        if (id !== null) conn.sendOrders([{ type: "move", soldierId: id, x, y }]);
      });
    });

    const onKey = (e: KeyboardEvent): void => {
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) {
        setSelected((prev) => connRef.current?.mySoldierIds[idx] ?? prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      connRef.current?.close();
      scene.dispose();
    };
  }, []);

  const mySoldiers = soldiers.filter((s) => myIds.includes(s.id));

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
          {GAME_NAME.toUpperCase()} <span style={{ opacity: 0.45 }}>M0</span>
        </div>
        <div style={{
          fontSize: 12, padding: "2px 10px", borderRadius: 4, alignSelf: "center",
          background: mode === "online" ? "#12351f" : "#3a2d12",
          color: mode === "online" ? "#5fd68a" : "#e6b45a",
        }}>
          {mode === "connecting" ? "connecting…" : mode === "online" ? "ONLINE" : "OFFLINE SIM"}
        </div>
      </div>

      {/* soldier cards */}
      <div style={{
        position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 8, fontFamily: "system-ui, sans-serif",
      }}>
        {mySoldiers.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            style={{
              width: 130, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
              textAlign: "left", color: "#dfe7ee",
              background: selected === s.id ? "#1d2a3a" : "#141a21e6",
              border: selected === s.id ? "1px solid #4da3ff" : "1px solid #2a3138",
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.6 }}>[{i + 1}] SOLDIER {s.id}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              HP <Bar value={s.hp} color="#5fd68a" />
            </div>
            <div style={{ fontSize: 12 }}>
              SUP <Bar value={s.suppression} color="#e66a5a" />
            </div>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3 }}>
              {s.stance} · {s.moveMode}{s.tx !== null ? " · moving" : ""}
            </div>
          </button>
        ))}
      </div>

      {/* help */}
      <div style={{
        position: "absolute", bottom: 12, left: 12, fontSize: 11, color: "#8b98a5",
        fontFamily: "system-ui, sans-serif", lineHeight: 1.7,
      }}>
        left-click: select · right-click: move order<br />
        1–4: pick soldier · WASD: pan · wheel: zoom · middle-drag: rotate
      </div>
    </div>
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
