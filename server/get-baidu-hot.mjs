import { WebSocket } from 'ws';

const ws = new WebSocket('ws://119.29.193.16:25818');
function send(obj) { ws.send(JSON.stringify(obj)); }
let seq = 0;
function cmd(action, params) {
  seq++;
  const id = '' + seq;
  send({ type: 'command', id, action, ...(params || {}) });
  return id;
}

ws.on('open', () => {
  send({ type: 'auth', role: 'controller', token: 'claude-relay-221c7e14' });
});

let pageTabId = null;

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.type === 'auth_ok') {
    console.log('[1] Opening Baidu hot search...');
    cmd('navigate', { url: 'https://top.baidu.com/board?tab=realtime' });
  }

  if (m.type === 'result' && m.ok) {
    const id = parseInt(m.id);

    if (id === 1) {
      pageTabId = m.data?.tabId;
      console.log('[2] Page loaded (tabId=' + pageTabId + '), waiting 4s for render...');
      cmd('wait', { ms: 4000 });
    }

    if (id === 2) {
      console.log('[3] Extracting hot search items...');
      cmd('get_text', { selector: 'body', tabId: pageTabId });
    }

    if (id === 3) {
      const text = m.data?.text || '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);

      console.log('\n========================================');
      console.log('   百度实时热搜 TOP 50');
      console.log('========================================\n');

      // Filter lines that look like hot search items:
      // Usually: ranking number + title + heat index
      let rank = 0;
      const results = [];
      for (const line of lines) {
        if (rank >= 50) break;
        // Skip obvious noise
        if (line.length < 2 || line === '百度' || line.includes('登录') || line.includes('注册') ||
            line.length > 80 || /^[0-9\s\-_]*$/.test(line)) continue;

        results.push(line);
      }

      // Try to get just the interesting content - deduplicate
      const seen = new Set();
      const hot_items = results.filter(l => {
        const key = l.slice(0, 20);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (hot_items.length > 0) {
        hot_items.slice(0, 50).forEach((item, i) => {
          console.log('  ' + (i + 1).toString().padStart(2, ' ') + '. ' + item);
        });
      } else {
        console.log('(No items extracted, raw text follows)');
        console.log(text.slice(0, 2000));
      }

      ws.close();
    }
  }

  if (m.type === 'result' && !m.ok) {
    console.error('ERR:', m.error);
    ws.close();
  }
  if (m.type === 'browser_status' && !m.connected) {
    console.error('Browser disconnected');
    ws.close();
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 25000);
