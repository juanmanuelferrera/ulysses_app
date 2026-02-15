// keyboard.js — Keyboard shortcuts with Ulysses-style three-panel navigation
import { bus } from './utils.js';
import { createSheet } from './db.js';
import { getActiveGroupId } from './library.js';
import { wrapSelection, openFind } from './editor.js';
import { getState } from './app.js';
import { selectNextSheet, selectPrevSheet } from './sheets.js';

// --- Panel focus state ---
// 'library' | 'sheets' | 'editor'
let focusedPanel = 'editor';
let libraryFocusIndex = -1;

function isEditorFocused() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.closest('.cm-editor')) return true;
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return true;
  if (active.isContentEditable) return true;
  return false;
}

function isInputFocused() {
  const active = document.activeElement;
  if (!active) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable;
}

/** Get all visible, navigable items in the library sidebar (filters + groups) */
function getLibraryItems() {
  const tree = document.getElementById('library-tree');
  if (!tree) return [];
  return [...tree.querySelectorAll('.filter-item, .group-item')].filter(el => {
    // Must be visible (not inside collapsed container)
    return el.offsetParent !== null;
  });
}

/** Highlight a library item by index */
function focusLibraryItem(index) {
  const items = getLibraryItems();
  if (items.length === 0) return;
  // Clear previous kb-focus
  document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));
  // Clamp
  index = Math.max(0, Math.min(index, items.length - 1));
  libraryFocusIndex = index;
  items[index].classList.add('kb-focus');
  items[index].scrollIntoView({ block: 'nearest' });
}

/** Switch focused panel */
function setPanel(panel) {
  focusedPanel = panel;
  // Clear all kb-focus highlights
  document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));

  if (panel === 'library') {
    // Blur editor
    document.activeElement?.blur();
    document.getElementById('app').focus();
    // Find the currently active item and highlight it
    const items = getLibraryItems();
    const activeIdx = items.findIndex(el => el.classList.contains('active'));
    focusLibraryItem(activeIdx >= 0 ? activeIdx : 0);
  } else if (panel === 'sheets') {
    document.activeElement?.blur();
    document.getElementById('app').focus();
    libraryFocusIndex = -1;
  } else if (panel === 'editor') {
    libraryFocusIndex = -1;
  }
}

