// sheets.js — Sheet list panel with multi-select, favorites, trash, sorting
import { bus, el, formatDate, wordCount, truncate, appConfirm, showUndoToast } from './utils.js';
import { createSheet, trashSheet, trashSheets, restoreSheet, deleteSheet, getSheets, getFilteredSheets,
         reorderSheets, moveSheet, moveSheets, toggleFavorite, emptyTrash, mergeSheets, undoMerge, getSheetTags, getTags } from './db.js';
import { getActiveGroupId, getActiveFilter, adjustGroupCount, getSidebarGroupOrder } from './library.js';

let listEl = null;
let activeSheetId = null;
let selectedIds = new Set();
let lastClickedId = null;
let allSheetIds = [];
let currentSortBy = 'manual';
let activeTagFilters = new Set();
let tagFilterMode = 'or';
let tagFilterVisible = false;
let currentSheets = [];

// --- Local sheets cache (keyed by groupId or filter) ---
const sheetsCache = {};
const cacheTimes = {};

function cacheKey(groupId, filter) {
  return filter ? `filter:${filter}` : `group:${groupId}`;
}

function getCached(groupId, filter) {
  const key = cacheKey(groupId, filter);
  return sheetsCache[key] || null;
}

function getCacheAge(groupId, filter) {
  const key = cacheKey(groupId, filter);
  return cacheTimes[key] ? Date.now() - cacheTimes[key] : Infinity;
}

export function setCache(groupId, filter, sheets) {
  const key = cacheKey(groupId, filter);
  sheetsCache[key] = sheets;
  cacheTimes[key] = Date.now();
}

function invalidateCache(groupId) {
  // Clear specific group or all caches
  if (groupId) {
    delete sheetsCache[`group:${groupId}`];
  } else {
    // Clear all filter caches (they may reference any group's sheets)
    for (const key of Object.keys(sheetsCache)) {
      if (key.startsWith('filter:')) delete sheetsCache[key];
    }
  }
}

export function setActiveSheet(id) {
  activeSheetId = id;
  updateSelectionUI();
}

// Return sheet data from in-memory list (avoids API call)
export function getLocalSheet(id) {
  return currentSheets.find(s => s.id === id) || null;
}

export function selectNextSheet() {
  if (allSheetIds.length === 0) return;
  const idx = allSheetIds.indexOf(activeSheetId);
  const next = idx < allSheetIds.length - 1 ? idx + 1 : 0;
  bus.emit('sheet:select', allSheetIds[next]);
}

export function selectPrevSheet() {
  if (allSheetIds.length === 0) return;
  const idx = allSheetIds.indexOf(activeSheetId);
  const prev = idx > 0 ? idx - 1 : allSheetIds.length - 1;
  bus.emit('sheet:select', allSheetIds[prev]);
}

