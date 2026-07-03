const WebSocket = require("ws");
function client(name) {
  const ws = new WebSocket("ws://localhost:8787");
  const c = { name, ws, welcome: null, last: null, events: 0 };
  ws.on("open", () => ws.send(JSON.stringify({t:"join",name})));
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.t === "welcome") c.welcome = m;
    if (m.t === "snapshot") { c.last = m; c.events += m.events.length; }
  });
  return c;
}
const a = client("alpha"), b = client("bravo");
setTimeout(() => {
  console.log("map:", a.welcome.mapW/1000 + "x" + a.welcome.mapH/1000, "m");
  for (const c of [a, b]) {
    const enemies = c.last.soldiers.filter(s => s.team !== c.welcome.team);
    const own = c.last.soldiers.filter(s => c.welcome.yourSoldierIds.includes(s.id));
    console.log(`${c.name}: team ${c.welcome.team} | spawn (${Math.round(own[0].x/1000)},${Math.round(own[0].y/1000)}) | enemies visible: ${enemies.length} | shots so far: ${c.events} | aim fields present: ${own.every(s => 'aimId' in s)}`);
  }
  // send both toward the courtyard
  for (const c of [a, b]) {
    c.ws.send(JSON.stringify({t:"orders",orders: c.welcome.yourSoldierIds.map(id => ({type:"move",soldierId:id,x:75000,y:75000,mode:"sprint"}))}));
  }
}, 2000);
setTimeout(() => {
  for (const c of [a, b]) {
    const enemies = c.last.soldiers.filter(s => s.team !== c.welcome.team);
    const own = c.last.soldiers.filter(s => c.welcome.yourSoldierIds.includes(s.id));
    const aiming = own.filter(s => s.aimId !== null).length;
    console.log(`${c.name} after advance: enemies visible: ${enemies.length} | own aiming: ${aiming} | shots seen: ${c.events} | own alive: ${own.filter(s=>s.alive).length}`);
  }
  process.exit(0);
}, 26000);
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 32000);
