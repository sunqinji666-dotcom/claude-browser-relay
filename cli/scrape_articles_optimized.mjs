import { WebSocket } from 'ws';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const WS_URL = 'ws://119.29.193.16:25818';
const TOKEN = 'claude-relay-221c7e14';
const URLS_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_article_urls.json';
const OUT_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_articles_content.json';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendCmdExpect(ws, action, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    ws.send(JSON.stringify({ type: 'command', id, action, ...params }));
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'result' && msg.id === id) { ws.removeListener('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('Timeout')); }, timeoutMs);
  });
}

async function main() {
  let results = [];
  let startFrom = 0;
  if (existsSync(OUT_FILE)) {
    results = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    console.log(`Loaded ${results.length} existing results`);
    startFrom = results.length;
  }
  
  const allUrls = JSON.parse(readFileSync(URLS_FILE, 'utf8'));
  console.log(`Total: ${allUrls.length}, starting from index ${startFrom}`);
  if (startFrom >= allUrls.length) { console.log('All done!'); process.exit(0); }
  
  const ws = new WebSocket(WS_URL);
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); setTimeout(() => e(new Error('conn timeout')), 10000); });
  
  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: TOKEN }));
  await new Promise((r, e) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'auth_ok') r(); if (m.type === 'error') e(new Error(m.message)); });
    setTimeout(() => e(new Error('auth timeout')), 10000);
  });
  console.log('Auth OK\n');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = startFrom; i < allUrls.length; i++) {
    const article = allUrls[i];
    
    try {
      // Navigate - shorter wait since it's the same domain
      await sendCmdExpect(ws, 'navigate', { url: article.url }, 10000);
      await sleep(800);
      
      // Get text content
      const textResult = await sendCmdExpect(ws, 'get_text', {}, 10000);
      const content = textResult.data?.text || '';
      
      // Get HTML for date and images
      const htmlResult = await sendCmdExpect(ws, 'get_html', {}, 10000);
      const html = htmlResult.data?.html || '';
      
      // Extract date
      let date = '';
      const dateMatch = html.match(/发布时间[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
      if (dateMatch) date = dateMatch[1];
      
      // Extract images
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
      const images = [];
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        if (src && !src.includes('qq.') && !src.includes('kefu') && !src.includes('/images/')) {
          images.push(src.startsWith('http') ? src : 'http://www.fengkeda.com' + (src.startsWith('/') ? '' : '/') + src);
        }
      }
      
      // Clean up content - remove noise
      let cleanText = content;
      // Remove common navigation text
      const noiseLines = [
        '首页', '关于我们', '服务项目', '精品案例', '最新动态', '联系我们',
        '设为首页', '添加收藏', '联系方式', '友情链接',
        '桂林峰可达会展有限公司'
      ];
      // We'll just keep the text as is but note the first ~200 chars for identification
      
      results.push({
        id: article.id,
        title: article.title,
        url: article.url,
        date: date,
        text: cleanText.substring(0, 20000),
        imageCount: images.length,
        images: images.slice(0, 20)
      });
      
      successCount++;
      
      // Progress indicator
      if ((i + 1) % 5 === 0 || i === startFrom) {
        process.stdout.write(`\r[${i+1}/${allUrls.length}] ✓${successCount} ✗${failCount}`);
      }
      
    } catch (err) {
      results.push({ id: article.id, title: article.title, url: article.url, error: err.message });
      failCount++;
      process.stdout.write(`\r[${i+1}/${allUrls.length}] ✓${successCount} ✗${failCount} [ERR: ${article.id}]`);
    }
    
    // Save every 10 articles
    if ((i + 1) % 10 === 0 || i === allUrls.length - 1) {
      writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
    }
  }
  
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n\n=== DONE! ✓${successCount} ✗${failCount} of ${allUrls.length} ===`);
  
  ws.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
