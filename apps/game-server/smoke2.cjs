const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:8787");
let welcomed = null, snaps = 0;
ws.on("open", () => ws.send(JSON.stringify({t:"join",name:"smoke"})));
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.t === "welcome") welcomed = m;
  if (m.t === "snapshot" && welcomed) {
    snaps++;
    const s = m.soldiers.find(x => x.id === welcomed.yourSoldierIds[0]);
    if (snaps === 1) ws.send(JSON.stringify({t:"orders",orders:[{type:"move",soldierId:s.id,x:50000,y:50000,mode:"sprint"}]}));
    if (snaps === 60) { // ~6s of sprinting from (30,10) toward building interior (50,50)
      const wallY = 44000, inBuilding = s.x > 44400 && s.x < 55800 && s.y > 44200 && s.y < 55800;
      console.log("pos:", s.x + "," + s.y, "| inside building:", inBuilding, "| stopped:", s.tx === null);
      process.exit(0);
    }
  }
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 15000);
