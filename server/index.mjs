import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.RELAY_PORT || '25818', 10);
const AUTH_TOKEN = process.env.RELAY_TOKEN || randomUUID();

// State
const controllers = new Map();   // ws → { id }
let browser = null;              // ws (only one browser at a time)

const wss = new WebSocketServer({ port: PORT });
console.log(`\n🔌 Claude Browser Relay — ws://0.0.0.0:${PORT}`);
console.log(`🔑 Auth token: ${AUTH_TOKEN}\n`);

wss.on('connection', (ws, req) => {
  const clientId = randomUUID().slice(0, 8);
  let role = null;
  let authed = false;

  console.log(`[${clientId}] connected (${req.socket.remoteAddress})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      return send(ws, { type: 'error', message: 'Invalid JSON' });
    }

    // --- AUTH ---
    if (msg.type === 'auth') {
      if (msg.token !== AUTH_TOKEN) {
        return send(ws, { type: 'error', message: 'Invalid token' });
      }
      if (msg.role !== 'controller' && msg.role !== 'browser') {
        return send(ws, { type: 'error', message: 'Role must be "controller" or "browser"' });
      }
      role = msg.role;
      authed = true;

      if (role === 'browser') {
        if (browser) {
          console.log(`[${clientId}] new browser — replacing old connection`);
        }
        browser = ws;
        broadcastControllers({ type: 'browser_status', connected: true });
      } else {
        controllers.set(ws, { id: clientId });
        send(ws, { type: 'browser_status', connected: browser !== null });
      }

      console.log(`[${clientId}] authed as ${role}`);
      send(ws, { type: 'auth_ok', role, clientId });
      return;
    }

    if (!authed) {
      return send(ws, { type: 'error', message: 'Auth required first' });
    }

    // --- ROUTING ---

    if (role === 'controller') {
      // Controller → Browser
      if (!browser || browser.readyState !== 1) {
        return send(ws, { type: 'error', message: 'No browser connected', id: msg.id });
      }
      msg._controllerId = clientId;
      send(browser, msg);
    } else if (role === 'browser') {
      // Browser → Controller (response)
      const controller = findController(msg._controllerId);
      if (controller) {
        send(controller, msg);
      } else {
        // Broadcast to all controllers if no specific target
        for (const [cws] of controllers) {
          send(cws, msg);
        }
      }
    }
  });

  ws.on('close', () => {
    console.log(`[${clientId}] disconnected (${role})`);
    if (role === 'browser' && ws === browser) {
      browser = null;
      broadcastControllers({ type: 'browser_status', connected: false });
    }
    if (role === 'controller') {
      controllers.delete(ws);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${clientId}] error:`, err.message);
  });
});

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastControllers(msg) {
  for (const [cws] of controllers) {
    send(cws, msg);
  }
}

function findController(id) {
  for (const [cws, info] of controllers) {
    if (info.id === id) return cws;
  }
  return null;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close(() => process.exit(0));
});
