import { WebSocket } from "ws";

const ws = new WebSocket("ws://119.29.193.16:25818");

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

let gotAuth = false;
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());

  // 处理 ping
  if (m.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
    return;
  }

  if (m.type === "browser_status") {
    console.log("browser_status:", JSON.stringify(m));
    return;
  }

  if (m.type === "auth_ok" && !gotAuth) {
    gotAuth = true;
    console.log("认证成功, session:", m.session);
    // 先看当前页面
    ws.send(JSON.stringify({ type: "command", id: "c1", action: "get_active_tab" }));
    return;
  }

  if (m.type === "result") {
    console.log("=== result [" + m.id + "] ===", JSON.stringify(m.data).substring(0, 3000));
    
    if (m.id === "c1") {
      // 取页面全部文本
      ws.send(JSON.stringify({ type: "command", id: "c2", action: "get_text" }));
    } else if (m.id === "c2") {
      // 评估 JS 找页面结构
      ws.send(JSON.stringify({ type: "command", id: "c3", action: "evaluate", code: `
        JSON.stringify({
          h: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(x=>x.tagName+':'+x.textContent.trim().substring(0,50)),
          btns: [...new Set([...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(x=>x))].slice(0,30),
          categories: (()=>{
            const txt = document.body.innerText;
            const lines = txt.split('\\n').filter(l=>l.trim()&&l.trim().length<80);
            return [...new Set(lines)].slice(0,80);
          })()
        })
      ` }));
    } else if (m.id === "c3") {
      try { console.log("evaluate结果:", JSON.parse(m.data.result)); } catch(e) { console.log("原始结果:", m.data); }
      // 截图
      ws.send(JSON.stringify({ type: "command", id: "c4", action: "screenshot" }));
    } else if (m.id === "c4") {
      console.log("截图完成");
      ws.close();
    }
    return;
  }

  console.log("[消息]", m.type, JSON.stringify(m).substring(0, 500));
});