function updateSelectionUI() {
  document.querySelectorAll('.sheet-card').forEach(card => {
    const id = card.dataset.id;
    const isSelected = selectedIds.has(id);
    const isActive = id === activeSheetId && selectedIds.size <= 1;
    card.classList.toggle('active', isActive);
    card.classList.toggle('selected', isSelected && selectedIds.size > 1);
  });
  const badge = document.getElementById('selection-badge');
  if (badge) {
    if (selectedIds.size > 1) {
      badge.textContent = `${selectedIds.size} selected`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

function clearSelection() {
  selectedIds.clear();
  updateSelectionUI();
}

function selectRange(fromId, toId) {
  const fromIdx = allSheetIds.indexOf(fromId);
  const toIdx = allSheetIds.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return;
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  for (let i = start; i <= end; i++) {
    selectedIds.add(allSheetIds[i]);
  }
}

export function initSheetList() {
  listEl = document.getElementById('sheet-list');

  // Selection badge
  const header = document.querySelector('#sheets-panel .panel-header');
  if (header) {
    const badge = el('span', {
      id: 'selection-badge',
      style: 'display: none; font-size: 11px; color: var(--accent); font-weight: 600; margin-left: 6px;',
    });
    header.querySelector('h2')?.after(badge);
  }

  // New sheet button
  document.getElementById('new-sheet-btn')?.addEventListener('click', async () => {
    const groupId = getActiveGroupId();
    if (!groupId) return;
    const sheet = await createSheet(groupId, '', '# ');
    bus.emit('sheet:created', sheet);
  });

  // Sort button
  document.getElementById('sort-sheets-btn')?.addEventListener('click', (e) => {
    showSortMenu(e.clientX, e.clientY);
  });

  // Filter input
  document.getElementById('sheet-filter')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.sheet-card').forEach(card => {
      const title = card.querySelector('.sheet-card-title')?.textContent.toLowerCase() || '';
      const preview = card.querySelector('.sheet-card-preview')?.textContent.toLowerCase() || '';
      card.style.display = (title.includes(q) || preview.includes(q)) ? '' : 'none';
    });
  });

  // Tag filter toggle
  const tagToggle = document.getElementById('tag-filter-toggle');
  const tagBar = document.getElementById('tag-filter-bar');
  tagToggle?.addEventListener('click', () => {
    tagFilterVisible = !tagFilterVisible;
    tagToggle.classList.toggle('active', tagFilterVisible);
    tagBar.style.display = tagFilterVisible ? '' : 'none';
    if (tagFilterVisible) {
      renderTagFilterBar();
    } else {
      activeTagFilters.clear();
      applyTagFilter();
    }
  });

  // Drag and drop
  listEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.sheet-card');
    if (!card) return;
    card.classList.add('dragging');
    if (selectedIds.size > 1 && selectedIds.has(card.dataset.id)) {
      e.dataTransfer.setData('text/sheet-ids', JSON.stringify([...selectedIds]));
    } else {
      e.dataTransfer.setData('text/sheet-ids', JSON.stringify([card.dataset.id]));
    }
    e.dataTransfer.setData('text/sheet-id', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  listEl.addEventListener('dragend', () => {
    document.querySelectorAll('.sheet-card').forEach(el => {
      el.classList.remove('dragging', 'drop-above', 'drop-below');
    });
  });

  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const card = e.target.closest('.sheet-card');
    if (!card || card.classList.contains('dragging')) return;
    const rect = card.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    card.classList.remove('drop-above', 'drop-below');
    card.classList.add(e.clientY < mid ? 'drop-above' : 'drop-below');
  });

  listEl.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.sheet-card');
    if (card) card.classList.remove('drop-above', 'drop-below');
  });

  listEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/sheet-id');
    const toCard = e.target.closest('.sheet-card');
    if (!toCard || !fromId) return;

    const cards = [...listEl.querySelectorAll('.sheet-card')];
    const ids = cards.map(c => c.dataset.id);
    const fromIdx = ids.indexOf(fromId);
    let toIdx = ids.indexOf(toCard.dataset.id);

    if (fromIdx === toIdx) return;
    ids.splice(fromIdx, 1);
    if (toCard.classList.contains('drop-below')) toIdx = Math.min(toIdx + 1, ids.length);
    ids.splice(toIdx, 0, fromId);

    await reorderSheets(ids);
    await refreshList();

    document.querySelectorAll('.sheet-card').forEach(el => {
      el.classList.remove('dragging', 'drop-above', 'drop-below');
    });
  });

  // Context menu
  listEl.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.sheet-card');
    if (!card) return;
    e.preventDefault();
    const cardId = card.dataset.id;

    if (!selectedIds.has(cardId)) {
      selectedIds.clear();
      selectedIds.add(cardId);
      activeSheetId = cardId;
      updateSelectionUI();
    }

    const filter = getActiveFilter();
    if (filter === 'trash') {
      showTrashContextMenu(e.clientX, e.clientY);
    } else if (selectedIds.size > 1) {
      showMultiContextMenu(e.clientX, e.clientY);
    } else {
      showSheetContextMenu(e.clientX, e.clientY, cardId);
    }
  });

  // Deselect on empty area click
  listEl.addEventListener('click', (e) => {
    if (!e.target.closest('.sheet-card')) clearSelection();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIds.size > 1) {
      if (listEl.matches(':hover')) {
        e.preventDefault();
        trashSelected();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a' && listEl.matches(':hover')) {
      e.preventDefault();
      allSheetIds.forEach(id => selectedIds.add(id));
      updateSelectionUI();
    }
  });

  // Invalidate cache on mutations
  bus.on('sheet:created', () => invalidateCache());
  bus.on('sheet:deleted', () => invalidateCache());
  bus.on('sheet:moved', () => invalidateCache());
  bus.on('group:updated', () => invalidateCache());

  // Events
  bus.on('sheet:updated', ({ id, title }) => {
    const card = listEl.querySelector(`[data-id="${id}"]`);
    if (card) {
      const titleEl = card.querySelector('.sheet-card-title');
      if (titleEl) titleEl.textContent = title;
    }
  });

  bus.on('sheet:attachments-changed', async (sheetId) => {
    const card = listEl.querySelector(`[data-id="${sheetId}"]`);
    if (!card) return;
    const { getSheet } = await import('./db.js');
    const sheet = await getSheet(sheetId);
    if (!sheet) return;
    const hasNotes = sheet.notes && sheet.notes.trim().length > 0;
    const hasAttachments = sheet.images && sheet.images !== '[]';
    const oldIndicator = card.querySelector('.sheet-card-indicator');
    if (hasNotes || hasAttachments) {
      if (!oldIndicator) {
        const header = card.querySelector('.sheet-card-header');
        header.appendChild(el('span', {
          class: 'sheet-card-indicator',
          title: hasNotes && hasAttachments ? 'Notes & Attachments' : hasNotes ? 'Has Notes' : 'Has Attachments',
          html: '&#128206;',
        }));
      } else {
        oldIndicator.title = hasNotes && hasAttachments ? 'Notes & Attachments' : hasNotes ? 'Has Notes' : 'Has Attachments';
      }
    } else if (oldIndicator) {
      oldIndicator.remove();
    }
  });

  bus.on('sheet:tags-changed', async (sheetId) => {
    const card = listEl.querySelector(`[data-id="${sheetId}"]`);
    if (card) {
      const oldTags = card.querySelector('.sheet-card-tags');
      if (oldTags) oldTags.remove();
      const tags = await getSheetTags(sheetId);
      if (tags.length > 0) {
        card.appendChild(el('div', { class: 'sheet-card-tags' },
          tags.map(t => el('span', {
            class: 'tag-pill',
            text: t.name,
            style: `background: ${t.color}`,
          }))
        ));
      }
    }
    if (tagFilterVisible) renderTagFilterBar();
  });

  bus.on('sheet:none', () => {
    listEl.innerHTML = '';
    selectedIds.clear();
    allSheetIds = [];
    const empty = el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-state-title', text: 'No Sheets' }),
      el('div', { class: 'empty-state-text', text: 'Create a new sheet to start writing' }),
    ]);
    listEl.appendChild(empty);
  });

  // Reset sort when selecting a group
  bus.on('group:select', async (groupId) => {
    if (currentSortBy === 'group') {
      currentSortBy = 'manual';
    }
    activeTagFilters.clear();
    if (tagFilterVisible) renderTagFilterBar();
    const newBtn = document.getElementById('new-sheet-btn');
    if (newBtn) newBtn.style.display = '';

    // Instant render from cache if available
    const cached = getCached(groupId, null);
    if (cached) {
      renderSheets(cached);
      if (currentSheets.length > 0) {
        bus.emit('sheet:select', currentSheets[0].id);
      } else {
        bus.emit('sheet:none');
      }
      // Skip background refresh if cache is fresh (< 30s, e.g. just bootstrapped)
      if (getCacheAge(groupId, null) > 30000) {
        getSheets(groupId, currentSortBy).then(sheets => {
          setCache(groupId, null, sheets);
          const cachedIds = cached.map(s => `${s.id}:${s.updatedAt}`).join(',');
          const freshIds = sheets.map(s => `${s.id}:${s.updatedAt}`).join(',');
          if (cachedIds !== freshIds) {
            renderSheets(sheets);
          }
        });
      }
      return;
    }

    // No cache — fetch and render
    const sheets = await getSheets(groupId, currentSortBy);
    setCache(groupId, null, sheets);
    renderSheets(sheets);
    if (currentSheets.length > 0) {
      bus.emit('sheet:select', currentSheets[0].id);
    } else {
      bus.emit('sheet:none');
    }
  });

  // Listen for filter changes
  bus.on('filter:select', async (filter) => {
    // Default to date sort for filter views
    if (currentSortBy === 'manual') currentSortBy = 'date';
    activeTagFilters.clear();
    if (tagFilterVisible) renderTagFilterBar();
    document.getElementById('sheets-panel-title').textContent =
      filter === 'all' ? 'All' :
      filter === 'recent' ? 'Last 7 Days' :
      filter === 'favorites' ? 'Favorites' :
      filter === 'trash' ? 'Trash' : '';
    const newBtn = document.getElementById('new-sheet-btn');
    if (newBtn) newBtn.style.display = filter === 'trash' ? 'none' : '';

    // Instant render from cache
    const cached = getCached(null, filter);
    if (cached) {
      renderSheets(cached);
      if (currentSheets.length > 0) {
        bus.emit('sheet:select', currentSheets[0].id);
      } else {
        bus.emit('sheet:none');
      }
      // Refresh in background
      getFilteredSheets(filter).then(sheets => {
        setCache(null, filter, sheets);
        const cachedIds = cached.map(s => `${s.id}:${s.updatedAt}`).join(',');
        const freshIds = sheets.map(s => `${s.id}:${s.updatedAt}`).join(',');
        if (cachedIds !== freshIds) {
          renderSheets(sheets);
        }
      });
      return;
    }

    // No cache — fetch and render
    const sheets = await getFilteredSheets(filter);
    setCache(null, filter, sheets);
    renderSheets(sheets);
    if (sheets.length > 0) {
      bus.emit('sheet:select', sheets[0].id);
    } else {
      bus.emit('sheet:none');
    }
  });

  // Tag reveal: show all sheets with a specific tag
  bus.on('tag:reveal', async (tag) => {
    if (currentSortBy === 'manual') currentSortBy = 'date';
    activeTagFilters.clear();
    document.getElementById('sheets-panel-title').textContent = tag.name;
    const newBtn = document.getElementById('new-sheet-btn');
    if (newBtn) newBtn.style.display = 'none';
    // Highlight the active keyword in the sidebar
    document.querySelectorAll('.group-item, .filter-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tag-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tagId === tag.id);
    });
    const sheets = await getFilteredSheets('tag:' + tag.id);
    renderSheets(sheets);
    if (sheets.length > 0) {
      bus.emit('sheet:select', sheets[0].id);
    } else {
      bus.emit('sheet:none');
    }
  });
}

