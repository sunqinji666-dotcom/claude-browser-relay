import { WebSocket } from "ws";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) process.exit(0); }, 30000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "browser_status") {
    console.log("Browser connected:", msg.connected);
  }
  if (msg.type === "auth_ok") {
    // Get all tabs to find any storyboard page
    ws.send(JSON.stringify({ type: "command", id: "tabs", action: "get_tabs" }));
  }
  if (msg.type === "result" && msg.id === "tabs") {
    if (msg.data) {
      msg.data.forEach(t => {
        if (t.url.includes("xinpianchang") && t.url.includes("storyboard")) {
          console.log("STORYBOARD TAB:", t.title, "|", t.url);
        }
        if (t.active) console.log("ACTIVE:", t.title, "|", t.url);
      });
      
      // Also look for the storyboard ID in the Shotlab page
      // Navigate to the shotlab page and check for the referenced storyboard
      const shotlabUrl = "https://aigc.xinpianchang.com/canvas/view/bf9df5b3de824b208c3e3e888235fc03";
      // Get current URL first
      ws.send(JSON.stringify({ type: "command", id: "url", action: "get_url" }));
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
