import { WebSocket } from "ws";
import fs from "fs";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) process.exit(0); }, 60000);
let step = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  
  if (msg.type === "auth_ok") {
    step = 1;
    ws.send(JSON.stringify({ type: "command", id: "find", action: "find_elements", query: "查看全部分镜" }));
  }
  
  if (msg.type === "result" && msg.id === "find") {
    if (msg.data && msg.data.elements) {
      const allBtns = msg.data.elements.filter(e => e.tag === "button" && e.text.includes("查看全部分镜"));
      if (allBtns.length > 0) {
        const btn = allBtns[0];
        const cx = Math.round(btn.rect.x + btn.rect.w/2);
        const cy = Math.round(btn.rect.y + btn.rect.h/2);
        console.log("Clicking button at:", cx, cy);
        step = 2;
        ws.send(JSON.stringify({ type: "command", id: "click", action: "click", x: cx, y: cy }));
      } else {
        console.log("No button found");
        done = true; ws.close(); process.exit(0);
      }
    }
  }
  
  if (msg.type === "result" && (msg.id === "click" || step === 2)) {
    step = 3;
    console.log("Click sent, waiting 5s...");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "gt2", action: "get_text" }));
    }, 5000);
  }
  
  if (msg.type === "result" && msg.id === "gt2") {
    const txt = msg.data?.text || "";
    console.log("After click - text length:", txt.length);
    
    if (txt.length > 2000) {
      // It expanded!
      const scenes = [...txt.matchAll(/(\d+)\/\d+镜\n画面内容/g)];
      console.log("Scene headers:", scenes.length);
      fs.writeFileSync("/tmp/storyboard-expanded.txt", txt);
      console.log("Full text saved!");
    } else {
      console.log("Still not expanded. Trying screenshot...");
      ws.send(JSON.stringify({ type: "command", id: "ss", action: "screenshot" }));
      return;
    }
    done = true; ws.close(); process.exit(0);
  }
  
  if (msg.type === "result" && msg.id === "ss") {
    if (msg.data && msg.data.dataUrl) {
      const b64 = msg.data.dataUrl.replace(/^data:image\/jpeg;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      fs.writeFileSync("/tmp/storyboard-click-result.jpg", buf);
      console.log("Screenshot saved:", buf.length, "bytes");
    }
    done = true; ws.close(); process.exit(0);
  }
});
