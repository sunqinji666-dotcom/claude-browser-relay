// Claude Browser Relay — Content Script
// Injected into web pages to execute commands that need page-level access

(() => {
  // --- Click ---
  function clickAt(x, y, button = 'left', clickCount = 1) {
    const el = document.elementFromPoint(x, y) || document.body;
    const opts = { bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: button === 'right' ? 2 : button === 'middle' ? 1 : 0,
      buttons: button === 'right' ? 2 : button === 'middle' ? 4 : 1,
      detail: clickCount };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (clickCount === 2) el.dispatchEvent(new MouseEvent('dblclick', opts));
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) el.focus();
    return { clicked: { x, y, tagName: el.tagName, text: (el.textContent || '').slice(0, 80) } };
  }

  function clickSelector(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    el.click();
    return { ok: true };
  }

  // --- Hover ---
  function hoverAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    return { hovered: { x, y, tagName: el.tagName } };
  }

  // --- Drag ---
  async function drag(x1, y1, x2, y2, steps = 10, duration = 500) {
    const start = document.elementFromPoint(x1, y1) || document.body;
    const stepDelay = duration / steps;
    start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x1, clientY: y1, button: 0, buttons: 1 }));
    for (let i = 1; i <= steps; i++) {
      const cx = x1 + ((x2 - x1) * i) / steps;
      const cy = y1 + ((y2 - y1) * i) / steps;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 }));
      await new Promise(r => setTimeout(r, stepDelay));
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2 }));
    return { dragged: { from: [x1, y1], to: [x2, y2] } };
  }

  // --- Type ---
  function typeText(text) {
    const el = document.activeElement || document.body;
    const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' });
    if (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      // Insert text at cursor
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const start = el.selectionStart;
        el.setRangeText(text, start, el.selectionEnd, 'end');
        el.dispatchEvent(inputEvent);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text);
        el.dispatchEvent(inputEvent);
      }
    } else {
      // Fallback: simulate keypresses
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
        el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
      }
    }
    return { typed: text.length > 200 ? `${text.slice(0, 200)}... (${text.length} chars)` : text };
  }

  // --- Key press ---
  function keyPress(key, modifiers = {}) {
    const el = document.activeElement || document.body;
    const opts = { bubbles: true, cancelable: true, key,
      ctrlKey: !!modifiers.ctrlKey, shiftKey: !!modifiers.shiftKey,
      altKey: !!modifiers.altKey, metaKey: !!modifiers.metaKey };
    for (let i = 0; i < (modifiers.repeat || 1); i++) {
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
    }
    return { keyPressed: key };
  }

  // --- Set Value ---
  function setValue(selector, value) {
    const el = selector === ':focus' ? document.activeElement : document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    const proto = Object.getPrototypeOf(el);
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { set: { selector, tagName: el.tagName } };
  }

  // --- Select Option ---
  function selectOption(selector, value) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    if (el.tagName === 'SELECT') {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = (value === true || value === 'true' || value === 'checked');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { selected: { selector, value } };
  }

  // --- Get Text ---
  function getText(selector) {
    const el = selector === 'body' ? document.body : (document.querySelector(selector) || document.body);
    // Prefer article / main content
    const article = el.querySelector('article, main, [role="main"]');
    const source = article || el;
    const text = source.innerText || source.textContent || '';
    return { text: text.slice(0, 100000) };
  }

  // --- Get HTML ---
  function getHtml(selector) {
    const el = document.querySelector(selector) || document.documentElement;
    return { html: el.outerHTML.slice(0, 500000) };
  }

  // --- Page Structure ---
  function getPageStructure(interactiveOnly = false) {
    const elements = [];
    const selector = interactiveOnly
      ? 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [onclick]'
      : 'a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, [role], label';
    document.querySelectorAll(selector).forEach((el, i) => {
      if (i > 500) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      elements.push({
        index: i,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        class: (el.className && typeof el.className === 'string') ? el.className.slice(0, 100) : null,
        role: el.getAttribute('role') || null,
        text: (el.textContent || '').trim().slice(0, 120),
        href: el.tagName === 'A' ? el.href : null,
        placeholder: el.placeholder || null,
        type: el.type || null,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        visible: rect.width > 0 && rect.height > 0
      });
    });
    return { elements };
  }

  // --- Find Elements ---
  function findElements(query, limit = 20) {
    const results = [];
    const lower = query.toLowerCase();
    const candidates = document.querySelectorAll('a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, label, span, div, p, [role]');
    for (const el of candidates) {
      if (results.length >= limit) break;
      const text = (el.textContent || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      if (text.includes(lower) || aria.includes(lower) || placeholder.includes(lower)) {
        const rect = el.getBoundingClientRect();
        results.push({
          index: results.length,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 120),
          role: el.getAttribute('role') || null,
          placeholder: el.placeholder || null,
          id: el.id || null,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        });
      }
    }
    return { elements: results };
  }

  // --- Scroll ---
  function scrollToPos(x, y) {
    window.scrollTo({ left: x, top: y, behavior: 'smooth' });
    return { scrolled: { x, y } };
  }

  function scrollToElement(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { scrolledTo: selector };
  }

  // --- Screenshot element ---
  async function screenshotElement(x, y, width, height) {
    // Use canvas to capture a region
    // Note: full cross-origin screenshots are limited without native captureVisibleTab
    // This is a best-effort attempt using canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Draw page background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // For actual pixel capture we'd need the visible tab screenshot from background
    // Content scripts can't do full page screenshots cross-origin
    return { dataUrl: null, note: 'Element screenshots require the full page screenshot from background script' };
  }

  // --- Wait For ---
  async function waitFor(selector, expectedText, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el && (!expectedText || el.textContent?.includes(expectedText))) {
        return { found: true, selector, elapsed: Date.now() - start };
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { found: false, selector, elapsed: timeout };
  }

  // --- Message Dispatcher ---
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.action) {
          case 'click': return sendResponse(clickAt(msg.x, msg.y, msg.button, msg.clickCount));
          case 'click_selector': return sendResponse(clickSelector(msg.selector));
          case 'hover': return sendResponse(hoverAt(msg.x, msg.y));
          case 'drag': return sendResponse(await drag(msg.x1, msg.y1, msg.x2, msg.y2, msg.steps, msg.duration));
          case 'type': return sendResponse(typeText(msg.text));
          case 'key_press': return sendResponse(keyPress(msg.key, msg));
          case 'set_value': return sendResponse(setValue(msg.selector, msg.value));
          case 'select_option': return sendResponse(selectOption(msg.selector, msg.value));
          case 'get_text': return sendResponse(getText(msg.selector));
          case 'get_html': return sendResponse(getHtml(msg.selector));
          case 'get_page_structure': return sendResponse(getPageStructure(msg.interactiveOnly));
          case 'find_elements': return sendResponse(findElements(msg.query, msg.limit));
          case 'scroll': return sendResponse(scrollToPos(msg.x, msg.y));
          case 'scroll_to': return sendResponse(scrollToElement(msg.selector));
          case 'screenshot_element': return sendResponse(await screenshotElement(msg.x, msg.y, msg.width, msg.height));
          case 'wait_for': return sendResponse(await waitFor(msg.selector, msg.text, msg.timeout));
          default: return sendResponse({ error: `Unknown action: ${msg.action}` });
        }
      } catch (err) {
        return sendResponse({ error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  });
})();
