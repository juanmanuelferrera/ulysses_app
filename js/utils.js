// utils.js — Shared utilities

// Simple event bus
export const bus = {
  _handlers: {},
  on(event, fn) {
    (this._handlers[event] ||= []).push(fn);
  },
  off(event, fn) {
    const h = this._handlers[event];
    if (h) this._handlers[event] = h.filter(f => f !== fn);
  },
  emit(event, data) {
    (this._handlers[event] || []).forEach(fn => fn(data));
  }
};

// Debounce
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Generate unique ID
export function uid() {
  return crypto.randomUUID();
}

// Format date
export function formatDate(d) {
  const date = new Date(d);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// Word count
export function wordCount(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

// Character count
export function charCount(text) {
  if (!text) return 0;
  return text.length;
}

// Truncate text for previews
export function truncate(text, len = 120) {
  if (!text) return '';
  const clean = text.replace(/^#+\s*/gm, '').replace(/[*_~`]/g, '').trim();
  return clean.length <= len ? clean : clean.slice(0, len) + '...';
}

// Extract title from markdown (first heading or first line)
export function extractTitle(content) {
  if (!content || !content.trim()) return 'Untitled';
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  const firstLine = content.trim().split('\n')[0].trim();
  return firstLine.slice(0, 60) || 'Untitled';
}

// Create DOM element helper
export function el(tag, attrs = {}, children = []) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') elem.className = v;
    else if (k === 'text') elem.textContent = v;
    else if (k === 'html') elem.innerHTML = v;
    else if (k.startsWith('on')) elem.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(elem.dataset, v);
    else elem.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
    else if (child) elem.appendChild(child);
  }
  return elem;
}

// Undo toast — shows a brief notification with an Undo button
// Returns a promise that resolves to true if undo was pressed, false if it expired
export function showUndoToast(message, { duration = 5000 } = {}) {
  return new Promise((resolve) => {
    // Remove any existing toast
    document.querySelector('.undo-toast')?.remove();

    let resolved = false;
    const toast = el('div', { class: 'undo-toast' }, [
      el('span', { text: message }),
      el('button', {
        class: 'undo-toast-btn',
        text: 'Undo',
        onClick: () => {
          if (!resolved) {
            resolved = true;
            toast.remove();
            resolve(true);
          }
        },
      }),
    ]);

    document.body.appendChild(toast);
    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
        resolve(false);
      }
    }, duration);
  });
}

// Custom alert dialog (replaces native alert())
export function appAlert(message) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay fade-in' });
    const modal = el('div', { class: 'modal', style: 'min-width: 320px; max-width: 380px; text-align: center;' }, [
      el('p', { text: message, style: 'font-size: 14px; color: var(--text-primary); margin-bottom: 20px; line-height: 1.5;' }),
      el('div', { style: 'display: flex; justify-content: center;' }, [
        el('button', {
          class: 'btn btn-primary',
          text: 'OK',
          style: 'padding: 8px 32px;',
          onClick: () => { overlay.remove(); resolve(); },
        }),
      ]),
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(); } });
    document.body.appendChild(overlay);
    modal.querySelector('.btn').focus();
  });
}

// Custom confirm dialog (replaces native confirm())
export function appConfirm(message, { confirmText = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay fade-in' });
    const modal = el('div', { class: 'modal', style: 'min-width: 320px; max-width: 380px; text-align: center;' }, [
      el('p', { text: message, style: 'font-size: 14px; color: var(--text-primary); margin-bottom: 20px; line-height: 1.5;' }),
      el('div', { style: 'display: flex; gap: 8px; justify-content: center;' }, [
        el('button', {
          class: 'btn',
          text: 'Cancel',
          style: 'padding: 8px 20px; flex: 1;',
          onClick: () => { overlay.remove(); resolve(false); },
        }),
        el('button', {
          class: `btn ${danger ? 'btn-primary' : 'btn-primary'}`,
          text: confirmText,
          style: `padding: 8px 20px; flex: 1; background: ${danger ? 'var(--danger)' : 'var(--accent)'};`,
          onClick: () => { overlay.remove(); resolve(true); },
        }),
      ]),
    ]);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    document.body.appendChild(overlay);
    // Focus the cancel button
    modal.querySelector('.btn').focus();
  });
}
