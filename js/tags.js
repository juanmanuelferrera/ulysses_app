// tags.js — Tag management
import { bus, el, appConfirm, showUndoToast } from './utils.js';
import { getTags, createTag, deleteTag, updateTag, getSheetTags, addTagToSheet, removeTagFromSheet } from './db.js';

const TAG_COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0c7', '#0071e3', '#5856d6', '#af52de', '#ff2d55',
  '#a2845e', '#636366',
];

let currentSheetId = null;

export function initTags() {
  renderTagsSidebar();

  document.getElementById('add-tag-btn')?.addEventListener('click', () => {
    showNewTagModal();
  });

  document.addEventListener('contextmenu', (e) => {
    const tagItem = e.target.closest('.tag-item');
    const tagPill = e.target.closest('.tag-pill');
    if (tagItem) {
      e.preventDefault();
      e.stopPropagation();
      const tagName = tagItem.querySelector('span').textContent;
      getTags().then(tags => {
        const tag = tags.find(t => t.name === tagName);
        if (tag) showTagContextMenu(e.clientX, e.clientY, tag);
      });
    } else if (tagPill) {
      e.preventDefault();
      e.stopPropagation();
      const tagName = tagPill.textContent;
      getTags().then(tags => {
        const tag = tags.find(t => t.name === tagName);
        if (tag && currentSheetId) showSheetTagContextMenu(e.clientX, e.clientY, tag, currentSheetId);
      });
    }
  });

  bus.on('sheet:loaded', (sheet) => {
    currentSheetId = sheet.id;
    renderSheetTags(sheet.id);
  });

  bus.on('sheet:none', () => {
    currentSheetId = null;
  });
}

async function renderTagsSidebar() {
  const tags = await getTags();
  const listEl = document.getElementById('tags-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const tag of tags) {
    const item = el('div', {
      class: 'tag-item',
      style: `background: ${tag.color}`,
    }, [
      el('span', { text: tag.name }),
    ]);

    item.addEventListener('click', () => {
      if (currentSheetId) {
        toggleTagOnSheet(currentSheetId, tag);
      }
    });

    listEl.appendChild(item);
  }
}

async function toggleTagOnSheet(sheetId, tag) {
  const sheetTags = await getSheetTags(sheetId);
  const hasTag = sheetTags.some(t => t.id === tag.id);

  if (hasTag) {
    await removeTagFromSheet(sheetId, tag.id);
  } else {
    await addTagToSheet(sheetId, tag.id);
  }
  renderSheetTags(sheetId);
  bus.emit('sheet:tags-changed', sheetId);
}

async function renderSheetTags(sheetId) {
  const statusEl = document.getElementById('status-group');
  if (statusEl) statusEl.innerHTML = '';
}

function showTagContextMenu(x, y, tag) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', text: 'Rename', onClick: () => {
      closeMenu();
      showRenameTagModal(tag);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: 'Delete', onClick: async () => {
      closeMenu();
      await deleteTag(tag.id);
      renderTagsSidebar();
      if (currentSheetId) bus.emit('sheet:tags-changed', currentSheetId);
      const undone = await showUndoToast(`Tag "${tag.name}" deleted`);
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

function showSheetTagContextMenu(x, y, tag, sheetId) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item danger', text: 'Remove from sheet', onClick: async () => {
      closeMenu();
      await removeTagFromSheet(sheetId, tag.id);
      bus.emit('sheet:tags-changed', sheetId);
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

  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: 'Rename Tag' }),
    el('div', { class: 'input-group' }, [
      el('label', { class: 'input-label', text: 'Name' }),
      nameInput,
    ]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
      el('button', { class: 'btn btn-primary', text: 'Rename', onClick: async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        await updateTag(tag.id, { name });
        renderTagsSidebar();
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

  const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'Tag name' });

  const colorPicker = el('div', { style: 'display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px;' },
    TAG_COLORS.map(color => {
      const swatch = el('div', {
        style: `width: 24px; height: 24px; border-radius: 50%; background: ${color}; cursor: pointer; border: 2px solid transparent;`,
        onClick: () => {
          selectedColor = color;
          colorPicker.querySelectorAll('div').forEach(d => d.style.borderColor = 'transparent');
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
    el('h3', { text: 'New Tag' }),
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
