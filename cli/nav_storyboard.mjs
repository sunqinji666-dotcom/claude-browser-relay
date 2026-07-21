import { WebSocket } from "ws";
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
    console.log("Auth OK, navigating...");
    ws.send(JSON.stringify({ type: "command", id: "nav", action: "navigate", url: "https://www.xinpianchang.com/storyboard/13704039" }));
  }
  if (msg.type === "result" && msg.id === "nav") {
    step = 2;
    console.log("Nav done:", msg.data?.url);
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "gt", action: "get_text" }));
    }, 4000);
  }
  if (msg.type === "result" && msg.id === "gt") {
    if (msg.data && msg.data.text) {
      const txt = msg.data.text;
      console.log("Page text length:", txt.length);
      
      // Find total scene count
      const totalMatch = txt.match(/(\d+)\/(\d+)镜/);
      if (totalMatch) console.log("Scene indicator:", totalMatch[0]);
      
      // Find all scene numbers
      const scenes = [...txt.matchAll(/(\d+)\/\d+镜\n画面内容/g)];
      console.log("Scene headers found:", scenes.length);
      if (scenes.length > 0) {
        console.log("First:", scenes[0][1]);
        console.log("Last:", scenes[scenes.length-1][1]);
      }
      
      // Check last few scenes
      const lines = txt.split("\n");
      const lastLines = lines.filter(l => l.trim()).slice(-30);
      console.log("\n--- Last 30 non-empty lines ---");
      lastLines.forEach(l => console.log(l.trim().slice(0, 120)));
    } else {
      console.log("No text:", JSON.stringify(msg).slice(0, 500));
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
