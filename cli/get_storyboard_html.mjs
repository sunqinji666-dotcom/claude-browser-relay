import { WebSocket } from "ws";
import fs from "fs";

async function main() {
  const ws = new WebSocket("ws://119.29.193.16:25818");
  await new Promise(r => ws.on("open", r));
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

  await sendAndWait({ type: "command", id: "nav", action: "navigate", url: "https://www.xinpianchang.com/storyboard/13704039" });
  console.log("Navigated");
  await new Promise(r => setTimeout(r, 4000));
  
  // Get the HTML, not just text
  const html = await sendAndWait({ type: "command", id: "html", action: "get_html", selector: "body" });
  if (html.data && html.data.html) {
    fs.writeFileSync("/tmp/storyboard-page.html", html.data.html);
    console.log("HTML saved:", html.data.html.length);
    
    // Look for JSON data, script tags with scene data, etc.
    const content = html.data.html;
    
    // Look for storyboard/scene data in various formats
    const patterns = [
      'storyboardData', '"scenes"', '"shots"', '"storyboard"', 
      'initialData', '__NEXT_DATA__', '__INITIAL_STATE__',
      'createScenes', 'sceneList', '"total"',
      '162', '13704039'
    ];
    
    for (const p of patterns) {
      let idx = content.indexOf(p);
      if (idx !== -1) {
        const context = content.slice(Math.max(0, idx - 50), idx + 150);
        console.log(`\nFound "${p}" at ${idx}:`);
        console.log(context.replace(/[\x00-\x1f]/g, ' ').slice(0, 200));
      }
    }
    
    // Look for script tags that might contain the scene data
    const scripts = [...content.matchAll(/<script[^>]*>([\s\S]{0,3000})<\/script>/g)];
    scripts.forEach((s, i) => {
      const code = s[1];
      if (code.includes('scene') || code.includes('分镜') || code.includes('13704039') || code.includes('storyboard')) {
        console.log(`\nScript #${i} (${code.length} chars):`);
        console.log(code.slice(0, 300));
        if (code.includes('13704039')) {
          // Find the exact position
          const pos = code.indexOf('13704039');
          console.log(`\nAround 13704039:`, code.slice(Math.max(0,pos-100), pos+200));
        }
      }
    });
  }
  
  ws.close();
}

main().catch(console.error);
