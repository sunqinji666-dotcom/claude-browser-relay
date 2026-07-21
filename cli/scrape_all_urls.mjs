import { WebSocket } from 'ws';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const WS_URL = 'ws://119.29.193.16:25818';
const TOKEN = 'claude-relay-221c7e14';
const OUT_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_article_urls.json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendCmd(ws, action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    ws.send(JSON.stringify({ type: 'command', id, action, ...params }));
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'result' && msg.id === id) { ws.removeListener('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('Timeout')); }, 20000);
  });
}

async function main() {
  const ws = new WebSocket(WS_URL);
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); setTimeout(() => e(new Error('conn timeout')), 10000); });

  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: TOKEN }));
  await new Promise((r, e) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'auth_ok') r(); if (m.type === 'error') e(new Error(m.message)); });
    setTimeout(() => e(new Error('auth timeout')), 10000);
  });
  console.log('Auth OK');

  const allUrls = [];
  
  for (let page = 1; page <= 19; page++) {
    const url = `http://www.fengkeda.com/news/index.asp?page=${page}`;
    console.log(`\nPage ${page}/19...`);
    
    try {
      await sendCmd(ws, 'navigate', { url });
      await sleep(1500);
      
      const htmlResult = await sendCmd(ws, 'get_html');
      const html = htmlResult.data?.html || '';
      
      // Parse article links from HTML: <a target="_blank" href="show.asp?ID=XXX">TITLE</a>
      const regex = /<a\s+target="_blank"\s+href="show\.asp\?ID=(\d+)"[^>]*>([^<]+)<\/a>/g;
      let match;
      let count = 0;
      while ((match = regex.exec(html)) !== null) {
        const id = match[1];
        const title = match[2].trim();
        const fullUrl = `http://www.fengkeda.com/news/show.asp?ID=${id}`;
        if (!allUrls.some(u => u.url === fullUrl)) {
          allUrls.push({ id: parseInt(id), title, url: fullUrl });
          count++;
        }
      }
      console.log(`  Found ${count} new articles (total: ${allUrls.length})`);
    } catch (err) {
      console.log(`  Error on page ${page}: ${err.message}`);
    }
  }
  
  // Sort by ID descending (newest first)
  allUrls.sort((a, b) => b.id - a.id);
  
  console.log(`\n=== TOTAL: ${allUrls.length} unique articles ===`);
  writeFileSync(OUT_FILE, JSON.stringify(allUrls, null, 2));
  console.log(`Saved to ${OUT_FILE}`);
  
  ws.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