async function refreshList() {
  const groupId = getActiveGroupId();
  const filter = getActiveFilter();
  let sheets;
  if (filter) {
    sheets = await getFilteredSheets(filter);
  } else if (groupId) {
    sheets = await getSheets(groupId, currentSortBy);
  } else {
    return;
  }
  renderSheets(sheets);
}

function dateBuckets(sheets, field) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 6 * 86400000);
  const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

  const bucketMap = new Map([
    ['Today', []],
    ['Yesterday', []],
    ['This Week', []],
    ['This Month', []],
    ['Older', []],
  ]);

  for (const sheet of sheets) {
    const d = new Date(sheet[field]);
    if (d >= today) bucketMap.get('Today').push(sheet);
    else if (d >= yesterday) bucketMap.get('Yesterday').push(sheet);
    else if (d >= weekAgo) bucketMap.get('This Week').push(sheet);
    else if (d >= monthAgo) bucketMap.get('This Month').push(sheet);
    else bucketMap.get('Older').push(sheet);
  }

  // Only return non-empty buckets
  return [...bucketMap.entries()]
    .filter(([, s]) => s.length > 0)
    .map(([label, s]) => ({ label, sheets: s }));
}

export function renderSheets(sheets) {
  if (!listEl) return;
  currentSheets = sheets;

  let filtered = sheets;
  if (activeTagFilters.size > 0) {
    filtered = sheets.filter(sheet => {
      const ids = (sheet.tags || []).map(t => t.id);
      return tagFilterMode === 'and'
        ? [...activeTagFilters].every(id => ids.includes(id))
        : [...activeTagFilters].some(id => ids.includes(id));
    });
  }

  listEl.innerHTML = '';

  if (filtered.length === 0) {
    if (activeTagFilters.size > 0) {
      listEl.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state-title', text: 'No Matching Sheets' }),
        el('div', { class: 'empty-state-text', text: 'No sheets match the selected tags' }),
      ]));
    } else {
      bus.emit('sheet:none');
    }
    return;
  }

  const isFilterView = !!getActiveFilter();
  const isAllView = getActiveFilter() === 'all';
  const groupByProject = isFilterView && (currentSortBy === 'group' || isAllView);
  const groupByDate = !isAllView && isFilterView && (currentSortBy === 'date' || currentSortBy === 'created');

  // Sort client-side for filter views
  if (isFilterView && currentSortBy === 'title') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (isFilterView && currentSortBy === 'created') {
    filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  allSheetIds = filtered.map(s => s.id);

  if (groupByProject) {
    // Group sheets by groupId
    const groups = new Map();
    for (const sheet of filtered) {
      const key = sheet.groupId;
      if (!groups.has(key)) {
        groups.set(key, { name: sheet.groupName || 'Untitled', sheets: [] });
      }
      groups.get(key).sheets.push(sheet);
    }

    // Sort groups to match sidebar order
    const sidebarOrder = getSidebarGroupOrder();
    const sortedGroupIds = [...groups.keys()].sort((a, b) => {
      const ai = sidebarOrder.indexOf(a);
      const bi = sidebarOrder.indexOf(b);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });

    for (const gid of sortedGroupIds) {
      const group = groups.get(gid);
      const separator = el('div', { class: 'sheet-group-separator' }, [
        el('span', { class: 'sheet-group-separator-name', text: group.name }),
        el('span', { class: 'sheet-group-separator-count', text: String(group.sheets.length) }),
      ]);
      listEl.appendChild(separator);

      for (const sheet of group.sheets) {
        listEl.appendChild(createSheetCard(sheet, false));
      }
    }
  } else if (groupByDate) {
    // Group sheets by date buckets
    const dateField = currentSortBy === 'created' ? 'createdAt' : 'updatedAt';
    const buckets = dateBuckets(filtered, dateField);

    for (const bucket of buckets) {
      const separator = el('div', { class: 'sheet-group-separator' }, [
        el('span', { class: 'sheet-group-separator-name', text: bucket.label }),
        el('span', { class: 'sheet-group-separator-count', text: String(bucket.sheets.length) }),
      ]);
      listEl.appendChild(separator);

      for (const sheet of bucket.sheets) {
        listEl.appendChild(createSheetCard(sheet, isFilterView));
      }
    }
  } else {
    // Check if sheets come from multiple groups (parent + subgroups)
    const uniqueGroups = new Set(filtered.map(s => s.groupId));
    if (!isFilterView && uniqueGroups.size > 1) {
      // Group by subgroup with separators
      const groups = new Map();
      for (const sheet of filtered) {
        const key = sheet.groupId;
        if (!groups.has(key)) {
          groups.set(key, { name: sheet.groupName || 'Untitled', sheets: [] });
        }
        groups.get(key).sheets.push(sheet);
      }
      for (const [, group] of groups) {
        const separator = el('div', { class: 'sheet-group-separator' }, [
          el('span', { class: 'sheet-group-separator-name', text: group.name }),
          el('span', { class: 'sheet-group-separator-count', text: String(group.sheets.length) }),
        ]);
        listEl.appendChild(separator);
        for (const sheet of group.sheets) {
          listEl.appendChild(createSheetCard(sheet, false));
        }
      }
    } else {
      for (const sheet of filtered) {
        listEl.appendChild(createSheetCard(sheet, isFilterView));
      }
    }
  }

  updateSelectionUI();
}

