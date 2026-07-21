import { WebSocket } from 'ws';
const cfg = {serverUrl:'ws://119.29.193.16:25818', authToken:'claude-relay-221c7e14'};
const cmd = JSON.parse(process.argv[2]);
const ws = new WebSocket(cfg.serverUrl);
let done=false, authed=false;
const timeout=setTimeout(()=>{if(!done){console.error('timeout'); ws.close(); process.exit(2)}}, 45000);
ws.on('open',()=>ws.send(JSON.stringify({type:'auth',role:'controller',token:cfg.authToken})));
ws.on('message',(raw)=>{
 const msg=JSON.parse(raw.toString());
 if(msg.type==='auth_ok' && !authed) { authed=true; ws.send(JSON.stringify({type:'command', id:'cmd', ...cmd})); }
 if(msg.type==='result' && msg.id==='cmd') {done=true; clearTimeout(timeout); console.log(JSON.stringify(msg,null,2)); ws.close();}
 if(msg.type==='error') console.error('ERR',msg.message);
});
