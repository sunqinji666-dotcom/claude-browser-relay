import { WebSocket } from "ws";
import fs from "fs";

const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) { console.log("TIMEOUT"); process.exit(1); } }, 40000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "auth_ok") {
    // Jump to the very bottom of the table
    ws.send(JSON.stringify({ type: "command", id: "s1", action: "scroll", x: 0, y: 100000 }));
  }

  if (msg.type === "result" && msg.id === "s1") {
    console.log("Scrolled to bottom");
    // Wait for virtual scroll to catch up
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "html", action: "get_html", selector: "body" }));
    }, 3000);
  }

  if (msg.type === "result" && msg.id === "html") {
    if (msg.data && msg.data.html) {
      fs.writeFileSync("/tmp/shotlab2-bottom.html", msg.data.html);
      console.log("Bottom HTML saved:", msg.data.html.length);
    }
    done = true;
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
