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

let step = 0;
ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "auth_ok") {
    console.log("=== 1/6 当前标签页 ===");
    send("get_active_tab");
  }
  else if (msg.type === "result" && msg.id === "cmd1") {
    console.log("标题:", msg.data?.title);
    console.log("URL:", msg.data?.url);
    console.log("");
    console.log("=== 2/6 页面全文本 ===");
    send("get_text");
  }
  else if (msg.type === "result" && msg.id === "cmd2") {
    const t = msg.data?.text || "";
    console.log(t.substring(0, 16000));
    if (t.length > 16000) console.log("\n... (截断)");
    console.log("");
    console.log("=== 3/6 页面 HTML 结构 ===");
    send("get_html", { depth: 0 });
  }
  else if (msg.type === "result" && msg.id === "cmd3") {
    const h = msg.data?.html || "";
    console.log(h.substring(0, 10000));
    if (h.length > 10000) console.log("\n... (截断)");
    console.log("");
    console.log("=== 4/6 页面截图 ===");
    send("screenshot");
  }
  else if (msg.type === "result" && msg.id === "cmd4") {
    console.log("截图已保存到:", msg.data?.path || "(内联数据)");
    // 尝试点击各个导航入口按钮
    console.log("");
    console.log("=== 5/6 探索导航菜单 — 先找可点击元素 ===");
    send("get_active_tab");
  }
  else if (msg.type === "result" && msg.id === "cmd5") {
    // 找"模型广场""产品""服务""帮助""文档""控制台"等关键词
    send("find_elements", { text: "模型" });
  }
  else if (msg.type === "result" && msg.id === "cmd6") {
    console.log("找到 '模型' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    send("find_elements", { text: "开通" });
  }
  else if (msg.type === "result" && msg.id === "cmd7") {
    console.log("找到 '开通' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    send("find_elements", { text: "计量" });
  }
  else if (msg.type === "result" && msg.id === "cmd8") {
    console.log("找到 '计量' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    send("find_elements", { text: "API" });
  }
  else if (msg.type === "result" && msg.id === "cmd9") {
    console.log("找到 'API' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    send("find_elements", { text: "价格" });
  }
  else if (msg.type === "result" && msg.id === "cmd10") {
    console.log("找到 '价格' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    send("find_elements", { text: "免费" });
  }
  else if (msg.type === "result" && msg.id === "cmd11") {
    console.log("找到 '免费' 元素:", JSON.stringify(msg.data, null, 2).substring(0, 4000));
    console.log("");
    console.log("=== 6/6 最终截图 ===");
    send("screenshot");
  }
  else if (msg.type === "result" && msg.id === "cmd12") {
    console.log("最终截图已保存");
    ws.close();
  }
});
