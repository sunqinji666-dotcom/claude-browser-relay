import { WebSocket } from "ws";
import fs from "fs";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) process.exit(0); }, 50000);
let step = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  
  if (msg.type === "auth_ok") {
    step = 1;
    // First scroll down to make the button visible
    ws.send(JSON.stringify({ type: "command", id: "s0", action: "scroll", x: 0, y: 1500 }));
  }
  
  if (msg.type === "result" && msg.id === "s0") {
    step = 2;
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "find", action: "find_elements", query: "查看全部分镜" }));
    }, 1000);
  }
  
  if (msg.type === "result" && msg.id === "find") {
    if (msg.data && msg.data.elements && msg.data.elements.length > 0) {
      // Find the button (not the parent div)
      const btns = msg.data.elements.filter(e => e.tag === "button" && e.text.includes("查看全部分镜"));
      const target = btns.length > 0 ? btns[0] : msg.data.elements[0];
      console.log("Target:", JSON.stringify({tag: target.tag, text: (target.text||"").slice(0,30), rect: target.rect}));
      
      const cx = target.rect.x + target.rect.w/2;
      const cy = target.rect.y + target.rect.h/2;
      console.log("Clicking at:", cx, cy);
      
      step = 3;
      ws.send(JSON.stringify({ type: "command", id: "click", action: "click", x: Math.round(cx), y: Math.round(cy) }));
    } else {
      console.log("No elements found");
      done = true; ws.close(); process.exit(0);
    }
  }
  
  if (msg.type === "result" && msg.id === "click") {
    step = 4;
    console.log("Clicked, waiting for expand...");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "gt", action: "get_text" }));
    }, 3000);
  }
  
  if (msg.type === "result" && msg.id === "gt") {
    if (msg.data && msg.data.text) {
      const txt = msg.data.text;
      console.log("Text length:", txt.length);
      
      const totalMatch = txt.match(/(\d+)\/(\d+)镜/);
      if (totalMatch) console.log("Scene indicator:", totalMatch[0]);
      
      const scenes = [...txt.matchAll(/(\d+)\/\d+镜\n画面内容/g)];
      console.log("Scene headers found:", scenes.length);
      if (scenes.length > 0) {
        console.log("First:", scenes[0][1]);
        console.log("Last:", scenes[scenes.length-1][1]);
      }
      
      // Check for 162 total
      if (txt.includes("162镜")) {
        const idx = txt.indexOf("162镜");
        console.log("162镜 context:", txt.slice(Math.max(0,idx-10), idx+30));
      }
      
      fs.writeFileSync("/tmp/storyboard-full-v2.txt", txt);
    } else {
      console.log("No text:", JSON.stringify(msg).slice(0, 200));
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
