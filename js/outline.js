// outline.js — Outline navigator panel (heading list with jump-to)
import { bus, el } from './utils.js';
import { getView, getContent } from './editor.js';
import { EditorView } from 'https://esm.sh/@codemirror/view@6';

let panelEl = null;
let listEl = null;
let visible = false;

export function initOutline() {
  // Create the outline panel (slides in from right, like attachments)
  panelEl = document.createElement('div');
  panelEl.id = 'outline-panel';
  panelEl.className = 'outline-panel';
  panelEl.innerHTML = `
    <div class="panel-header">
      <h2>Outline</h2>
      <button class="btn btn-icon" id="close-outline">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="outline-list" id="outline-list"></div>
  `;
  document.getElementById('editor-panel').appendChild(panelEl);

  listEl = panelEl.querySelector('#outline-list');

  // Close button
  panelEl.querySelector('#close-outline').addEventListener('click', togglePanel);

  // Toggle button in toolbar
  document.getElementById('outline-btn')?.addEventListener('click', togglePanel);

  // Rebuild outline when a sheet loads
  bus.on('sheet:loaded', (sheet) => {
    buildOutline(sheet.content || '');
  });

  // Rebuild outline when content changes (stats fire on every edit)
  bus.on('editor:stats', () => {
    const content = getContent();
    buildOutline(content);
  });

  // Clear when no sheet selected
  bus.on('sheet:none', () => {
    listEl.innerHTML = '';
  });
}

function togglePanel() {
  visible = !visible;
  panelEl.classList.toggle('open', visible);
  document.getElementById('outline-btn')?.classList.toggle('active-toggle', visible);

  // Close attachments panel if open (avoid overlap)
  if (visible) {
    const attachPanel = document.getElementById('attachments-panel');
    if (attachPanel && attachPanel.classList.contains('open')) {
      attachPanel.classList.remove('open');
      document.getElementById('attachments-btn')?.classList.remove('active-toggle');
    }
  }
}

function buildOutline(content) {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!content || !content.trim()) {
    listEl.appendChild(
      el('div', {
        class: 'outline-empty',
        text: 'No headings found',
      })
    );
    return;
  }

  const lines = content.split('\n');
  let headingsFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;

    headingsFound = true;
    const level = match[1].length; // 1-6
    const text = match[2].replace(/[*_~`]/g, '').trim(); // Strip inline markdown
    const lineNum = i; // 0-based line index

    const levelClass = `h${Math.min(level, 4)}`; // h1, h2, h3, h4 (h5/h6 same indent as h4)

    const item = el('div', {
      class: `outline-item ${levelClass}`,
      text: text,
      title: text,
      onClick: () => scrollToLine(lineNum),
    });

    listEl.appendChild(item);
  }

  if (!headingsFound) {
    listEl.appendChild(
      el('div', {
        class: 'outline-empty',
        text: 'No headings found',
      })
    );
  }
}

function scrollToLine(lineIndex) {
  const view = getView();
  if (!view) return;

  const doc = view.state.doc;
  // lineIndex is 0-based, doc.line() is 1-based
  if (lineIndex + 1 > doc.lines) return;

  const line = doc.line(lineIndex + 1);
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 60 }),
  });
  view.focus();
}
