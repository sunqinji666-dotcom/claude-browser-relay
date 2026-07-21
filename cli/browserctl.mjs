#!/usr/bin/env node
// Claude Browser Relay — CLI Controller
// Connects to the relay server and sends browser commands.

import { WebSocket } from 'ws';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import * as fs from 'fs';

const CONFIG_FILE = `${process.env.HOME || process.env.USERPROFILE}/.browser-relay.json`;

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();
let ws = null;
let pending = new Map(); // id → { resolve, reject }
let cmdId = 0;

const STATE = { serverUrl: null, authToken: null, running: false, browserConnected: false };

// --- Connect ---
function connect(serverUrl, authToken) {
  return new Promise((resolve, reject) => {
    const wsUrl = serverUrl.startsWith('ws') ? serverUrl : `ws://${serverUrl}`;

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      log(`🔌 Connected to ${wsUrl}`);
      ws.send(JSON.stringify({ type: 'auth', role: 'controller', token: authToken }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'auth_ok') {
        log(`✅ Authenticated as "${msg.role}"`);
        STATE.running = true;
        STATE.serverUrl = serverUrl;
        STATE.authToken = authToken;
        saveConfig({ serverUrl, authToken });
        resolve();
      } else if (msg.type === 'browser_status') {
        STATE.browserConnected = msg.connected;
        log(msg.connected ? '🌐 Browser connected' : '❌ Browser disconnected');
      } else if (msg.type === 'error') {
        if (!msg.id) {
          log(`❌ ${msg.message}`);
        }
        // Error for a specific command id
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id).reject(new Error(msg.message));
          pending.delete(msg.id);
        }
      } else if (msg.type === 'result') {
        if (msg.id && pending.has(msg.id)) {
          if (msg.ok) {
            pending.get(msg.id).resolve(msg.data);
          } else {
            pending.get(msg.id).reject(new Error(msg.error));
          }
          pending.delete(msg.id);
        }
      }
    });

    ws.on('close', () => {
      STATE.running = false;
      STATE.browserConnected = false;
      ws = null;
      log('🔌 Disconnected');
      // Reject all pending
      for (const [id, p] of pending) {
        p.reject(new Error('Connection closed'));
      }
      pending.clear();
    });

    ws.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection timeout'));
      }
    }, 10000);
  });
}

// --- Send command ---
function sendCmd(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Not connected'));
    }
    if (!STATE.browserConnected && action !== 'get_tabs' && action !== 'get_platform') {
      log('⚠  No browser connected — command may fail');
    }
    const id = `${++cmdId}`;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ type: 'command', id, action, ...params }));
    // Timeout
    setTimeout(() => {
      if (pending.has(id)) {
        pending.get(id).reject(new Error(`Command "${action}" timed out`));
        pending.delete(id);
      }
    }, 30000);
  });
}

// --- CLI ---
function log(msg) {
  process.stderr.write(`\x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m ${msg}\n`);
}

