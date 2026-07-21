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

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.type === 'auth_ok') {
    console.log('[1] Getting page text...');
    cmd('get_text', { selector: 'body' });
  }

  if (m.type === 'result' && m.ok) {
    if (m.id === '1') {
      const text = m.data?.text || '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
      console.log('Total text lines:', lines.length);
      console.log('\n=== Page text (first 3000 chars) ===');
      console.log(text.slice(0, 3000));

      // Try to get page structure too
      console.log('\n[2] Getting page structure...');
      cmd('get_page_structure', { interactiveOnly: true });
    }

    if (m.id === '2') {
      const els = m.data?.elements || [];
      console.log('\n=== Interactive elements (' + els.length + ') ===');
      // Find links and buttons with meaningful text
      els.filter(e => e.text && e.text.length > 3 && e.tag !== 'html')
         .slice(0, 40)
         .forEach((e, i) => console.log('  ' + (i + 1) + '. [' + e.tag + '] ' + e.text.slice(0, 80) + ' @ ' + e.rect.x + ',' + e.rect.y));

      // Done
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
setTimeout(() => process.exit(1), 15000);
