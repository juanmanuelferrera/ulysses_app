// search.js — Full-text search across all sheets
import { bus, el, truncate } from './utils.js';
import { searchSheets, getGroup } from './db.js';

let overlayEl = null;

export function initSearch() {
  document.getElementById('search-btn')?.addEventListener('click', openSearch);

  bus.on('search:open', openSearch);
}

export function openSearch() {
  if (overlayEl) return;

  overlayEl = el('div', { class: 'search-overlay fade-in' });
  const inputEl = el('input', { type: 'text', placeholder: 'Search all sheets...' });
  const resultsEl = el('div', { class: 'search-results' });

  const modal = el('div', { class: 'search-modal' }, [
    el('div', { class: 'search-modal-input' }, [inputEl]),
    resultsEl,
  ]);

  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);
  inputEl.focus();

  let selectedIdx = -1;

  inputEl.addEventListener('input', async () => {
    const q = inputEl.value.trim();
    if (!q) {
      resultsEl.innerHTML = '';
      return;
    }

    const results = await searchSheets(q);
    selectedIdx = -1;
    resultsEl.innerHTML = '';

    if (results.length === 0) {
      resultsEl.appendChild(el('div', { class: 'empty-state', style: 'padding: 20px;' }, [
        el('div', { class: 'empty-state-text', text: 'No results found' }),
      ]));
      return;
    }

    for (const sheet of results) {
      const group = await getGroup(sheet.groupId);
      const item = el('div', { class: 'search-result-item' }, [
        el('div', { class: 'search-result-title', text: sheet.title || 'Untitled' }),
        el('div', { class: 'search-result-preview', text: highlightMatch(truncate(sheet.content, 100), q) }),
        el('div', { class: 'search-result-group', text: group?.name || 'Unknown' }),
      ]);

      item.addEventListener('click', () => {
        bus.emit('group:select', sheet.groupId);
        setTimeout(() => bus.emit('sheet:select', sheet.id), 100);
        closeSearch();
      });

      resultsEl.appendChild(item);
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = resultsEl.querySelectorAll('.search-result-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((item, i) => item.classList.toggle('selected', i === selectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((item, i) => item.classList.toggle('selected', i === selectedIdx));
    } else if (e.key === 'Enter') {
      if (selectedIdx >= 0 && items[selectedIdx]) {
        items[selectedIdx].click();
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeSearch();
  });
}

function closeSearch() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function highlightMatch(text, query) {
  // Simple text highlight — returns text as-is since we use textContent
  return text;
}