function createSheetCard(sheet, showGroupName) {
  const tags = sheet.tags || [];
  const hasNotes = sheet.notes && sheet.notes.trim().length > 0;
  const hasAttachments = sheet.images && sheet.images !== '[]' && sheet.images !== '[]';
  
  const card = el('div', {
    class: 'sheet-card',
    dataset: { id: sheet.id },
    draggable: 'true',
  }, [
    el('div', { class: 'sheet-card-header' }, [
      el('div', { class: 'sheet-card-title', text: sheet.title || 'Untitled' }),
      sheet.favorite ? el('span', { class: 'sheet-card-fav', html: '&#9733;' }) : null,
      hasNotes || hasAttachments ? el('span', { class: 'sheet-card-indicator', title: hasNotes && hasAttachments ? 'Notes & Attachments' : hasNotes ? 'Has Notes' : 'Has Attachments', html: '&#128206;' }) : null,
    ].filter(Boolean)),
    el('div', { class: 'sheet-card-preview', text: truncate(sheet.content) }),
    el('div', { class: 'sheet-card-meta' }, [
      showGroupName && sheet.groupName
        ? el('span', { class: 'sheet-card-group', text: sheet.groupName })
        : null,
      el('span', { text: formatDate(sheet.updatedAt) }),
      el('span', { text: `${wordCount(sheet.content)} words` }),
    ].filter(Boolean)),
    tags.length > 0 ? el('div', { class: 'sheet-card-tags' },
      tags.map(t => el('span', {
        class: 'tag-pill',
        text: t.name,
        style: `background: ${t.color}`,
      }))
    ) : null,
  ].filter(Boolean));

  card.addEventListener('click', (e) => {
    const id = sheet.id;
    if (e.metaKey || e.ctrlKey) {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      lastClickedId = id;
    } else if (e.shiftKey && lastClickedId) {
      selectRange(lastClickedId, id);
    } else {
      selectedIds.clear();
      selectedIds.add(id);
      lastClickedId = id;
      bus.emit('sheet:select', id);
    }
    updateSelectionUI();
  });

  return card;
}

