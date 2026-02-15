// markup-bar.js — Ulysses-style formatting toolbar
import { wrapSelection, insertText, getView } from './editor.js';

/**
 * Insert text at the beginning of the current line(s).
 * Used for headings, blockquotes, and list prefixes.
 */
function insertAtLineStart(prefix) {
  const view = getView();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const lineStart = view.state.doc.lineAt(from).from;
  const lineEnd = view.state.doc.lineAt(to).to;
  const lineText = view.state.doc.sliceString(lineStart, lineEnd);

  // If we are inserting a heading, strip any existing heading prefix first
  let cleaned = lineText;
  if (prefix.startsWith('#')) {
    cleaned = lineText.replace(/^#{1,6}\s*/, '');
  }

  const newText = prefix + cleaned;
  view.dispatch({
    changes: { from: lineStart, to: lineEnd, insert: newText },
    selection: { anchor: lineStart + newText.length },
  });
  view.focus();
}

/**
 * Insert a new line with the given prefix (for lists, blockquotes)
 * If text is selected, prefix each selected line.
 */
function prefixLines(prefix) {
  const view = getView();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  if (from === to) {
    // No selection: insert prefix at start of current line
    const lineText = startLine.text;
    // If line already has this prefix, remove it (toggle behavior)
    if (lineText.startsWith(prefix)) {
      view.dispatch({
        changes: { from: startLine.from, to: startLine.to, insert: lineText.slice(prefix.length) },
      });
    } else {
      view.dispatch({
        changes: { from: startLine.from, to: startLine.from, insert: prefix },
        selection: { anchor: startLine.from + prefix.length + lineText.length },
      });
    }
  } else {
    // Selection spans lines: prefix each line
    const changes = [];
    for (let i = startLine.number; i <= endLine.number; i++) {
      const line = view.state.doc.line(i);
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
    view.dispatch({ changes });
  }
  view.focus();
}

/**
 * Insert a numbered list. Each selected line gets 1. 2. 3. etc.
 */
function insertNumberedList() {
  const view = getView();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  if (from === to) {
    // No selection: insert "1. " at start of current line
    const lineText = startLine.text;
    if (/^\d+\.\s/.test(lineText)) {
      // Toggle off: remove numbered prefix
      view.dispatch({
        changes: { from: startLine.from, to: startLine.to, insert: lineText.replace(/^\d+\.\s/, '') },
      });
    } else {
      view.dispatch({
        changes: { from: startLine.from, to: startLine.from, insert: '1. ' },
        selection: { anchor: startLine.from + 3 + lineText.length },
      });
    }
  } else {
    const changes = [];
    let num = 1;
    for (let i = startLine.number; i <= endLine.number; i++) {
      const line = view.state.doc.line(i);
      const prefix = `${num}. `;
      changes.push({ from: line.from, to: line.from, insert: prefix });
      num++;
    }
    view.dispatch({ changes });
  }
  view.focus();
}

const markupActions = [
  {
    id: 'h1',
    label: 'H1',
    title: 'Heading 1',
    action: () => insertAtLineStart('# '),
    icon: null, // uses text label
  },
  {
    id: 'h2',
    label: 'H2',
    title: 'Heading 2',
    action: () => insertAtLineStart('## '),
  },
  {
    id: 'h3',
    label: 'H3',
    title: 'Heading 3',
    action: () => insertAtLineStart('### '),
  },
  { id: 'sep-1', separator: true },
  {
    id: 'bold',
    title: 'Bold',
    action: () => wrapSelection('**', '**'),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
    </svg>`,
  },
  {
    id: 'italic',
    title: 'Italic',
    action: () => wrapSelection('*', '*'),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="19" y1="4" x2="10" y2="4"/>
      <line x1="14" y1="20" x2="5" y2="20"/>
      <line x1="15" y1="4" x2="9" y2="20"/>
    </svg>`,
  },
  {
    id: 'strikethrough',
    title: 'Strikethrough',
    action: () => wrapSelection('~~', '~~'),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 4H9a3 3 0 0 0 0 6h6"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <path d="M15 12a3 3 0 1 1 0 6H8"/>
    </svg>`,
  },
  { id: 'sep-2', separator: true },
  {
    id: 'link',
    title: 'Link',
    action: () => {
      const view = getView();
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.doc.sliceString(from, to);
      if (selected) {
        // Wrap selected text as link text
        const replacement = `[${selected}](url)`;
        view.dispatch({
          changes: { from, to, insert: replacement },
          // Select "url" so user can type the URL
          selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
        });
      } else {
        const link = '[link text](url)';
        view.dispatch({
          changes: { from, to, insert: link },
          // Select "link text" so user can type the label
          selection: { anchor: from + 1, head: from + 10 },
        });
      }
      view.focus();
    },
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`,
  },
  {
    id: 'image',
    title: 'Image',
    action: () => {
      const view = getView();
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.doc.sliceString(from, to);
      const alt = selected || 'alt text';
      const img = `![${alt}](url)`;
      view.dispatch({
        changes: { from, to, insert: img },
        // Select "url"
        selection: { anchor: from + alt.length + 4, head: from + alt.length + 7 },
      });
      view.focus();
    },
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`,
  },
  { id: 'sep-3', separator: true },
  {
    id: 'checkbox',
    title: 'Task List',
    action: () => prefixLines('- [ ] '),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M8 12l3 3 5-6"/>
    </svg>`,
  },
  {
    id: 'ul',
    title: 'Bullet List',
    action: () => prefixLines('- '),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/>
    </svg>`,
  },
  {
    id: 'ol',
    title: 'Numbered List',
    action: () => insertNumberedList(),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="10" y1="6" x2="21" y2="6"/>
      <line x1="10" y1="12" x2="21" y2="12"/>
      <line x1="10" y1="18" x2="21" y2="18"/>
      <text x="2" y="8" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="600">1</text>
      <text x="2" y="14" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="600">2</text>
      <text x="2" y="20" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="600">3</text>
    </svg>`,
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    action: () => prefixLines('> '),
    svg: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5 3.871 3.871 0 0 1-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5 3.871 3.871 0 0 1-2.748-1.179z"/>
    </svg>`,
  },
  { id: 'sep-4', separator: true },
  {
    id: 'code',
    title: 'Inline Code',
    action: () => wrapSelection('`', '`'),
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>`,
  },
  {
    id: 'divider',
    title: 'Horizontal Rule',
    action: () => {
      const view = getView();
      if (!view) return;
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      // Insert on a new line if current line has content
      const prefix = line.text.trim() ? '\n' : '';
      const divider = prefix + '---\n';
      view.dispatch({
        changes: { from: line.to, to: line.to, insert: divider },
        selection: { anchor: line.to + divider.length },
      });
      view.focus();
    },
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="3" y1="12" x2="21" y2="12"/>
    </svg>`,
  },
];

export function initMarkupBar() {
  const bar = document.getElementById('markup-bar');
  if (!bar) return;

  const inner = bar.querySelector('.markup-bar-inner');
  if (!inner) return;

  for (const item of markupActions) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'markup-bar-sep';
      inner.appendChild(sep);
      continue;
    }

    const btn = document.createElement('button');
    btn.className = 'markup-btn';
    btn.title = item.title;
    btn.type = 'button';

    if (item.svg) {
      btn.innerHTML = item.svg;
    } else if (item.label) {
      btn.textContent = item.label;
      btn.classList.add('markup-btn-text');
    }

    btn.addEventListener('mousedown', (e) => {
      // Prevent the button from stealing focus from the editor
      e.preventDefault();
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      item.action();
    });

    inner.appendChild(btn);
  }
}
