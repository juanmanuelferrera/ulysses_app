// export.js — Export sheets & groups: TXT, MD, HTML, PDF, DOCX + data backup/restore
import { bus, el, appConfirm, appAlert } from './utils.js';
import { getContent } from './editor.js';
import { getSheet, getSheets, exportAllData, importAllData } from './db.js';
import { getActiveGroupId } from './library.js';

let currentSheetTitle = 'Untitled';
let currentSheetId = null;

export function initExport() {
  document.getElementById('export-btn')?.addEventListener('click', openExportModal);
  bus.on('export:open', openExportModal);

  bus.on('sheet:loaded', (sheet) => {
    currentSheetId = sheet.id;
    currentSheetTitle = sheet.title || 'Untitled';
  });
  bus.on('sheet:updated', ({ title }) => {
    if (title) currentSheetTitle = title;
  });
  bus.on('sheet:none', () => {
    currentSheetId = null;
    currentSheetTitle = 'Untitled';
  });
}

function sanitizeFilename(name) {
  return (name || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Untitled';
}

function openExportModal() {
  const overlay = el('div', { class: 'modal-overlay' });

  // Tab state
  let activeTab = 'sheet';

  const tabSheet = el('button', { class: 'btn btn-primary', text: 'Current Sheet', onClick: () => switchTab('sheet') });
  const tabGroup = el('button', { class: 'btn', text: 'Entire Group', onClick: () => switchTab('group') });
  const tabBar = el('div', { style: 'display: flex; gap: 4px; margin-bottom: 16px;' }, [tabSheet, tabGroup]);

  const formatGrid = el('div', { class: 'export-options' });
  const backupSection = createBackupSection(overlay);

  function switchTab(tab) {
    activeTab = tab;
    tabSheet.className = tab === 'sheet' ? 'btn btn-primary' : 'btn';
    tabGroup.className = tab === 'group' ? 'btn btn-primary' : 'btn';
    renderFormats();
  }

  function renderFormats() {
    formatGrid.innerHTML = '';
    const formats = [
      { label: 'Plain Text', format: 'txt', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` },
      { label: 'Markdown', format: 'md', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
      { label: 'HTML', format: 'html', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>` },
      { label: 'PDF', format: 'pdf', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` },
      { label: 'DOCX', format: 'docx', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>` },
    ];
    for (const f of formats) {
      const opt = el('div', { class: 'export-option' }, [
        el('div', { html: f.icon }),
        el('span', { text: f.label }),
      ]);
      opt.addEventListener('click', async () => {
        overlay.remove();
        if (activeTab === 'sheet') {
          await exportSheet(f.format);
        } else {
          await exportGroup(f.format);
        }
      });
      formatGrid.appendChild(opt);
    }
  }

  renderFormats();

  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: 'Export' }),
    tabBar,
    formatGrid,
    backupSection,
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
    ]),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function createBackupSection(overlay) {
  return el('div', { style: 'border-top: 1px solid var(--border-light); margin-top: 16px; padding-top: 16px;' }, [
    el('h3', { text: 'Data Backup', style: 'margin-bottom: 8px;' }),
    el('div', { style: 'display: flex; gap: 8px;' }, [
      el('button', { class: 'btn btn-primary', style: 'flex: 1;', text: 'Export All Data', onClick: async () => {
        const json = await exportAllData();
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(json, `ulysses-backup-${date}.json`, 'application/json');
        overlay.remove();
      }}),
      el('button', { class: 'btn btn-primary', style: 'flex: 1;', text: 'Import Data', onClick: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const text = await file.text();
            if (!await appConfirm('This will replace ALL current data. Continue?', { confirmText: 'Replace', danger: true })) return;
            await importAllData(text);
            overlay.remove();
            window.location.reload();
          } catch (err) {
            appAlert('Import failed: ' + err.message);
          }
        };
        input.click();
      }}),
    ]),
    el('p', { text: 'Export saves all groups, sheets, tags, goals, and settings as JSON.', style: 'font-size: 11px; color: var(--text-tertiary); margin-top: 8px;' }),
  ]);
}

// --- Single sheet export ---
async function exportSheet(format) {
  const content = getContent();
  if (!content) return;
  const filename = sanitizeFilename(currentSheetTitle);
  await exportContent(content, filename, format);
}

