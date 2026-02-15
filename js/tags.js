// tags.js — Ulysses-style Keywords: sidebar filtering + sheet assignment
import { bus, el, appConfirm, showUndoToast } from './utils.js';
import { getTags, createTag, deleteTag, updateTag, getSheetTags, addTagToSheet, removeTagFromSheet } from './db.js';

const TAG_COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0c7', '#0071e3', '#5856d6', '#af52de', '#ff2d55',
  '#a2845e', '#636366',
];

let currentSheetId = null;
let allTags = [];

export function initTags() {
  // Tags sidebar is rendered by bootstrap with prefetched data
  document.getElementById('add-tag-btn')?.addEventListener('click', () => {
    showNewTagModal();
  });

  // Right-click on sidebar tags
  document.addEventListener('contextmenu', (e) => {
    const tagItem = e.target.closest('.tag-item');
    if (tagItem) {
      e.preventDefault();
      e.stopPropagation();
      const tagId = tagItem.dataset.tagId;
      const tag = allTags.find(t => t.id === tagId);
      if (tag) showTagContextMenu(e.clientX, e.clientY, tag);
    }
  });

  bus.on('sheet:loaded', (sheet) => {
    currentSheetId = sheet.id;
    renderSheetKeywords(sheet.id);
  });

  bus.on('sheet:none', () => {
    currentSheetId = null;
    clearSheetKeywords();
  });

  bus.on('sheet:tags-changed', () => {
    renderTagsSidebar();
  });
}

// --- Sidebar: tags as filters with counts ---
export async function renderTagsSidebar(prefetchedTags = null) {
  allTags = prefetchedTags || await getTags();
  const listEl = document.getElementById('tags-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const tag of allTags) {
    const item = el('div', {
      class: 'tag-item',
      dataset: { tagId: tag.id },
    }, [
      el('span', { class: 'tag-dot', style: `background: ${tag.color}` }),
      el('span', { class: 'tag-name', text: tag.name }),
      tag.sheetCount > 0 ? el('span', { class: 'group-count', text: String(tag.sheetCount) }) : null,
    ].filter(Boolean));

    // Click = filter sheets by this tag
    item.addEventListener('click', () => {
      bus.emit('tag:reveal', tag);
    });

    listEl.appendChild(item);
  }
}

// --- Sheet keywords panel (in attachments) ---
export async function renderSheetKeywords(sheetId) {
  const container = document.getElementById('sheet-keywords');
  if (!container) return;
  container.innerHTML = '';

  const sheetTags = await getSheetTags(sheetId);
  allTags = await getTags();

  // Render assigned tags as removable pills
  const pillsContainer = el('div', { class: 'keywords-pills' });
  for (const tag of sheetTags) {
    const pill = el('span', { class: 'keyword-pill', style: `background: ${tag.color}` }, [
      el('span', { text: tag.name }),
      el('span', { class: 'keyword-remove', html: '&times;', onClick: async (e) => {
        e.stopPropagation();
        await removeTagFromSheet(sheetId, tag.id);
        bus.emit('sheet:tags-changed', sheetId);
        renderSheetKeywords(sheetId);
      }}),
    ]);
    pillsContainer.appendChild(pill);
  }
  container.appendChild(pillsContainer);

  // Autocomplete input
  const inputWrap = el('div', { class: 'keyword-input-wrap' });
  const input = el('input', {
    class: 'keyword-input',
    type: 'text',
    placeholder: sheetTags.length > 0 ? 'Add keyword...' : 'Add keyword...',
  });
  const dropdown = el('div', { class: 'keyword-dropdown' });
  dropdown.style.display = 'none';

  inputWrap.appendChild(input);
  inputWrap.appendChild(dropdown);
  container.appendChild(inputWrap);

  const assignedIds = new Set(sheetTags.map(t => t.id));

  function showDropdown(filter = '') {
    dropdown.innerHTML = '';
    const q = filter.toLowerCase();
    const available = allTags.filter(t => !assignedIds.has(t.id) && t.name.toLowerCase().includes(q));
    const exactMatch = allTags.some(t => t.name.toLowerCase() === q);

    if (available.length === 0 && !q) {
      dropdown.style.display = 'none';
      return;
    }

    for (const tag of available) {
      const opt = el('div', { class: 'keyword-option' }, [
        el('span', { class: 'tag-dot', style: `background: ${tag.color}` }),
        el('span', { text: tag.name }),
      ]);
      opt.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        await addTagToSheet(sheetId, tag.id);
        bus.emit('sheet:tags-changed', sheetId);
        input.value = '';
        renderSheetKeywords(sheetId);
      });
      dropdown.appendChild(opt);
    }

    // "Create new" option if typed text doesn't match any existing tag
    if (q && !exactMatch) {
      const createOpt = el('div', { class: 'keyword-option keyword-create' }, [
        el('span', { text: `Create "${filter}"` }),
      ]);
      createOpt.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
        const newTag = await createTag(filter.trim(), color);
        await addTagToSheet(sheetId, newTag.id);
        bus.emit('sheet:tags-changed', sheetId);
        input.value = '';
        renderSheetKeywords(sheetId);
      });
      dropdown.appendChild(createOpt);
    }

    dropdown.style.display = available.length > 0 || (q && !exactMatch) ? '' : 'none';
  }

  input.addEventListener('focus', () => showDropdown(input.value));
  input.addEventListener('input', () => showDropdown(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      const val = input.value.trim();
      // Try to find existing tag
      const existing = allTags.find(t => t.name.toLowerCase() === val.toLowerCase() && !assignedIds.has(t.id));
      if (existing) {
        await addTagToSheet(sheetId, existing.id);
      } else if (!allTags.some(t => t.name.toLowerCase() === val.toLowerCase())) {
        // Create new tag
        const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
        const newTag = await createTag(val, color);
        await addTagToSheet(sheetId, newTag.id);
      }
      bus.emit('sheet:tags-changed', sheetId);
      input.value = '';
      renderSheetKeywords(sheetId);
    }
    if (e.key === 'Escape') {
      input.blur();
    }
  });
}

