// editor.js — CodeMirror 6 setup with markdown and auto-save
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, rectangularSelection, ViewPlugin, Decoration, WidgetType } from 'https://esm.sh/@codemirror/view@6';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import { defaultKeymap, history, historyKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands@6';
import { markdown, markdownLanguage } from 'https://esm.sh/@codemirror/lang-markdown@6';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from 'https://esm.sh/@codemirror/language@6';
import { closeBrackets, closeBracketsKeymap } from 'https://esm.sh/@codemirror/autocomplete@6';
import { search, searchKeymap, openSearchPanel } from 'https://esm.sh/@codemirror/search@6';
import { bus, debounce } from './utils.js';

let view = null;
const readOnlyComp = new Compartment();
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
  '.cm-link': { color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' },
  '.cm-url': { color: 'var(--text-tertiary)', fontSize: '0.9em' },
  // Make markdown links in content clickable
  '.cm-content a': { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' },
  '.cm-content a:hover': { textDecoration: 'underline' },
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

// --- Checkbox widget: renders - [ ] and - [x] as clickable checkboxes ---
class CheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-checkbox-wrap';
    wrap.innerHTML = this.checked
      ? `<svg class="cm-checkbox cm-checkbox-checked" viewBox="0 0 16 16" width="16" height="16"><rect x="1" y="1" width="14" height="14" rx="3" fill="var(--accent)" stroke="var(--accent)"/><path d="M4.5 8l2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg class="cm-checkbox" viewBox="0 0 16 16" width="16" height="16"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"/></svg>`;
    return wrap;
  }
  eq(other) { return other.checked === this.checked; }
  ignoreEvent() { return false; }
}

function buildCheckboxDecorations(view) {
  const widgets = [];
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i);
    const match = line.text.match(/^(\s*- )(\[[ xX]\])/);
    if (match) {
      const start = line.from + match[1].length;
      const end = start + match[2].length;
      widgets.push(
        Decoration.replace({
          widget: new CheckboxWidget(match[2][1] !== ' '),
        }).range(start, end)
      );
    }
  }
  return Decoration.set(widgets);
}

const checkboxPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildCheckboxDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildCheckboxDecorations(update.view);
    }
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    mousedown: (e, view) => {
      const wrap = e.target.closest('.cm-checkbox-wrap');
      if (!wrap) return false;
      const pos = view.posAtDOM(wrap);
      const line = view.state.doc.lineAt(pos);
      const match = line.text.match(/^(\s*- )(\[)([ xX])(\])/);
      if (match) {
        const charPos = line.from + match[1].length + match[2].length;
        const newChar = match[3] === ' ' ? 'x' : ' ';
        view.dispatch({ changes: { from: charPos, to: charPos + 1, insert: newChar } });
        e.preventDefault();
        return true;
      }
      return false;
    },
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
        // Escape: if search panel open, close it; otherwise blur editor for arrow navigation
        { key: 'Escape', run: (v) => {
          const searchPanel = v.dom.querySelector('.cm-search');
          if (searchPanel) return false; // let default handler close search
          v.contentDOM.blur();
          document.getElementById('app')?.focus();
          return true;
        }},
        // Enter on checkbox line: continue with new checkbox or clear empty one
        { key: 'Enter', run: (v) => {
          const { head } = v.state.selection.main;
          const line = v.state.doc.lineAt(head);
          const match = line.text.match(/^(\s*- \[[ xX]\] )(.*)/);
          if (!match) return false;
          const prefix = match[1].replace(/\[[xX]\]/, '[ ]');
          if (match[2].trim() === '') {
            // Empty checkbox line — clear it back to plain line
            v.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
          } else {
            // Continue with a new unchecked checkbox
            v.dispatch({
              changes: { from: head, to: head, insert: '\n' + prefix },
              selection: { anchor: head + 1 + prefix.length },
            });
          }
          return true;
        }},
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
      checkboxPlugin,
      readOnlyComp.of(EditorState.readOnly.of(true)),
    ],
  });

  view = new EditorView({
    state: startState,
    parent: container,
  });

  // Click handler for links
  view.dom.addEventListener('click', (e) => {
    let target = e.target;
    let url = null;
    
    // Walk up to find if we clicked inside a link element
    while (target && target !== view.dom) {
      // Check for <a> tags
      if (target.tagName === 'A') {
        url = target.getAttribute('href');
        break;
      }
      // Check for CodeMirror link classes
      if (target.classList && (
        target.classList.contains('cm-link') || 
        target.classList.contains('cm-url')
      )) {
        url = target.getAttribute('href') || target.textContent;
        break;
      }
      // Check for any element containing a URL-like text
      const text = target.textContent || '';
      if (text.match(/^https?:\/\//) || text.match(/^www\./)) {
        url = text;
        break;
      }
      target = target.parentElement;
    }
    
    if (url) {
      if (url.startsWith('www.')) url = 'https://' + url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        window.open(url, '_blank');
        e.preventDefault();
      }
    }
  });

  return view;
}

export function setContent(sheetId, content, cursorAtEnd = true) {
  if (!view) return;
  currentSheetId = sheetId;
  enableEditor();
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

export function clearEditor() {
  if (!view) return;
  currentSheetId = null;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: '' },
    effects: readOnlyComp.reconfigure(EditorState.readOnly.of(true)),
  });
  view.dom.style.opacity = '0.5';
  view.dom.closest('.editor-container')?.classList.add('editor-disabled');
  updateStats('');
}

export function enableEditor() {
  if (!view) return;
  view.dispatch({
    effects: readOnlyComp.reconfigure(EditorState.readOnly.of(false)),
  });
  view.dom.style.opacity = '1';
  view.dom.closest('.editor-container')?.classList.remove('editor-disabled');
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
