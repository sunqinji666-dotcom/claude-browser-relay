import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import urlMod from 'url';

const RELAY = 'ws://119.29.193.16:25818';
const TOKEN = 'claude-relay-221c7e14';
const OUT = process.argv[2] || '/sessions/gifted-wonderful-heisenberg/mnt/本地工具/super-i-copy';
const BASE_URL = 'https://www.super-i.cn';

mkdirSync(OUT, { recursive: true });
mkdirSync(OUT + '/images', { recursive: true });
mkdirSync(OUT + '/videos', { recursive: true });

function fullUrl(u) {
  if (u.startsWith('http')) return u;
  return BASE_URL + (u.startsWith('/') ? '' : '/') + u;
}

function safeName(url, prefix, ext) {
  const hash = [...url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
  return prefix + hash + ext;
}

function absoluteRemoteUrl(u) {
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `${BASE_URL}${u}`;
  if (u.startsWith('static/')) return `${BASE_URL}/${u}`;
  return u;
}

function rewriteAssetUrls(html) {
  let out = html;

  // Preserve the original remote CSS/JS/runtime so the mirror keeps the site's real layout.
  out = out.replace(
    /(src|href|poster|data-src|data-original|action)=["'](\/(?!\/)[^"']+)["']/gi,
    (_, attr, value) => `${attr}="${absoluteRemoteUrl(value)}"`
  );
  out = out.replace(
    /(src|href|poster|data-src|data-original|action)=["'](static\/[^"']+)["']/gi,
    (_, attr, value) => `${attr}="${absoluteRemoteUrl(value)}"`
  );
  out = out.replace(
    /url\((['"]?)\/(?!\/)([^)'"]+)\1\)/gi,
    (_, quote, value) => `url(${quote}${absoluteRemoteUrl('/' + value)}${quote})`
  );
  out = out.replace(
    /url\((['"]?)static\/([^)'"]+)\1\)/gi,
    (_, quote, value) => `url(${quote}${absoluteRemoteUrl('static/' + value)}${quote})`
  );

  return out;
}

// ─── Step 1: Connect & fetch HTML ───
async function fetchPage() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    let seq = 0;
    function cmd(a, p) { seq++; ws.send(JSON.stringify({ type: 'command', id: '' + seq, action: a, ...(p || {}) })); }
    let html = '', text = '';
    let tabId = null;

    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: TOKEN })));
    ws.on('message', r => {
      const m = JSON.parse(r.toString());
      if (m.type === 'auth_ok') cmd('get_active_tab');
      if (m.type === 'result' && m.id === '1') {
        tabId = m.data?.id;
        if (!tabId) {
          ws.close();
          reject(new Error('No active tab found'));
          return;
        }
        cmd('get_html', { selector: 'html', maxLength: 500000, tabId });
      }
      if (m.type === 'result' && m.id === '2') {
        html = m.data?.html || '';
        cmd('get_text', { selector: 'body', tabId });
      } else if (m.type === 'result' && m.id === '3') {
        text = m.data?.text || '';
        ws.close();
        resolve({ html, text });
      }
      if (m.type === 'result' && !m.ok) { ws.close(); reject(new Error(m.error)); }
    });
    ws.on('close', () => { if (!html) reject(new Error('WS closed early')); });
    ws.on('error', e => reject(e));
    setTimeout(() => reject(new Error('Timeout')), 30000);
  });
}

async function download(url, dest) {
  try {
    execSync(`curl -sL -o '${dest}' --connect-timeout 8 --max-time 30 '${url}' 2>/dev/null`, { stdio: 'pipe', timeout: 40000 });
    return existsSync(dest) ? parseInt(execSync(`wc -c < '${dest}'`).toString().trim()) : 0;
  } catch { return -1; }
}

async function main() {
  console.log('Fetching page content...');
  const { html, text } = await fetchPage();
  console.log('HTML:', html.length, 'chars | Text:', text.length, 'chars');

  writeFileSync(OUT + '/raw-text.txt', text);

  // ─── Extract URLs ───
  const imgRe = /<img[^>]+(?:src|data-src)=["']?([^"' >]+)/gi;
  const srcRe = /<source[^>]+src=["']?([^"' >]+)/gi;
  const vidRe = /<video[^>]+src=["']?([^"' >]+)/gi;
  const bgRe = /background(?:-image)?\s*:\s*url\(["']?([^"')\s]+)/gi;

  const images = [...new Set([...html.matchAll(imgRe)].map(m => m[1]).filter(u => u.length > 5 && !u.startsWith('data:')))];
  const sources = [...new Set([...html.matchAll(srcRe)].map(m => m[1]))];
  const videos = [...new Set([...html.matchAll(vidRe)].map(m => m[1]))];
  const bgImgs = [...new Set([...html.matchAll(bgRe)].map(m => m[1]).filter(u => u.length > 5 && !u.startsWith('data:')))];

  console.log('Found:', images.length, 'images,', bgImgs.length, 'bg-images,', videos.length, 'videos,', sources.length, 'sources');

  // ─── Download all ───
  const urlMap = {};

  for (const list of [images, bgImgs]) {
    for (const url of list) {
      const fu = fullUrl(url);
      const ext = path.extname(fu).split('?')[0] || '.jpg';
      const name = 'img_' + safeName(url, 'i', ext);
      const dest = OUT + '/images/' + name;
      if (!urlMap[url]) {
        const size = await download(fu, dest);
        if (size > 0) {
          urlMap[url] = 'images/' + name;
          console.log('IMG:', name, '(', Math.round(size / 1024), 'KB)');
        } else { urlMap[url] = url; }
      }
    }
  }

  for (const url of [...videos, ...sources]) {
    const fu = fullUrl(url);
    const ext = path.extname(fu).split('?')[0] || '.mp4';
    const name = 'video_' + safeName(url, 'v', ext);
    const dest = OUT + '/videos/' + name;
    if (!urlMap[url]) {
      const size = await download(fu, dest);
      if (size > 0) {
        urlMap[url] = 'videos/' + name;
        console.log('VID:', name, '(', Math.round(size / 1024), 'KB)');
      } else { urlMap[url] = url; }
    }
  }

  // ─── Build local HTML ───
  let local = html;
  for (const [orig, localPath] of Object.entries(urlMap)) {
    if (orig !== localPath) {
      local = local.split(orig).join(localPath);
    }
  }

  local = rewriteAssetUrls(local);

  writeFileSync(OUT + '/index.html', local);

  console.log('\n✅ Done!');
  console.log('Location:', OUT);
  console.log('Files:');
  console.log('  index.html (' + local.length + ' bytes)');
  console.log('  raw-text.txt');
  const imgCount = execSync(`ls ${OUT}/images/ 2>/dev/null | wc -l`).toString().trim();
  const vidCount = execSync(`ls ${OUT}/videos/ 2>/dev/null | wc -l`).toString().trim();
  console.log('  images/: ' + imgCount + ' files');
  console.log('  videos/: ' + vidCount + ' files');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