function clearSheetKeywords() {
  const container = document.getElementById('sheet-keywords');
  if (container) container.innerHTML = '';
}

// --- Sidebar context menu ---
function showTagContextMenu(x, y, tag) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', text: 'Show Sheets', onClick: () => {
      closeMenu();
      bus.emit('tag:reveal', tag);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item', text: 'Rename', onClick: () => {
      closeMenu();
      showRenameTagModal(tag);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: 'Delete', onClick: async () => {
      closeMenu();
      await deleteTag(tag.id);
      renderTagsSidebar();
      if (currentSheetId) {
        bus.emit('sheet:tags-changed', currentSheetId);
        renderSheetKeywords(currentSheetId);
      }
      const undone = await showUndoToast(`Keyword "${tag.name}" deleted`);
      if (undone) {
        await createTag(tag.name, tag.color);
        renderTagsSidebar();
      }
    }}),
  ]);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);
}

function showRenameTagModal(tag) {
  const overlay = el('div', { class: 'modal-overlay fade-in' });
  const nameInput = el('input', { class: 'input', type: 'text', value: tag.name });

  // Color picker
  let selectedColor = tag.color;
  const colorPicker = el('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;' },
    TAG_COLORS.map(color => {
      const swatch = el('div', {
        style: `width: 20px; height: 20px; border-radius: 50%; background: ${color}; cursor: pointer; border: 2px solid transparent;`,
        onClick: () => {
          selectedColor = color;
          colorPicker.querySelectorAll('div').forEach(d => { d.style.borderColor = 'transparent'; d.style.boxShadow = 'none'; });
          swatch.style.borderColor = '#fff';
          swatch.style.boxShadow = `0 0 0 2px ${color}`;
        },
      });
      if (color === selectedColor) {
        swatch.style.borderColor = '#fff';
        swatch.style.boxShadow = `0 0 0 2px ${color}`;
      }
      return swatch;
    })
  );

  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: 'Edit Keyword' }),
    el('div', { class: 'input-group' }, [
      el('label', { class: 'input-label', text: 'Name' }),
      nameInput,
    ]),
    el('div', { class: 'input-group' }, [
      el('label', { class: 'input-label', text: 'Color' }),
      colorPicker,
    ]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
      el('button', { class: 'btn btn-primary', text: 'Save', onClick: async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        await updateTag(tag.id, { name, color: selectedColor });
        renderTagsSidebar();
        if (currentSheetId) renderSheetKeywords(currentSheetId);
        overlay.remove();
      }}),
    ]),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  nameInput.focus();
  nameInput.select();
}

function showNewTagModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  let selectedColor = TAG_COLORS[0];

  const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Keyword name' });

  const colorPicker = el('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;' },
    TAG_COLORS.map(color => {
      const swatch = el('div', {
        style: `width: 24px; height: 24px; border-radius: 50%; background: ${color}; cursor: pointer; border: 2px solid transparent;`,
        onClick: () => {
          selectedColor = color;
          colorPicker.querySelectorAll('div').forEach(d => { d.style.borderColor = 'transparent'; d.style.boxShadow = 'none'; });
          swatch.style.borderColor = '#fff';
          swatch.style.boxShadow = `0 0 0 2px ${color}`;
        },
      });
      if (color === selectedColor) {
        swatch.style.borderColor = '#fff';
        swatch.style.boxShadow = `0 0 0 2px ${color}`;
      }
      return swatch;
    })
  );

  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: 'New Keyword' }),
    el('div', { class: 'input-group' }, [
      el('label', { class: 'input-label', text: 'Name' }),
      nameInput,
    ]),
    el('div', { class: 'input-group' }, [
      el('label', { class: 'input-label', text: 'Color' }),
      colorPicker,
    ]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
      el('button', { class: 'btn btn-primary', text: 'Create', onClick: async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        await createTag(name, selectedColor);
        renderTagsSidebar();
        overlay.remove();
      }}),
    ]),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  nameInput.focus();
}
