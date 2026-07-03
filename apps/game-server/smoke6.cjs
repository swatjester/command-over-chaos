const WebSocket = require("ws");
function join(token, archetype) {
  return new Promise((res) => {
    const ws = new WebSocket("ws://localhost:8787");
    ws.on("open", () => ws.send(JSON.stringify({t:"join",name:"s",token,archetype})));
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.t === "welcome") res({ ws, welcome: m, snap: null });
    });
  });
}
(async () => {
  const a = await join("tok-alpha", "rangers");
  console.log("join1: soldiers", a.welcome.yourSoldierIds.join(","), "team", a.welcome.team);
  a.ws.send(JSON.stringify({t:"orders",orders:[{type:"move",soldierId:a.welcome.yourSoldierIds[0],x:75000,y:60000,mode:"sprint"}]}));
  await new Promise(r => setTimeout(r, 1000));
  a.ws.close(); // "refresh"
  await new Promise(r => setTimeout(r, 500));
  const a2 = await join("tok-alpha", "rangers");
  const same = JSON.stringify(a2.welcome.yourSoldierIds) === JSON.stringify(a.welcome.yourSoldierIds);
  console.log("rejoin: soldiers", a2.welcome.yourSoldierIds.join(","), "| squad reclaimed:", same);
  // verify archetype weapons in snapshot
  await new Promise((res) => {
    a2.ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.t === "snapshot") {
        const mine = m.soldiers.filter(s => a2.welcome.yourSoldierIds.includes(s.id));
        console.log("rangers kit:", mine.map(s => s.weapon).join(","));
        console.log("soldier0 moved:", mine[0].x !== 69500 + 1 ? `(${mine[0].x},${mine[0].y})` : "no");
        res();
      }
    });
  });
  process.exit(0);
})();
