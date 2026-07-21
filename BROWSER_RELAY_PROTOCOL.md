# Claude Browser Relay — AI Agent 浏览器控制协议

## 架构概览

```
AI Agent (你)               中转服务器               Chrome 扩展
    │                          │                        │
    │  ① WebSocket 连接        │                        │
    │  ② auth (controller)     │                        │
    ├──────────────────────────►│  ③ auth (browser)      │
    │                          │◄───────────────────────┤
    │  ④ 发送指令              │                        │
    ├──────────────────────────►│  ⑤ 转发指令             │
    │                          ├────────────────────────►│
    │                          │  ⑥ 返回结果             │
    │  ⑦ 返回结果              │◄───────────────────────┤
    │◄──────────────────────────┤                        │
```

1. Chrome 扩展（`extension/`）以 `browser` 角色连接到中转服务器
2. AI Agent 以 `controller` 角色连接到中转服务器
3. controller 发指令 → 服务器转发给 browser → browser 在 Chrome 里执行 → 结果原路返回

## 连接信息

```
服务器地址：ws://119.29.193.16:25818
认证 Token：claude-relay-221c7e14
```

## 连接流程

### 1. 建立 WebSocket 连接

```
WebSocket 连接到 ws://119.29.193.16:25818
```

### 2. 认证

连接成功后，第一个消息必须是认证：

```json
{
  "type": "auth",
  "role": "controller",
  "token": "claude-relay-221c7e14"
}
```

服务器回复：

```json
{
  "type": "auth_ok",
  "role": "controller",
  "clientId": "abc12345"
}
```

然后你会收到 browser 的连接状态：

```json
{
  "type": "browser_status",
  "connected": true
}
```

**注意**：`browser_status` 的 `connected` 为 `false` 时，说明 Chrome 扩展未连接或未打开，此时所有指令都会失败。

### 3. 发送指令

```json
{
  "type": "command",
  "id": "唯一的请求ID",
  "action": "操作名称",
  "参数1": "值1",
  "参数2": "值2"
}
```

### 4. 接收结果

成功：

```json
{
  "type": "result",
  "id": "与请求匹配的ID",
  "ok": true,
  "data": { /* 返回数据 */ }
}
```

失败：

```json
{
  "type": "result",
  "id": "与请求匹配的ID",
  "ok": false,
  "error": "错误描述"
}
```

通用错误（不带 id，通常不是针对特定指令的）：

```json
{
  "type": "error",
  "message": "错误描述"
}
```

---

## 所有可用指令

以下全部 `action` 值均可作为 `"action"` 字段传入。参数用键值对形式放在指令对象中。

---

### 导航

#### navigate — 导航到 URL
```json
{
  "type": "command", "id": "1",
  "action": "navigate",
  "url": "https://example.com"
}
```
返回：`{ tabId, url }`

#### new_tab — 新建标签页
```json
{
  "type": "command", "id": "2",
  "action": "new_tab",
  "url": "https://example.com"
}
```
`url` 可选，不传则打开空白页。返回：`{ tabId, url }`

#### close_tab — 关闭标签页
```json
{
  "type": "command", "id": "3",
  "action": "close_tab",
  "tabId": 12345
}
```
`tabId` 可选，不传则关闭当前活跃标签页。返回：`{ ok: true }`

#### go_back — 后退
```json
{ "type": "command", "id": "4", "action": "go_back" }
```

#### go_forward — 前进
```json
{ "type": "command", "id": "5", "action": "go_forward" }
```

---

### 标签页信息

#### get_tabs — 列出所有标签页
```json
{ "type": "command", "id": "6", "action": "get_tabs" }
```
返回：`[ { id, title, url, active } ]`

#### get_active_tab — 获取当前标签页
```json
{ "type": "command", "id": "7", "action": "get_active_tab" }
```
返回：`{ id, title, url }`

#### get_tab_info — 获取指定标签页
```json
{
  "type": "command", "id": "8",
  "action": "get_tab_info",
  "tabId": 12345
}
```

#### get_url — 获取当前 URL
```json
{ "type": "command", "id": "9", "action": "get_url" }
```
返回：`{ url }`

#### get_title — 获取当前标题
```json
{ "type": "command", "id": "10", "action": "get_title" }
```
返回：`{ title }`

---

### 截图

