import { WebSocket } from "ws";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) { console.log("TIMEOUT"); process.exit(1); } }, 30000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    ws.send(JSON.stringify({ type: "command", id: "f1", action: "find_elements", query: "/" }));
  }
  if (msg.type === "result" && msg.id === "f1") {
    if (msg.data && msg.data.elements) {
      msg.data.elements.forEach(el => {
        const txt = (el.text || "").trim();
        if (txt.match(/\d+\/\d+/) || txt.includes("镜") || txt.includes("162") || txt.includes("共")) {
          console.log("Found:", txt.slice(0, 120));
        }
      });
    } else {
      console.log("No elements:", JSON.stringify(msg).slice(0, 500));
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
