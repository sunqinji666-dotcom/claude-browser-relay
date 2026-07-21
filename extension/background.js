'use strict';

// Claude Browser Bridge v2.0 — Background Service Worker
// Production-hardened: CSP-safe eval, content script health, state persistence,
// debugger auto-detach, event queue, heartbeat reconnection.

// ─── State ───
let ws = null, reconnectTimer = null, heartbeatTimer = null, debuggerIdleTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000, HEARTBEAT_INTERVAL = 25000, DEBUGGER_IDLE_MS = 90000;
let connectedAt = null, connectionId = null;
let injectedTabs = new Set(), debuggedTabs = new Set();
let lastConsoleLogs = new Map(), networkRequests = new Map(), blockedUrls = new Map();
let eventQueue = [];

// ─── Boot ───
(async function boot() {
  try {
    const saved = await chrome.storage.session.get(['injectedTabs','debuggedTabs','blockedUrls']);
    if (saved.injectedTabs) injectedTabs = new Set(saved.injectedTabs);
    if (saved.debuggedTabs) debuggedTabs = new Set(saved.debuggedTabs);
    if (saved.blockedUrls) blockedUrls = new Map(Object.entries(saved.blockedUrls));
  } catch {}
  console.log('[Bridge] v2.0 starting...');
  connect();
})();

function persist() {
  chrome.storage.session.set({
    injectedTabs: [...injectedTabs],
    debuggedTabs: [...debuggedTabs],
    blockedUrls: Object.fromEntries(blockedUrls)
  }).catch(() => {});
}

function log(m) { console.log('[Bridge] ' + m); }
function logE(m,e) { console.error('[Bridge] ' + m, e?.message || e); }
function pushEvent(type, data) {
  eventQueue.push({ type, data, ts: Date.now() });
  if (eventQueue.length > 50) eventQueue.shift();
}

async function getConfig() {
  return chrome.storage.local.get({ serverUrl: 'ws://127.0.0.1:25818', authToken: '' });
}

function jitter(ms) { return ms + Math.floor(Math.random() * ms * 0.3); }

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, jitter(reconnectDelay));
}

async function connect() {
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  if (ws) { try { ws.close(); } catch {}; ws = null; }

  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.authToken) {
    reconnectDelay = 10000; scheduleReconnect(); return;
  }

  try { ws = new WebSocket(cfg.serverUrl); }
  catch (err) { logE('WebSocket creation failed', err); reconnectDelay = Math.min(reconnectDelay*2, MAX_RECONNECT_DELAY); scheduleReconnect(); return; }

  ws.onopen = () => {
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: 'auth', role: 'browser', token: cfg.authToken, version: '2.0.0' }));
  };

  ws.onmessage = async (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'auth_ok') {
      connectedAt = Date.now(); connectionId = msg.clientId;
      log('Authenticated as ' + msg.role + ' (' + connectionId + ')');
      startHeartbeat(); persist();
      return;
    }
    if (msg.type === 'browser_status' || msg.type === 'event' || msg.type === 'ping' || msg.type === 'pong') return;
    if (msg.type === 'command' || msg.action) {
      handleMessage(msg).catch(e => logE('Command failed', e));
    }
  };

  ws.onclose = (ev) => {
    log('Disconnected (code=' + ev.code + ')');
    connectedAt = null; connectionId = null;
    clearInterval(heartbeatTimer); ws = null;
    reconnectDelay = Math.min(reconnectDelay*2, MAX_RECONNECT_DELAY);
    scheduleReconnect();
  };

  ws.onerror = () => {};
}

function sendRaw(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) sendRaw({ type: 'ping' });
    else clearInterval(heartbeatTimer);
  }, HEARTBEAT_INTERVAL);
}

async function handleMessage(msg) {
  try {
    const result = await executeCommand(msg);
    reply(msg, { type: 'result', id: msg.id, ok: true, data: result });
  } catch (err) {
    logE('Command "' + msg.action + '" failed', err);
    reply(msg, { type: 'result', id: msg.id, ok: false, error: err.message });
  }
}