#### screenshot — 截取可见区域
```json
{
  "type": "command", "id": "11",
  "action": "screenshot",
  "format": "jpeg",
  "quality": 80,
  "tabId": 12345
}
```
- `format`：`"jpeg"`（默认）或 `"png"`
- `quality`：JPEG 质量 1-100，默认 80
- `tabId`：可选，不传则用当前活跃标签

返回：`{ tabId, format, dataUrl, _note }`
`dataUrl` 是一个 base64 data URL (`data:image/jpeg;base64,...`)，你可以解码保存为文件。

#### screenshot_element — 截取指定区域
```json
{
  "type": "command", "id": "12",
  "action": "screenshot_element",
  "x": 100, "y": 200,
  "width": 400, "height": 300
}
```
注意：区域截图依赖 content script，跨域页面可能受限。返回：`{ tabId, dataUrl }`

---

### 鼠标操作

所有坐标相对于浏览器视口，单位为像素。

#### click — 左键单击
```json
{
  "type": "command", "id": "13",
  "action": "click",
  "x": 500, "y": 300,
  "button": "left",
  "clickCount": 1
}
```
- `button`：`"left"` / `"right"` / `"middle"`
- `clickCount`：`1` = 单击，`2` = 双击

#### double_click — 双击（便捷方法）
```json
{
  "type": "command", "id": "14",
  "action": "double_click",
  "x": 500, "y": 300
}
```

#### right_click — 右键单击
```json
{
  "type": "command", "id": "15",
  "action": "right_click",
  "x": 500, "y": 300
}
```

#### hover — 鼠标悬停
```json
{
  "type": "command", "id": "16",
  "action": "hover",
  "x": 500, "y": 300
}
```
触发 mouseover/mouseenter/mousemove 事件，用于显示 tooltip、下拉菜单等。

#### drag — 拖拽
```json
{
  "type": "command", "id": "17",
  "action": "drag",
  "x1": 100, "y1": 200,
  "x2": 500, "y2": 600,
  "steps": 20,
  "duration": 800
}
```
- `steps`：中间帧数（越多越平滑），默认 10
- `duration`：总时长毫秒，默认 500

---

### 键盘操作

#### type — 输入文本
```json
{
  "type": "command", "id": "18",
  "action": "type",
  "text": "Hello World"
}
```
在焦点元素处输入。对 input/textarea 使用原生 setRangeText，对 contentEditable 使用 execCommand，其他元素模拟 keypress。

#### key_press — 按键
```json
{
  "type": "command", "id": "19",
  "action": "key_press",
  "key": "Enter",
  "ctrlKey": false,
  "shiftKey": false,
  "altKey": false,
  "metaKey": false,
  "repeat": 1
}
```
- `key`：按键名称，如 `"Enter"`, `"Escape"`, `"Tab"`, `"ArrowDown"`, `"a"`, `"Backspace"`
- `ctrlKey` / `shiftKey` / `altKey` / `metaKey`：修饰键
- `repeat`：重复次数，默认 1

---

### 滚动

#### scroll — 滚动到坐标
```json
{
  "type": "command", "id": "20",
  "action": "scroll",
  "x": 0, "y": 500
}
```

#### scroll_to — 滚动到元素
```json
{
  "type": "command", "id": "21",
  "action": "scroll_to",
  "selector": "#target-element"
}
```

---

### 表单操作

#### set_value — 设置输入值
```json
{
  "type": "command", "id": "22",
  "action": "set_value",
  "selector": "#email",
  "value": "hello@example.com"
}
```
- `selector`：CSS 选择器，或用 `:focus` 表示当前焦点元素
- 使用原生 setter，触发 input 和 change 事件

#### select_option — 选择选项
```json
{
  "type": "command", "id": "23",
  "action": "select_option",
  "selector": "#country",
  "value": "CN"
}
```
适用于 `<select>`、`<input type="checkbox">`、`<input type="radio">`。

#### file_upload — 文件上传
```json
{
  "type": "command", "id": "24",
  "action": "file_upload",
  "selector": "input[type=file]",
  "files": ["/path/to/file.jpg"]
}
```
注意：文件上传需要 CDP 调试器附加，浏览器顶部会显示调试器横幅。实际文件路径必须在用户机器上存在。

---

### 页面内容

#### get_text — 提取文本
```json
{
  "type": "command", "id": "25",
  "action": "get_text",
  "selector": "article"
}
```
- `selector` 默认为 `"body"`，优先提取 `<article>`, `<main>`, `[role="main"]` 内容
- 返回最多 100K 字符