// --- Sort menu ---
function showSortMenu(x, y) {
  document.querySelector('.context-menu')?.remove();
  const isFilterView = !!getActiveFilter();
  const options = isFilterView
    ? [
        { label: 'Date Modified', value: 'date' },
        { label: 'Date Created', value: 'created' },
        { label: 'Title', value: 'title' },
        { label: 'By Group', value: 'group' },
      ]
    : [
        { label: 'Manual', value: 'manual' },
        { label: 'Date Modified', value: 'date' },
        { label: 'Date Created', value: 'created' },
        { label: 'Title', value: 'title' },
      ];
  const menu = el('div', { class: 'context-menu fade-in' },
    options.map(o => el('div', {
      class: `context-menu-item${currentSortBy === o.value ? ' active-sort' : ''}`,
      text: (currentSortBy === o.value ? '• ' : '  ') + o.label,
      onClick: async () => {
        currentSortBy = o.value;
        await refreshList();
        menu.remove();
      },
    }))
  );
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

// --- Single-sheet context menu ---
function showSheetContextMenu(x, y, sheetId) {
  document.querySelector('.context-menu')?.remove();

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', text: 'Open in New Window', onClick: () => {
      closeMenu();
      const url = `${window.location.origin}${window.location.pathname}?sheet=${sheetId}`;
      window.open(url, '_blank', 'width=1200,height=800');
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item', text: 'Favorite', onClick: async () => {
      await toggleFavorite(sheetId);
      await refreshList();
      closeMenu();
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item', text: 'Duplicate', onClick: async () => {
      const { getSheet } = await import('./db.js');
      const original = await getSheet(sheetId);
      if (original) {
        const copy = await createSheet(original.groupId, original.title + ' (copy)', original.content);
        bus.emit('sheet:created', copy);
      }
      closeMenu();
    }}),
    el('div', { class: 'context-menu-item', text: 'Move to...', onClick: () => {
      closeMenu();
      showMoveModal([sheetId]);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: 'Move to Trash', onClick: async () => {
      closeMenu();
      const groupId = getActiveGroupId();
      if (groupId) adjustGroupCount(groupId, -1);
      await trashSheet(sheetId);
      if (activeSheetId === sheetId) {
        bus.emit('sheet:deleted', sheetId);
      }
      await refreshList();
      bus.emit('group:updated');
      const undone = await showUndoToast('Sheet moved to trash');
      if (undone) {
        if (groupId) adjustGroupCount(groupId, +1);
        await restoreSheet(sheetId);
        await refreshList();
        bus.emit('group:updated');
        bus.emit('sheet:select', sheetId);
      }
    }}),
  ]);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);
}

