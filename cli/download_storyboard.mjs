import { WebSocket } from "ws";
const ws = new WebSocket("ws://119.29.193.16:25818");
const timer = setTimeout(() => { process.exit(0); }, 30000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    // Find and click "下载全部分镜"
    ws.send(JSON.stringify({ type: "command", id: "find", action: "find_elements", query: "下载全部分镜" }));
  }
  if (msg.type === "result" && msg.id === "find") {
    if (msg.data && msg.data.elements) {
      const btn = msg.data.elements.find(e => e.tag === "button" && e.text.includes("下载全部分镜"));
      if (btn) {
        console.log("Download button:", JSON.stringify(btn.rect));
        const cx = Math.round(btn.rect.x + btn.rect.w / 2);
        const cy = Math.round(btn.rect.y + btn.rect.h / 2);
        ws.send(JSON.stringify({ type: "command", id: "click", action: "click", x: cx, y: cy }));
      } else {
        // Check all elements
        msg.data.elements.forEach(e => {
          if (e.text && e.text.includes("下载")) console.log("Download related:", e.tag, (e.text||"").slice(0,60), JSON.stringify(e.rect));
        });
        console.log("No download button found");
        clearTimeout(timer); ws.close(); process.exit(0);
      }
    }
  }
  if (msg.type === "result" && msg.id === "click") {
    console.log("Clicked download, waiting for response...");
    setTimeout(() => {
      // Check what tab is active now
      ws.send(JSON.stringify({ type: "command", id: "tabs", action: "get_tabs" }));
    }, 3000);
  }
  if (msg.type === "result" && msg.id === "tabs") {
    if (msg.data) {
      msg.data.forEach(t => {
        if (t.active) console.log("Active tab:", t.title, t.url);
      });
    }
    clearTimeout(timer); ws.close(); process.exit(0);
  }
});