export function initKeyboard() {
  initSwipeGestures();

  // When editor gets focus via click, update panel state
  document.getElementById('editor-panel')?.addEventListener('mousedown', () => {
    if (focusedPanel !== 'editor') setPanel('editor');
  });
  document.getElementById('sheets-panel')?.addEventListener('mousedown', (e) => {
    // Only if clicking on the sheet list area, not header buttons
    if (e.target.closest('.sheet-card') || e.target.closest('.sheet-list')) {
      if (focusedPanel !== 'sheets') {
        focusedPanel = 'sheets';
        document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));
      }
    }
  });
  document.getElementById('library-panel')?.addEventListener('mousedown', (e) => {
    if (e.target.closest('.filter-item') || e.target.closest('.group-item')) {
      focusedPanel = 'library';
      document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));
    }
  });

  document.addEventListener('keydown', async (e) => {
    const meta = e.metaKey || e.ctrlKey;

    // --- Global shortcuts (work from any panel) ---

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

    // Cmd+1 — Toggle library panel visibility
    if (meta && e.key === '1') {
      e.preventDefault();
      document.getElementById('app').classList.toggle('library-hidden');
      return;
    }

    // Cmd+2 — Toggle sheets panel visibility
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
    if (meta && !e.shiftKey && e.key === 'k') {
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

    // Cmd+Up/Down — Navigate sheets from editor without leaving it
    if (meta && e.key === 'ArrowDown' && isEditorFocused()) {
      e.preventDefault();
      selectNextSheet();
      return;
    }
    if (meta && e.key === 'ArrowUp' && isEditorFocused()) {
      e.preventDefault();
      selectPrevSheet();
      return;
    }

    // --- Don't handle navigation keys when in an input field ---
    if (isInputFocused()) return;

    // --- Escape — Move focus one panel to the left ---
    if (e.key === 'Escape') {
      // First close any overlay
      const overlay = document.querySelector('.search-overlay') || document.querySelector('.modal-overlay') || document.querySelector('.context-menu');
      if (overlay) {
        overlay.remove();
        return;
      }

      if (focusedPanel === 'editor' || isEditorFocused()) {
        e.preventDefault();
        document.activeElement?.blur();
        document.querySelector('.cm-editor .cm-content')?.blur();
        const app = document.getElementById('app');
        if (!app.classList.contains('sheets-hidden')) {
          setPanel('sheets');
        } else if (!app.classList.contains('library-hidden')) {
          setPanel('library');
        }
      } else if (focusedPanel === 'sheets') {
        e.preventDefault();
        const app = document.getElementById('app');
        if (!app.classList.contains('library-hidden')) {
          setPanel('library');
        }
      }
      // In library, Escape does nothing
      return;
    }

    // --- Enter — Move focus one panel to the right / activate selection ---
    if (e.key === 'Enter' && !meta) {
      if (focusedPanel === 'library') {
        e.preventDefault();
        // Activate the kb-focused library item
        const items = getLibraryItems();
        if (libraryFocusIndex >= 0 && libraryFocusIndex < items.length) {
          items[libraryFocusIndex].click();
        }
        // Move focus to sheets panel
        const app = document.getElementById('app');
        if (app.classList.contains('sheets-hidden')) {
          app.classList.remove('sheets-hidden');
        }
        setPanel('sheets');
        return;
      }
      if (focusedPanel === 'sheets') {
        e.preventDefault();
        setPanel('editor');
        const { focus } = await import('./editor.js');
        focus();
        return;
      }
      // In editor, Enter is normal typing
      return;
    }

    // --- Arrow Up/Down — Navigate within focused panel ---
    if (e.key === 'ArrowDown') {
      if (focusedPanel === 'library') {
        e.preventDefault();
        focusLibraryItem(libraryFocusIndex + 1);
        return;
      }
      if (focusedPanel === 'sheets') {
        e.preventDefault();
        selectNextSheet();
        return;
      }
    }

    if (e.key === 'ArrowUp') {
      if (focusedPanel === 'library') {
        e.preventDefault();
        focusLibraryItem(libraryFocusIndex - 1);
        return;
      }
      if (focusedPanel === 'sheets') {
        e.preventDefault();
        selectPrevSheet();
        return;
      }
    }

    // --- Arrow Left/Right in library — collapse/expand groups ---
    if (e.key === 'ArrowLeft' && focusedPanel === 'library') {
      e.preventDefault();
      const items = getLibraryItems();
      const item = items[libraryFocusIndex];
      if (!item || !item.classList.contains('group-item')) return;

      const groupId = item.dataset.id;
      const children = document.querySelector(`.group-children[data-parent="${groupId}"]`);

      if (children && children.style.display !== 'none') {
        // Collapse this group's children
        children.style.display = 'none';
        item.querySelector('.group-chevron')?.classList.remove('open');
      } else {
        // Already collapsed or no children — jump to parent group
        const parentContainer = item.closest('.group-children');
        if (parentContainer) {
          const parentId = parentContainer.dataset.parent;
          const parentItem = document.querySelector(`.group-item[data-id="${parentId}"]`);
          if (parentItem) {
            const newItems = getLibraryItems();
            const parentIdx = newItems.indexOf(parentItem);
            if (parentIdx >= 0) focusLibraryItem(parentIdx);
          }
        }
      }
      return;
    }

    if (e.key === 'ArrowRight' && focusedPanel === 'library') {
      e.preventDefault();
      const items = getLibraryItems();
      const item = items[libraryFocusIndex];
      if (!item || !item.classList.contains('group-item')) return;

      const groupId = item.dataset.id;
      const children = document.querySelector(`.group-children[data-parent="${groupId}"]`);

      if (children && children.style.display === 'none') {
        // Expand this group's children
        children.style.display = '';
        item.querySelector('.group-chevron')?.classList.add('open');
      } else if (children) {
        // Already expanded — move focus to first child
        const newItems = getLibraryItems();
        const currentIdx = newItems.indexOf(item);
        if (currentIdx >= 0 && currentIdx + 1 < newItems.length) {
          focusLibraryItem(currentIdx + 1);
        }
      }
      return;
    }
  });
}

// --- Trackpad swipe gestures ---
// Two-finger horizontal swipe anywhere on screen.
// Fingers left → hide panels | Fingers right → show panels
function initSwipeGestures() {
  const THRESHOLD = 30;
  const COOLDOWN = 500;

  let accum = 0;
  let lastTrigger = 0;
  let resetTimer = null;

  window.addEventListener('wheel', (e) => {
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    if (absX <= absY || absX < 2) return;

    e.preventDefault();
    e.stopPropagation();

    if (Date.now() - lastTrigger < COOLDOWN) return;

    accum += e.deltaX;

    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { accum = 0; }, 200);

    const app = document.getElementById('app');
    const libHidden = app.classList.contains('library-hidden');
    const sheetsHidden = app.classList.contains('sheets-hidden');

    // Fingers LEFT → collapse
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

    // Fingers RIGHT → expand
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