// --- Multi-sheet context menu ---
function showMultiContextMenu(x, y) {
  document.querySelector('.context-menu')?.remove();
  const count = selectedIds.size;
  const ids = [...selectedIds];

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', style: 'color: var(--text-tertiary); pointer-events: none;', text: `${count} sheets selected` }),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item', text: `Merge ${count} sheets`, onClick: async () => {
      closeMenu();
      const groupId = getActiveGroupId();
      if (groupId) {
        const { merged, originals } = await mergeSheets(ids, groupId);
        selectedIds.clear();
        bus.emit('sheet:created', merged);
        const undone = await showUndoToast(`${count} sheets merged`);
        if (undone) {
          await undoMerge(merged.id, originals.map(s => s.id));
          bus.emit('sheet:deleted', merged.id);
          await refreshList();
          if (originals.length > 0) bus.emit('sheet:select', originals[0].id);
        }
      }
    }}),
    el('div', { class: 'context-menu-item', text: `Move ${count} sheets to...`, onClick: () => {
      closeMenu();
      showMoveModal(ids);
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: `Trash ${count} sheets`, onClick: async () => {
      closeMenu();
      await trashSelected();
    }}),
  ]);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);
}

// --- Trash context menu ---
function showTrashContextMenu(x, y) {
  document.querySelector('.context-menu')?.remove();
  const ids = [...selectedIds];
  const count = ids.length;

  const menu = el('div', { class: 'context-menu fade-in' }, [
    el('div', { class: 'context-menu-item', text: count > 1 ? `Restore ${count} sheets` : 'Restore', onClick: async () => {
      closeMenu();
      for (const id of ids) await restoreSheet(id);
      selectedIds.clear();
      await refreshList();
      bus.emit('group:updated');
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: count > 1 ? `Delete ${count} permanently` : 'Delete permanently', onClick: async () => {
      closeMenu();
      if (await appConfirm(`Permanently delete ${count} sheet${count > 1 ? 's' : ''}? This cannot be undone.`)) {
        for (const id of ids) await deleteSheet(id);
        selectedIds.clear();
        await refreshList();
      }
    }}),
    el('div', { class: 'context-menu-divider' }),
    el('div', { class: 'context-menu-item danger', text: 'Empty Trash', onClick: async () => {
      closeMenu();
      if (await appConfirm('Permanently delete all items in Trash?')) {
        await emptyTrash();
        await refreshList();
        bus.emit('group:updated');
      }
    }}),
  ]);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const closeMenu = () => menu.remove();
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);
}

