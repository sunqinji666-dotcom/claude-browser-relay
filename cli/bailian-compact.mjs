import { WebSocket } from "ws";

const ws = new WebSocket("ws://119.29.193.16:25818");
let cmdId = 0;
function next() { return "c" + (++cmdId); }
function send(action, p = {}) {
  const id = next();
  ws.send(JSON.stringify({ type: "command", id, action, ...p }));
  return id;
}

let seq = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "auth_ok") {
    // 1. 先截图当前页面
    send("screenshot");
  }
  else if (m.id === "c1") {
    // 2. 获取页面所有文本和结构
    send("evaluate", { code: `
      (() => {
        // 页面完整文本
        const body = document.body.innerText;
        const lines = body.split('\\n').filter(l => l.trim()).slice(0, 120);
        
        // 标题级别
        const h = [];
        document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => h.push(el.tagName + ': ' + el.textContent.trim().substring(0,60)));
        
        // 所有可见的链接文本
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const r = a.getBoundingClientRect();
          const t = (a.textContent || '').trim().substring(0,50);
          if (t && r.width > 0) links.push(t + ' -> ' + (a.href || '').substring(0,80));
        });
        
        // 所有按钮
        const btns = [];
        document.querySelectorAll('button').forEach(b => {
          const t = (b.textContent || '').trim().substring(0,50);
          if (t) btns.push(t);
        });
        
        return JSON.stringify({ lines: lines.slice(0,80), headings: h.slice(0,20), links: links.slice(0,30), buttons: [...new Set(btns)].slice(0,30) });
      })();
    `});
  }
  else if (m.id === "c2") {
    try { 
      const d = JSON.parse(m.data.result);
      console.log("====== 百炼模型市场 页面快照 ======");
      console.log("\n--- 标题结构 ---");
      d.headings.forEach(h => console.log("  " + h));
      console.log("\n--- 页面文本行 (前80行) ---");
      d.lines.forEach(l => console.log("  " + l));
      console.log("\n--- 可见链接 (前30) ---");
      d.links.forEach(l => console.log("  " + l));
      console.log("\n--- 按钮 (前30) ---");
      d.buttons.forEach(b => console.log("  " + b));
    } catch(e) { console.log("解析失败:", m.data); }
  }
  else {
    console.log("\n[未知消息]", JSON.stringify(m).substring(0, 500));
  }
});
