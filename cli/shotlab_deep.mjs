import { WebSocket } from "ws";
import fs from "fs";
const ws = new WebSocket("ws://119.29.193.16:25818");
const timer = setTimeout(() => { process.exit(0); }, 30000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    // Navigate back to Shotlab canvas
    ws.send(JSON.stringify({ type: "command", id: "nav", action: "navigate", url: "https://aigc.xinpianchang.com/canvas/view/bf9df5b3de824b208c3e3e888235fc03" }));
  }
  if (msg.type === "result" && msg.id === "nav") {
    console.log("Back to Shotlab");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "ps", action: "get_page_structure", interactiveOnly: false }));
    }, 5000);
  }
  if (msg.type === "result" && msg.id === "ps") {
    if (msg.data && msg.data.elements) {
      // Find the storyboard table and its container
      msg.data.elements.forEach((el, i) => {
        const txt = (el.text || "").trim();
        if (txt.includes("分镜表") || txt.includes("编号") || el.class?.includes("scroll") || el.class?.includes("table")) {
          console.log(`[${i}] <${el.tag}> class=${el.class} id=${el.id} rect=${JSON.stringify(el.rect)} ${txt.slice(0,60)}`);
        }
      });
      
      // Count total scene numbers across all elements
      const sceneNums = new Set();
      msg.data.elements.forEach(el => {
        const txt = el.text || "";
        const matches = [...txt.matchAll(/(\d+)\/\d+镜/g)];
        matches.forEach(m => sceneNums.add(parseInt(m[1])));
      });
      
      if (sceneNums.size > 0) {
        console.log("\nScene numbers found:", Math.min(...sceneNums), "→", Math.max(...sceneNums), "(", sceneNums.size, "unique)");
      }
      
      // Also check for scrollable containers
      const scrollable = msg.data.elements.filter(el => {
        const rect = el.rect;
        return rect && rect.h > 300 && rect.w > 200 && (el.class || "").includes("overflow");
      });
      console.log("\nScrollable containers:", scrollable.length);
    }
    clearTimeout(timer); ws.close(); process.exit(0);
  }
});