function reply(original, data) {
  data._controllerId = original._controllerId;
  sendRaw(data);
}

// ─── Command Executor ───
async function executeCommand(cmd) {
  const a = cmd.action;

  if (a === 'get_tabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
  }

  const tabId = cmd.tabId || (await getActiveTab()).id;

  if (a === 'navigate') {
    const t = await getActiveTab();
    await chrome.tabs.update(t.id, { url: fmtUrl(cmd.url) });
    await waitLoad(t.id); onTabChanged(t.id);
    return { tabId: t.id, url: cmd.url };
  }
  if (a === 'new_tab') {
    const t = await chrome.tabs.create({ url: cmd.url ? fmtUrl(cmd.url) : 'about:blank', active: true });
    await waitLoad(t.id);
    return { tabId: t.id, url: t.url };
  }
  if (a === 'close_tab') { await chrome.tabs.remove(tabId); return { ok: true }; }
  if (a === 'go_back' || a === 'go_forward') {
    const t = await getActiveTab();
    if (a === 'go_back') await chrome.tabs.goBack(t.id); else await chrome.tabs.goForward(t.id);
    await wait(500); await waitLoad(t.id); onTabChanged(t.id);
    return { tabId: t.id };
  }
  if (a === 'refresh') { await chrome.tabs.reload(tabId); await waitLoad(tabId); onTabChanged(tabId); return { tabId }; }

  if (a === 'get_active_tab') { const t = await getActiveTab(); return { id: t.id, title: t.title, url: t.url }; }
  if (a === 'get_url') { const t = await getActiveTab(); return { url: t.url }; }
  if (a === 'get_title') { const t = await getActiveTab(); return { title: t.title }; }

  if (a === 'screenshot') {
    const t = await chrome.tabs.get(tabId);
    const d = await chrome.tabs.captureVisibleTab(t.windowId,
      cmd.format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: parseInt(cmd.quality,10) || 80 });
    return { tabId: t.id, format: cmd.format || 'jpeg', dataUrl: d };
  }

  if (a === 'click' || a === 'double_click' || a === 'right_click' || a === 'hover') {
    await ensureInjected(tabId);
    let ac = 'click', btn = cmd.button || 'left', cc = cmd.clickCount || 1;
    if (a === 'double_click') cc = 2;
    else if (a === 'right_click') { btn = 'right'; cc = 1; }
    else if (a === 'hover') ac = 'hover';
    const r = await chrome.tabs.sendMessage(tabId, { action: ac, x: cmd.x, y: cmd.y, button: btn, clickCount: cc });
    if (a !== 'hover') await wait(300);
    return r || { ok: true };
  }

  if (a === 'drag') {
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { action: 'drag', x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, steps: cmd.steps || 10, duration: cmd.duration || 500 });
    await wait(500);
    return { ok: true };
  }

  if (a === 'type') { await ensureInjected(tabId); await chrome.tabs.sendMessage(tabId, { action: 'type', text: cmd.text }); return { ok: true }; }
  if (a === 'key_press') {
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { action: 'key_press', key: cmd.key, ctrlKey: cmd.ctrlKey, shiftKey: cmd.shiftKey, altKey: cmd.altKey, metaKey: cmd.metaKey, repeat: cmd.repeat || 1 });
    return { ok: true };
  }

  if (a === 'scroll') { await ensureInjected(tabId); await chrome.tabs.sendMessage(tabId, { action: 'scroll', x: cmd.x || 0, y: cmd.y || 0 }); return { ok: true }; }
  if (a === 'scroll_to') { await ensureInjected(tabId); await chrome.tabs.sendMessage(tabId, { action: 'scroll_to', selector: cmd.selector }); return { ok: true }; }

  if (a === 'set_value') { await ensureInjected(tabId); await chrome.tabs.sendMessage(tabId, { action: 'set_value', selector: cmd.selector, value: cmd.value }); return { ok: true }; }
  if (a === 'select_option') { await ensureInjected(tabId); await chrome.tabs.sendMessage(tabId, { action: 'select_option', selector: cmd.selector, value: cmd.value }); return { ok: true }; }

  if (a === 'get_text') {
    await ensureInjected(tabId);
    const r = await chrome.tabs.sendMessage(tabId, { action: 'get_text', selector: cmd.selector || 'body', maxLength: cmd.maxLength || 100000 });
    return { text: r.text, length: r.text.length };
  }
  if (a === 'get_html') {
    await ensureInjected(tabId);
    const r = await chrome.tabs.sendMessage(tabId, { action: 'get_html', selector: cmd.selector || 'html', maxLength: cmd.maxLength || 500000 });
    return { html: r.html };
  }
  if (a === 'get_page_structure') { await ensureInjected(tabId); return await chrome.tabs.sendMessage(tabId, { action: 'get_page_structure', interactiveOnly: cmd.interactiveOnly ?? false }); }
  if (a === 'find_elements') { await ensureInjected(tabId); return await chrome.tabs.sendMessage(tabId, { action: 'find_elements', query: cmd.query, limit: cmd.limit || 20 }); }

  if (a === 'evaluate' || a === 'eval') {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: new Function('code', 'return eval(code);'), args: [cmd.code], world: 'MAIN' });
      return { result: r[0]?.result };
    } catch {
      await ensureInjected(tabId);
      const r = await chrome.tabs.sendMessage(tabId, { action: 'eval_page', code: cmd.code });
      return { result: r };
    }
  }
  if (a === 'evaluate_async' || a === 'eval_async') {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: new Function('code', 'return (async () => { return eval(code); })();'), args: [cmd.code], world: 'MAIN' });
      return { result: r[0]?.result };
    } catch { throw new Error('CSP blocked async eval. Page may not support JS execution.'); }
  }

  if (a === 'get_console_logs') return { logs: lastConsoleLogs.get(tabId) || [] };
  if (a === 'clear_console_logs') { lastConsoleLogs.delete(tabId); return { ok: true }; }

  if (a === 'get_network_requests') {
    const reqs = networkRequests.get(tabId) || [];
    if (cmd.clear) networkRequests.set(tabId, []);
    return { requests: reqs.slice(-(cmd.limit || 100)) };
  }
  if (a === 'clear_network_requests') { networkRequests.set(tabId, []); return { ok: true }; }

  if (a === 'get_cookies') { const t = await getActiveTab(); return { cookies: await chrome.cookies.getAll({ url: cmd.url || t.url }) }; }
  if (a === 'set_cookie') {
    const t = await getActiveTab();
    return { cookie: await chrome.cookies.set({ url: cmd.url || t.url, name: cmd.name, value: cmd.value, domain: cmd.domain, path: cmd.path || '/' }) };
  }

  if (a === 'wait') { const ms = Math.min(cmd.ms || 1000, 30000); await wait(ms); return { waited: ms }; }
  if (a === 'wait_for') {
    await ensureInjected(tabId);
    return await chrome.tabs.sendMessage(tabId, { action: 'wait_for', selector: cmd.selector, text: cmd.text, timeout: Math.min(cmd.timeout || 10000, 30000) });
  }

  if (a === 'resize_window') { const t = await getActiveTab(); await chrome.windows.update(t.windowId, { width: cmd.width, height: cmd.height }); return { ok: true }; }
  if (a === 'download') return { downloadId: await chrome.downloads.download({ url: cmd.url, filename: cmd.filename }) };

  if (a === 'get_events') { const q = [...eventQueue]; eventQueue = []; return { events: q }; }

  if (a === 'file_upload') {
    if (!cmd.files || !cmd.selector) throw new Error('file_upload requires files[] and selector');
    await attachDebugger(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Page.setInterceptFileChooserDialog', { enabled: true });
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { action: 'click_selector', selector: cmd.selector });
    return { ok: true };
  }

  throw new Error('Unknown action: ' + a);
}

