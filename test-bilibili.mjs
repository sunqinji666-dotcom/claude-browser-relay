import { WebSocket } from 'ws';

const ws = new WebSocket('ws://119.29.193.16:25818');
let seq = 0;
function cmd(action, params) {
  seq++;
  ws.send(JSON.stringify({ type: 'command', id: '' + seq, action, ...(params || {}) }));
  return seq;
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: 'claude-relay-221c7e14' }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.type === 'auth_ok') {
    console.log('[1] Navigating to B站热门...');
    cmd('navigate', { url: 'https://www.bilibili.com/v/popular/hot' });
  }

  if (m.type === 'result' && m.ok) {
    const rid = parseInt(m.id);

    if (rid === 1) {
      console.log('[2] Page loaded, waiting 5s...');
      cmd('wait', { ms: 5000 });
    }

    if (rid === 2) {
      console.log('[3] Getting page text...');
      cmd('get_text', { selector: 'body' });
    }

    if (rid === 3) {
      const text = m.data?.text || '';
      console.log('[4] Got', text.length, 'chars\n');

      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
      console.log('=== 页面文本片段 ===');
      console.log(text.slice(0, 2000));

      console.log('\n=== 提取视频标题 ===');
      const candidates = lines.filter(l => l.length > 5 && l.length < 120);
      candidates.slice(0, 30).forEach((l, i) => console.log(`  ${i+1}. ${l}`));
      ws.close();
    }
  }

  if (m.type === 'result' && !m.ok) {
    console.error('ERR:', m.error);
    ws.close();
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 30000);
