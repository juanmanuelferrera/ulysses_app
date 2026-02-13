// keyboard.js — Keyboard shortcuts
import { bus } from './utils.js';
import { createSheet } from './db.js';
import { getActiveGroupId } from './library.js';
import { wrapSelection, openFind } from './editor.js';
import { getState } from './app.js';

export function initKeyboard() {
  initSwipeGestures();

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;

    // Cmd+N — New sheet
    if (meta && e.key === 'n') {
      e.preventDefault();
      const groupId = getActiveGroupId();
      if (groupId) {
        createSheet(groupId, '', '# ').then(sheet => {
          bus.emit('sheet:created', sheet);
        });
      }
      return;
    }

    // Cmd+F — Find & Replace in current sheet
    if (meta && !e.shiftKey && e.key === 'f') {
      e.preventDefault();
      openFind();
      return;
    }

    // Cmd+Shift+F — Global search
    if (meta && e.shiftKey && e.key === 'f') {
      e.preventDefault();
      bus.emit('search:open');
      return;
    }

    // Cmd+1 — Toggle library
    if (meta && e.key === '1') {
      e.preventDefault();
      document.getElementById('app').classList.toggle('library-hidden');
      return;
    }

    // Cmd+2 — Toggle sheets panel
    if (meta && e.key === '2') {
      e.preventDefault();
      document.getElementById('app').classList.toggle('sheets-hidden');
      return;
    }

    // Cmd+3 — Focus-only (hide both panels)
    if (meta && e.key === '3') {
      e.preventDefault();
      const app = document.getElementById('app');
      const bothHidden = app.classList.contains('library-hidden') && app.classList.contains('sheets-hidden');
      if (bothHidden) {
        app.classList.remove('library-hidden', 'sheets-hidden');
      } else {
        app.classList.add('library-hidden', 'sheets-hidden');
      }
      return;
    }

    // Cmd+B — Bold
    if (meta && e.key === 'b') {
      e.preventDefault();
      wrapSelection('**', '**');
      return;
    }

    // Cmd+I — Italic
    if (meta && e.key === 'i') {
      e.preventDefault();
      wrapSelection('*', '*');
      return;
    }

    // Cmd+K — Link
    if (meta && e.key === 'k') {
      e.preventDefault();
      wrapSelection('[', '](url)');
      return;
    }

    // Cmd+Shift+K — Inline code
    if (meta && e.shiftKey && e.key === 'k') {
      e.preventDefault();
      wrapSelection('`', '`');
      return;
    }

    // Cmd+Shift+O — Open current sheet in new window
    if (meta && e.shiftKey && e.key === 'o') {
      e.preventDefault();
      const sheetId = getState().activeSheetId;
      if (sheetId) {
        const url = `${window.location.origin}${window.location.pathname}?sheet=${sheetId}`;
        window.open(url, '_blank', 'width=1200,height=800');
      }
      return;
    }

    // Cmd+E — Export
    if (meta && e.key === 'e') {
      e.preventDefault();
      bus.emit('export:open');
      return;
    }

    // Escape — Close overlays
    if (e.key === 'Escape') {
      document.querySelector('.search-overlay')?.remove();
      document.querySelector('.modal-overlay')?.remove();
      document.querySelector('.context-menu')?.remove();
    }
  });
}

// --- Trackpad swipe gestures ---
// Two-finger horizontal swipe anywhere on screen.
// Fingers left → hide panels | Fingers right → show panels
function initSwipeGestures() {
  const THRESHOLD = 30;    // very light swipe triggers
  const COOLDOWN = 500;    // ms before next toggle allowed

  let accum = 0;
  let lastTrigger = 0;
  let resetTimer = null;

  window.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    // Only horizontal-dominant gestures
    if (absX <= absY || absX < 2) return;

    // Steal from CodeMirror / scrollable panels
    e.preventDefault();
    e.stopPropagation();

    // Cooldown — don't rapid-fire toggles
    if (Date.now() - lastTrigger < COOLDOWN) return;

    accum += e.deltaX;

    // Reset accumulator if no input for a bit
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { accum = 0; }, 200);

    const app = document.getElementById('app');
    const libHidden = app.classList.contains('library-hidden');
    const sheetsHidden = app.classList.contains('sheets-hidden');

    // Fingers LEFT (positive deltaX on macOS natural scroll) → collapse
    if (accum > THRESHOLD) {
      accum = 0;
      lastTrigger = Date.now();
      if (!sheetsHidden) {
        app.classList.add('sheets-hidden');
      } else if (!libHidden) {
        app.classList.add('library-hidden');
      }
      return;
    }

    // Fingers RIGHT (negative deltaX) → expand
    if (accum < -THRESHOLD) {
      accum = 0;
      lastTrigger = Date.now();
      if (libHidden) {
        app.classList.remove('library-hidden');
      } else if (sheetsHidden) {
        app.classList.remove('sheets-hidden');
      }
      return;
    }
  }, { capture: true, passive: false });
}
