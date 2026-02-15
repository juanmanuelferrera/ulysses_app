// app.js — Init, event bus wiring, global state
import { bus } from './utils.js';
import { initDB, getGroups, getSheets, getSheet, updateSheet, createSheet, getSetting, setSetting, computeStats, getFilteredSheets, bootstrapData } from './db.js';
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

async function init() {
  // Show cached content immediately (before auth verification) to avoid cold-start stall
  const cacheKey = 'ulysses_cache';
  const cached = localStorage.getItem(cacheKey);
  const hasToken = !!localStorage.getItem('ulysses_token');

  if (hasToken && cached) {
    // Render cached UI instantly while auth verifies in background
    await bootstrap(true); // skipFetch=true: render cache only
    // Yield to browser so it paints the cached content before blocking on network
    await new Promise(r => setTimeout(r, 0));
  }

  // Now verify auth (may hit cold start)
  const authed = await initAuth();
  if (!authed) {
    bus.on('auth:success', () => bootstrap(false));
    return;
  }

  // If we already showed cache, just refresh data; otherwise full bootstrap
  await bootstrap(false);
}

let bootstrapped = false;

async function bootstrap(skipFetch = false) {
  // Init modules only once
  if (!bootstrapped) {
    bus.on('sheet:none', () => { clearEditor(); });

    initMobile();

    const editorContainer = document.getElementById('editor-container');
    initEditor(editorContainer);

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

    document.getElementById('typewriter-btn')?.addEventListener('click', () => {
      const container = document.getElementById('editor-container');
      const on = toggleTypewriter(container);
      document.getElementById('typewriter-btn')?.classList.toggle('active-toggle', on);
    });

    document.getElementById('focus-mode-btn')?.addEventListener('click', () => {
      const container = document.getElementById('editor-container');
      const on = toggleFocusMode(container);
      document.getElementById('focus-mode-btn')?.classList.toggle('active-toggle', on);
    });

    document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    });

    wireEvents();
    bootstrapped = true;
  }

  // --- Load data ---
  const urlParams = new URLSearchParams(window.location.search);
  const deepLinkSheetId = urlParams.get('sheet');

  const cacheKey = 'ulysses_cache';
  const cached = localStorage.getItem(cacheKey);

  // Restore last view (group or filter) from localStorage
  let lastView = null;
  try {
    const lv = localStorage.getItem('ulysses_lastView');
    if (lv) lastView = JSON.parse(lv);
  } catch (e) {}

  // --- skipFetch mode: render from cache only, return immediately ---
  if (skipFetch) {
    if (cached && !deepLinkSheetId) {
      try {
        const data = JSON.parse(cached);
        if (data.groups && data.sheets) {
          const { renderTagsSidebar } = await import('./tags.js');
          await renderGroups(data.groups, data.counts);
          renderTagsSidebar(data.tags || []);

          // Helper: get sheets for a group from sheetsByGroup cache (with descendants)
          function getSheetsForGroup(groupId) {
            if (!data.sheetsByGroup) return data.sheets.filter(s => s.groupId === groupId);
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
            return result.length > 0 ? result : data.sheets.filter(s => s.groupId === groupId);
          }

          if (lastView?.type === 'filter') {
            // Set filter UI directly — don't emit filter:select which triggers API calls before auth
            const filterLabels = { all: 'All', recent: 'Last 7 Days', favorites: 'Favorites', trash: 'Trash' };
            document.getElementById('sheets-panel-title').textContent = filterLabels[lastView.id] || '';
            document.querySelectorAll('.filter-item').forEach(el => {
              el.classList.toggle('active', el.dataset.filter === lastView.id);
            });
            document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
            // For filter views, use all sheets from cache as best approximation
            renderSheets(data.sheets);
            if (data.sheets.length > 0) {
              const firstSheet = data.sheets[0];
              state.activeSheetId = firstSheet.id;
              setContent(firstSheet.id, firstSheet.content);
              setActiveSheet(firstSheet.id);
              bus.emit('sheet:loaded', firstSheet);
            }
          } else {
            const targetGroupId = lastView?.type === 'group' && data.groups.some(g => g.id === lastView.id)
              ? lastView.id : (data.groups.length > 0 ? data.groups[0].id : null);
            if (targetGroupId) {
              const targetGroup = data.groups.find(g => g.id === targetGroupId);
              document.getElementById('sheets-panel-title').textContent = targetGroup?.name || 'Sheets';
              state.activeGroupId = targetGroupId;
              document.querySelector(`.group-item[data-id="${targetGroupId}"]`)?.classList.add('active');
              // Get the correct sheets for this group from cached sheetsByGroup
              const groupSheets = getSheetsForGroup(targetGroupId);
              setSheetsCache(targetGroupId, null, groupSheets);
              renderSheets(groupSheets);
              if (groupSheets.length > 0) {
                const firstSheet = groupSheets[0];
                state.activeSheetId = firstSheet.id;
                setContent(firstSheet.id, firstSheet.content);
                setActiveSheet(firstSheet.id);
                bus.emit('sheet:loaded', firstSheet);
              }
            }
          }
        }
      } catch (e) { /* ignore bad cache */ }
    }
    return;
  }

  // --- Full fetch path ---
  let usedCache = !!(cached && !deepLinkSheetId);

  // 1) Fetch fresh data
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
      const sheetsChanged = JSON.stringify(cachedData.sheets) !== JSON.stringify(freshData.sheets);

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
      if (sheetsChanged) {
        // Render correct sheets for the active view, not just freshData.sheets (which is first group only)
        const activeFilter = getActiveFilter();
        if (activeFilter) {
          // Re-trigger filter to load correct sheets from API
          bus.emit('filter:select', activeFilter);
        } else if (state.activeGroupId && freshData.sheetsByGroup) {
          // Get sheets for active group from fresh data
          const childMap = {};
          for (const g of freshData.groups) {
            if (g.parentId) (childMap[g.parentId] ||= []).push(g.id);
          }
          const ids = new Set();
          const stack = [state.activeGroupId];
          while (stack.length > 0) {
            const id = stack.pop();
            ids.add(id);
            if (childMap[id]) stack.push(...childMap[id]);
          }
          const activeSheets = [];
          for (const gid of ids) {
            if (freshData.sheetsByGroup[gid]) activeSheets.push(...freshData.sheetsByGroup[gid]);
          }
          renderSheets(activeSheets);
        } else {
          renderSheets(freshData.sheets);
        }
      }
    } catch (e) { /* ignore comparison errors */ }
    return;
  }

  // 3) First load (no cache) or deep link — render fresh data
  const { groups, counts, tags, sheets } = freshData;
  const { renderTagsSidebar } = await import('./tags.js');
  await renderGroups(groups, counts);
  renderTagsSidebar(tags || []);

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
    document.querySelector(`.group-item[data-id="${targetGroupId}"]`)?.classList.add('active');
    if (sheets.length > 0 && sheets[0].groupId === targetGroupId) {
      renderSheets(sheets);
      bus.emit('sheet:select', sheets[0].id);
    } else {
      bus.emit('group:select', targetGroupId);
    }
  } else {
    bus.emit('sheet:none');
  }
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
  const markupStats = document.getElementById('markup-stats');

  statsBadge?.addEventListener('click', (e) => {
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
  bus.on('goal:updated', (goal) => { currentGoal = goal; });

  bus.on('editor:stats', (stats) => {
    if (statsBadge) {
      const w = stats.words;
      statsBadge.textContent = w >= 1000 ? (w / 1000).toFixed(1) + 'k' : String(w);
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    // Desktop popover — ring + details
    set('sp-words', stats.words.toLocaleString());
    set('sp-chars', stats.chars.toLocaleString());
    set('sp-sentences', stats.sentences.toLocaleString());
    set('sp-paragraphs', stats.paragraphs.toLocaleString());
    set('sp-reading', stats.readingTime);

    // Ring progress + color
    const ring = document.getElementById('sp-ring');
    const goalLabel = document.getElementById('sp-goal-label');
    const subtitle = document.getElementById('sp-subtitle');
    const wordsCountEl = document.getElementById('sp-words');
    const circumference = 2 * Math.PI * 52; // r=52
    if (ring) {
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
        if (mode === 'atLeast') {
          ringColor = 'var(--success)'; // always green — more is better
        } else if (mode === 'atMost') {
          ringColor = current > target ? 'var(--danger)' : 'var(--success)';
        } else {
          const tolerance = target * 0.1;
          if (current > target + tolerance) ringColor = 'var(--danger)';
          else ringColor = 'var(--success)';
        }

        ring.style.strokeDashoffset = circumference * (1 - pct);
        ring.style.stroke = ringColor;
        if (subtitle) subtitle.textContent = 'Already';
        if (wordsCountEl) wordsCountEl.style.color = '';

        if (statsBadge) {
          statsBadge.style.borderColor = ringColor;
          statsBadge.style.color = ringColor;
        }

        if (goalLabel) {
          const modeLabel = mode === 'atLeast' ? 'of at least' : mode === 'about' ? 'of about' : 'of at most';
          const typeLabels = { words: 'words', chars: 'characters', charsNoSpaces: 'characters', sentences: 'sentences', paragraphs: 'paragraphs', pages: 'pages' };
          goalLabel.innerHTML = `${modeLabel} <strong>${target.toLocaleString()}</strong> ${typeLabels[t] || t}`;
        }
      } else {
        ring.style.strokeDashoffset = circumference;
        ring.style.stroke = 'var(--border)';
        if (subtitle) subtitle.textContent = '';
        if (goalLabel) goalLabel.textContent = '';
        if (statsBadge) {
          statsBadge.style.borderColor = '';
          statsBadge.style.color = '';
        }
      }
    }

    // Mobile markup bar + popover
    set('markup-stats-label', `${stats.words} words`);
    set('msp-words', stats.words.toLocaleString());
    set('msp-chars', stats.chars.toLocaleString());
    set('msp-chars-ns', stats.charsNoSpaces.toLocaleString());
    set('msp-sentences', stats.sentences.toLocaleString());
    set('msp-paragraphs', stats.paragraphs.toLocaleString());
    set('msp-reading', stats.readingTime);
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
