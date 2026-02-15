// app.js — Init, event bus wiring, global state
import { bus } from './utils.js';
import { initDB, getGroups, getSheets, getSheet, updateSheet, createSheet, getSetting, setSetting, computeStats, getFilteredSheets, bootstrapData, poll as pollApi } from './db.js';
import { initEditor, setContent, getContent, clearEditor, enableEditor, focus as editorFocus } from './editor.js';
import { initLibrary, renderGroups, getActiveGroupId, getActiveFilter, adjustGroupCount } from './library.js';
import { initSheetList, renderSheets, setActiveSheet, setCache as setSheetsCache, getLocalSheet } from './sheets.js';
import { initTags } from './tags.js';
import { initGoals } from './goals.js';
import { initSearch } from './search.js';
import { initKeyboard } from './keyboard.js';
import { initTheme } from './theme.js';
import { initExport } from './export.js';
import { initSplitView } from './split-view.js';
import { initAttachments } from './attachments.js';
import { initOutline } from './outline.js';
import { initMarkupBar } from './markup-bar.js';
import { toggleTypewriter, toggleFocusMode } from './editor.js';
import { initAuth } from './auth.js';

let state = {
  activeGroupId: null,
  activeSheetId: null,
};

function hideLoader() {
  const loader = document.getElementById('app-loading');
  if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 300); }
}

async function init() {
  const authed = await initAuth();
  if (!authed) {
    // Show login form — remove loader so it's visible
    hideLoader();
    bus.on('auth:success', () => bootstrap());
    return;
  }
  await bootstrap();
}

// Helper: get sheets for a specific group from data with sheetsByGroup (with descendants)
function getSheetsForGroup(data, groupId) {
  if (!data.sheetsByGroup) return (data.sheets || []).filter(s => s.groupId === groupId);
  const childMap = {};
  for (const g of data.groups) {
    if (g.parentId) (childMap[g.parentId] ||= []).push(g.id);
  }
  const ids = new Set();
  const stack = [groupId];
  while (stack.length > 0) {
    const id = stack.pop();
    ids.add(id);
    if (childMap[id]) stack.push(...childMap[id]);
  }
  const result = [];
  for (const gid of ids) {
    if (data.sheetsByGroup[gid]) result.push(...data.sheetsByGroup[gid]);
  }
  return result.length > 0 ? result : (data.sheets || []).filter(s => s.groupId === groupId);
}

