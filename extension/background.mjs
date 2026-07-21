// Claude Browser Relay — Extension Background Service Worker v0.2
// Production-hardened: reconnection, heartbeat, state persistence, cleanup.

// ============================================================
// STATE (recovered from storage on wake)
// ============================================================
let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 25000;

let connectedAt = null;
let connectionId = null;

// ============================================================
// CONFIG (backed by chrome.storage)
// ============================================================
async function getConfig() {
  const cfg = await chrome.storage.local.get({
    serverUrl: 'ws://127.0.0.1:25818',
    authToken: ''
  });
  return cfg;
}

// ============================================================
// DIAGNOSTICS
// ============================================================
function diag(msg) {
  console.log(`[Bridge] ${msg}`);
}

function diagErr(msg, err) {
  console.error(`[Bridge] ${msg}`, err?.message || err);
}

// ============================================================
// CONNECTION (with exponential backoff + jitter)
// ============================================================
function jitter(ms) {
  return ms + Math.floor(Math.random() * ms * 0.3);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = jitter(reconnectDelay);
  diag(`Reconnecting in ${Math.round(delay / 1000)}s...`);
  reconnectTimer = setTimeout(connect, delay);
}

async function connect() {
  // Clear any pending reconnect
  clearTimeout(reconnectTimer);

  // Don't double-connect
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  // Clean up stale socket
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.authToken) {
    diag('No server URL or token configured — retrying in 10s');
    reconnectDelay = 10000;
    scheduleReconnect();
    return;
  }

  diag(`Connecting to ${cfg.serverUrl}...`);

  try {
    ws = new WebSocket(cfg.serverUrl);
  } catch (err) {
    diagErr('Failed to create WebSocket', err);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000; // Reset on successful connect
    diag('TCP open — sending auth...');
    ws.send(JSON.stringify({ type: 'auth', role: 'browser', token: cfg.authToken }));
  };

  ws.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    // Track auth success
    if (msg.type === 'auth_ok') {
      connectedAt = Date.now();
      connectionId = msg.clientId;
      diag(`Authenticated as ${msg.role} (${connectionId})`);
      startHeartbeat();
      return;
    }

    // Ignore status pushes
    if (msg.type === 'browser_status') return;

    // Pong
    if (msg.type === 'ping') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      return;
    }

    // Command
    if (msg.type === 'command' || msg.action) {
      await handleMessage(msg);
    }
  };

  ws.onclose = (event) => {
    diag(`Disconnected (code=${event.code}, reason="${event.reason || 'none'}")`);
    connectedAt = null;
    connectionId = null;
    clearInterval(heartbeatTimer);
    ws = null;

    // If clean close (1000), don't reconnect unless we want to
    // For our use case, always reconnect
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose always fires after onerror, so just log here
    diag('WebSocket transport error');
    // Don't set ws=null here — let onclose handle cleanup
  };
}

// ============================================================
// HEARTBEAT
// ============================================================
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    } else {
      clearInterval(heartbeatTimer);
    }
  }, HEARTBEAT_INTERVAL);
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
async function handleMessage(msg) {
  try {
    const result = await executeCommand(msg);
    reply(msg, { type: 'result', id: msg.id, ok: true, data: result });
  } catch (err) {
    diagErr(`Command "${msg.action}" failed`, err);
    reply(msg, { type: 'result', id: msg.id, ok: false, error: err.message });
  }
}

function reply(original, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    data._controllerId = original._controllerId;
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      diagErr('Failed to send reply', err);
    }
  }
}

