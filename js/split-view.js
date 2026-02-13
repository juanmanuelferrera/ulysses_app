// split-view.js — Side-by-side editor + preview
import { bus, el } from './utils.js';
import { getContent } from './editor.js';

let previewPane = null;
let active = false;

export function initSplitView() {
  document.getElementById('split-btn')?.addEventListener('click', toggleSplit);
}

async function toggleSplit() {
  const app = document.getElementById('app');
  const editorPanel = document.getElementById('editor-panel');
  active = !active;

  if (active) {
    app.classList.add('split-view');

    // Create preview pane
    previewPane = el('div', { class: 'preview-pane' }, [
      el('div', { class: 'preview-content', id: 'preview-content' }),
    ]);
    editorPanel.appendChild(previewPane);
    await updatePreview();

    // Listen for changes
    bus.on('editor:save', onEditorChange);
  } else {
    app.classList.remove('split-view');
    if (previewPane) {
      previewPane.remove();
      previewPane = null;
    }
    bus.off('editor:save', onEditorChange);
  }
}

async function onEditorChange() {
  await updatePreview();
}

async function updatePreview() {
  const contentEl = document.getElementById('preview-content');
  if (!contentEl) return;

  const { marked } = await import('https://esm.sh/marked@12');
  const content = getContent();
  contentEl.innerHTML = marked.parse(content || '');
}

export function isSplitActive() {
  return active;
}