async function bootstrap() {

  bus.on('sheet:none', () => clearEditor());

  initMobile();

  // Init editor (sync, no API)
  const editorContainer = document.getElementById('editor-container');
  initEditor(editorContainer);

  // Init modules (sync, no API — just event binding)
  initLibrary();
  initSheetList();
  initTags();
  initGoals();
  initSearch();
  initKeyboard();
  initTheme();
  initExport();
  initSplitView();
  initAttachments();
  initOutline();
  initMarkupBar();

  // Typewriter mode toggle
  document.getElementById('typewriter-btn')?.addEventListener('click', () => {
    const container = document.getElementById('editor-container');
    const on = toggleTypewriter(container);
    document.getElementById('typewriter-btn')?.classList.toggle('active-toggle', on);
  });

  // Focus mode toggle
  document.getElementById('focus-mode-btn')?.addEventListener('click', () => {
    const container = document.getElementById('editor-container');
    const on = toggleFocusMode(container);
    document.getElementById('focus-mode-btn')?.classList.toggle('active-toggle', on);
  });

  // Fullscreen toggle
  document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  // --- Wire up ALL events FIRST (before any data loading) ---
  wireEvents();

  // --- Load data ---
  const urlParams = new URLSearchParams(window.location.search);
  const deepLinkSheetId = urlParams.get('sheet');

  const cacheKey = 'ulysses_cache';
  const cached = localStorage.getItem(cacheKey);
  let usedCache = false;

  // Restore last view (group or filter) from localStorage
  let lastView = null;
  try {
    const lv = localStorage.getItem('ulysses_lastView');
    if (lv) lastView = JSON.parse(lv);
  } catch (e) {}

  // Restore last active sheet
  const lastSheetId = localStorage.getItem('ulysses_lastSheet');

  // 1) Instant render from localStorage cache (zero API calls)
  if (cached && !deepLinkSheetId) {
    try {
      const data = JSON.parse(cached);
      if (data.groups && data.sheets) {
        const { renderTagsSidebar } = await import('./tags.js');
        await renderGroups(data.groups, data.counts);
        renderTagsSidebar(data.tags || []);

        // Restore last view or default to first group
        if (lastView?.type === 'filter') {
          // Build filter sheets from cached data (avoid API call)
          const allCachedSheets = [];
          if (data.sheetsByGroup) {
            for (const gid of Object.keys(data.sheetsByGroup)) allCachedSheets.push(...data.sheetsByGroup[gid]);
          } else {
            allCachedSheets.push(...(data.sheets || []));
          }
          let filterSheets = allCachedSheets;
          const fid = lastView.id;
          if (fid === 'recent') {
            const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            filterSheets = allCachedSheets.filter(s => s.createdAt > weekAgo);
          } else if (fid === 'favorites') {
            filterSheets = allCachedSheets.filter(s => s.favorite);
          } else if (fid === 'trash') {
            filterSheets = []; // trash not in bootstrap cache
          }
          filterSheets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const filterLabels = { all: 'All', recent: 'Last 7 Days', favorites: 'Favorites', trash: 'Trash' };
          document.getElementById('sheets-panel-title').textContent = filterLabels[fid] || '';
          document.querySelector(`.filter-item[data-filter="${fid}"]`)?.classList.add('active');
          setSheetsCache(null, fid, filterSheets);
          renderSheets(filterSheets);
          if (filterSheets.length > 0) {
            const targetSheet = (lastSheetId && filterSheets.find(s => s.id === lastSheetId)) || filterSheets[0];
            state.activeSheetId = targetSheet.id;
            setContent(targetSheet.id, targetSheet.content);
            setActiveSheet(targetSheet.id);
            bus.emit('sheet:loaded', targetSheet);
          }
        } else {
          const targetGroupId = lastView?.type === 'group' && data.groups.some(g => g.id === lastView.id)
            ? lastView.id : (data.groups.length > 0 ? data.groups[0].id : null);
          if (targetGroupId) {
            const targetGroup = data.groups.find(g => g.id === targetGroupId);
            document.getElementById('sheets-panel-title').textContent = targetGroup?.name || 'Sheets';
            state.activeGroupId = targetGroupId;
            try { localStorage.setItem('ulysses_lastView', JSON.stringify({ type: 'group', id: targetGroupId })); } catch (e) {}
            document.querySelector(`.group-item[data-id="${targetGroupId}"]`)?.classList.add('active');
            const groupSheets = getSheetsForGroup(data, targetGroupId);
            setSheetsCache(targetGroupId, null, groupSheets);
            renderSheets(groupSheets);
            if (groupSheets.length > 0) {
              // Restore last sheet or fall back to first
              const targetSheet = (lastSheetId && groupSheets.find(s => s.id === lastSheetId)) || groupSheets[0];
              state.activeSheetId = targetSheet.id;
              setContent(targetSheet.id, targetSheet.content);
              setActiveSheet(targetSheet.id);
              bus.emit('sheet:loaded', targetSheet);
            }
          }
        }
        usedCache = true;
        hideLoader();
      }
    } catch (e) { /* ignore bad cache */ }
  }

  // Fetch fresh data
  const [, freshData] = await Promise.all([
    initDB(),
    bootstrapData(deepLinkSheetId),
  ]);

  // Save to localStorage for next load
  try { localStorage.setItem(cacheKey, JSON.stringify(freshData)); } catch (e) {}

  // Seed in-memory sheets cache for ALL groups (instant group clicks)
  if (freshData.sheetsByGroup) {
    const childMap = {};
    for (const g of freshData.groups) {
      if (g.parentId) (childMap[g.parentId] ||= []).push(g.id);
    }
    function getDescendantIds(groupId) {
      const ids = new Set();
      const stack = [groupId];
      while (stack.length > 0) {
        const id = stack.pop();
        ids.add(id);
        if (childMap[id]) stack.push(...childMap[id]);
      }
      return ids;
    }
    for (const g of freshData.groups) {
      const descendantIds = getDescendantIds(g.id);
      const groupSheets = [];
      for (const gid of descendantIds) {
        if (freshData.sheetsByGroup[gid]) {
          groupSheets.push(...freshData.sheetsByGroup[gid]);
        }
      }
      setSheetsCache(g.id, null, groupSheets);
    }
  } else {
    const freshGroupId = freshData.firstGroupId || (freshData.groups.length > 0 ? freshData.groups[0].id : null);
    if (freshGroupId) {
      setSheetsCache(freshGroupId, null, freshData.sheets);
    }
  }

  // 2) Reconcile: if cache was already rendered, silently update only what changed
  if (usedCache) {
    try {
      const cachedData = JSON.parse(cached);
      const groupsChanged = JSON.stringify(cachedData.groups) !== JSON.stringify(freshData.groups)
                         || JSON.stringify(cachedData.counts) !== JSON.stringify(freshData.counts);
      const tagsChanged = JSON.stringify(cachedData.tags) !== JSON.stringify(freshData.tags);

      if (groupsChanged) {
        await renderGroups(freshData.groups, freshData.counts);
        if (state.activeGroupId) {
          document.querySelector(`.group-item[data-id="${state.activeGroupId}"]`)?.classList.add('active');
        }
      }
      if (tagsChanged) {
        const { renderTagsSidebar } = await import('./tags.js');
        renderTagsSidebar(freshData.tags || []);
      }
      // Re-render sheet list if sheets changed (new/removed), but preserve active editor content
      if (state.activeGroupId) {
        const cachedSheetIds = (getSheetsForGroup(cachedData, state.activeGroupId)).map(s => s.id).sort().join(',');
        const freshSheetIds = (getSheetsForGroup(freshData, state.activeGroupId)).map(s => s.id).sort().join(',');
        if (cachedSheetIds !== freshSheetIds) {
          const freshSheets = getSheetsForGroup(freshData, state.activeGroupId);
          renderSheets(freshSheets);
          if (state.activeSheetId) setActiveSheet(state.activeSheetId);
        }
      }
    } catch (e) { /* ignore comparison errors */ }
    startPolling();
    return;
  }

  // 3) First load (no cache) or deep link — render fresh data
  const { groups, counts, tags, sheets } = freshData;
  const { renderTagsSidebar } = await import('./tags.js');
  await renderGroups(groups, counts);
  renderTagsSidebar(tags || []);
  hideLoader();

  if (deepLinkSheetId) {
    const sheet = sheets.find(s => s.id === deepLinkSheetId) || (sheets.length > 0 ? sheets[0] : null);
    if (sheet) {
      state.activeGroupId = freshData.firstGroupId;
      document.getElementById('sheets-panel-title').textContent =
        groups.find(g => g.id === freshData.firstGroupId)?.name || 'Sheets';
      document.querySelector(`.group-item[data-id="${freshData.firstGroupId}"]`)?.classList.add('active');
      renderSheets(sheets);
      bus.emit('sheet:select', deepLinkSheetId);
    }
  } else if (lastView?.type === 'filter') {
    bus.emit('filter:select', lastView.id);
  } else if (groups.length > 0) {
    const targetGroupId = lastView?.type === 'group' && groups.some(g => g.id === lastView.id)
      ? lastView.id : groups[0].id;
    const targetGroup = groups.find(g => g.id === targetGroupId);
    document.getElementById('sheets-panel-title').textContent = targetGroup?.name || 'Sheets';
    state.activeGroupId = targetGroupId;
    try { localStorage.setItem('ulysses_lastView', JSON.stringify({ type: 'group', id: targetGroupId })); } catch (e) {}
    document.querySelector(`.group-item[data-id="${targetGroupId}"]`)?.classList.add('active');
    // Get correct sheets for target group
    const targetSheets = getSheetsForGroup(freshData, targetGroupId);
    if (targetSheets.length > 0) {
      renderSheets(targetSheets);
      // Restore last sheet or fall back to first
      const restoreId = lastSheetId && targetSheets.some(s => s.id === lastSheetId) ? lastSheetId : targetSheets[0].id;
      bus.emit('sheet:select', restoreId);
    } else {
      bus.emit('group:select', targetGroupId);
    }
  } else {
    bus.emit('sheet:none');
  }
  startPolling();
}

