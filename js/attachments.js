// attachments.js — Sheet notes, image attachments & keywords panel (Ulysses-style)
import { bus, el } from './utils.js';
import { getSheet, updateSheet } from './db.js';
import { renderSheetKeywords } from './tags.js';

let currentSheetId = null;
let panelEl = null;
let visible = false;

export function initAttachments() {
  // Create the attachments panel (slides in from right)
  panelEl = document.createElement('div');
  panelEl.id = 'attachments-panel';
  panelEl.className = 'attachments-panel';
  panelEl.innerHTML = `
    <div class="panel-header">
      <h2>Attachments</h2>
      <button class="btn btn-icon" id="close-attachments">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="attachments-content">
      <div class="attach-section">
        <label class="input-label">Keywords</label>
        <div id="sheet-keywords"></div>
      </div>
      <div class="attach-section">
        <label class="input-label">Notes</label>
        <textarea id="sheet-notes" class="input" rows="6" placeholder="Add notes about this sheet..."></textarea>
      </div>
      <div class="attach-section">
        <label class="input-label">Images</label>
        <div id="image-list" class="image-list"></div>
        <button class="btn" id="add-image-btn" style="width: 100%; margin-top: 6px;">+ Add Image</button>
      </div>
    </div>
  `;
  document.getElementById('editor-panel').appendChild(panelEl);

  // Close button
  panelEl.querySelector('#close-attachments').addEventListener('click', togglePanel);

  // Notes auto-save
  const notesEl = panelEl.querySelector('#sheet-notes');
  let saveTimer;
  notesEl.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (currentSheetId) {
        await updateSheet(currentSheetId, { notes: notesEl.value });
        bus.emit('sheet:attachments-changed', currentSheetId);
      }
    }, 500);
  });

  // Add image button
  panelEl.querySelector('#add-image-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      for (const file of e.target.files) {
        await addImage(file);
      }
    };
    input.click();
  });

  // Paste image support
  document.addEventListener('paste', async (e) => {
    if (!visible || !currentSheetId) return;
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) await addImage(file);
      }
    }
  });

  // Toggle button in toolbar
  document.getElementById('attachments-btn')?.addEventListener('click', togglePanel);

  // Load notes when sheet changes
  bus.on('sheet:loaded', async (sheet) => {
    currentSheetId = sheet.id;
    notesEl.value = sheet.notes || '';
    await renderImages();
    // Keywords are rendered by tags.js via its own sheet:loaded listener
  });

  bus.on('sheet:none', () => {
    currentSheetId = null;
    notesEl.value = '';
    panelEl.querySelector('#image-list').innerHTML = '';
  });
}

function togglePanel() {
  visible = !visible;
  panelEl.classList.toggle('open', visible);
  document.getElementById('attachments-btn')?.classList.toggle('active-toggle', visible);
}

async function addImage(file) {
  if (!currentSheetId) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const sheet = await getSheet(currentSheetId);
    const images = JSON.parse(sheet.images || '[]');
    images.push({
      name: file.name,
      type: file.type,
      data: reader.result,
      addedAt: Date.now(),
    });
    await updateSheet(currentSheetId, { images: JSON.stringify(images) });
    bus.emit('sheet:attachments-changed', currentSheetId);
    await renderImages();
  };
  reader.readAsDataURL(file);
}

async function renderImages() {
  const listEl = panelEl.querySelector('#image-list');
  listEl.innerHTML = '';
  if (!currentSheetId) return;

  const sheet = await getSheet(currentSheetId);
  const images = JSON.parse(sheet.images || '[]');

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const item = el('div', { class: 'image-thumb' }, [
      el('img', { src: img.data, alt: img.name }),
      el('button', {
        class: 'image-remove',
        html: '&times;',
        onClick: async (e) => {
          e.stopPropagation();
          images.splice(i, 1);
          await updateSheet(currentSheetId, { images: JSON.stringify(images) });
          bus.emit('sheet:attachments-changed', currentSheetId);
          await renderImages();
        },
      }),
    ]);

    // Click to insert markdown reference
    item.querySelector('img').addEventListener('click', () => {
      const { insertText } = import('./editor.js');
      // Copy data URL to clipboard for pasting
      navigator.clipboard?.writeText(`![${img.name}](${img.data.slice(0, 50)}...)`);
    });

    listEl.appendChild(item);
  }
}
