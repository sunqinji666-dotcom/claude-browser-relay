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
    ws.send(JSON.stringify({ type: "command", id: "ss", action: "screenshot" }));
  }
  if (msg.type === "result" && msg.id === "ss") {
    if (msg.data && msg.data.dataUrl) {
      const b64 = msg.data.dataUrl.replace(/^data:image\/jpeg;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      fs.writeFileSync("/tmp/storyboard-page.jpg", buf);
      console.log("Screenshot:", buf.length, "bytes");
    }
    clearTimeout(timer); ws.close(); process.exit(0);
  }
});
