import { WebSocket } from 'ws';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const WS_URL = 'ws://119.29.193.16:25818';
const TOKEN = 'claude-relay-221c7e14';
const URLS_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_article_urls.json';
const OUT_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_articles_content.json';

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
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('Timeout')); }, 15000);
  });
}

async function main() {
  // Load existing progress
  let results = [];
  let startFrom = 0;
  if (existsSync(OUT_FILE)) {
    results = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    console.log(`Loaded ${results.length} existing results`);
    startFrom = results.length;
  }
  
  const allUrls = JSON.parse(readFileSync(URLS_FILE, 'utf8'));
  console.log(`Total: ${allUrls.length}, starting from index ${startFrom}`);
  if (startFrom >= allUrls.length) { console.log('Done!'); process.exit(0); }
  
  const ws = new WebSocket(WS_URL);
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); setTimeout(() => e(new Error('conn timeout')), 10000); });
  
  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: TOKEN }));
  await new Promise((r, e) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'auth_ok') r(); if (m.type === 'error') e(new Error(m.message)); });
    setTimeout(() => e(new Error('auth timeout')), 10000);
  });
  console.log('Auth OK');
  
  // First navigate to the news site to establish the domain context
  await sendCmd(ws, 'navigate', { url: 'http://www.fengkeda.com/news/' });
  await sleep(2000);
  console.log('Initial page loaded\n');
  
  // Process articles in batches using fetch from the browser context
  const BATCH_SIZE = 30;
  
  for (let batchStart = startFrom; batchStart < allUrls.length; batchStart += BATCH_SIZE) {
    const batch = allUrls.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`Batch ${Math.floor(batchStart/BATCH_SIZE)+1}/${Math.ceil(allUrls.length/BATCH_SIZE)} (${batchStart}-${batchStart+batch.length-1})`);
    
    // Build a JavaScript code string that fetches multiple articles
    const articleInfos = batch.map(a => `{id:${a.id},title:${JSON.stringify(a.title)},url:${JSON.stringify(a.url)}}`);
    
    const code = `
      (async () => {
        const articles = [${articleInfos.join(',')}];
        const results = [];
        for (const art of articles) {
          try {
            const resp = await fetch(art.url);
            const html = await resp.text();
            
            // Extract text content (remove HTML tags)
            const temp = document.createElement('div');
            temp.innerHTML = html;
            
            // Get the main content area text
            const contentDiv = temp.querySelector('div.bgwhite') || temp.querySelector('.right2.bgwhite') || temp.querySelector('body');
            const text = contentDiv ? contentDiv.textContent.trim() : temp.body.textContent.trim();
            
            // Extract date
            const dateMatch = html.match(/发布时间[：:]\\s*(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})/);
            const date = dateMatch ? dateMatch[1] : '';
            
            // Extract images
            const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
            const images = [];
            let m;
            while ((m = imgRegex.exec(html)) !== null) {
              const src = m[1];
              if (src && !src.includes('qq.gif') && !src.includes('kefu') && !src.includes('/images/')) {
                images.push(src.startsWith('http') ? src : 'http://www.fengkeda.com' + (src.startsWith('/') ? '' : '/') + src);
              }
            }
            
            results.push({ id: art.id, title: art.title, url: art.url, date, text: text.substring(0, 20000), imageCount: images.length, images: images.slice(0, 20) });
          } catch(e) {
            results.push({ id: art.id, title: art.title, url: art.url, error: e.message });
          }
        }
        return results;
      })()
    `;
    
    try {
      const evalResult = await sendCmd(ws, 'evaluate', { code });
      const batchResults = evalResult.data?.result || [];
      
      for (const r of batchResults) {
        // Remove navigation/header/footer text from content
        let cleanText = r.text || '';
        // Remove common header/footer text
        const noisePatterns = [
          '首页\\s*关于我们\\s*服务项目\\s*精品案例\\s*最新动态\\s*联系我们',
          '设为首页.*?添加收藏',
          '桂林峰可达会展有限公司.*?桂ICP备11006069号',
          '联系方式.*?友情链接'
        ];
        for (const p of noisePatterns) {
          cleanText = cleanText.replace(new RegExp(p, 'gs'), '');
        }
        r.text = cleanText.trim().substring(0, 20000);
        results.push(r);
      }
      
      console.log(`  Got ${batchResults.length} articles, total: ${results.length}`);
    } catch (err) {
      console.log(`  Batch error: ${err.message}, will retry individually`);
      // Fallback: scrape one by one
      for (const art of batch) {
        try {
          const code2 = `(async()=>{const r=await fetch(${JSON.stringify(art.url)});const h=await r.text();const d=document.createElement('div');d.innerHTML=h;const c=d.querySelector('div.bgwhite')||d.querySelector('.right2.bgwhite')||d.querySelector('body');const t=c?c.textContent.trim():'';const m=h.match(/发布时间[：:]\\s*(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})/);return{text:t.substring(0,20000),date:m?m[1]:''};})()`;
          const r2 = await sendCmd(ws, 'evaluate', { code: code2 });
          const data = r2.data?.result || {};
          results.push({ id: art.id, title: art.title, url: art.url, date: data.date || '', text: (data.text||'').trim().substring(0,20000) });
          console.log(`  [${results.length}] ${art.title}`);
        } catch(err2) {
          console.log(`  FAILED: ${art.title}: ${err2.message}`);
          results.push({ id: art.id, title: art.title, url: art.url, error: err2.message });
        }
      }
    }
    
    // Save progress
    writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  }
  
  console.log(`\n=== DONE! ${results.length} articles saved ===`);
  ws.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
