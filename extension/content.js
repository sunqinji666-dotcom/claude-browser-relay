// ============================================================
// Claude Browser Bridge v2.0 — Content Script
// Runs in every page's context.
// Handles: clicks, typing, scrolling, form filling, text/HTML extraction,
//   element search, page structure analysis, and page-level JS eval (bypasses CSP).
// Added: heartbeat ping response, rich text extraction, element bounding box.
// ============================================================

'use strict';

// ─── Ping — health check from background ───
function pingResponder() { return { pong: true, url: location.href, loaded: document.readyState }; }

// ─── Click (any button, any click count) ───
function clickAt(x, y, button = 'left', clickCount = 1) {
  const el = document.elementFromPoint(x, y) || document.body;
  const rect = el.getBoundingClientRect();
  // Normalize coordinates to be relative to the element's client rect
  const clientX = x, clientY = y; // already in viewport coords
  const btnMap = { left: 0, middle: 1, right: 2 };
  const opts = {
    bubbles: true, cancelable: true, view: window,
    clientX, clientY,
    screenX: clientX + window.screenX, screenY: clientY + window.screenY,
    button: btnMap[button] ?? 0,
    buttons: button === 'right' ? 2 : button === 'middle' ? 4 : 1,
    detail: clickCount
  };

  ['mousedown', 'mouseup', 'click'].forEach(name => {
    const ev = new MouseEvent(name, opts);
    el.dispatchEvent(ev);
  });
  if (clickCount === 2) el.dispatchEvent(new MouseEvent('dblclick', opts));

  // Focus the element if it's focusable
  if (/^(input|textarea|select|button|a)$/i.test(el.tagName) || el.isContentEditable || el.tabIndex >= 0) {
    try { el.focus(); } catch {}
  }

  return {
    clicked: { x, y, tagName: el.tagName, id: el.id || null, text: (el.textContent || '').trim().slice(0, 100) }
  };
}

function clickSelector(selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  const rect = el.getBoundingClientRect();
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  return clickAt(cx, cy);
}

// ─── Hover ───
function hoverAt(x, y) {
  const el = document.elementFromPoint(x, y) || document.body;
  ['mouseover', 'mouseenter', 'mousemove'].forEach(name => {
    el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  });
  return { hovered: { x, y, tagName: el.tagName } };
}

// ─── Drag ───
async function drag(x1, y1, x2, y2, steps = 10, duration = 500) {
  const startEl = document.elementFromPoint(x1, y1) || document.body;
  const stepDelay = duration / steps;
  startEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x1, clientY: y1, button: 0, buttons: 1 }));
  for (let i = 1; i <= steps; i++) {
    const cx = x1 + ((x2 - x1) * i) / steps;
    const cy = y1 + ((y2 - y1) * i) / steps;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 }));
    await new Promise(r => setTimeout(r, stepDelay));
  }
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2 }));
  return { dragged: { from: [x1, y1], to: [x2, y2] } };
}

// ─── Type ───
function typeText(text) {
  const el = document.activeElement || document.body;
  if (el.isContentEditable || /^(input|textarea)$/i.test(el.tagName)) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const start = el.selectionStart;
      try { el.setRangeText(text, start, el.selectionEnd || start, 'end'); } catch {
        el.value = (el.value || '') + text;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
    }
  } else {
    for (const ch of text) {
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
    }
  }
  return { typed: text.length > 200 ? text.slice(0, 200) + `... (${text.length} chars)` : text };
}

// ─── Key Press ───
function keyPress(key, mods = {}) {
  const el = document.activeElement || document.body;
  const opts = { bubbles: true, cancelable: true, key, ctrlKey: !!mods.ctrlKey, shiftKey: !!mods.shiftKey, altKey: !!mods.altKey, metaKey: !!mods.metaKey };
  for (let i = 0; i < (mods.repeat || 1); i++) {
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  return { keyPressed: key };
}

// ─── Set Value ───
function setValue(selector, value) {
  const el = selector === ':focus' ? document.activeElement : document.querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) { setter.call(el, value); } else { el.value = value; }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { set: { selector, tagName: el.tagName } };
}

// ─── Select Option ───
function selectOption(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  if (el.tagName === 'SELECT') { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
  else if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type)) {
    el.checked = (value === true || value === 'true' || value === 'checked');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
  return { selected: { selector, value } };
}

// ─── Get Text ───
function getText(selector = 'body', maxLength = 100000) {
  const el = selector === 'body' ? document.body : (document.querySelector(selector) || document.body);
  const article = el.querySelector('article, main, [role="main"]');
  const source = article || el;
  const text = (source.innerText || source.textContent || '').slice(0, maxLength);
  return { text };
}

// ─── Get HTML ───
function getHtml(selector = 'html', maxLength = 500000) {
  const el = document.querySelector(selector) || document.documentElement;
  return { html: el.outerHTML.slice(0, maxLength) };
}