// ============================================================
// COMMAND EXECUTOR
// ============================================================
async function executeCommand(cmd) {
  switch (cmd.action) {
    // ─── Navigation ───
    case 'navigate': {
      const tab = await getActiveTab();
      await chrome.tabs.update(tab.id, { url: formatUrl(cmd.url) });
      await waitLoad(tab.id);
      onTabNavigated(tab.id);
      return { tabId: tab.id, url: cmd.url };
    }

    case 'new_tab': {
      const tab = await chrome.tabs.create({ url: cmd.url ? formatUrl(cmd.url) : 'about:blank' });
      await waitLoad(tab.id);
      return { tabId: tab.id, url: tab.url };
    }

    case 'close_tab': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await chrome.tabs.remove(tabId);
      return { ok: true };
    }

    case 'go_back':
    case 'go_forward': {
      const tab = await getActiveTab();
      if (!tab.id) throw new Error('No active tab');
      if (cmd.action === 'go_back') {
        await chrome.tabs.goBack(tab.id);
      } else {
        await chrome.tabs.goForward(tab.id);
      }
      await wait(500);
      await waitLoad(tab.id);
      onTabNavigated(tab.id);
      return { tabId: tab.id };
    }

    // ─── Tab Info ───
    case 'get_tabs': {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
    }

    case 'get_active_tab': {
      const tab = await getActiveTab();
      return { id: tab.id, title: tab.title, url: tab.url };
    }

    case 'get_tab_info': {
      const tab = cmd.tabId ? await chrome.tabs.get(cmd.tabId) : await getActiveTab();
      return { id: tab.id, title: tab.title, url: tab.url };
    }

    case 'get_url': {
      const tab = await getActiveTab();
      return { url: tab.url };
    }

    case 'get_title': {
      const tab = await getActiveTab();
      return { title: tab.title };
    }

    // ─── Screenshot ───
    case 'screenshot': {
      const tab = cmd.tabId ? await chrome.tabs.get(cmd.tabId) : await getActiveTab();
      const dataUrl = await chrome.tabs.captureVisibleTab(
        tab.windowId,
        cmd.format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: cmd.quality || 80 }
      );
      return { tabId: tab.id, format: cmd.format || 'jpeg', dataUrl };
    }

    case 'screenshot_element': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'screenshot_element',
        x: cmd.x, y: cmd.y,
        width: cmd.width, height: cmd.height
      });
      if (!result || !result.dataUrl) throw new Error('Element screenshot failed');
      return { tabId, dataUrl: result.dataUrl };
    }

    // ─── Mouse ───
    case 'click':
    case 'double_click':
    case 'right_click':
    case 'hover': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      let result;
      if (cmd.action === 'double_click') {
        result = await chrome.tabs.sendMessage(tabId, { action: 'click', x: cmd.x, y: cmd.y, button: 'left', clickCount: 2 });
      } else if (cmd.action === 'right_click') {
        result = await chrome.tabs.sendMessage(tabId, { action: 'click', x: cmd.x, y: cmd.y, button: 'right', clickCount: 1 });
      } else if (cmd.action === 'hover') {
        result = await chrome.tabs.sendMessage(tabId, { action: 'hover', x: cmd.x, y: cmd.y });
      } else {
        result = await chrome.tabs.sendMessage(tabId, { action: 'click', x: cmd.x, y: cmd.y, button: cmd.button || 'left', clickCount: cmd.clickCount || 1 });
      }
      await wait(300);
      return result || { ok: true };
    }

    case 'drag': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, {
        action: 'drag',
        x1: cmd.x1, y1: cmd.y1,
        x2: cmd.x2, y2: cmd.y2,
        steps: cmd.steps || 10,
        duration: cmd.duration || 500
      });
      await wait(500);
      return { ok: true };
    }

    // ─── Keyboard ───
    case 'type': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { action: 'type', text: cmd.text });
      return { ok: true };
    }

    case 'key_press': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, {
        action: 'key_press', key: cmd.key,
        ctrlKey: cmd.ctrlKey, shiftKey: cmd.shiftKey,
        altKey: cmd.altKey, metaKey: cmd.metaKey,
        repeat: cmd.repeat || 1
      });
      return { ok: true };
    }

    // ─── Scroll ───
    case 'scroll': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { action: 'scroll', x: cmd.x || 0, y: cmd.y || 0 });
      return { ok: true };
    }

    case 'scroll_to': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { action: 'scroll_to', selector: cmd.selector });
      return { ok: true };
    }

    // ─── Form ───
    case 'set_value': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { action: 'set_value', selector: cmd.selector, value: cmd.value });
      return { ok: true };
    }

    case 'select_option': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      await chrome.tabs.sendMessage(tabId, { action: 'select_option', selector: cmd.selector, value: cmd.value });
      return { ok: true };
    }

    // ─── Page Content ───
    case 'get_text': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      const result = await chrome.tabs.sendMessage(tabId, { action: 'get_text', selector: cmd.selector || 'body' });
      return { text: result.text };
    }

    case 'get_html': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      const result = await chrome.tabs.sendMessage(tabId, { action: 'get_html', selector: cmd.selector || 'html' });
      return { html: result.html };
    }

    case 'get_page_structure': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: 'get_page_structure', interactiveOnly: cmd.interactiveOnly ?? false });
    }

    case 'find_elements': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, { action: 'find_elements', query: cmd.query, limit: cmd.limit || 20 });
    }

    // ─── JavaScript ───
    case 'evaluate': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: new Function(`return (${cmd.code})`)(),
        world: 'ISOLATED'
      });
      return { result: results[0]?.result };
    }

    case 'evaluate_async': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: new Function(`return (async () => { ${cmd.code} })();`)(),
        world: 'ISOLATED'
      });
      return { result: results[0]?.result };
    }

    // ─── Console Logs ───
    case 'get_console_logs': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      const logs = lastConsoleLogs.get(tabId) || [];
      // Only attach if we haven't already — returns cached otherwise
      return { logs };
    }

    case 'clear_console_logs': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      lastConsoleLogs.delete(tabId);
      return { ok: true };
    }

    // ─── Network Monitoring ───
    case 'get_network_requests': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      const requests = networkRequests.get(tabId) || [];
      if (cmd.clear) networkRequests.set(tabId, []);
      return { requests: requests.slice(-(cmd.limit || 100)) };
    }

    case 'clear_network_requests': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      networkRequests.set(tabId, []);
      return { ok: true };
    }

    // ─── Cookies ───
    case 'get_cookies': {
      const tab = await getActiveTab();
      const url = cmd.url || tab.url;
      return { cookies: await chrome.cookies.getAll({ url }) };
    }

    case 'set_cookie': {
      const tab = await getActiveTab();
      const cookie = await chrome.cookies.set({
        url: cmd.url || tab.url,
        name: cmd.name, value: cmd.value,
        domain: cmd.domain, path: cmd.path || '/'
      });
      return { cookie };
    }

    // ─── Wait ───
    case 'wait': {
      const ms = Math.min(cmd.ms || 1000, 30000);
      await wait(ms);
      return { waited: ms };
    }

    case 'wait_for': {
      const tabId = cmd.tabId || (await getActiveTab()).id;
      await ensureInjected(tabId);
      return await chrome.tabs.sendMessage(tabId, {
        action: 'wait_for',
        selector: cmd.selector,
        text: cmd.text,
        timeout: Math.min(cmd.timeout || 10000, 30000)
      });
    }

    // ─── Window ───
    case 'resize_window': {
      const tab = await getActiveTab();
      await chrome.windows.update(tab.windowId, { width: cmd.width, height: cmd.height });
      return { ok: true };
    }

    // ─── Download ───
    case 'download': {
      const downloadId = await chrome.downloads.download({ url: cmd.url, filename: cmd.filename });
      return { downloadId };
    }

    default:
      throw new Error(`Unknown action: ${cmd.action}`);
  }
}