// ─── Helpers ───
async function getActiveTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t) throw new Error('No active tab');
  return t;
}
function fmtUrl(u) { if (!u || u === 'forward' || u === 'back') return u; return u.startsWith('http') ? u : 'https://' + u; }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitLoad(tabId) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { cleanup(); resolve(); }, 15000);
    const l = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const cleanup = () => { if (!done) { done = true; clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); } };
    chrome.tabs.onUpdated.addListener(l);
  });
}

function onTabChanged(tabId) {
  injectedTabs.delete(tabId);
  if (debuggedTabs.has(tabId)) { chrome.debugger.detach({ tabId }).catch(() => {}); debuggedTabs.delete(tabId); }
  persist();
}

chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === 'loading') onTabChanged(id); });
chrome.tabs.onRemoved.addListener(id => { onTabChanged(id); lastConsoleLogs.delete(id); networkRequests.delete(id); blockedUrls.delete(id); persist(); });
chrome.tabs.onActivated.addListener(({ tabId }) => pushEvent('tab_activated', { tabId }));

// ─── Content Script Injection ───
async function ensureInjected(tabId) {
  if (injectedTabs.has(tabId)) {
    try { const r = await chrome.tabs.sendMessage(tabId, { action: 'ping' }); if (r && r.pong) return; } catch { injectedTabs.delete(tabId); }
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    injectedTabs.add(tabId); persist();
  } catch { throw new Error('Cannot inject into tab ' + tabId + ' — may be a restricted page'); }
}

