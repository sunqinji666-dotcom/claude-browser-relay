import { WebSocket } from "ws";
import fs from "fs";

const ws = new WebSocket("ws://119.29.193.16:25818");
const timer = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 25000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    console.log("Auth OK, navigating...");
    ws.send(JSON.stringify({
      type: "command", id: "nav",
      action: "navigate",
      url: "https://aigc.xinpianchang.com/canvas/view/bf9df5b3de824b208c3e3e888235fc03"
    }));
  }
  if (msg.type === "result" && msg.id === "nav") {
    console.log("Navigated:", msg.data?.url);
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "html", action: "get_html", selector: "body" }));
    }, 3000);
  }
  if (msg.type === "result" && msg.id === "html") {
    if (msg.data && msg.data.html) {
      fs.writeFileSync("/tmp/shotlab2-html.txt", msg.data.html);
      console.log("HTML saved:", msg.data.html.length, "chars");
    } else {
      console.log("No HTML:", JSON.stringify(msg).slice(0, 500));
    }
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
