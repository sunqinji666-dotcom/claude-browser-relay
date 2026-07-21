import { WebSocket } from 'ws';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const WS_URL = 'ws://119.29.193.16:25818';
const TOKEN = 'claude-relay-221c7e14';
const URLS_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_article_urls.json';
const OUT_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/all_articles_content.json';
const PROGRESS_FILE = '/Users/jacksun/Documents/codex/fengkeda-scrape/progress.json';

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
  // Load existing progress
  let results = [];
  let startFrom = 0;
  if (existsSync(OUT_FILE)) {
    results = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    console.log(`Loaded ${results.length} existing results`);
    startFrom = results.length;
  }
  
  const allUrls = JSON.parse(readFileSync(URLS_FILE, 'utf8'));
  console.log(`Total articles: ${allUrls.length}, starting from index ${startFrom}`);
  
  if (startFrom >= allUrls.length) {
    console.log('All articles already scraped!');
    process.exit(0);
  }
  
  const ws = new WebSocket(WS_URL);
  await new Promise((r, e) => { ws.on('open', r); ws.on('error', e); setTimeout(() => e(new Error('conn timeout')), 10000); });
  
  ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: TOKEN }));
  await new Promise((r, e) => {
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.type === 'auth_ok') r(); if (m.type === 'error') e(new Error(m.message)); });
    setTimeout(() => e(new Error('auth timeout')), 10000);
  });
  console.log('Auth OK\n');
  
  for (let i = startFrom; i < allUrls.length; i++) {
    const article = allUrls[i];
    console.log(`[${i+1}/${allUrls.length}] ${article.title}`);
    
    try {
      await sendCmd(ws, 'navigate', { url: article.url });
      await sleep(1500);
      
      // Get page text content
      const textResult = await sendCmd(ws, 'get_text');
      let content = textResult.data?.text || '';
      
      // Also try to get date from the page
      const htmlResult = await sendCmd(ws, 'get_html');
      const html = htmlResult.data?.html || '';
      
      // Extract date
      let date = '';
      const dateMatch = html.match(/发布时间[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
      if (dateMatch) date = dateMatch[1];
      
      // Extract image URLs
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
      const images = [];
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        if (src && !src.includes('qq.gif') && !src.includes('kefu') && !src.includes('/images/')) {
          if (src.startsWith('http')) images.push(src);
          else images.push('http://www.fengkeda.com' + (src.startsWith('/') ? '' : '/') + src);
        }
      }
      
      results.push({
        id: article.id,
        title: article.title,
        url: article.url,
        date: date,
        text: content.substring(0, 30000),
        imageCount: images.length,
        images: images.slice(0, 20)
      });
      
      // Save progress every 10 articles
      if (i % 10 === 0 || i === allUrls.length - 1) {
        writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
      }
      
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({
        id: article.id,
        title: article.title,
        url: article.url,
        error: err.message
      });
    }
  }
  
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n=== DONE! Saved ${results.length} articles to ${OUT_FILE} ===`);
  
  ws.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
