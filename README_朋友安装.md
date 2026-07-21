# Claude Browser Relay 朋友安装说明

这是一套让 AI 通过中转服务控制“你当前 Chrome 浏览器”的本地工具。

它适合这样的场景：

- 朋友也有 Codex，想让 Codex 操作自己电脑上的 Chrome。
- 想用自己的浏览器登录状态、Cookie、网页权限，而不是让 AI 新开一个无登录浏览器。
- 想让 AI 做打开网页、点击、输入、截图、读取页面内容等浏览器自动化操作。

## 一句话原理

```text
Codex / AI controller -> WebSocket relay server -> Chrome 扩展 -> 朋友的 Chrome 浏览器
```

三部分分别是：

1. `server/`：WebSocket 中转服务器，只负责转发消息。
2. `extension/`：Chrome 扩展，安装在朋友的 Chrome 里，真正执行浏览器操作。
3. `cli/`：命令行 controller，用来测试连接、发指令、验证截图。

## 先选部署方案

### 方案 A：本机模式，不需要买服务器

如果朋友的 Codex 和 Chrome 都在同一台电脑上，推荐用这个。

优点：

- 不需要公网服务器。
- 最安全，浏览器控制链路只在本机。
- 最适合个人日常使用。

连接地址：

```text
ws://127.0.0.1:25818
```

适用情况：

```text
朋友电脑上运行 Codex
朋友电脑上运行 Chrome
朋友电脑上运行 relay server
```

### 方案 B：使用 Jack 的服务器开独立端口

如果朋友的 AI 环境需要通过公网连接他的浏览器，或者他不方便自己买服务器，可以借用 Jack 的腾讯云服务器。

推荐做法：

```text
Jack 自己使用: ws://119.29.193.16:25818 + Jack 自己的 token
朋友使用:     ws://119.29.193.16:25819 + 朋友自己的 token
```

必须做到：

- 独立端口
- 独立 token
- 独立 pm2 进程名

不要让朋友直接共用 Jack 当前的 `25818` 和 token。否则新的 browser 连接可能会顶掉 Jack 的浏览器连接，也有隐私风险。

### 方案 C：朋友自己买服务器

这是长期最独立的方案。

朋友可以购买任意轻量云服务器，只要支持：

- Node.js 18+
- 一个开放的 TCP 端口，比如 `25818`
- pm2 或 systemd 常驻运行

## 本机模式安装步骤

### 1. 安装 Node.js

需要 Node.js 18 或更高版本。

检查：

```bash
node -v
npm -v
```

### 2. 安装 server 依赖

```bash
cd claude-browser-relay/server
npm install
```

### 3. 生成自己的 token

```bash
node -e "console.log(require('crypto').randomUUID())"
```

复制输出结果，例如：

```text
8f14b1b2-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 4. 启动本机 relay server

把下面的 token 换成朋友自己的 token：

```bash
cd claude-browser-relay/server
RELAY_PORT=25818 RELAY_TOKEN="朋友自己的token" npm start
```

看到类似输出就说明服务起来了：

```text
Claude Browser Relay — ws://0.0.0.0:25818
Auth token: ...
```

### 5. 安装 Chrome 扩展

打开 Chrome：

```text
chrome://extensions/
```

然后：

1. 打开右上角“开发者模式”
2. 点击“加载已解压的扩展程序”
3. 选择项目里的 `extension/` 文件夹
4. 点击扩展图标，填入：

```text
Server URL: ws://127.0.0.1:25818
Token: 朋友自己的token
```

保存后，如果显示 connected / 已连接，就说明扩展连上了本机 server。

### 6. 安装 cli 依赖并测试

```bash
cd claude-browser-relay/cli
npm install
node browserctl.mjs
```

进入交互命令后：

```text
connect ws://127.0.0.1:25818 朋友自己的token
tabs
screenshot
```

如果能看到当前标签页、能截图，说明整套链路可用。

## 使用 Jack 服务器开独立端口

这个方案适合 Jack 帮朋友省一台服务器。

### Jack 要做的事

在 Jack 的服务器上开一个新端口，例如 `25819`，并给朋友生成独立 token。

可以使用项目里的脚本：

```bash
bash scripts/deploy-shared-instance.sh root@119.29.193.16 friend-name 25819
```

脚本会在服务器上创建：

```text
~/claude-browser-relay-friend-name
```

并启动 pm2 进程：

```text
claude-browser-relay-friend-name
```

脚本完成后会输出：

```text
Server URL: ws://119.29.193.16:25819
Token: ...
```

把这两项给朋友即可。

### 服务器安全组

腾讯云安全组需要放行朋友使用的端口，例如：

```text
25819/TCP
```

如果端口没放行，朋友的扩展和 CLI 都会连不上。

### 朋友要做的事

朋友只需要：

1. 安装 Chrome 扩展
2. 在扩展里填写 Jack 给的 `Server URL` 和 `Token`
3. 在自己的 Codex / CLI 里也使用同样的 `Server URL` 和 `Token`

示例：

```text
Server URL: ws://119.29.193.16:25819
Token: 朋友自己的token
```

## 给朋友拷贝项目时注意

建议不要把这些东西打包给朋友：

- `node_modules/`
- 截图测试文件
- Jack 自己的 `.browser-relay.json`
- Jack 当前正在使用的 token

项目里提供了一个安全的配置示例：

```text
.browser-relay.example.json
```

朋友可以参考它创建自己的 `~/.browser-relay.json`，但不要直接使用示例里的占位 token。

可以用项目里的打包脚本生成干净交付包：

```bash
bash scripts/make-friend-package.sh
```

打包结果会出现在：

```text
/tmp/claude-browser-relay-friend-package
```

## 隐私和安全提醒

这个工具可以操作浏览器，也可以截图和读取页面内容，所以不要把 token 当普通密码随便发。

建议规则：

1. 每个人一个独立 token。
2. 每个人一个独立端口或独立服务器。
3. 不共用 Jack 当前的 `25818`。
4. 不把 token 发到群聊或公开文档。
5. 不用时可以停止对应 pm2 进程。

## 常见问题

### 朋友没有服务器怎么办？

优先用本机模式：

```text
ws://127.0.0.1:25818
```

只要 Codex 和 Chrome 在同一台电脑，就不需要服务器。

### 可以用 Jack 的服务器吗？

可以，但要独立端口和独立 token。

推荐：

```text
Jack: 25818
朋友: 25819
```

### 为什么不能共用同一个端口？

当前 server 逻辑同一时间只保存一个 browser 连接。新的 browser 连上时，会替换旧 browser。

所以朋友如果连 Jack 的 `25818`，可能会把 Jack 的 Chrome 顶掉。

### Chrome 扩展显示未连接怎么办？

按顺序检查：

1. server 是否启动
2. Server URL 是否正确
3. Token 是否正确
4. 端口是否被防火墙 / 安全组放行
5. 本机模式下是否使用了 `ws://127.0.0.1:25818`

### 返回 `Unknown action: undefined` 是什么问题？

命令格式错了。

必须用：

```json
{
  "type": "command",
  "id": "cmd1",
  "action": "navigate",
  "url": "https://www.baidu.com"
}
```

不能用：

```json
{
  "type": "command",
  "id": "cmd1",
  "method": "navigate",
  "params": {
    "url": "https://www.baidu.com"
  }
}
```
