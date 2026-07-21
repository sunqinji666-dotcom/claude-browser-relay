import { WebSocket } from "ws";
const ws = new WebSocket("ws://119.29.193.16:25818");
const timer = setTimeout(() => { process.exit(0); }, 20000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "auth_ok") {
    ws.send(JSON.stringify({ type: "command", id: "ps", action: "get_page_structure", interactiveOnly: false }));
  }
  if (msg.type === "result" && msg.id === "ps") {
    if (msg.data && msg.data.elements) {
      // Find scrollable containers and the scene list area
      let sceneElements = [];
      msg.data.elements.forEach((el, i) => {
        const txt = (el.text || "").trim();
        if (txt.includes("查看全部分镜")) {
          console.log("Button:", JSON.stringify({idx: i, tag: el.tag, rect: el.rect, text: txt.slice(0,50)}));
        }
        if (txt.match(/\d+\/\d+镜/)) {
          sceneElements.push({idx: i, tag: el.tag, text: txt.slice(0, 80)});
        }
      });
      
      // Show all scene-related elements
      console.log("\nScene elements:");
      sceneElements.forEach(s => console.log("  [" + s.idx + "] <" + s.tag + ">", s.text));
      
      // Show the element structure around the scenes
      console.log("\n--- Full elements with coordinates ---");
      msg.data.elements.forEach((el, i) => {
        const txt = (el.text || "").trim();
        if (txt && (txt.includes("镜") || txt.includes("画面内容") || el.tag === "button")) {
          console.log(`[${i}] <${el.tag}> (${el.rect.x},${el.rect.y},${el.rect.w},${el.rect.h}) ${txt.slice(0,80)}`);
        }
      });
    }
    clearTimeout(timer); ws.close(); process.exit(0);
  }
});
