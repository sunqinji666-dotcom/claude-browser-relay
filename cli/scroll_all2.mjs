import { WebSocket } from "ws";
import fs from "fs";

async function main() {
  const ws = new WebSocket("ws://119.29.193.16:25818");
  await new Promise(r => ws.on("open", r));
  
  // Wait for auth response
  const auth = await new Promise(resolve => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth_ok") resolve(msg);
    });
    ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
  });
  console.log("Auth OK:", auth.clientId);

  // Helper: send and wait
  async function sendAndWait(cmd) {
    return new Promise(resolve => {
      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "result" && msg.id === cmd.id) {
          ws.removeListener("message", handler);
          resolve(msg);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify(cmd));
    });
  }
  
  const allNums = new Set();
  
  for (let y = 500; y <= 12000; y += 500) {
    await sendAndWait({ type: "command", id: "s" + y, action: "scroll", x: 0, y });
    await new Promise(r => setTimeout(r, 800));
    
    const ps = await sendAndWait({ type: "command", id: "ps" + y, action: "get_page_structure", interactiveOnly: false });
    
    if (ps.data && ps.data.elements) {
      const nums = new Set();
      ps.data.elements.forEach(el => {
        const txt = el.text || "";
        const matches = [...txt.matchAll(/(\d+)\/\d+镜/g)];
        matches.forEach(m => nums.add(parseInt(m[1])));
      });
      
      if (nums.size > 0) {
        const sorted = [...nums].sort((a,b) => a-b);
        console.log(`y=${y}: ${sorted[0]}→${sorted[sorted.length-1]} (${nums.size})`);
        nums.forEach(n => allNums.add(n));
      }
    }
  }
  
  const sorted = [...allNums].sort((a,b) => a-b);
  console.log("\n=== Final ===");
  console.log("Unique:", sorted.length);
  console.log("Range:", sorted[0], "→", sorted[sorted.length-1]);
  
  const missing = [];
  for (let i = 1; i <= Math.max(...sorted); i++) {
    if (!sorted.includes(i)) missing.push(i);
  }
  if (missing.length > 0) console.log("Missing:", missing.slice(0, 30).join(","), missing.length > 30 ? `...(+${missing.length-30} more)` : "");
  else console.log("✅ All scenes present");
  
  ws.close();
}

main().catch(console.error);
