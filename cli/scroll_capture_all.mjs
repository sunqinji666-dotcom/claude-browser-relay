import { WebSocket } from "ws";
import fs from "fs";

async function main() {
  const ws = new WebSocket("ws://119.29.193.16:25818");
  
  await new Promise((resolve) => {
    ws.on("open", resolve);
  });
  
  // Auth
  const auth = await sendCmd(ws, { type: "auth", role: "controller", token: "claude-relay-221c7e14" });
  if (auth.type !== "auth_ok") { console.log("Auth failed"); return; }
  console.log("Auth OK");
  
  let allTexts = [];
  let prevLen = 0;
  
  // Scroll in increments and capture text each time
  for (let scrollY = 500; scrollY <= 10000; scrollY += 500) {
    await sendCmd(ws, { type: "command", id: "s" + scrollY, action: "scroll", x: 0, y: scrollY });
    await sleep(800);
    
    const result = await sendCmd(ws, { type: "command", id: "gt" + scrollY, action: "get_text" });
    const txt = result.data?.text || "";
    
    if (txt.length > prevLen) {
      allTexts.push({ scrollY, len: txt.length, text: txt });
      prevLen = txt.length;
      console.log("Scroll", scrollY, "- text length:", txt.length);
      
      const scenes = [...txt.matchAll(/(\d+)\/\d+镜\n画面内容/g)];
      console.log("  Scenes visible:", scenes.length);
      if (scenes.length > 0) console.log("  Range:", scenes[0][1], "→", scenes[scenes.length-1][1]);
    }
    
    // Stop if we've been getting the same length for a while
    if (txt.length > 0 && txt.length === prevLen && scrollY > 3000) {
      console.log("Text not growing, ending scroll");
      break;
    }
  }
  
  // Save the largest text capture
  if (allTexts.length > 0) {
    const largest = allTexts.reduce((a, b) => a.len > b.len ? a : b);
    fs.writeFileSync("/tmp/storyboard-full-scroll.txt", largest.text);
    console.log("\nFinal text length:", largest.len);
    
    const scenes = [...largest.text.matchAll(/(\d+)\/\d+镜\n画面内容/g)];
    console.log("Total scenes found:", scenes.length);
    if (scenes.length > 0) {
      console.log("Range:", scenes[0][1], "→", scenes[scenes.length-1][1]);
    }
    
    // Check for specific scene numbers
    const allNums = scenes.map(s => parseInt(s[1]));
    const missing = [];
    for (let i = 1; i <= 162; i++) {
      if (!allNums.includes(i)) missing.push(i);
    }
    if (missing.length > 0) console.log("Missing scenes:", missing.join(","));
    else console.log("All 162 scenes present! ✅");
  }
  
  ws.close();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendCmd(ws, cmd) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "result" || msg.type === "auth_ok" || msg.type === "error") {
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(cmd));
  });
}

main().catch(console.error);
