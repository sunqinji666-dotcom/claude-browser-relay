import { WebSocket } from "ws";
import fs from "fs";

async function main() {
  const ws = new WebSocket("ws://119.29.193.16:25818");
  await new Promise(r => ws.on("open", r));
  
  // Auth
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
  const auth = await waitMsg(ws, "auth_ok");
  console.log("Auth OK");
  
  // Check URL
  ws.send(JSON.stringify({ type: "command", id: "chk", action: "get_active_tab" }));
  const tab = await waitMsg(ws, "chk");
  console.log("URL:", tab.data?.url);
  
  const allNums = new Set();
  
  // Scroll progressively and capture
  for (let y = 500; y <= 12000; y += 500) {
    ws.send(JSON.stringify({ type: "command", id: "s" + y, action: "scroll", x: 0, y }));
    await waitMsg(ws, "s" + y);
    await sleep(800);
    
    ws.send(JSON.stringify({ type: "command", id: "ps" + y, action: "get_page_structure", interactiveOnly: false }));
    const ps = await waitMsg(ws, "ps" + y);
    
    if (ps.data && ps.data.elements) {
      const nums = new Set();
      ps.data.elements.forEach(el => {
        const txt = el.text || "";
        const matches = [...txt.matchAll(/(\d+)\/\d+镜/g)];
        matches.forEach(m => nums.add(parseInt(m[1])));
      });
      
      if (nums.size > 0) {
        const sorted = [...nums].sort((a,b) => a-b);
        console.log(`Scroll ${y}: ${sorted[0]}→${sorted[sorted.length-1]} (${nums.size})`);
        nums.forEach(n => allNums.add(n));
      }
    }
  }
  
  const sorted = [...allNums].sort((a,b) => a-b);
  console.log("\n=== Results ===");
  console.log("Total unique scenes:", sorted.length);
  console.log("Range:", sorted[0], "→", sorted[sorted.length-1]);
  
  const missing = [];
  for (let i = 1; i <= sorted[sorted.length-1]; i++) {
    if (!sorted.includes(i)) missing.push(i);
  }
  if (missing.length > 0) console.log("Missing:", missing.join(", "));
  else console.log("✅ Continuous");
  
  ws.close();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitMsg(ws, id) {
  return new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if ((msg.type === "result" || msg.type === "auth_ok") && msg.id === id) {
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

main().catch(console.error);
