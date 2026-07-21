import { WebSocket } from "ws";

const ws = new WebSocket("ws://119.29.193.16:25818");

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

let phase = "auth";
let resultCount = 0;

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
  if (m.type === "browser_status") return;

  if (m.type === "auth_ok") {
    console.log("认证成功. 导航到百炼模型市场...");
    ws.send(JSON.stringify({ type: "command", id: "nav1", action: "navigate", url: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market" }));
    return;
  }

  if (m.type === "result") {
    resultCount++;
    const id = m.id;
    console.log(`\n===== [${id}] =====`);
    
    if (id === "nav1") {
      console.log("导航命令已发送. 等待 3 秒让页面加载...");
      // 先不要发命令，直接等 setTimeout 后再发
      setTimeout(() => {
        console.log("\n--- 获取页面文本 ---");
        ws.send(JSON.stringify({ type: "command", id: "gt1", action: "get_text" }));
      }, 3000);
    }
    else if (id === "gt1") {
      const text = m.data.text || "";
      console.log("页面文本 (前 2000 字):");
      console.log(text.substring(0, 2000));
      if (text.length > 2000) console.log(`...(共${text.length}字)`);
      
      // 拿 evaluate
      setTimeout(() => {
        console.log("\n--- 分析页面结构 ---");
        ws.send(JSON.stringify({ type: "command", id: "ev1", action: "evaluate", code: `
          (() => {
            const allText = document.body.innerText;
            const lines = allText.split('\\n').filter(l => l.trim()).slice(0, 100);
            const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.tagName + ': ' + h.textContent.trim().substring(0,60));
            const buttons = [...new Set([...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(x => x))].slice(0, 30);
            const allALinks = [...document.querySelectorAll('a[href]')].map(a => ({t: a.textContent.trim().substring(0,50), h: (a.href||'').substring(0,100)})).filter(x => x.t).slice(0, 30);
            return JSON.stringify({ lines: lines.slice(0,80), headings, buttons, links: allALinks });
          })();
        ` }));
      }, 1000);
    }
    else if (id === "ev1") {
      try {
        const d = JSON.parse(m.data.result);
        console.log("标题结构:");
        d.headings.forEach(h => console.log("  " + h));
        console.log("\n按钮:");
        d.buttons.forEach(b => console.log("  " + b));
        console.log("\n链接:");
        d.links.forEach(l => console.log("  " + l.t + " -> " + l.h.substring(0,80)));
        console.log("\n页面文本行 (前80行):");
        d.lines.forEach(l => console.log("  " + l));
      } catch(e) { console.log("evaluate原始:", JSON.stringify(m.data).substring(0, 3000)); }
      
      // 截图
      setTimeout(() => {
        console.log("\n--- 截图 ---");
        ws.send(JSON.stringify({ type: "command", id: "scr1", action: "screenshot" }));
      }, 500);
    }
    else if (id === "scr1") {
      console.log("截图成功");
      
      // 再看看更细粒度的功能区域
      setTimeout(() => {
        console.log("\n--- 探索功能区块（模型列表/筛选/分类） ---");
        ws.send(JSON.stringify({ type: "command", id: "ev2", action: "evaluate", code: `
          (() => {
            const tabs = [...document.querySelectorAll('[role=tab], [class*=tab], [class*=Tab]')].map(t => t.textContent.trim()).filter(x => x).slice(0, 20);
            const cards = [...document.querySelectorAll('[class*=card], [class*=Card]')].map(c => c.textContent.trim().substring(0,80)).filter(x => x).slice(0, 20);
            const filters = [...document.querySelectorAll('[class*=filter], [class*=Filter], select, [class*=select], [class*=Select]')].map(f => f.textContent.trim().substring(0,60)).filter(x => x).slice(0, 20);
            // 找价格信息
            const prices = [...document.querySelectorAll('[class*=price], [class*=Price], [class*=cost], [class*=Cost]')].map(p => p.textContent.trim().substring(0,60)).filter(x => x).slice(0, 20);
            // 找模型名称
            const names = [...document.querySelectorAll('[class*=modelName], [class*=model-name], [class*=title], [class*=Title]')].map(el => el.textContent.trim().substring(0,50)).filter(x => x && x.length > 1).slice(0, 20);
            return JSON.stringify({ tabs: [...new Set(tabs)], cards: [...new Set(cards)], filters: [...new Set(filters)], prices: [...new Set(prices)], names: [...new Set(names)] });
          })();
        ` }));
      }, 500);
    }
    else if (id === "ev2") {
      try { console.log("功能区块分析:", JSON.parse(m.data.result)); } catch(e) { console.log("原始:", JSON.stringify(m.data).substring(0, 2000)); }
      
      // 如果还有余力，看看模型详情
      setTimeout(() => {
        console.log("\n--- 尝试找模型名称/价格详情 ---");
        ws.send(JSON.stringify({ type: "command", id: "ev3", action: "evaluate", code: `
          (() => {
            // 找一个可能是模型列表的表格/列表
            const tables = [...document.querySelectorAll('table, [role=grid], [class*=list], [class*=List]')].map(t => t.textContent.trim().substring(0,100)).filter(x => x).slice(0, 10);
            // 所有相对短的文本行
            const allLines = document.body.innerText.split('\\n').filter(l => l.trim() && l.trim().length < 120);
            const uniqueShort = [...new Set(allLines)].slice(0, 120);
            return JSON.stringify({ tables, textLines: uniqueShort });
          })();
        ` }));
      }, 500);
    }
    else if (id === "ev3") {
      try { console.log("详细文本:", JSON.parse(m.data.result)); } catch(e) { console.log("原始:", JSON.stringify(m.data).substring(0, 2000)); }
      ws.close();
    }
  }
});

// Safety timeout
setTimeout(() => { console.log("\n--- 超时退出 ---"); ws.close(); process.exit(0); }, 45000);
