// library.js — Groups sidebar with smart filters, favorites, trash
import { bus, el, appConfirm } from './utils.js';
import { createGroup, updateGroup, deleteGroup, getGroups, getSheets, reorderGroups, getFilteredSheets, getFilterCounts, emptyTrash } from './db.js';

let activeGroupId = null;
let activeFilter = null;  // 'all', 'recent', 'favorites', 'trash'
let treeEl = null;
let pendingRenameId = null;

export function getActiveGroupId() {
  return activeGroupId;
}

export function getActiveFilter() {
  return activeFilter;
}

export function initLibrary() {
  treeEl = document.getElementById('library-tree');

  bus.on('group:select', (groupId) => {
    activeGroupId = groupId;
    activeFilter = null;
    document.querySelectorAll('.group-item, .filter-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === groupId);
    });
  });

  bus.on('filter:select', (filter) => {
    activeFilter = filter;
    activeGroupId = null;
    document.querySelectorAll('.group-item, .filter-item').forEach(el => {
      el.classList.toggle('active', el.dataset.filter === filter);
    });
  });

  // New group button
  document.getElementById('new-group-btn')?.addEventListener('click', async () => {
    const group = await createGroup('New Group');
    pendingRenameId = group.id;
    bus.emit('group:created', group);
  });

  // Context menu
  treeEl.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.group-item');
    if (!item) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, item.dataset.id);
  });

  // Drag and drop
  treeEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.group-item');
    if (!item) return;
    e.dataTransfer.setData('text/group-id', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  treeEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.group-item');
    if (item) item.classList.add('drop-target');
  });

  treeEl.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.group-item');
    if (item) item.classList.remove('drop-target');
  });

  treeEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    const fromId = e.dataTransfer.getData('text/group-id');
    const sheetId = e.dataTransfer.getData('text/sheet-id');
    const sheetIdsJson = e.dataTransfer.getData('text/sheet-ids');
    const toItem = e.target.closest('.group-item');
    if (!toItem) return;
    const toId = toItem.dataset.id;

    if (sheetIdsJson) {
      // Moving sheets to a group
      const { moveSheets } = await import('./db.js');
      const ids = JSON.parse(sheetIdsJson);
      await moveSheets(ids, toId);
      bus.emit('sheet:moved');
    } else if (sheetId) {
      const { moveSheet } = await import('./db.js');
      await moveSheet(sheetId, toId);
      bus.emit('sheet:moved');
    } else if (fromId && fromId !== toId) {
      const groups = await getGroups();
      const ids = groups.map(g => g.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);
      await reorderGroups(ids);
      bus.emit('group:updated');
    }
  });
}

export async function renderGroups(groups) {
  if (!treeEl) return;
  treeEl.innerHTML = '';

  // Fetch filter counts in one API call
  const counts = await getFilterCounts();

  // Smart filters section
  const filtersSection = el('div', { class: 'library-section' });
  const filters = [
    { id: 'all', name: 'All', icon: 'M4 6h16M4 12h16M4 18h16', count: counts.all },
    { id: 'recent', name: 'Last 7 Days', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', count: counts.recent },
    { id: 'favorites', name: 'Favorites', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', count: counts.favorites },
    { id: 'trash', name: 'Trash', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', count: counts.trash },
  ];

  for (const f of filters) {
    const item = el('div', {
      class: `filter-item${activeFilter === f.id ? ' active' : ''}`,
      dataset: { filter: f.id },
    }, [
      el('span', { class: 'group-icon', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${f.icon}"/></svg>` }),
      el('span', { class: 'group-name', text: f.name }),
      f.count > 0 ? el('span', { class: 'group-count', text: String(f.count) }) : null,
    ].filter(Boolean));

    item.addEventListener('click', () => {
      bus.emit('filter:select', f.id);
    });

    filtersSection.appendChild(item);
  }
  treeEl.appendChild(filtersSection);

  // Divider
  treeEl.appendChild(el('div', { class: 'library-divider' }));

  // Groups section — use sheetCount from API (no extra calls needed)
  const topLevel = groups.filter(g => !g.parentId);
  const children = groups.filter(g => g.parentId);

  for (const group of topLevel) {
    treeEl.appendChild(createGroupItem(group, group.sheetCount || 0, false));

    const kids = children.filter(c => c.parentId === group.id);
    for (const kid of kids) {
      treeEl.appendChild(createGroupItem(kid, kid.sheetCount || 0, true));
    }
  }

  // Auto-start rename for newly created groups
  if (pendingRenameId) {
    const id = pendingRenameId;
    pendingRenameId = null;
    startRename(id);
  }
}

function createGroupItem(group, count, isChild) {
  const item = el('div', {
    class: `group-item${isChild ? ' child' : ''}${group.id === activeGroupId ? ' active' : ''}`,
    dataset: { id: group.id },
    draggable: 'true',
  }, [
    el('span', { class: 'group-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' }),
    el('span', { class: 'group-name', text: group.name }),
    el('span', { class: 'group-count', text: String(count) }),
  ]);

  item.addEventListener('click', () => {
    document.getElementById('sheets-panel-title').textContent = group.name;
    bus.emit('group:select', group.id);
  });

  return item;
}

function startRename(groupId) {
  const item = treeEl.querySelector(`[data-id="${groupId}"]`);
  if (!item) return;
  const nameEl = item.querySelector('.group-name');
  const input = el('input', {
    class: 'group-name-input',
    type: 'text',
  });
  input.value = nameEl.textContent;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = async () => {
    const name = input.value.trim() || 'Untitled';
    await updateGroup(groupId, { name });
    bus.emit('group:updated');
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = nameEl.textContent; input.blur(); }
  });
}

function showContextMenu(x, y, groupId) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', text: 'New Sheet', onClick: async () => {
      const { createSheet } = await import('./db.js');
      const sheet = await createSheet(groupId);
      bus.emit('sheet:created', sheet);
      closeMenu();
    }}),
    el('div', { class: 'context-menu-item', text: 'New Sub-group', onClick: async () => {
      closeMenu();
      const group = await createGroup('New Sub-group', groupId);
      pendingRenameId = group.id;
      bus.emit('group:created', group);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item', text: 'Rename', onClick: () => {
      startRename(groupId);
      closeMenu();
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: 'Delete', onClick: async () => {
      closeMenu();
      if (await appConfirm('Delete this group and all its sheets?')) {
        await deleteGroup(groupId);
        bus.emit('group:deleted');
      }
    }}),
  ]);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 10);
}