#### get_html — 提取 HTML
```json
{
  "type": "command", "id": "26",
  "action": "get_html",
  "selector": "html"
}
```
返回最多 500K 字符。`selector` 默认为 `"html"`。

#### get_page_structure — 页面结构
```json
{
  "type": "command", "id": "27",
  "action": "get_page_structure",
  "interactiveOnly": true
}
```
- `interactiveOnly`：`true` 时只返回可交互元素（链接、按钮、输入框等），`false` 时还包含标题等
- 每个元素返回：`{ index, tag, id, class, role, text, href, placeholder, type, rect: { x, y, w, h }, visible }`
- 最多返回 500 个元素

#### find_elements — 搜索元素
```json
{
  "type": "command", "id": "28",
  "action": "find_elements",
  "query": "登录",
  "limit": 20
}
```
- 在文本、aria-label、placeholder 中匹配关键词
- 返回匹配元素的坐标和属性，格式同 get_page_structure

---

### JavaScript 执行

#### evaluate — 同步执行
```json
{
  "type": "command", "id": "29",
  "action": "evaluate",
  "code": "document.title"
}
```
在页面 `MAIN` world 中执行，返回 `{ result }`。

#### evaluate_async — 异步执行
```json
{
  "type": "command", "id": "30",
  "action": "evaluate_async",
  "code": "await fetch('/api/data').then(r => r.json())"
}
```
代码会被包裹在 async 函数中执行。返回 `{ result }`。

---

### Cookie

#### get_cookies — 读取 Cookie
```json
{
  "type": "command", "id": "31",
  "action": "get_cookies",
  "url": "https://example.com"
}
```
- `url` 可选，不传则用当前页面 URL
- 返回 `{ cookies: [...] }`

#### set_cookie — 设置 Cookie
```json
{
  "type": "command", "id": "32",
  "action": "set_cookie",
  "url": "https://example.com",
  "name": "session",
  "value": "abc123",
  "domain": ".example.com",
  "path": "/"
}
```

---

### 等待

#### wait — 等待毫秒
```json
{
  "type": "command", "id": "33",
  "action": "wait",
  "ms": 2000
}
```
最长 30 秒。

#### wait_for — 等待元素出现
```json
{
  "type": "command", "id": "34",
  "action": "wait_for",
  "selector": ".loading-complete",
  "text": "完成",
  "timeout": 10000
}
```
- `selector`：CSS 选择器
- `text`：可选，等待元素文本包含此字符串
- `timeout`：超时毫秒数，默认 10000，最长 30000

---

### 窗口

#### resize_window — 调整窗口尺寸
```json
{
  "type": "command", "id": "35",
  "action": "resize_window",
  "width": 1440,
  "height": 900
}
```

---

### 下载

#### download — 下载文件
```json
{
  "type": "command", "id": "36",
  "action": "download",
  "url": "https://example.com/report.pdf",
  "filename": "my-report.pdf"
}
```
`filename` 可选。

---

### 网络监控

#### get_network_requests — 查看网络请求
```json
{
  "type": "command", "id": "37",
  "action": "get_network_requests",
  "limit": 50,
  "clear": false
}
```
- 需要先附加调试器（首次调用自动附加，浏览器顶部会显示调试器横幅）
- 返回：`{ requests: [ { requestId, url, method, type, status, timestamp } ] }`
- `clear`：设为 `true` 则返回后清空记录

#### clear_network_requests — 清空请求记录
```json
{ "type": "command", "id": "38", "action": "clear_network_requests" }
```

#### block_request — 拦截请求
```json
{
  "type": "command", "id": "39",
  "action": "block_request",
  "pattern": "analytics"
}
```

#### unblock_request — 取消拦截
```json
{ "type": "command", "id": "40", "action": "unblock_request" }
```

---

### 控制台日志

#### get_console_logs — 查看控制台日志
```json
{
  "type": "command", "id": "41",
  "action": "get_console_logs"
}
```
- 需要先附加调试器
- 返回：`{ logs: [ { type, args, timestamp } ] }`

#### clear_console_logs — 清空日志
```json
{ "type": "command", "id": "42", "action": "clear_console_logs" }
```

---

## 完整操作示例

### 示例 1：打开网页并截图