// --- Bulk trash ---
async function trashSelected() {
  const count = selectedIds.size;
  if (count === 0) return;

  const groupId = getActiveGroupId();
  if (groupId) adjustGroupCount(groupId, -count);

  const ids = [...selectedIds];
  await trashSheets(ids);
  const deletedActive = selectedIds.has(activeSheetId);
  selectedIds.clear();
  await refreshList();
  bus.emit('group:updated');

  if (deletedActive) {
    const groupId = getActiveGroupId();
    const filter = getActiveFilter();
    let sheets;
    if (filter) sheets = await getFilteredSheets(filter);
    else if (groupId) sheets = await getSheets(groupId);
    else sheets = [];
    if (sheets.length > 0) {
      bus.emit('sheet:select', sheets[0].id);
    } else {
      bus.emit('sheet:none');
    }
  }

  const undone = await showUndoToast(`${count} sheet${count > 1 ? 's' : ''} moved to trash`);
  if (undone) {
    for (const id of ids) await restoreSheet(id);
    await refreshList();
    bus.emit('group:updated');
    if (ids.length > 0) bus.emit('sheet:select', ids[0]);
  }
}

// --- Move modal ---
async function showMoveModal(sheetIds) {
  const { getGroups } = await import('./db.js');
  const groups = await getGroups();
  const currentGroupId = getActiveGroupId();
  const count = sheetIds.length;

  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: count > 1 ? `Move ${count} sheets to...` : 'Move to Group' }),
    ...groups
      .filter(g => g.id !== currentGroupId)
      .map(g => el('div', {
        class: 'context-menu-item',
        text: g.name,
        onClick: async () => {
          await moveSheets(sheetIds, g.id);
          selectedIds.clear();
          bus.emit('sheet:moved');
          bus.emit('group:updated');
          overlay.remove();
        },
      })),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
    ]),
  ]);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}