// ─── Debugger Management ───
const interceptHandlers = new Map();
let debuggerListener = null;

function getDebuggerListener() {
  if (debuggerListener) return debuggerListener;
  debuggerListener = (source, method, params) => {
    if (!debuggedTabs.has(source.tabId)) return;
    clearTimeout(debuggerIdleTimer);
    debuggerIdleTimer = setTimeout(() => { for (const id of debuggedTabs) detachDebugger(id).catch(() => {}); }, DEBUGGER_IDLE_MS);

    if (method === 'Fetch.requestPaused') {
      const h = interceptHandlers.get(source.tabId) || {};
      if (Object.keys(h).find(p => params.request?.url?.includes(p))) {
        chrome.debugger.sendCommand({ tabId: source.tabId }, 'Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return;
      }
      chrome.debugger.sendCommand({ tabId: source.tabId }, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
    }

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
      const ex = reqs.find(r => r.requestId === params.requestId);
      if (ex) { ex.status = params.response?.status; ex.responseTimestamp = Date.now(); }
    }
  };
  chrome.debugger.onEvent.addListener(debuggerListener);
  return debuggerListener;
}

async function attachDebugger(tabId) {
  if (debuggedTabs.has(tabId)) {
    try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }); clearTimeout(debuggerIdleTimer); return; } catch { debuggedTabs.delete(tabId); }
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggedTabs.add(tabId);
  getDebuggerListener();
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
}

async function detachDebugger(tabId) {
  if (!debuggedTabs.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  debuggedTabs.delete(tabId);
}

chrome.debugger.onDetach.addListener((source, reason) => { debuggedTabs.delete(source.tabId); interceptHandlers.delete(source.tabId); });

// ─── Popup Messaging ───
chrome.runtime.onConnect.addListener(() => {});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === 'ping') { sendResponse({ pong: true, version: '2.0.0' }); return; }
      if (msg.action === 'reconnect') { reconnectDelay = 1000; connect(); sendResponse({ ok: true }); return; }
      if (msg.action === 'get_config') { sendResponse(await getConfig()); return; }
      if (msg.action === 'set_config') {
        await chrome.storage.local.set({ serverUrl: msg.serverUrl, authToken: msg.authToken });
        if (ws) { try { ws.close(); } catch {} }
        reconnectDelay = 1000; connect();
        sendResponse({ ok: true });
        return;
      }
      if (msg.action === 'get_status') {
        sendResponse({ connected: ws !== null && ws.readyState === WebSocket.OPEN, serverUrl: ws?.url || null, connectedAt, connectionId, version: '2.0.0' });
        return;
      }
    } catch (e) { sendResponse({ error: e.message }); }
  })();
  return true;
});

// ─── Keepalive ───
chrome.alarms.create('keepalive-bridge', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive-bridge') {
    if (!ws || ws.readyState !== WebSocket.OPEN) { reconnectDelay = 1000; connect(); }
  }
});
