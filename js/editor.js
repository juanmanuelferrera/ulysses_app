// editor.js — CodeMirror 6 setup with markdown and auto-save
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, rectangularSelection } from 'https://esm.sh/@codemirror/view@6';
import { EditorState } from 'https://esm.sh/@codemirror/state@6';
import { defaultKeymap, history, historyKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { markdown, markdownLanguage } from 'https://esm.sh/@codemirror/lang-markdown@6';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from 'https://esm.sh/@codemirror/language@6';
import { closeBrackets, closeBracketsKeymap } from 'https://esm.sh/@codemirror/autocomplete@6';
import { search, searchKeymap, openSearchPanel } from 'https://esm.sh/@codemirror/search@6';
import { bus, debounce } from './utils.js';

let view = null;
let currentSheetId = null;
let typewriterMode = false;
let focusMode = false;

// Ulysses-like theme — proportional font, clean reading experience
const ulyssesTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '17px',
  },
  '.cm-scroller': {
    fontFamily: "'Seravek', 'Gill Sans', 'Avenir Next', 'Avenir', 'Helvetica Neue', -apple-system, sans-serif",
    lineHeight: '1.6',
    padding: '40px 60px',
    overflow: 'auto',
    letterSpacing: '-0.01em',
  },
  '.cm-content': {
    maxWidth: '680px',
    margin: '0 auto',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '1px 0',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--accent-light)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(0, 113, 227, 0.2) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  // Markdown styling — Ulysses dims syntax markers, emphasizes content
  '.cm-header-1': { fontSize: '1.5em', fontWeight: '700', letterSpacing: '-0.02em' },
  '.cm-header-2': { fontSize: '1.3em', fontWeight: '600', letterSpacing: '-0.01em' },
  '.cm-header-3': { fontSize: '1.15em', fontWeight: '600' },
  '.cm-header-4': { fontSize: '1.05em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '600' },
  '.cm-emphasis': { fontStyle: 'italic' },
  '.cm-strikethrough': { textDecoration: 'line-through', color: 'var(--text-tertiary)' },
  '.cm-link': { color: 'var(--accent)', textDecoration: 'none' },
  '.cm-url': { color: 'var(--text-tertiary)', fontSize: '0.9em' },
  // Syntax markers (##, **, __, etc.) dimmed like Ulysses
  '.cm-meta': { color: 'var(--text-tertiary)', fontWeight: '400' },
  '.cm-comment': { color: 'var(--text-tertiary)' },
  '.cm-monospace': {
    fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
    fontSize: '0.88em',
    backgroundColor: 'var(--bg-tertiary)',
    borderRadius: '3px',
    padding: '2px 5px',
  },
});

const autoSave = debounce((content) => {
  if (currentSheetId) {
    bus.emit('editor:save', { id: currentSheetId, content });
  }
}, 500);

async function updateStats(content) {
  const { computeStats } = await import('./db.js');
  bus.emit('editor:stats', computeStats(content));
}

export function initEditor(container) {
  const startState = EditorState.create({
    doc: '',
    extensions: [
      history(),
      drawSelection(),
      highlightActiveLine(),
      rectangularSelection(),
      bracketMatching(),
      closeBrackets(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle),
      search({ top: true }),
      ulyssesTheme,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const content = update.state.doc.toString();
          autoSave(content);
          updateStats(content);
        }
        // Typewriter mode: keep cursor line centered
        if (typewriterMode && (update.docChanged || update.selectionSet)) {
          const pos = update.state.selection.main.head;
          requestAnimationFrame(() => {
            update.view.dispatch({
              effects: EditorView.scrollIntoView(pos, { y: 'center' }),
            });
          });
        }
      }),
      EditorView.lineWrapping,
    ],
  });

  view = new EditorView({
    state: startState,
    parent: container,
  });

  return view;
}

export function setContent(sheetId, content, cursorAtEnd = true) {
  if (!view) return;
  currentSheetId = sheetId;
  const doc = content || '';
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
    selection: { anchor: cursorAtEnd ? doc.length : 0 },
  });
  updateStats(doc);
}

export function getContent() {
  if (!view) return '';
  return view.state.doc.toString();
}

export function focus() {
  if (view) view.focus();
}

export function insertText(text) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

export function wrapSelection(before, after) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);
  const wrapped = before + selected + after;
  view.dispatch({
    changes: { from, to, insert: wrapped },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

export function toggleTypewriter(container) {
  typewriterMode = !typewriterMode;
  container.classList.toggle('typewriter', typewriterMode);
  return typewriterMode;
}

export function isTypewriterMode() {
  return typewriterMode;
}

export function toggleFocusMode(container) {
  focusMode = !focusMode;
  container.classList.toggle('focus-mode', focusMode);
  return focusMode;
}

export function isFocusMode() {
  return focusMode;
}

export function getView() {
  return view;
}

export function openFind() {
  if (view) openSearchPanel(view);
}