// --- Tag Filter Bar ---
async function renderTagFilterBar() {
  const bar = document.getElementById('tag-filter-bar');
  if (!bar) return;
  bar.innerHTML = '';

  const usedTagMap = new Map();
  for (const sheet of currentSheets) {
    for (const tag of (sheet.tags || [])) {
      if (!usedTagMap.has(tag.id)) usedTagMap.set(tag.id, { ...tag, count: 0 });
      usedTagMap.get(tag.id).count++;
    }
  }

  let tags = [...usedTagMap.values()];
  if (tags.length === 0) {
    const allTags = await getTags();
    tags = allTags.map(t => ({ ...t, count: 0 }));
  }

  if (tags.length === 0) {
    bar.appendChild(el('span', { style: 'font-size:11px; color:var(--text-tertiary);', text: 'No tags yet' }));
    return;
  }

  for (const tag of tags) {
    const chip = el('div', {
      class: 'tag-filter-chip' + (activeTagFilters.has(tag.id) ? ' selected' : ''),
      style: 'background:' + tag.color,
      text: tag.name + (tag.count ? ' (' + tag.count + ')' : ''),
    });

    chip.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) {
        if (activeTagFilters.has(tag.id)) activeTagFilters.delete(tag.id);
        else activeTagFilters.add(tag.id);
      } else {
        if (activeTagFilters.has(tag.id) && activeTagFilters.size === 1) {
          activeTagFilters.clear();
        } else {
          activeTagFilters.clear();
          activeTagFilters.add(tag.id);
        }
      }
      renderTagFilterBar();
      applyTagFilter();
    });

    bar.appendChild(chip);
  }

  if (activeTagFilters.size > 1) {
    const modeBtn = el('span', {
      class: 'tag-filter-mode',
      text: tagFilterMode === 'or' ? 'OR' : 'AND',
    });
    modeBtn.addEventListener('click', () => {
      tagFilterMode = tagFilterMode === 'or' ? 'and' : 'or';
      modeBtn.textContent = tagFilterMode === 'or' ? 'OR' : 'AND';
      applyTagFilter();
    });
    bar.appendChild(modeBtn);
  }
}

function applyTagFilter() {
  renderSheets(currentSheets);
  const firstCard = listEl.querySelector('.sheet-card');
  if (firstCard) bus.emit('sheet:select', firstCard.dataset.id);
}