// --- Auto-poll for external changes (DB writes from CLI, other devices) ---
let pollState = { lastModified: 0, total: 0 };
let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  // Initialize with current state so first poll doesn't false-trigger
  pollApi().then(r => { if (r) pollState = r; }).catch(() => {});
  pollTimer = setInterval(async () => {
    try {
      const r = await pollApi();
      if (!r) return;
      if (r.lastModified !== pollState.lastModified || r.total !== pollState.total) {
        pollState = r;
        await refreshCurrentView();
      }
    } catch (e) { /* ignore poll errors */ }
  }, 10000); // check every 10 seconds
}

async function refreshCurrentView() {
  const fresh = await bootstrapData();
  try { localStorage.setItem('ulysses_cache', JSON.stringify(fresh)); } catch (e) {}

  // Update in-memory sheets cache
  if (fresh.sheetsByGroup) {
    const childMap = {};
    for (const g of fresh.groups) {
      if (g.parentId) (childMap[g.parentId] ||= []).push(g.id);
    }
    for (const g of fresh.groups) {
      const ids = new Set();
      const stack = [g.id];
      while (stack.length) { const id = stack.pop(); ids.add(id); if (childMap[id]) stack.push(...childMap[id]); }
      const sheets = [];
      for (const gid of ids) { if (fresh.sheetsByGroup[gid]) sheets.push(...fresh.sheetsByGroup[gid]); }
      setSheetsCache(g.id, null, sheets);
    }
  }

  // Re-render sidebar (groups + filter counts + tags)
  await renderGroups(fresh.groups, fresh.counts);
  const { renderTagsSidebar } = await import('./tags.js');
  renderTagsSidebar(fresh.tags || []);

  // Restore active highlight
  const filter = getActiveFilter();
  if (filter) {
    document.querySelector(`.filter-item[data-filter="${filter}"]`)?.classList.add('active');
  } else if (state.activeGroupId) {
    document.querySelector(`.group-item[data-id="${state.activeGroupId}"]`)?.classList.add('active');
  }

  // Re-render sheet list for current view
  if (filter) {
    // Build filter sheets from fresh data (no extra API call)
    const allSheets = [];
    if (fresh.sheetsByGroup) {
      for (const gid of Object.keys(fresh.sheetsByGroup)) allSheets.push(...fresh.sheetsByGroup[gid]);
    }
    let filterSheets = allSheets;
    if (filter === 'recent') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      filterSheets = allSheets.filter(s => s.createdAt > weekAgo);
    } else if (filter === 'favorites') {
      filterSheets = allSheets.filter(s => s.favorite);
    } else if (filter === 'trash') {
      filterSheets = await getFilteredSheets('trash');
    }
    filterSheets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    setSheetsCache(null, filter, filterSheets);
    renderSheets(filterSheets);
  } else if (state.activeGroupId) {
    const sheets = getSheetsForGroup(fresh, state.activeGroupId);
    renderSheets(sheets);
  }
  if (state.activeSheetId) setActiveSheet(state.activeSheetId);
}

