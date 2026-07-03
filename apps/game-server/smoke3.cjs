const WebSocket = require("ws");
function client(name) {
  const ws = new WebSocket("ws://localhost:8787");
  const c = { name, ws, welcome: null, last: null, events: 0, kills: 0 };
  ws.on("open", () => ws.send(JSON.stringify({t:"join",name})));
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.t === "welcome") c.welcome = m;
    if (m.t === "snapshot") {
      c.last = m;
      c.events += m.events.length;
      c.kills += m.events.filter(e => e.kill).length;
    }
  });
  return c;
}
const a = client("alpha"), b = client("bravo");
setTimeout(() => {
  // advance toward each other at sprint
  for (const c of [a, b]) {
    const ids = c.welcome.yourSoldierIds;
    c.ws.send(JSON.stringify({t:"orders",orders: ids.map(id => ({type:"move",soldierId:id,x:45000,y:50000,mode:"sprint"}))}));
  }
}, 1500);
setTimeout(() => {
  for (const c of [a, b]) {
    const own = c.last.soldiers.filter(s => c.welcome.yourSoldierIds.includes(s.id));
    const enemies = c.last.soldiers.filter(s => s.team !== c.welcome.team);
    const dead = c.last.soldiers.filter(s => !s.alive).length;
    console.log(`${c.name}: team ${c.welcome.team} | sees ${c.last.soldiers.length} soldiers (${enemies.length} enemies) | shot events seen: ${c.events} | kills seen: ${c.kills} | dead in view: ${dead}`);
    const hurt = own.filter(s => s.hp < 100).length;
    console.log(`  own alive: ${own.filter(s=>s.alive).length}/4, hurt: ${hurt}, suppressed>0: ${own.filter(s=>s.suppression>0).length}`);
  }
  process.exit(0);
}, 14000);
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 20000);
