import { WebSocket } from "ws";
import fs from "fs";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) process.exit(0); }, 40000);
let step = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  
  if (msg.type === "auth_ok") {
    step = 1;
    // Find the "查看全部分镜" button
    ws.send(JSON.stringify({ type: "command", id: "find", action: "find_elements", query: "查看全部分镜" }));
  }
  
  if (msg.type === "result" && msg.id === "find") {
    if (msg.data && msg.data.elements) {
      const btn = msg.data.elements.find(e => e.text && e.text.includes("查看全部分镜"));
      if (btn) {
        step = 2;
        console.log("Button found at:", btn.rect.x, btn.rect.y);
        ws.send(JSON.stringify({ type: "command", id: "click", action: "click", x: btn.rect.x + btn.rect.w/2, y: btn.rect.y + btn.rect.h/2 }));
      } else {
        console.log("Button not found, elements:", msg.data.elements.length);
        msg.data.elements.forEach(e => console.log("  ", (e.text || "").slice(0, 80)));
        done = true; ws.close(); process.exit(0);
      }
    } else {
      console.log("No elements:", JSON.stringify(msg).slice(0, 300));
      done = true; ws.close(); process.exit(0);
    }
  }
  
  if (msg.type === "result" && msg.id === "click") {
    step = 3;
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
      console.log("Scene headers:", scenes.length);
      if (scenes.length > 0) {
        console.log("First:", scenes[0][1]);
        console.log("Last:", scenes[scenes.length-1][1]);
      }
      
      fs.writeFileSync("/tmp/storyboard-full.txt", txt);
      console.log("Full text saved to /tmp/storyboard-full.txt");
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
