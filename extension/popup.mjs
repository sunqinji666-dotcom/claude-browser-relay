// Popup logic for Claude Browser Bridge v0.2

const $ = (id) => document.getElementById(id);

async function init() {
  const cfg = await chrome.runtime.sendMessage({ action: 'get_config' });
  $('serverUrl').value = cfg.serverUrl || 'ws://119.29.193.16:25818';
  $('authToken').value = cfg.authToken || '';
  await updateStatus();
}

async function updateStatus() {
  const status = await chrome.runtime.sendMessage({ action: 'get_status' });
  const dot = $('dot');
  const st = $('statusText');
  const detail = $('statusDetail');

  if (status.connected) {
    dot.className = 'dot on';
    st.textContent = '已连接';
    const uptime = status.connectedAt ? Math.floor((Date.now() - status.connectedAt) / 1000) : 0;
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;
    detail.textContent = `在线 ${mins}m ${secs}s · ${status.connectionId || ''}`;
  } else {
    dot.className = 'dot off';
    st.textContent = '未连接 — 自动重连中...';
    detail.textContent = '';
  }
}

$('saveBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim();
  const authToken = $('authToken').value.trim();
  const err = $('errorMsg');

  if (!serverUrl && !authToken) {
    err.textContent = '请填写服务器地址和 Token';
    err.style.display = 'block';
    return;
  }

  err.style.display = 'none';
  try {
    await chrome.runtime.sendMessage({ action: 'set_config', serverUrl, authToken });
    $('saveBtn').textContent = '✅ 已保存';
    setTimeout(() => { $('saveBtn').textContent = '💾 保存配置'; }, 1500);
    setTimeout(updateStatus, 2000);
  } catch (e) {
    err.textContent = `保存失败: ${e.message}`;
    err.style.display = 'block';
  }
});

$('reconnectBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'reconnect' });
  $('reconnectBtn').textContent = '🔄 重连中...';
  setTimeout(async () => {
    await updateStatus();
    $('reconnectBtn').textContent = '🔄 手动重连';
  }, 1500);
});

init();
setInterval(updateStatus, 3000);
