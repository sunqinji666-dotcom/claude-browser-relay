import { WebSocket } from "ws";
import fs from "fs";

async function main() {
  const ws = new WebSocket("ws://119.29.193.16:25818");
  await new Promise(r => ws.on("open", r));
  
  // Auth
  await new Promise(resolve => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth_ok") resolve();
    });
    ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
  });
  console.log("Auth OK");
  
  function sendAndWait(cmd) {
    return new Promise(resolve => {
      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "result" && msg.id === cmd.id) {
          ws.removeListener("message", handler);
          resolve(msg);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify(cmd));
    });
  }
  
  // Navigate to storyboard page  
  await sendAndWait({ type: "command", id: "nav", action: "navigate", url: "https://www.xinpianchang.com/storyboard/13704039" });
  console.log("Navigated to storyboard page");
  await new Promise(r => setTimeout(r, 3000));
  
  // Get page structure to find the modal close button
  const ps = await sendAndWait({ type: "command", id: "ps", action: "get_page_structure", interactiveOnly: false });
  
  if (ps.data && ps.data.elements) {
    // Find "关闭" button or any modal close elements
    ps.data.elements.forEach((el, i) => {
      const txt = (el.text || "").trim();
      if (txt.includes("关闭") || txt.includes("会员") || txt.includes("开通") || txt.includes("支付") || (el.class && el.class.includes("modal"))) {
        console.log(`[${i}] <${el.tag}> ${txt.slice(0, 80)} rect=${JSON.stringify(el.rect)}`);
      }
    });
    
    // Also try to find the actual storyboard content area
    const sceneElements = ps.data.elements.filter(el => {
      const txt = el.text || "";
      return txt.match(/\d+\/\d+镜/) || txt.includes("画面内容");
    });
    console.log("\nScene elements:", sceneElements.length);
    sceneElements.slice(0, 3).forEach(el => console.log("  ", (el.text || "").slice(0, 80)));
    
    // Take screenshot
    await sendAndWait({ type: "command", id: "ss", action: "screenshot" });
    // The result may not reach here, but let's see
  }
  
  await new Promise(r => setTimeout(r, 2000));
  ws.close();
}

main().catch(console.error);