// --- All event wiring (runs once, before data load) ---
function wireEvents() {
  bus.on('group:select', (groupId) => {
    state.activeGroupId = groupId;
    try { localStorage.setItem('ulysses_lastView', JSON.stringify({ type: 'group', id: groupId })); } catch (e) {}
  });

  bus.on('sheet:select', async (sheetId) => {
    if (state.activeSheetId === sheetId) return; // already loaded
    state.activeSheetId = sheetId;
    try { localStorage.setItem('ulysses_lastSheet', sheetId); } catch (e) {}
    const wasInNavMode = document.activeElement === document.getElementById('app');
    // Try local cache first (instant), fall back to API
    const sheet = getLocalSheet(sheetId) || await getSheet(sheetId);
    if (sheet) {
      setContent(sheet.id, sheet.content);
      setActiveSheet(sheetId);
      bus.emit('sheet:loaded', sheet);
      if (!wasInNavMode) editorFocus();
    }
  });

  bus.on('editor:save', async ({ id, content }) => {
    const { extractTitle } = await import('./utils.js');
    const title = extractTitle(content);
    await updateSheet(id, { content, title });
    bus.emit('sheet:updated', { id, content, title });
  });

  bus.on('sheet:created', async (sheet) => {
    if (sheet.groupId) adjustGroupCount(sheet.groupId, +1);
    const groupId = getActiveGroupId();
    if (groupId) {
      const sheets = await getSheets(groupId);
      renderSheets(sheets);
    }
    bus.emit('sheet:select', sheet.id);
    bus.emit('group:updated');
  });

  bus.on('sheet:deleted', async (sheetId) => {
    if (state.activeSheetId === sheetId) {
      const groupId = getActiveGroupId();
      const filter = getActiveFilter();
      let sheets;
      if (filter) sheets = await getFilteredSheets(filter);
      else if (groupId) sheets = await getSheets(groupId);
      else sheets = [];
      renderSheets(sheets);
      if (sheets.length > 0) {
        bus.emit('sheet:select', sheets[0].id);
      } else {
        state.activeSheetId = null;
        try { localStorage.removeItem('ulysses_lastSheet'); } catch (e) {}
        setContent(null, '');
        bus.emit('sheet:none');
      }
    }
  });

  bus.on('group:created', async () => {
    const groups = await getGroups();
    await renderGroups(groups);
  });

  bus.on('group:deleted', async () => {
    const groups = await getGroups();
    await renderGroups(groups);
    if (groups.length > 0) {
      bus.emit('group:select', groups[0].id);
    }
  });

  bus.on('group:updated', async () => {
    const groups = await getGroups();
    await renderGroups(groups);
  });

  bus.on('sheet:moved', async () => {
    const groupId = getActiveGroupId();
    if (groupId) {
      const sheets = await getSheets(groupId);
      renderSheets(sheets);
    }
    const groups = await getGroups();
    await renderGroups(groups);
  });

  // Stats display — floating indicator (desktop) + markup bar (mobile)
  const statsFloat = document.getElementById('stats-float');
  const statsBadge = document.getElementById('stats-badge');
  const statsTrigger = document.querySelector('.stats-float-trigger');
  const badgeRing = document.getElementById('stats-badge-ring');
  const markupStats = document.getElementById('markup-stats');
  const badgeCircumference = 2 * Math.PI * 17; // r=17 from SVG
  if (badgeRing) {
    badgeRing.style.strokeDasharray = badgeCircumference;
    badgeRing.style.strokeDashoffset = badgeCircumference;
  }

  statsTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    statsFloat.classList.toggle('open');
  });
  markupStats?.addEventListener('click', (e) => {
    e.stopPropagation();
    markupStats.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (statsFloat && !statsFloat.contains(e.target)) {
      statsFloat.classList.remove('open');
    }
    if (markupStats && !markupStats.contains(e.target)) {
      markupStats.classList.remove('open');
    }
  });

  let currentGoal = null;
  let lastStats = null;

  function renderStatsDisplay(stats) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // Desktop popover details
    set('sp-words', stats.words.toLocaleString());
    set('sp-chars', stats.chars.toLocaleString());
    set('sp-sentences', stats.sentences.toLocaleString());
    set('sp-paragraphs', stats.paragraphs.toLocaleString());
    set('sp-reading', stats.readingTime);

    // Popover ring + goal label
    const ring = document.getElementById('sp-ring');
    const goalLabel = document.getElementById('sp-goal-label');
    const subtitle = document.getElementById('sp-subtitle');
    const circumference = 2 * Math.PI * 52; // r=52

    if (currentGoal && currentGoal.targetValue > 0) {
      const t = currentGoal.targetType;
      let current;
      if (t === 'pages') current = Math.ceil(stats.words / 250);
      else if (t === 'words') current = stats.words;
      else if (t === 'chars') current = stats.chars;
      else if (t === 'charsNoSpaces') current = stats.charsNoSpaces;
      else if (t === 'sentences') current = stats.sentences;
      else if (t === 'paragraphs') current = stats.paragraphs;
      else current = stats.words;

      const target = currentGoal.targetValue;
      const mode = currentGoal.mode || 'about';
      const pct = Math.min(current / target, 1);

      let ringColor = 'var(--success)';
      if (mode === 'atMost') {
        ringColor = current > target ? 'var(--danger)' : 'var(--success)';
      } else if (mode === 'about') {
        const tolerance = target * 0.1;
        ringColor = current > target + tolerance ? 'var(--danger)' : 'var(--success)';
      }

      // Badge: show word count, ring shows progress
      if (statsBadge) {
        const w = stats.words;
        statsBadge.textContent = w >= 1000 ? (w / 1000).toFixed(1) + 'k' : String(w);
        statsBadge.style.color = ringColor;
      }
      if (badgeRing) {
        badgeRing.style.strokeDashoffset = badgeCircumference * (1 - pct);
        badgeRing.style.stroke = ringColor;
      }

      // Popover ring
      if (ring) {
        ring.style.strokeDashoffset = circumference * (1 - pct);
        ring.style.stroke = ringColor;
      }
      if (subtitle) subtitle.textContent = 'Already';
      if (goalLabel) {
        const modeLabel = mode === 'atLeast' ? 'of at least' : mode === 'about' ? 'of about' : 'of at most';
        const typeLabels = { words: 'words', chars: 'characters', charsNoSpaces: 'characters', sentences: 'sentences', paragraphs: 'paragraphs', pages: 'pages' };
        goalLabel.innerHTML = `${modeLabel} <strong>${target.toLocaleString()}</strong> ${typeLabels[t] || t}`;
      }
    } else {
      // No goal — plain word count badge
      if (statsBadge) {
        const w = stats.words;
        statsBadge.textContent = w >= 1000 ? (w / 1000).toFixed(1) + 'k' : String(w);
        statsBadge.style.color = '';
      }
      if (badgeRing) {
        badgeRing.style.strokeDashoffset = badgeCircumference;
        badgeRing.style.stroke = 'transparent';
      }
      if (ring) {
        ring.style.strokeDashoffset = circumference;
        ring.style.stroke = 'var(--border)';
      }
      if (subtitle) subtitle.textContent = '';
      if (goalLabel) goalLabel.textContent = '';
    }

    // Mobile markup bar + popover
    set('markup-stats-label', `${stats.words} words`);
    set('msp-words', stats.words.toLocaleString());
    set('msp-chars', stats.chars.toLocaleString());
    set('msp-chars-ns', stats.charsNoSpaces.toLocaleString());
    set('msp-sentences', stats.sentences.toLocaleString());
    set('msp-paragraphs', stats.paragraphs.toLocaleString());
    set('msp-reading', stats.readingTime);
  }

  bus.on('goal:updated', (goal) => {
    currentGoal = goal;
    if (lastStats) renderStatsDisplay(lastStats);
  });

  bus.on('editor:stats', (stats) => {
    lastStats = stats;
    renderStatsDisplay(stats);
  });

  // Panel toggle buttons
  document.getElementById('toggle-library')?.addEventListener('click', () => {
    document.getElementById('app').classList.toggle('library-hidden');
  });
  document.getElementById('toggle-sheets')?.addEventListener('click', () => {
    document.getElementById('app').classList.toggle('sheets-hidden');
  });
}