// ============================================================
// HELPERS
// ============================================================
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab;
}

function formatUrl(url) {
  if (!url || url === 'forward' || url === 'back') return url;
  return url.startsWith('http') ? url : `https://${url}`;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// waitLoad with guaranteed listener cleanup
async function waitLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    const timeout = setTimeout(() => { cleanup(); resolve(); }, 15000);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ============================================================
// DEBUGGER MANAGEMENT (with dedup + auto-detach on navigation)
// ============================================================
const debuggedTabs = new Set();
let debuggerListener = null;

function getDebuggerListener() {
  if (debuggerListener) return debuggerListener;
  debuggerListener = (source, method, params) => {
    if (!debuggedTabs.has(source.tabId)) return;

    if (method === 'Runtime.consoleAPICalled') {
      const logs = lastConsoleLogs.get(source.tabId) || [];
      logs.push({ type: params.type, args: params.args, timestamp: Date.now() });
      if (logs.length > 500) logs.shift();
      lastConsoleLogs.set(source.tabId, logs);
    }
    if (method === 'Network.requestWillBeSent') {
      const reqs = networkRequests.get(source.tabId) || [];
      reqs.push({ requestId: params.requestId, url: params.request?.url, method: params.request?.method, type: params.type, timestamp: Date.now() });
      if (reqs.length > 1000) reqs.shift();
      networkRequests.set(source.tabId, reqs);
    }
    if (method === 'Network.responseReceived') {
      const reqs = networkRequests.get(source.tabId) || [];
      const existing = reqs.find(r => r.requestId === params.requestId);
      if (existing) {
        existing.status = params.response?.status;
        existing.responseTimestamp = Date.now();
      }
    }
  };
  chrome.debugger.onEvent.addListener(debuggerListener);
  return debuggerListener;
}

async function attachDebugger(tabId) {
  if (debuggedTabs.has(tabId)) {
    // Verify still attached
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' });
      return;
    } catch {
      // Detached by navigation — clean up and re-attach
      debuggedTabs.delete(tabId);
    }
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggedTabs.add(tabId);
  getDebuggerListener(); // Ensure global listener is registered
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
}

// Clean up debugger + content script when tab navigates
function onTabNavigated(tabId) {
  if (debuggedTabs.has(tabId)) {
    chrome.debugger.detach({ tabId }).catch(() => {});
    debuggedTabs.delete(tabId);
  }
  // Content script is gone after navigation — clear cache so ensureInjected re-injects
  injectedTabs.delete(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    onTabNavigated(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabNavigated(tabId);
  injectedTabs.delete(tabId);
  lastConsoleLogs.delete(tabId);
  networkRequests.delete(tabId);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  debuggedTabs.delete(source.tabId);
  diag(`Debugger detached from tab ${source.tabId} (${reason})`);
});

// ============================================================
// CONTENT SCRIPT INJECTION
// ============================================================
const injectedTabs = new Set();

async function ensureInjected(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.mjs'] });
    injectedTabs.add(tabId);
  } catch {
    throw new Error(`Cannot inject into tab ${tabId} — may be a restricted page`);
  }
}

// ============================================================
// DATA STORES
// ============================================================
const lastConsoleLogs = new Map();
const networkRequests = new Map();

// ============================================================
// MESSAGE ROUTING (popup ↔ background)
// ============================================================
chrome.runtime.onConnect.addListener(() => {});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'ping') return Promise.resolve({ pong: true });
  if (msg.action === 'reconnect') { reconnectDelay = 1000; connect(); return Promise.resolve({ ok: true }); }
  if (msg.action === 'get_config') return getConfig();
  if (msg.action === 'set_config') {
    return chrome.storage.local.set({ serverUrl: msg.serverUrl, authToken: msg.authToken }).then(() => {
      // Reconnect with new config
      if (ws) { try { ws.close(); } catch {} }
      reconnectDelay = 1000;
      connect();
      return { ok: true };
    });
  }
  if (msg.action === 'get_status') {
    return Promise.resolve({
      connected: ws !== null && ws.readyState === WebSocket.OPEN,
      serverUrl: ws?.url || null,
      connectedAt,
      connectionId
    });
  }
});

// ============================================================
// KEEPALIVE — Chrome MV3 kills idle SW after 30s
// ============================================================
chrome.alarms?.create?.('keepalive-bridge', { periodInMinutes: 0.5 }); // every 30s
chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === 'keepalive-bridge') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      diag('Keepalive check: reconnecting...');
      reconnectDelay = 1000;
      connect();
    }
  }
});

// ============================================================
// BOOT
// ============================================================
diag('Service Worker starting...');
connect();
