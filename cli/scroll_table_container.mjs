import { WebSocket } from "ws";
import fs from "fs";

const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) process.exit(0); }, 60000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

let step = 0;
let allSceneNums = new Set();
let captures = [];

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  
  if (msg.type === "auth_ok") {
    step = 1;
    // First make sure we're on Shotlab canvas
    ws.send(JSON.stringify({ type: "command", id: "chk", action: "get_active_tab" }));
  }
  
  if (msg.type === "result" && msg.id === "chk") {
    console.log("Current:", msg.data?.url);
    step = 2;
    // Scroll the table container at specific Y positions
    // The table container is at y:100 and height is ~568
    // Let me scroll the page to make the table show different sections
    doNextScroll(0);
  }

  function doNextScroll(scrollY) {
    if (scrollY > 10000) {
      // Done scrolling, show results
      const sorted = [...allSceneNums].sort((a,b) => a-b);
      console.log("\n=== All scene numbers found across scrolls ===");
      console.log("Count:", sorted.length);
      console.log("Range:", sorted[0], "→", sorted[sorted.length-1]);
      
      // Find gaps
      const missing = [];
      for (let i = sorted[0]; i <= sorted[sorted.length-1]; i++) {
        if (!sorted.includes(i)) missing.push(i);
      }
      if (missing.length > 0) console.log("Gaps:", missing.join(","));
      else console.log("Continuous ✅");
      
      // Write all captures
      fs.writeFileSync("/tmp/shotlab-captures.json", JSON.stringify(captures, null, 2));
      console.log("Captures saved");
      
      done = true; ws.close(); process.exit(0);
      return;
    }
    
    step = 3;
    ws.send(JSON.stringify({ type: "command", id: "s" + scrollY, action: "scroll", x: 0, y: scrollY }));
    
    const handler = (raw2) => {
      const msg2 = JSON.parse(raw2.toString());
      if (msg2.type === "result" && msg2.id === "s" + scrollY) {
        ws.removeListener("message", handler);
        setTimeout(() => {
          // Use find_elements with query "镜" to find all scene indicators
          ws.send(JSON.stringify({ type: "command", id: "ps" + scrollY, action: "get_page_structure", interactiveOnly: false }));
        }, 1000);
      }
    };
    ws.on("message", handler);
  }
  
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "result" && msg.id && msg.id.toString().startsWith("ps")) {
      const scrollY = parseInt(msg.id.toString().replace("ps", ""));
      
      if (msg.data && msg.data.elements) {
        // Find scene numbers
        const sceneNums = new Set();
        msg.data.elements.forEach(el => {
          const txt = el.text || "";
          const matches = [...txt.matchAll(/(\d+)\/\d+镜/g)];
          matches.forEach(m => sceneNums.add(parseInt(m[1])));
        });
        
        if (sceneNums.size > 0) {
          const sorted = [...sceneNums].sort((a,b) => a-b);
          console.log("Scroll", scrollY, "- scenes:", sorted[0], "→", sorted[sorted.length-1], "(", sceneNums.size, ")");
          sceneNums.forEach(n => allSceneNums.add(n));
          captures.push({ scrollY, sceneNums: sorted });
        }
      }
      
      // Next scroll - jump by 600px each time
      doNextScroll(scrollY + 600);
    }
  });
});