// --- Group export (all sheets combined) ---
async function exportGroup(format) {
  const groupId = getActiveGroupId();
  if (!groupId) {
    appAlert('No group selected.');
    return;
  }
  const sheets = await getSheets(groupId);
  if (!sheets || sheets.length === 0) {
    appAlert('No sheets in this group.');
    return;
  }

  // Get group name from first sheet's groupName or panel title
  const panelTitle = document.getElementById('sheets-panel-title')?.textContent || 'Group';
  const combined = sheets.map(s => {
    const title = s.title || 'Untitled';
    return `# ${title}\n\n${s.content || ''}`;
  }).join('\n\n---\n\n');

  const filename = sanitizeFilename(panelTitle);
  await exportContent(combined, filename, format);
}

// --- Format handlers ---
async function exportContent(content, filename, format) {
  switch (format) {
    case 'txt':
      downloadFile(stripMarkdown(content), `${filename}.txt`, 'text/plain');
      break;
    case 'md':
      downloadFile(content, `${filename}.md`, 'text/markdown');
      break;
    case 'html':
      await exportHTML(content, filename);
      break;
    case 'pdf':
      await exportPDF(content, filename);
      break;
    case 'docx':
      await exportDOCX(content, filename);
      break;
  }
}

function stripMarkdown(md) {
  return md
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')    // bold
    .replace(/\*(.*?)\*/g, '$1')        // italic
    .replace(/`(.*?)`/g, '$1')          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '- ')      // list markers (normalize)
    .replace(/^>\s+/gm, '')             // blockquotes
    .replace(/^---+$/gm, '')            // horizontal rules
    .replace(/!\[.*?\]\(.*?\)/g, '')    // images
    .replace(/\n{3,}/g, '\n\n');        // collapse extra blank lines
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportHTML(markdownContent, filename) {
  const { marked } = await import('https://esm.sh/marked@12');
  const html = marked.parse(markdownContent);
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${filename}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #333; }
    h1 { font-size: 28px; } h2 { font-size: 22px; } h3 { font-size: 18px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 14px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #0071e3; padding-left: 16px; color: #666; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    hr { border: none; height: 1px; background: #ddd; margin: 32px 0; }
  </style>
</head>
<body>${html}</body>
</html>`;
  downloadFile(fullHtml, `${filename}.html`, 'text/html');
}

async function exportPDF(markdownContent, filename) {
  const { marked } = await import('https://esm.sh/marked@12');
  const html = marked.parse(markdownContent);

  const container = document.createElement('div');
  container.style.cssText = 'font-family: -apple-system, sans-serif; max-width: 720px; margin: 0 auto; line-height: 1.7; color: #333; padding: 20px;';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const html2pdf = (await import('https://esm.sh/html2pdf.js@0.10.1')).default;
    await html2pdf().set({
      margin: [15, 15],
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(container).save();
  } catch (err) {
    console.error('PDF export failed:', err);
    appAlert('PDF export failed. Try HTML export instead.');
  } finally {
    container.remove();
  }
}

async function exportDOCX(markdownContent, filename) {
  try {
    const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import('https://esm.sh/docx@8');

    const lines = markdownContent.split('\n');
    const children = [];

    for (const line of lines) {
      if (line.startsWith('### ')) {
        children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
      } else if (line.startsWith('## ')) {
        children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      } else if (line.startsWith('# ')) {
        children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      } else if (line.match(/^---+$/)) {
        children.push(new Paragraph({ text: '' }));
      } else if (line.trim() === '') {
        children.push(new Paragraph({ text: '' }));
      } else {
        const runs = [];
        const parts = line.split(/(\*\*.*?\*\*|\*.*?\*)/g);
        for (const part of parts) {
          if (part.startsWith('**') && part.endsWith('**')) {
            runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
          } else if (part.startsWith('*') && part.endsWith('*')) {
            runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
          } else {
            runs.push(new TextRun(part));
          }
        }
        children.push(new Paragraph({ children: runs }));
      }
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('DOCX export failed:', err);
    appAlert('DOCX export failed. Try Markdown or HTML export instead.');
  }
}