async function handleCommand(input) {
  const args = input.trim().split(/\s+/);
  if (!args.length) return;
  const cmd = args[0];
  const rest = args.slice(1);

  try {
    switch (cmd) {
      case 'connect': {
        const cfg = loadConfig();
        const server = rest[0] || cfg?.serverUrl;
        const token = rest[1] || cfg?.authToken;
        if (!server || !token) {
          console.log('Usage: connect <ws://server:port> <token>');
          return;
        }
        await connect(server, token);
        return;
      }

      case 'status':
        console.log(JSON.stringify({
          connected: ws !== null,
          browserConnected: STATE.browserConnected,
          serverUrl: STATE.serverUrl,
          pendingCommands: pending.size
        }, null, 2));
        return;

      case 'disconnect':
        if (ws) ws.close();
        return;

      // --- Navigation ---
      case 'nav':
      case 'navigate': {
        const result = await sendCmd('navigate', { url: args[1] });
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      case 'newtab':
      case 'nt': {
        const result = await sendCmd('new_tab', { url: rest[0] });
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      case 'close':
        await sendCmd('close_tab', rest[0] ? { tabId: parseInt(rest[0]) } : {});
        console.log('Tab closed');
        return;

      case 'back':
        await sendCmd('go_back');
        return;

      case 'forward':
        await sendCmd('go_forward');
        return;

      // --- Tabs ---
      case 'tabs':
      case 'ls': {
        const result = await sendCmd('get_tabs');
        console.table(result.map((t, i) => ({ '#': i, id: t.id, title: (t.title || '').slice(0, 60), active: t.active, url: t.url })));
        return;
      }

      case 'url': {
        const result = await sendCmd('get_url');
        console.log(result.url);
        return;
      }

      case 'title': {
        const result = await sendCmd('get_title');
        console.log(result.title);
        return;
      }

      // --- Screenshot ---
      case 'shot':
      case 'screenshot':
      case 'ss': {
        const quality = parseInt(rest[0]) || 80;
        const result = await sendCmd('screenshot', { quality });
        // Save to file
        const filename = `screenshot-${Date.now()}.jpg`;
        const buf = Buffer.from(result.dataUrl.split(',')[1], 'base64');
        fs.writeFileSync(filename, buf);
        console.log(`Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
        return;
      }

      // --- Click ---
      case 'click': {
        const x = parseInt(rest[0]);
        const y = parseInt(rest[1]);
        if (isNaN(x) || isNaN(y)) { console.log('Usage: click <x> <y>'); return; }
        await sendCmd('click', { x, y });
        console.log('Clicked');
        return;
      }

      case 'dblclick': {
        const x = parseInt(rest[0]);
        const y = parseInt(rest[1]);
        await sendCmd('double_click', { x, y });
        console.log('Double-clicked');
        return;
      }

      case 'rclick': {
        const x = parseInt(rest[0]);
        const y = parseInt(rest[1]);
        await sendCmd('right_click', { x, y });
        console.log('Right-clicked');
        return;
      }

      case 'hover': {
        const x = parseInt(rest[0]);
        const y = parseInt(rest[1]);
        await sendCmd('hover', { x, y });
        console.log('Hovered');
        return;
      }

      case 'drag': {
        const [x1, y1, x2, y2] = rest.map(Number);
        await sendCmd('drag', { x1, y1, x2, y2 });
        console.log('Dragged');
        return;
      }

      // --- Keyboard ---
      case 'type':
      case 't': {
        const text = rest.join(' ');
        await sendCmd('type', { text });
        console.log('Typed');
        return;
      }

      case 'key':
      case 'k': {
        const key = rest[0];
        await sendCmd('key_press', {
          key,
          ctrlKey: rest.includes('--ctrl'),
          shiftKey: rest.includes('--shift'),
          altKey: rest.includes('--alt'),
          metaKey: rest.includes('--meta')
        });
        console.log(`Pressed: ${key}`);
        return;
      }

      // --- Scroll ---
      case 'scroll': {
        const x = parseInt(rest[0]) || 0;
        const y = parseInt(rest[1]) || 0;
        await sendCmd('scroll', { x, y });
        console.log(`Scrolled to (${x}, ${y})`);
        return;
      }

      case 'scrollto': {
        await sendCmd('scroll_to', { selector: rest[0] });
        console.log(`Scrolled to: ${rest[0]}`);
        return;
      }

      // --- Form ---
      case 'set':
      case 'fill': {
        const selector = rest[0];
        const value = rest.slice(1).join(' ');
        await sendCmd('set_value', { selector, value });
        console.log(`Set "${selector}" = "${value}"`);
        return;
      }

      case 'select': {
        await sendCmd('select_option', { selector: rest[0], value: rest[1] });
        console.log(`Selected "${rest[1]}" on "${rest[0]}"`);
        return;
      }

      // --- Page Content ---
      case 'text': {
        const selector = rest[0] || 'body';
        const result = await sendCmd('get_text', { selector });
        console.log(result.text.slice(0, 5000));
        return;
      }

      case 'html': {
        const result = await sendCmd('get_html', { selector: rest[0] || 'html' });
        console.log(result.html.slice(0, 10000));
        return;
      }

      case 'find':
      case 'f': {
        const query = rest.join(' ');
        const result = await sendCmd('find_elements', { query, limit: parseInt(rest[rest.length - 1]) || 20 });
        if (result.elements.length === 0) {
          console.log('No elements found');
        } else {
          console.table(result.elements.map(e => ({
            '#': e.index,
            tag: e.tag,
            text: e.text.slice(0, 60),
            id: e.id || '',
            rect: `${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}`
          })));
        }
        return;
      }

      case 'structure': {
        const result = await sendCmd('get_page_structure', { interactiveOnly: rest.includes('--interactive') });
        console.log(`${result.elements.length} elements`);
        for (const el of result.elements.slice(0, 50)) {
          console.log(`  [${el.index}] ${el.tag} "${el.text}" @ ${el.rect.x},${el.rect.y}`);
        }
        return;
      }

      // --- JavaScript ---
      case 'eval': {
        const code = rest.join(' ');
        const result = await sendCmd('evaluate', { code });
        console.log(result.result);
        return;
      }

      case 'evala': {
        const code = rest.join(' ');
        const result = await sendCmd('evaluate_async', { code });
        console.log(result.result);
        return;
      }

      // --- Cookies ---
      case 'cookies': {
        const result = await sendCmd('get_cookies', { url: rest[0] });
        console.table(result.cookies);
        return;
      }

      // --- Wait ---
      case 'wait': {
        const ms = parseInt(rest[0]) || 1000;
        await sendCmd('wait', { ms });
        console.log(`Waited ${ms}ms`);
        return;
      }

      // --- Window ---
      case 'resize':
      case 'rs': {
        const w = parseInt(rest[0]);
        const h = parseInt(rest[1]);
        if (!w || !h) { console.log('Usage: resize <width> <height>'); return; }
        await sendCmd('resize_window', { width: w, height: h });
        console.log(`Resized to ${w}x${h}`);
        return;
      }

      // --- Network Monitoring ---
      case 'network':
      case 'net': {
        const result = await sendCmd('get_network_requests', { limit: parseInt(rest[0]) || 50 });
        console.table(result.requests.slice(-50).map(r => ({
          url: r.url?.slice(0, 80),
          method: r.method,
          type: r.type,
          status: r.status || '...'
        })));
        return;
      }

      case 'block': {
        await sendCmd('block_request', { pattern: rest[0] });
        console.log(`Blocked: ${rest[0]}`);
        return;
      }

      case 'unblock': {
        await sendCmd('unblock_request');
        console.log('Unblocked all');
        return;
      }

      // --- Console ---
      case 'console':
      case 'log': {
        const result = await sendCmd('get_console_logs');
        for (const entry of (result.logs || []).slice(-20)) {
          const text = entry.args?.map(a => a.value || a.description).join(' ') || '';
          console.log(`[${entry.type}] ${text.slice(0, 200)}`);
        }
        return;
      }

      // --- Download ---
      case 'download':
      case 'dl': {
        const url = rest[0];
        await sendCmd('download', { url, filename: rest[1] || undefined });
        console.log(`Downloading: ${url}`);
        return;
      }

      // --- Batch / Macro ---
      case 'batch':
      case 'run': {
        const file = rest[0];
        if (!file) { console.log('Usage: run <script.json>'); return; }
        if (!fs.existsSync(file)) { console.log(`File not found: ${file}`); return; }
        const script = JSON.parse(fs.readFileSync(file, 'utf-8'));
        for (const step of script) {
          console.log(`\n▶ ${step.action} ${JSON.stringify(step.params || {})}`);
          const result = await sendCmd(step.action, step.params || {});
          if (step.save) {
            console.log(JSON.stringify(result, null, 2));
          }
        }
        return;
      }

      // --- Help ---
      case 'help':
      case 'h':
      case '?':
        console.log(`
Claude Browser Relay CLI  —  available commands:

  connect <url> <token>     Connect to relay server
  status                     Show connection status
  disconnect                 Disconnect

  Navigation:
    nav <url>                Navigate to URL
    nt [url]                 New tab
    close [tabId]            Close tab
    back / forward           Go back/forward

  Tabs & Info:
    tabs / ls                List all tabs
    url                      Current URL
    title                    Current title
    ss [quality]             Screenshot (saves to disk)

  Mouse:
    click <x> <y>            Left click
    dblclick <x> <y>         Double click
    rclick <x> <y>           Right click
    hover <x> <y>            Hover
    drag <x1> <y1> <x2> <y2> Drag

  Keyboard:
    type <text>              Type text
    key <key> [--ctrl] ...   Press key with modifiers

  Scroll:
    scroll [x] [y]           Scroll to position
    scrollto <selector>      Scroll to element

  Form:
    fill <selector> <value>  Set input value
    select <sel> <value>     Select option

  Content:
    text [selector]          Get page text
    html [selector]          Get page HTML
    find <query> [limit]     Find elements matching text
    structure [--interactive] Get page structure

  JS:
    eval <js code>           Evaluate JS
    evala <async js>         Evaluate async JS

  Network:
    net [limit]              Show network requests
    block <pattern>          Block URLs matching pattern
    unblock                  Remove all blocks
    console/log              Show console logs

  Other:
    cookies [url]            Get cookies
    wait <ms>                Wait
    resize <w> <h>           Resize window
    download <url> [name]    Download file
    run <script.json>        Run batch script
    quit                     Exit
`);
        return;

      case 'quit':
      case 'exit':
      case 'q':
        if (ws) ws.close();
        process.exit(0);

      default:
        console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
    }
  } catch (err) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
  }
}

// --- Main ---
async function main() {
  console.log('🌐 Claude Browser Relay CLI');
  console.log('Type "help" for commands, "connect <url> <token>" to start.\n');

  // Auto-connect if config exists
  const cfg = loadConfig();
  if (cfg && cfg.serverUrl && cfg.authToken) {
    console.log(`Auto-connecting to ${cfg.serverUrl}...`);
    try {
      await connect(cfg.serverUrl, cfg.authToken);
    } catch (err) {
      console.error(`Auto-connect failed: ${err.message}`);
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('browser> ');

  rl.on('line', async (line) => {
    rl.pause();
    await handleCommand(line);
    rl.resume();
    rl.prompt();
  });

  rl.prompt();

  rl.on('close', () => {
    if (ws) ws.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
