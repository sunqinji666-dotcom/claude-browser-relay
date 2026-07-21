// ============================================================
// Claude Browser Bridge v2.0 — Popup
// Rich status panel with real-time event log & diagnostics.
// ============================================================

'use strict';

const $ = (id) => document.getElementById(id) || { innerText: '', textContent: '', style: {}, value: '', classList: { add() {}, remove() {} }, addEventListener() {} };

// ─── Logging ───
const logLines = [];
const MAX_LOG = 100;

function addLog(level, msg) {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false });
  logLines.push({ ts, level, msg });
  if (logLines.length > MAX_LOG) logLines.shift();
  renderLog();
}

function renderLog() {
  const feed = $('logFeed');
  if (!feed) return;
  if (logLines.length === 0) {
    feed.innerHTML = '<div class="log-line empty">No events yet</div>';
    return;
  }
  feed.innerHTML = logLines.slice(-30).map(l =>
    `<div class="log-line ${l.level}"><span class="ts">${l.ts}</span>${esc(l.msg)}</div>`
  ).join('');
  feed.scrollTop = feed.scrollHeight;
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ─── Toast ───
function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (ok ? 'toast-ok' : 'toast-err');
  setTimeout(() => { t.className = 'toast'; }, 2000);
}

// ─── Status ───
async function updateStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ action: 'get_status' });
    const dot = $('statusDot');
    const label = $('statusLabel');
    const detail = $('statusDetail');
    const uptime = $('uptime');
    const version = $('versionTag');

    if (version) version.textContent = 'v' + (status.version || '2.0');

    if (status.connected) {
      dot.className = 'status-indicator on';
      label.className = 'status-label on';
      label.textContent = 'CONNECTED';
      const elapsed = status.connectedAt ? Math.floor((Date.now() - status.connectedAt) / 1000) : 0;
      const m = Math.floor(elapsed / 60), s = elapsed % 60;
      detail.textContent = 'ID: ' + (status.connectionId || '—');
      if (uptime) uptime.textContent = m + 'm ' + s + 's';
      addLog('ok', 'Connected · ' + m + 'm ' + s + 's');
    } else {
      dot.className = 'status-indicator off';
      label.className = 'status-label off';
      label.textContent = 'DISCONNECTED';
      detail.textContent = status.serverUrl || 'No server configured';
      if (uptime) uptime.textContent = '';
    }
  } catch (e) {
    const dot = $('statusDot');
    if (dot) { dot.className = 'status-indicator connecting'; }
    const label = $('statusLabel');
    if (label) { label.className = 'status-label connecting'; label.textContent = '...'; }
  }
}

// ─── Config ───
async function loadConfig() {
  try {
    const cfg = await chrome.runtime.sendMessage({ action: 'get_config' });
    $('serverUrl').value = cfg.serverUrl || 'ws://119.29.193.16:25818';
    $('authToken').value = cfg.authToken || '';
  } catch {}
}

async function saveConfig() {
  const serverUrl = $('serverUrl').value.trim();
  const authToken = $('authToken').value.trim();

  if (!serverUrl) { toast('Server URL required', false); return; }
  if (!authToken) { toast('Auth token required', false); return; }

  try {
    await chrome.runtime.sendMessage({ action: 'set_config', serverUrl, authToken });
    addLog('cmd', 'Config saved — reconnecting...');
    toast('Saved & connecting');
    setTimeout(updateStatus, 2000);
  } catch (e) {
    addLog('err', 'Save failed: ' + e.message);
    toast('Save failed: ' + e.message, false);
  }
}

$('saveBtn').addEventListener('click', saveConfig);

$('reconnectBtn').addEventListener('click', async () => {
  addLog('cmd', 'Manual reconnect...');
  await chrome.runtime.sendMessage({ action: 'reconnect' });
  toast('Reconnecting...');
  setTimeout(updateStatus, 1500);
});

$('disconnectBtn').addEventListener('click', async () => {
  addLog('cmd', 'Manual disconnect');
  await chrome.runtime.sendMessage({ action: 'set_config', serverUrl: '', authToken: '' });
  toast('Disconnected');
  $('authToken').value = '';
  setTimeout(updateStatus, 1000);
});

$('clearLogBtn').addEventListener('click', () => {
  logLines.length = 0;
  renderLog();
});

$('exportLogs').addEventListener('click', () => {
  const text = logLines.map(l => `[${l.ts}] [${l.level}] ${l.msg}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'browser-bridge-logs-' + Date.now() + '.txt' });
});

// ─── Keyboard shortcut: Enter saves ───
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (document.activeElement === $('authToken') || document.activeElement === $('serverUrl'))) {
    saveConfig();
  }
});

// ─── Init ───
loadConfig().then(() => updateStatus());

// Poll status every 5s
setInterval(updateStatus, 5000);

// Connect log from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'log') {
    addLog(msg.level || 'info', msg.msg);
  }
});
