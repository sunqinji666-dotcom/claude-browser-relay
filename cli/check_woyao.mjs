import WebSocket from 'ws';

const ws = new WebSocket('ws://119.29.193.16:25818');
let seq = 0;

function cmd(action, params) {
  seq++;
  ws.send(JSON.stringify({ type: 'command', id: '' + seq, action, ...(params || {}) }));
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: 'claude-relay-221c7e14' }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());

  if (m.type === 'auth_ok') {
    console.log('[1] navigate');
    cmd('navigate', { url: 'https://woyao.pro/' });
  }

  if (m.type === 'browser_status') {
    console.log('[browser] connected:', m.connected);
  }

  if (m.type === 'result' && m.ok) {
    const id = parseInt(m.id);
    const d = m.data;

    if (id === 1) {
      console.log('[2] wait 5s');
      cmd('wait', { ms: 5000 });
    } else if (id === 2) {
      console.log('[3] screenshot');
      cmd('screenshot', { format: 'jpeg', quality: 85 });
    } else if (id === 3) {
      console.log('[4] text');
      cmd('get_text');
    } else if (id === 4) {
      console.log('=== TEXT ===');
      console.log((d?.text || '').slice(0, 12000));
      console.log('[5] find "余额"');
      cmd('find_elements', { query: '余额', limit: 50 });
    } else if (id === 5) {
      console.log('\n=== FIND 余额 ===');
      (d?.elements || []).forEach(el => console.log('  [' + el.index + '] <' + el.tag + '> "' + el.text + '"'));
      console.log('[6] find "key"');
      cmd('find_elements', { query: 'key', limit: 50 });
    } else if (id === 6) {
      console.log('\n=== FIND key ===');
      (d?.elements || []).forEach(el => console.log('  [' + el.index + '] <' + el.tag + '> "' + el.text + '"'));
      console.log('[7] find "API"');
      cmd('find_elements', { query: 'API', limit: 50 });
    } else if (id === 7) {
      console.log('\n=== FIND API ===');
      (d?.elements || []).forEach(el => console.log('  [' + el.index + '] <' + el.tag + '> "' + el.text + '"'));
      console.log('[8] find "模型"');
      cmd('find_elements', { query: '模型', limit: 50 });
    } else if (id === 8) {
      console.log('\n=== FIND 模型 ===');
      (d?.elements || []).forEach(el => console.log('  [' + el.index + '] <' + el.tag + '> "' + el.text + '"'));
      console.log('[9] structure');
      cmd('get_page_structure', { interactiveOnly: false });
    } else if (id === 9) {
      console.log('\n=== STRUCTURE ===');
      (d?.elements || []).slice(0, 80).forEach(el => {
        const t = (el.text||'').slice(0, 80);
        const c = (el.class||'').slice(0, 80);
        const r = '(' + el.rect.x + ',' + el.rect.y + ' ' + el.rect.w + 'x' + el.rect.h + ')';
        console.log('  [' + el.index + '] <' + el.tag + '> "' + t + '" ' + r + ' v=' + el.visible + ' ' + (el.href||'') + ' c="' + c + '"');
      });
      console.log('\nDONE');
      ws.close();
    }
  }

  if (m.type === 'result' && !m.ok) {
    console.log('ERR ' + m.id + ': ' + m.error);
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 40000);
