// app.js — Init, event bus wiring, global state
import { bus } from './utils.js';
import { initDB, getGroups, getSheets, getSheet, updateSheet, createSheet, getSetting, setSetting, computeStats, getFilteredSheets } from './db.js';
import { initEditor, setContent, getContent, focus as editorFocus } from './editor.js';
import { initLibrary, renderGroups, getActiveGroupId, getActiveFilter } from './library.js';
import { initSheetList, renderSheets, setActiveSheet } from './sheets.js';
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
  // Authenticate before loading data
  const authed = await initAuth();
  if (!authed) {
    // Wait for successful auth, then bootstrap
    bus.on('auth:success', () => bootstrap());
    return;
  }
  await bootstrap();
}

async function bootstrap() {
  initMobile();
  await initDB();

  // Init editor
  const editorContainer = document.getElementById('editor-container');
  initEditor(editorContainer);

  // Init modules
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

  // Check URL for deep-link to a specific sheet (?sheet=ID)
  const urlParams = new URLSearchParams(window.location.search);
  const deepLinkSheetId = urlParams.get('sheet');

  // Load groups and auto-select first group + first sheet
  const groups = await getGroups();
  await renderGroups(groups);

  if (deepLinkSheetId) {
    // Deep-link: load the target sheet and its group directly
    const sheet = await getSheet(deepLinkSheetId);
    if (sheet) {
      state.activeGroupId = sheet.groupId;
      const sheets = await getSheets(sheet.groupId);
      document.getElementById('sheets-panel-title').textContent =
        groups.find(g => g.id === sheet.groupId)?.name || 'Sheets';
      renderSheets(sheets);
      bus.emit('sheet:select', deepLinkSheetId);
    }
  } else if (groups.length > 0) {
    const firstGroup = groups[0];
    document.getElementById('sheets-panel-title').textContent = firstGroup.name;
    state.activeGroupId = firstGroup.id;
    bus.emit('group:select', firstGroup.id);

    // Wait for sheets to load, then select first
    const sheets = await getSheets(firstGroup.id);
    renderSheets(sheets);
    if (sheets.length > 0) {
      bus.emit('sheet:select', sheets[0].id);
    }
  }

  // Wire up events
  bus.on('group:select', async (groupId) => {
    state.activeGroupId = groupId;
    const sheets = await getSheets(groupId);
    renderSheets(sheets);
    if (sheets.length > 0) {
      bus.emit('sheet:select', sheets[0].id);
    } else {
      state.activeSheetId = null;
      setContent(null, '');
      bus.emit('editor:stats', { words: 0, chars: 0, charsNoSpaces: 0, sentences: 0, paragraphs: 0, readingTime: '0 min' });
      bus.emit('sheet:none');
    }
  });

  bus.on('sheet:select', async (sheetId) => {
    state.activeSheetId = sheetId;
    const sheet = await getSheet(sheetId);
    if (sheet) {
      setContent(sheet.id, sheet.content);
      setActiveSheet(sheetId);
      bus.emit('sheet:loaded', sheet);
      editorFocus();
    }
  });

  bus.on('editor:save', async ({ id, content }) => {
    const { extractTitle } = await import('./utils.js');
    const title = extractTitle(content);
    await updateSheet(id, { content, title });
    bus.emit('sheet:updated', { id, content, title });
  });

  bus.on('sheet:created', async (sheet) => {
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
    // Update sidebar counts
    const groups = await getGroups();
    await renderGroups(groups);
  });

  // Stats display — full statistics
  bus.on('editor:stats', (stats) => {
    const statsEl = document.getElementById('stats');
    if (statsEl) {
      statsEl.textContent = `${stats.words} words  |  ${stats.chars} characters`;
      statsEl.title = `${stats.words} words\n${stats.chars} characters\n${stats.charsNoSpaces} characters (no spaces)\n${stats.sentences} sentences\n${stats.paragraphs} paragraphs\n${stats.readingTime} reading time`;
    }
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

  // Handle virtual keyboard on mobile
  if ('visualViewport' in window) {
    const onResize = () => {
      const vv = window.visualViewport;
      document.documentElement.style.height = vv.height + 'px';
      document.getElementById('app').style.height = vv.height + 'px';
      window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', () => window.scrollTo(0, 0));
  }

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
  bus.on('filter:select', () => {
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
