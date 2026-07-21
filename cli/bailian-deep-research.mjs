import { WebSocket } from "ws";

const ws = new WebSocket("ws://119.29.193.16:25818");
let cmdId = 0;
function nextCmd() { return "cmd" + (++cmdId); }
function send(action, params = {}) {
  const id = nextCmd();
  ws.send(JSON.stringify({ type: "command", id, action, ...params }));
  return id;
}

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", role: "controller", token: "claude-relay-221c7e14" }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "auth_ok") {
    // Step 1: 看看当前页面是不是百炼控制台
    console.log("=== 1. 确认当前页面 ===");
    send("evaluate", { code: "JSON.stringify({title: document.title, url: location.href, bodyText: document.body.innerText.substring(0, 5000)})" });
  }

  else if (msg.type === "result" && msg.id === "cmd1") {
    const data = JSON.parse(msg.data.result);
    console.log("标题:", data.title);
    console.log("URL:", data.url);
    console.log("页面内容前500字:\n", data.bodyText.substring(0, 500));

    // 寻找左侧导航/百炼入口/模型入口
    console.log("\n=== 2. 导航栏分析 ===");
    send("evaluate", { code: `
      // 找所有左侧导航链接
      const links = [];
      document.querySelectorAll('a[href*="bailian"], a[href*="model"], [class*="nav"] a, [class*="menu"] a, [class*="sidebar"] a').forEach(a => {
        links.push({text: a.textContent?.trim()?.substring(0,60), href: a.href, cls: a.className?.substring(0,80)});
      });
      // 如果没找到，找所有可见的导航项
      if (links.length === 0) {
        document.querySelectorAll('[class*="left"] a, nav a, [role="menuitem"], [class*="side"] a, [class*="Menu"] a').forEach(a => {
          links.push({text: a.textContent?.trim()?.substring(0,60), href: a.href, cls: a.className?.substring(0,80)});
        });
      }
      JSON.stringify(links.slice(0, 60));
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd2") {
    const links = JSON.parse(msg.data.result);
    console.log("导航链接(前60个):");
    links.forEach((l, i) => console.log(`  [${i}] ${l.text || "(无文字)"} -> ${l.href?.substring(0,80) || "无href"} (${l.cls})`));

    // Step 3: 判断是否在百炼控制台内部
    console.log("\n=== 3. 检查页面是否显示模型市场 ===");
    send("evaluate", { code: `
      // 检查是否在百炼控制台
      const isBailian = location.href.includes('bailian');
      
      // 找页面中的tab/分类
      const tabs = [];
      document.querySelectorAll('[role="tab"], [class*="tab"], [class*="Tab"], [class*="category"], [class*="Category"]').forEach(t => {
        tabs.push({text: t.textContent?.trim()?.substring(0,40), cls: t.className?.substring(0,60), role: t.getAttribute('role')});
      });
      
      // 找所有按钮
      const buttons = [];
      document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="Btn"]').forEach(b => {
        const txt = b.textContent?.trim()?.substring(0,50);
        if (txt && txt.length > 0) buttons.push(txt);
      });
      
      // 找主要卡片/板块区域
      const cards = [];
      document.querySelectorAll('[class*="card"], [class*="Card"], [class*="block"], [class*="Block"], [class*="section"], [class*="Section"]').forEach(c => {
        const txt = c.textContent?.trim()?.substring(0,60);
        if (txt && txt.length > 0 && txt.length < 100) cards.push(txt);
      });
      
      JSON.stringify({
        isBailian,
        bailianTabs: tabs,
        buttons: [...new Set(buttons)].slice(0, 40),
        cards: [...new Set(cards)].slice(0, 30)
      });
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd3") {
    const ui = JSON.parse(msg.data.result);
    console.log("是否在百炼页面:", ui.isBailian);
    console.log("Tabs:", JSON.stringify(ui.bailianTabs));
    console.log("按钮:", JSON.stringify(ui.buttons));
    console.log("卡片/板块:", JSON.stringify(ui.cards));

    // Step 4: 尝试进入模型广场或百炼内部
    console.log("\n=== 4. 查看百炼内部完整导航 ===");
    send("evaluate", { code: `
      // 展开左侧所有菜单项
      const allNavItems = [];
      document.querySelectorAll('[class*="left"] *, [data-testid] *, [class*="sidemenu"] *, [class*="SideMenu"] *').forEach(el => {
        const txt = el.textContent?.trim()?.substring(0,50);
        const parentTxt = el.parentElement?.textContent?.trim()?.substring(0,50);
        if (txt && txt.length > 0 && txt.length < 80 && txt !== parentTxt) {
          allNavItems.push(txt);
        }
      });
      
      // 找所有可见的链接
      const visibleLinks = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const rect = a.getBoundingClientRect();
        const txt = a.textContent?.trim()?.substring(0,60);
        if (txt && rect.width > 0 && rect.height > 0 && txt.length > 0) {
          visibleLinks.push({text: txt, href: a.href?.substring(0,100)});
        }
      });
      
      JSON.stringify({
        uniqueNavTexts: [...new Set(allNavItems)].slice(0, 80),
        visibleLinks: visibleLinks.slice(0, 40)
      });
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd4") {
    const nav = JSON.parse(msg.data.result);
    console.log("唯一导航文本:");
    nav.uniqueNavTexts.forEach((t, i) => console.log(`  [${i}] ${t}`));
    console.log("\n可见链接:");
    nav.visibleLinks.forEach((l, i) => console.log(`  [${i}] "${l.text}" -> ${l.href}`));

    // 现在尝试点击进入百炼或模型市场
    console.log("\n=== 5. 尝试导航到百炼控制台 ===");
    // 先看看页面是否有"模型广场"或"百炼"入口链接
    const bailianLink = nav.visibleLinks.find(l => l.text.includes("百炼") || l.href?.includes("bailian"));
    const modelLink = nav.visibleLinks.find(l => l.text.includes("模型") && (l.text.includes("广场") || l.text.includes("市场")));
    console.log("找到百炼链接:", bailianLink?.href || "无");
    console.log("找到模型链接:", modelLink?.href || "无");

    // 不管了，直接 navigate 到百炼模型市场
    console.log("\n直接 navigate 到百炼模型市场页...");
    send("navigate", { url: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market" });
  }

  else if (msg.type === "result" && msg.id === "cmd5") {
    // navigated，等页面加载
    console.log("导航完成，等待一秒...");
    await new Promise(r => setTimeout(r, 2000));
    send("get_active_tab");
  }
  
  else if (msg.type === "result" && msg.id === "cmd6") {
    console.log("当前标签:", msg.data?.title, msg.data?.url);
    // 获取页面完整内容
    send("get_text");
  }

  else if (msg.type === "result" && msg.id === "cmd7") {
    const text = msg.data?.text || "";
    console.log("\n=== 百炼模型市场页面文本 ===");
    console.log(text);

    // 深入分析页面功能区域
    console.log("\n=== 6. 分析页面功能结构 ===");
    send("evaluate", { code: `
      // 找所有功能区
      const sections = [];
      document.querySelectorAll('[class*="section"], [class*="Section"], [class*="filter"], [class*="Filter"], [class*="search"], [class*="Search"], [class*="model-item"], [class*="modelCard"]').forEach(el => {
        const txt = el.textContent?.trim()?.substring(0,80);
        if (txt && txt.length > 0) sections.push(txt);
      });
      
      // 找所有可点击的模型卡片/列表项
      const modelItems = [];
      document.querySelectorAll('[class*="model"], [class*="Model"], [class*="item-card"], [class*="card-item"]').forEach(el => {
        const txt = el.textContent?.trim()?.substring(0,60);
        if (txt && txt.length > 0) modelItems.push(txt);
      });
      
      // 筛选条件类别
      const allText = document.body.innerText;
      const lines = allText.split('\\n').filter(l => l.trim().length > 0 && l.trim().length < 50);
      const uniqueLines = [...new Set(lines)].slice(0, 60);
      
      JSON.stringify({
        sections: [...new Set(sections)].slice(0, 30),
        modelItems: [...new Set(modelItems)].slice(0, 30),
        shortLines: uniqueLines
      });
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd8") {
    const analysis = JSON.parse(msg.data.result);
    console.log("功能区块:", JSON.stringify(analysis.sections, null, 2));
    console.log("模型项:", JSON.stringify(analysis.modelItems, null, 2));
    console.log("页面短文本行:");
    analysis.shortLines.forEach((l, i) => console.log(`  ${l}`));

    // 获取截图看页面实际样子
    console.log("\n=== 7. 页面截图 ===");
    send("screenshot");
  }

  else if (msg.type === "result" && msg.id === "cmd9") {
    // 找模型分类/筛选
    console.log("\n=== 8. 探索筛选/分类 ===");
    send("evaluate", { code: `
      // 找下拉/筛选项
      const selects = [];
      document.querySelectorAll('select, [role="listbox"], [class*="dropdown"], [class*="select"], [class*="Select"], [class*="checkbox"], [class*="Checkbox"], [class*="radio"], [class*="Radio"]').forEach(el => {
        const txt = el.textContent?.trim()?.substring(0,80);
        if (txt && txt.length > 0) selects.push(txt.substring(0,60));
      });
      
      // 找标签/分类标签
      const tags = [];
      document.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="badge"], [class*="Badge"], [class*="label"], [class*="Label"]').forEach(el => {
        const txt = el.textContent?.trim()?.substring(0,40);
        if (txt && txt.length > 0) tags.push(txt);
      });
      
      JSON.stringify({
        selectors: [...new Set(selects)].slice(0, 30),
        tags: [...new Set(tags)].slice(0, 30)
      });
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd10") {
    const ui2 = JSON.parse(msg.data.result);
    console.log("筛选项:", JSON.stringify(ui2.selectors, null, 2));
    console.log("标签/分类:", JSON.stringify(ui2.tags, null, 2));

    // 打开一个模型详情看看
    console.log("\n=== 9. 探索模型详情页 ===");
    // 找第一个模型卡片/链接点击
    send("evaluate", { code: `
      // 找页面中所有的 h3/h4/h5，这些通常是模型名
      const headings = [];
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        const txt = h.textContent?.trim();
        if (txt && txt.length > 0 && txt.length < 60) headings.push({tag: h.tagName, text: txt});
      });
      JSON.stringify(headings.slice(0, 20));
    `});
  }

  else if (msg.type === "result" && msg.id === "cmd11") {
    console.log("页面标题:", JSON.parse(JSON.stringify(msg.data)));
    const headings = JSON.parse(msg.data.result);
    console.log("页面标题结构:");
    headings.forEach(h => console.log(`  <${h.tag}> ${h.text}`));

    // 最终截图
    console.log("\n=== 10. 最终截图 ===");
    send("screenshot");
  }

  else if (msg.type === "result" && msg.id === "cmd12") {
    console.log("\n=== 调研完成 ===");
    ws.close();
  }
});
