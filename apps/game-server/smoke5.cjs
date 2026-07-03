const WebSocket = require("ws");
function client(name){const ws=new WebSocket("ws://localhost:8787");const c={name,ws,welcome:null,last:null};
ws.on("open",()=>ws.send(JSON.stringify({t:"join",name})));
ws.on("message",(d)=>{const m=JSON.parse(d);if(m.t==="welcome")c.welcome=m;if(m.t==="snapshot")c.last=m;});return c;}
const a=client("alpha"),b=client("bravo");
setTimeout(()=>{for(const c of [a,b]){c.ws.send(JSON.stringify({t:"orders",orders:c.welcome.yourSoldierIds.map(id=>({type:"move",soldierId:id,x:75000,y:75000,mode:"sprint"}))}));}},2000);
setTimeout(()=>{
  for(const c of [a,b]){const own=c.last.soldiers.filter(s=>c.welcome.yourSoldierIds.includes(s.id));
  console.log(`${c.name}: alive ${own.filter(s=>s.alive).length}/4`);}
  process.exit(0);},26000);
