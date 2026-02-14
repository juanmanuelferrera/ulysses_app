// library.js — Groups sidebar with smart filters, favorites, trash
import { bus, el, appConfirm } from './utils.js';
import { createGroup, updateGroup, deleteGroup, getGroups, getSheets, reorderGroups, getFilteredSheets, getFilterCounts, emptyTrash } from './db.js';
import { renderIcon, showIconPicker, ICON_COLORS } from './icons.js';
import { logout } from './auth.js';

let activeGroupId = null;
let activeFilter = null;  // 'all', 'recent', 'favorites', 'trash'
let treeEl = null;
let pendingRenameId = null;
let allGroups = [];

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

  // Logout button in header
  document.getElementById('header-logout-btn')?.addEventListener('click', () => {
    logout();
  });

  // New group button
  document.getElementById('new-group-btn')?.addEventListener('click', async () => {
    const group = await createGroup('New Group', null, 'notes');
    pendingRenameId = group.id;
    bus.emit('group:created', group);
  });

  // Context menu
  treeEl.addEventListener('contextmenu', (e) => {
    const groupItem = e.target.closest('.group-item');
    const filterItem = e.target.closest('.filter-item');
    
    if (groupItem) {
      e.preventDefault();
      const isChild = groupItem.classList.contains('child');
      showContextMenu(e.clientX, e.clientY, groupItem.dataset.id, isChild);
    } else if (filterItem) {
      e.preventDefault();
      const filterId = filterItem.dataset.filter;
      showFilterContextMenu(e.clientX, e.clientY, filterId);
    }
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

    if (toItem) {
      const toId = toItem.dataset.id;
      if (sheetIdsJson) {
        const { moveSheets } = await import('./db.js');
        const ids = JSON.parse(sheetIdsJson);
        await moveSheets(ids, toId);
        bus.emit('sheet:moved');
      } else if (sheetId) {
        const { moveSheet } = await import('./db.js');
        await moveSheet(sheetId, toId);
        bus.emit('sheet:moved');
      } else if (fromId && fromId !== toId) {
        // Nest: set the dragged group as a child of the target group
        await updateGroup(fromId, { parentId: toId });
        bus.emit('group:updated');
      }
    } else if (fromId) {
      // Dropped on empty space — move to top level
      await updateGroup(fromId, { parentId: null });
      bus.emit('group:updated');
    }
  });
}

export async function renderGroups(groups) {
  if (!treeEl) return;
  treeEl.innerHTML = '';
  allGroups = groups;

  // Fetch filter counts
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

  // --- Sections ---
  const sections = ['projects', 'notes'];
  const sectionLabels = { projects: 'Projects', notes: 'Notes' };

  for (const sec of sections) {
    const topLevel = groups.filter(g => g.parentId == null && (g.section === sec || (!g.section && sec === 'notes')));
    
    // Section header
    const chevronSvg = '<svg class="section-chevron open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    const header = el('div', { class: 'section-header', dataset: { section: sec } }, [
      el('span', { html: chevronSvg }),
      el('span', { text: sectionLabels[sec] }),
      el('button', { class: 'section-add', text: '+', title: 'New Group', onClick: async (e) => {
        e.stopPropagation();
        const group = await createGroup('New Group', null, sec);
        pendingRenameId = group.id;
        bus.emit('group:created', group);
      }}),
    ]);

    const sectionContainer = el('div', { class: 'section-container', dataset: { section: sec } });
    
    header.addEventListener('click', () => {
      const chevron = header.querySelector('.section-chevron');
      const isOpen = chevron.classList.toggle('open');
      sectionContainer.style.display = isOpen ? '' : 'none';
    });

    treeEl.appendChild(header);

    // Render groups recursively
    for (const group of topLevel) {
      renderGroupRecursive(group, groups, sectionContainer, 0);
    }

    treeEl.appendChild(sectionContainer);
  }

  // Mobile logout link
  const existingLogout = document.querySelector('.mobile-logout');
  if (existingLogout) existingLogout.remove();
  const mobileLogout = el('div', { class: 'mobile-logout' }, [
    el('button', { text: 'Sign Out', onClick: () => { logout(); }}),
  ]);
  treeEl.appendChild(mobileLogout);

  // Auto-start rename
  if (pendingRenameId) {
    const id = pendingRenameId;
    pendingRenameId = null;
    startRename(id);
  }


}

function getRecursiveSheetCount(group, allGroups) {
  let count = group.sheetCount || 0;
  const kids = allGroups.filter(g => g.parentId === group.id);
  for (const kid of kids) {
    count += getRecursiveSheetCount(kid, allGroups);
  }
  return count;
}

function renderGroupRecursive(group, allGroups, container, depth) {
  const kids = allGroups.filter(g => g.parentId === group.id);
  const hasKids = kids.length > 0;
  const totalSheets = getRecursiveSheetCount(group, allGroups);

  container.appendChild(createGroupItem(group, totalSheets, depth, hasKids));

  if (hasKids) {
    const childContainer = el('div', {
      class: 'group-children',
      dataset: { parent: group.id },
    });
    if (group.collapsed) childContainer.style.display = 'none';
    for (const kid of kids) {
      renderGroupRecursive(kid, allGroups, childContainer, depth + 1);
    }
    container.appendChild(childContainer);
  }
}

