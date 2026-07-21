import { WebSocket } from "ws";
const ws = new WebSocket("ws://119.29.193.16:25818");
let done = false;
const timer = setTimeout(() => { if (!done) { console.log("TIMEOUT"); process.exit(1); } }, 30000);
let step = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    step = 1;
    // Scroll way down
    ws.send(JSON.stringify({ type: "command", id: "s1", action: "scroll", x: 0, y: 50000 }));
  }
  if (msg.type === "result" && msg.id === "s1") {
    step = 2;
    console.log("Scrolled");
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "command", id: "ps", action: "get_page_structure", interactiveOnly: false }));
    }, 2000);
  }
  if (msg.type === "result" && msg.id === "ps") {
    if (msg.data && msg.data.elements) {
      // Find all scene-number-like text
      msg.data.elements.forEach(el => {
        const txt = (el.text || "").trim();
        if (txt.match(/^\d+\/162镜$/) || txt.match(/^\d+\/162$/) || txt.includes("162镜")) {
          console.log("TOTAL INDICATOR:", txt);
        }
        // Find scene numbers (like "1/162镜" "50/162镜")
        if (txt.match(/^\d+\/\d+镜$/)) {
          console.log("Scene page:", txt);
        }
      });
      
      // Get the text content of the whole page
      const fullText = msg.data.elements.map(e => e.text || "").join(" ");
      const totalMatch = fullText.match(/(\d+)\/(\d+)镜/);
      if (totalMatch) console.log("\nTotal indicator:", totalMatch[0]);
      
      // Check for 162
      if (fullText.includes("162")) {
        const idx = fullText.indexOf("162");
        console.log("\n'162' context:", fullText.slice(Math.max(0,idx-20), idx+30));
      }
    }
    done = true; clearTimeout(timer); ws.close(); process.exit(0);
  }
});