```
→ 连接 WebSocket
→ 发送 auth

→ { "type": "command", "id": "1", "action": "navigate", "url": "https://github.com" }
← { "type": "result", "id": "1", "ok": true, "data": { "tabId": 123, "url": "https://github.com" } }

→ 等待 2 秒

→ { "type": "command", "id": "2", "action": "screenshot", "quality": 85 }
← { "type": "result", "id": "2", "ok": true, "data": { "tabId": 123, "format": "jpeg", "dataUrl": "data:image/jpeg;base64,..." } }

解码 dataUrl 的 base64 部分，保存为 screenshot.jpg
```

### 示例 2：搜索并点击

```
→ { "type": "command", "id": "1", "action": "navigate", "url": "https://www.baidu.com" }

→ { "type": "command", "id": "2", "action": "find_elements", "query": "搜索" }
← { "type": "result", "ok": true, "data": { "elements": [{ "index": 0, "tag": "input", "rect": { "x": 300, "y": 150, "w": 500, "h": 40 } }] } }

→ { "type": "command", "id": "3", "action": "click", "x": 550, "y": 170 }
→ { "type": "command", "id": "4", "action": "type", "text": "天气" }
→ { "type": "command", "id": "5", "action": "key_press", "key": "Enter" }
```

### 示例 3：填表自动化

```
→ { "type": "command", "id": "1", "action": "navigate", "url": "https://example.com/login" }
→ { "type": "command", "id": "2", "action": "set_value", "selector": "#email", "value": "user@example.com" }
→ { "type": "command", "id": "3", "action": "set_value", "selector": "#password", "value": "mypassword" }
→ { "type": "command", "id": "4", "action": "find_elements", "query": "登录" }
→ { "type": "command", "id": "5", "action": "click", "x": 400, "y": 300 }
→ { "type": "command", "id": "6", "action": "wait", "ms": 3000 }
→ { "type": "command", "id": "7", "action": "screenshot", "quality": 80 }
```

### 示例 4：提取页面数据

```
→ { "type": "command", "id": "1", "action": "navigate", "url": "https://news.ycombinator.com" }
→ { "type": "command", "id": "2", "action": "get_text", "selector": "body" }
→ { "type": "command", "id": "3", "action": "evaluate", "code": "Array.from(document.querySelectorAll('.titleline a')).map(a => ({title: a.textContent, url: a.href}))" }
```

---

## 错误处理指南

### 常见错误原因

| 错误消息 | 原因 | 处理方法 |
|----------|------|----------|
| `No browser connected` | Chrome 扩展未连接 | 检查扩展 popup 是否显示"已连接" |
| `No active tab` | 没有打开的标签页 | 先 new_tab 创建新标签 |
| `Cannot inject into tab` | 页面不允许注入（chrome:// 等） | 该页面无法控制，导航到普通网页 |
| `Connection closed` | WebSocket 断开 | 重新连接并认证 |
| `Invalid token` | Token 错误 | 确认 token 是否正确 |
| `Element not found: xxx` | CSS 选择器未匹配 | 先用 find_elements 或 get_page_structure 定位 |
| 命令超时 | 页面加载慢或浏览器无响应 | 增加 wait 时间，或检查浏览器是否卡死 |

### 最佳实践

1. **截图确认**：操作前先 screenshot 确认页面状态
2. **等待加载**：导航后等待 2-3 秒让页面渲染完成
3. **查找再点击**：先 find_elements 定位元素获取坐标，再 click
4. **命令 ID 唯一**：每个命令用递增的 ID，方便匹配响应
5. **超时处理**：设置合理的超时（建议 15-30 秒），超时后重试

---

## 连接管理

- 服务器同时只接受**一个 browser 连接**（新的 browser 连接会踢掉旧的）
- 允许多个 controller 同时连接
- 断开后会自动重连（扩展内置重连机制，间隔 1s → 2s → 4s → ... → 30s）
- 30 秒无响应视为命令超时

## 服务器运维

```bash
# 查看运行状态
pm2 status claude-browser-relay

# 查看日志
pm2 logs claude-browser-relay

# 重启服务
pm2 restart claude-browser-relay

# 更换 Token
echo "新token" > ~/claude-browser-relay/server/.token
RELAY_TOKEN="新token" pm2 restart claude-browser-relay
```

## 本地 CLI 工具

项目还包含一个命令行工具，位于 `cli/` 目录：

```bash
cd claude-browser-relay/cli
npm install
node browserctl.mjs
```

交互式命令参考 `help` 指令输出。

---

**版本**：0.1.0  
**协议版本**：1  
**最后更新**：2026-06-05