function createGroupItem(group, count, depth, hasKids) {
  // Build icon element
  let iconEl;
  if (group.icon) {
    const colorHex = group.iconColor
      ? (ICON_COLORS.find(c => c.id === group.iconColor)?.hex || 'currentColor')
      : 'currentColor';
    const svg = renderIcon(group.icon, colorHex, 16);
    iconEl = el('span', { class: 'group-icon group-icon-custom' });
    if (svg) iconEl.appendChild(svg);
  } else {
    iconEl = el('span', { class: 'group-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' });
  }

  const children = [];

  // Chevron or spacer
  {
    if (hasKids) {
      const chevron = el('span', {
        class: `group-chevron${group.collapsed ? '' : ' open'}`,
        html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
        onClick: async (e) => {
          e.stopPropagation();
          const collapsed = !group.collapsed;
          group.collapsed = collapsed;
          chevron.classList.toggle('open', !collapsed);
          const container = treeEl.querySelector(`[data-parent="${group.id}"]`);
          if (container) container.style.display = collapsed ? 'none' : '';
          await updateGroup(group.id, { collapsed: collapsed ? 1 : 0 });
        },
      });
      children.push(chevron);
    } else {
      children.push(el('span', { class: 'group-chevron-spacer' }));
    }
  }

  children.push(iconEl);
  children.push(el('span', { class: 'group-name', text: group.name }));
  children.push(el('span', { class: 'group-count', text: String(count) }));

  const item = el('div', {
    class: `group-item depth-${depth}${group.id === activeGroupId ? ' active' : ''}`,
    dataset: { id: group.id },
    draggable: 'true',
  }, children);

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

function showContextMenu(x, y, groupId, isChild = false) {
  document.querySelector('.context-menu')?.remove();

  const ctxGroup = allGroups.find(g => g.id === groupId);
  const ctxIsProject = ctxGroup && ctxGroup.section === 'projects' && !ctxGroup.parentId;

  const items = [];
  if (!ctxIsProject) {
    items.push(el('div', { class: 'context-menu-item', text: 'New Sheet', onClick: async () => {
      const { createSheet } = await import('./db.js');
      const sheet = await createSheet(groupId);
      bus.emit('sheet:created', sheet);
      closeMenu();
    }}));
  }
  items.push(el('div', { class: 'context-menu-item', text: 'New Group\u2026', onClick: async () => {
      closeMenu();
      const group = await createGroup('New Group', groupId);
      console.log('[library] Created group:', JSON.stringify(group));
      pendingRenameId = group.id;
      bus.emit('group:created', group);
    }}));

  items.push(el('div', { class: 'context-menu-divider' }));
  items.push(el('div', { class: 'context-menu-item', text: 'Change Icon...', onClick: async () => {
    closeMenu();
    const item = treeEl.querySelector(`[data-id="${groupId}"]`);
    const rect = item?.getBoundingClientRect();
    const result = await showIconPicker(
      rect ? rect.right + 4 : x, rect ? rect.top : y,
      item?.dataset.icon, item?.dataset.iconColor
    );
    if (result) {
      await updateGroup(groupId, { icon: result.icon, iconColor: result.color });
      bus.emit('group:updated');
    }
  }}));
  items.push(el('div', { class: 'context-menu-item', text: 'Rename', onClick: () => {
    startRename(groupId);
    closeMenu();
  }}));
  // Move between sections (top-level groups only)
  const thisGroup = allGroups.find(g => g.id === groupId);
  if (thisGroup && !thisGroup.parentId) {
    const curSec = thisGroup.section || 'notes';
    const targetSec = curSec === 'projects' ? 'notes' : 'projects';
    const label = targetSec === 'projects' ? 'Move to Projects' : 'Move to Notes';
    items.push(el('div', { class: 'context-menu-item', text: label, onClick: async () => {
      closeMenu();
      await updateGroup(groupId, { section: targetSec });
      bus.emit('group:updated');
    }}));
  }

  items.push(el('div', { class: 'context-menu-divider' }));
  items.push(el('div', { class: 'context-menu-item danger', text: 'Move to Trash', onClick: async () => {
    closeMenu();
    if (await appConfirm('Move this group and all its sheets to Trash?')) {
      await deleteGroup(groupId);
      bus.emit('group:deleted');
    }
  }}));

  const menu = el('div', { class: 'context-menu fade-in' }, items);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 10);
}

// --- Filter context menu ---
function showFilterContextMenu(x, y, filterId) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' });
  const closeMenu = () => menu.remove();

  // Only show menu for Trash filter
  if (filterId === 'trash') {
    menu.appendChild(el('div', { class: 'context-menu-item danger', text: 'Delete All Files in Trash', onClick: async () => {
      closeMenu();
      if (await appConfirm('Permanently delete all items in Trash?')) {
        await emptyTrash();
        bus.emit('group:updated');
      }
    }}));
  } else {
    // Don't show menu for other filters
    return;
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 10);
}