export function getState() { return state; }

document.addEventListener('DOMContentLoaded', init);


// === Mobile Navigation ===
function initMobile() {
  const appEl = document.getElementById('app');

  const isMobile = () => window.innerWidth <= 768;

  // Back to library
  document.getElementById('mobile-back-library')?.addEventListener('click', () => {
    appEl.classList.remove('mobile-sheets', 'mobile-editor');
  });

  // Back to sheets
  document.getElementById('mobile-back-sheets')?.addEventListener('click', () => {
    appEl.classList.remove('mobile-editor');
    appEl.classList.add('mobile-sheets');
  });

  // When a group is selected, show sheets panel
  bus.on('group:select', () => {
    if (isMobile()) {
      appEl.classList.remove('mobile-editor');
      appEl.classList.add('mobile-sheets');
    }
  });

  // When a filter is selected, show sheets panel
  bus.on('filter:select', (filter) => {
    try { localStorage.setItem('ulysses_lastView', JSON.stringify({ type: 'filter', id: filter })); } catch (e) {}
    if (isMobile()) {
      appEl.classList.remove('mobile-editor');
      appEl.classList.add('mobile-sheets');
    }
  });

  // When a keyword tag is revealed, show sheets panel
  bus.on('tag:reveal', () => {
    if (isMobile()) {
      appEl.classList.remove('mobile-editor');
      appEl.classList.add('mobile-sheets');
    }
  });

  // When a sheet is selected, show editor
  bus.on('sheet:select', () => {
    if (isMobile()) {
      appEl.classList.add('mobile-editor');
    }
  });

  // Handle resize: clean up mobile classes when going to desktop
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      appEl.classList.remove('mobile-sheets', 'mobile-editor');
    }
  });
}