// ─── Page Structure ───
function getPageStructure(interactiveOnly = false) {
  const elements = [];
  const sel = interactiveOnly
    ? 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="menuitem"], [role="tab"], [onclick]'
    : 'a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, [role], label, summary, details';
  document.querySelectorAll(sel).forEach((el, i) => {
    if (i > 500) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && !el.id) return; // skip invisible-only-if-nameless
    elements.push({
      index: i,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 100) || null,
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      text: (el.textContent || '').trim().slice(0, 150),
      href: el.tagName === 'A' ? el.href : null,
      placeholder: el.placeholder || null,
      type: el.type || null,
      checked: el.checked ?? null,
      disabled: el.disabled ?? null,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0
    });
  });
  return { elements };
}

// ─── Find Elements ───
function findElements(query, limit = 20) {
  const results = [];
  const lower = query.toLowerCase();
  const candidates = document.querySelectorAll('a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, label, span, div, p, li, [role], [aria-label]');
  for (const el of candidates) {
    if (results.length >= limit) break;
    const text = (el.textContent || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();
    if (text.includes(lower) || aria.includes(lower) || placeholder.includes(lower) || (el.id && el.id.toLowerCase().includes(lower))) {
      const rect = el.getBoundingClientRect();
      results.push({
        index: results.length,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 150),
        id: el.id || null,
        role: el.getAttribute('role') || null,
        placeholder: el.placeholder || null,
        href: el.tagName === 'A' ? el.href : null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
      });
    }
  }
  return { elements: results };
}

// ─── Scroll ───
function scrollToPos(x, y) { window.scrollTo({ left: x, top: y, behavior: 'smooth' }); return { scrolled: { x, y } }; }
function scrollToElement(selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('Element not found: ' + selector);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { scrolledTo: selector };
}

// ─── Wait For ───
async function waitFor(selector, expectedText, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el && (!expectedText || (el.textContent || '').includes(expectedText))) {
      return { found: true, selector, elapsed: Date.now() - start };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return { found: false, selector, elapsed: timeout };
}

// ─── Page-level JS Evaluation (bypasses extension CSP) ───
// This function runs IN the page's own execution context, so it is NOT
// restricted by the extension's CSP. It uses DOM script injection.
function evalPage(code) {
  return new Promise((resolve, reject) => {
    try {
      // Method 1: new Function (works in page context, bypasses CSP for non-'unsafe-eval' pages)
      // But if the PAGE has CSP blocking eval, we use Method 2: script element injection
      try {
        const fn = new Function('"use strict"; return (' + code + ');');
        const result = fn();
        resolve(result);
      } catch (evalErr) {
        // Method 2: Inject a script element into the page
        const id = '__browser_bridge_eval_' + Date.now();
        const script = document.createElement('script');
        script.id = id;
        script.textContent = `
          (function() {
            try {
              const __result = (${code});
              document.dispatchEvent(new CustomEvent('__bridge_eval_result', { detail: { ok: true, result: __result, id: '${id}' } }));
            } catch(e) {
              document.dispatchEvent(new CustomEvent('__bridge_eval_result', { detail: { ok: false, error: e.message, id: '${id}' } }));
            }
          })();
        `;
        const handler = (e) => {
          if (e.detail && e.detail.id === id) {
            document.removeEventListener('__bridge_eval_result', handler);
            script.remove();
            if (e.detail.ok) resolve(e.detail.result);
            else reject(new Error(e.detail.error));
          }
        };
        document.addEventListener('__bridge_eval_result', handler);
        (document.head || document.documentElement).appendChild(script);
      }
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Message Dispatcher ───
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      let result;
      switch (msg.action) {
        case 'ping': result = pingResponder(); break;
        case 'click': result = clickAt(msg.x, msg.y, msg.button, msg.clickCount); break;
        case 'click_selector': result = clickSelector(msg.selector); break;
        case 'hover': result = hoverAt(msg.x, msg.y); break;
        case 'drag': result = await drag(msg.x1, msg.y1, msg.x2, msg.y2, msg.steps, msg.duration); break;
        case 'type': result = typeText(msg.text); break;
        case 'key_press': result = keyPress(msg.key, msg); break;
        case 'set_value': result = setValue(msg.selector, msg.value); break;
        case 'select_option': result = selectOption(msg.selector, msg.value); break;
        case 'get_text': result = getText(msg.selector, msg.maxLength); break;
        case 'get_html': result = getHtml(msg.selector, msg.maxLength); break;
        case 'get_page_structure': result = getPageStructure(msg.interactiveOnly); break;
        case 'find_elements': result = findElements(msg.query, msg.limit); break;
        case 'scroll': result = scrollToPos(msg.x, msg.y); break;
        case 'scroll_to': result = scrollToElement(msg.selector); break;
        case 'wait_for': result = await waitFor(msg.selector, msg.text, msg.timeout); break;
        case 'eval_page': result = await evalPage(msg.code); sendResponse(result); return true;
        default: sendResponse({ error: 'Unknown action: ' + msg.action }); return;
      }
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep channel open for async
});
