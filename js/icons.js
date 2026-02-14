// icons.js — Group icon catalog + picker (Ulysses-style)
import { el } from './utils.js';

// 12 Ulysses-style colors
export const ICON_COLORS = [
  { id: 'red', hex: '#FF3B30' },
  { id: 'orange', hex: '#FF9500' },
  { id: 'yellow', hex: '#FFCC00' },
  { id: 'green', hex: '#34C759' },
  { id: 'mint', hex: '#00C7BE' },
  { id: 'teal', hex: '#30B0C7' },
  { id: 'blue', hex: '#007AFF' },
  { id: 'indigo', hex: '#5856D6' },
  { id: 'purple', hex: '#AF52DE' },
  { id: 'pink', hex: '#FF2D55' },
  { id: 'brown', hex: '#A2845E' },
  { id: 'gray', hex: '#8E8E93' },
];

// Icon catalog — SF Symbols-inspired SVG paths (viewBox 0 0 24 24)
export const ICONS = {
  // Writing
  'pencil': 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  'pen': 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  'book': 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  'book-open': 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  'notebook': 'M2 6h4M2 10h4M2 14h4M2 18h4M6 2v20M20 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12V2z',
  'document': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  'scroll': 'M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M14 3v6',

  // Objects
  'lightbulb': 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  'gear': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  'camera': 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'music': 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  'film': 'M19.82 2H4.18A2.18 2.18 0 0 0 2 4.18v15.64A2.18 2.18 0 0 0 4.18 22h15.64A2.18 2.18 0 0 0 22 19.82V4.18A2.18 2.18 0 0 0 19.82 2zM7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5',
  'mic': 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  'coffee': 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3',
  'palette': 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM9.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',

  // Nature
  'leaf': 'M11 20A7 7 0 0 0 9.8 6.9C15.5 4.9 20 .5 20 .5s-3.4 5.1-5.4 11.6A5 5 0 0 1 11 20zM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 12 13',
  'sun': 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  'moon': 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  'star': 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  'cloud': 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  'flower': 'M12 7.5a4.5 4.5 0 1 1 4.5 4.5M12 7.5A4.5 4.5 0 1 0 7.5 12M12 7.5V2M7.5 12a4.5 4.5 0 1 0 4.5 4.5M7.5 12H2M12 16.5a4.5 4.5 0 1 0 4.5-4.5M12 16.5V22M16.5 12a4.5 4.5 0 1 0-4.5-4.5M16.5 12H22',
  'tree': 'M12 22V8M12 8L7 13M12 8l5 5M8 2l4 6 4-6',
  'mountain': 'M8 3l-6 18h20L14 3l-3 8z',

  // People & Body
  'heart': 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  'user': 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'users': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  'brain': 'M9.5 2A5.5 5.5 0 0 0 5 9.5c0 1.6.7 3 1.7 4L12 21l5.3-7.5c1-1 1.7-2.4 1.7-4A5.5 5.5 0 0 0 14.5 2c-1.4 0-2.6.5-3.5 1.3A5.4 5.4 0 0 0 9.5 2z',

  // Communication
  'chat': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  'mail': 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
  'globe': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  'phone': 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.65 2.35a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.76.29 1.54.52 2.35.65a2 2 0 0 1 1.72 2.01z',

  // Navigation
  'flag': 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  'pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'bookmark': 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  'compass': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',

  // Symbols
  'tag': 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  'clock': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  'calendar': 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  'lock': 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  'key': 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'zap': 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',

  // Categories
  'folder': 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  'archive': 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  'box': 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  'grid': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  'layers': 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',

  // Transport & Misc
  'plane': 'M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5 7.6 4.6-3 3-2-.6c-.4-.1-.8 0-1 .3l-.5.5 3 1.5 1.5 3 .5-.5c.3-.3.4-.7.3-1l-.6-2 3-3 4.6 7.6.5-.3c.4-.2.6-.6.5-1.1z',
  'rocket': 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3M22 2l-7.5 7.5M15 9a3 3 0 1 0 0-6M2 14l3.5-3.5M10 22l3.5-3.5',
  'puzzle': 'M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.29-3.29c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z',
  'game': 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-.71 6.39A3 3 0 0 0 4.975 19h.05a3 3 0 0 0 2.56-1.43l.71-1.14a2 2 0 0 1 1.7-.96h4.01a2 2 0 0 1 1.7.96l.71 1.14A3 3 0 0 0 18.975 19h.05a3 3 0 0 0 2.983-3.32l-.71-6.39A4 4 0 0 0 17.32 5z',
  'home': 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  'briefcase': 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  'graduation': 'M22 10l-10-5-10 5 10 5 10-5zM6 12v5c3 3 9 3 12 0v-5',
  'code': 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  'terminal': 'M4 17l6-5-6-5M12 19h8',
};

// Render an icon SVG element
export function renderIcon(iconId, color, size = 16) {
  const path = ICONS[iconId];
  if (!path) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color || 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

// Show the icon picker popup
// Returns a Promise that resolves to { icon, color } or null if cancelled
export function showIconPicker(anchorX, anchorY, currentIcon, currentColor) {
  return new Promise((resolve) => {
    const existing = document.querySelector('.icon-picker');
    if (existing) existing.remove();

    let selectedIcon = currentIcon || null;
    let selectedColor = currentColor || null;

    const picker = el('div', { class: 'icon-picker fade-in' });

    // Color row
    const colorRow = el('div', { class: 'icon-picker-colors' });
    // "No color" option
    const noColor = el('div', {
      class: `icon-picker-color-swatch${!selectedColor ? ' active' : ''}`,
      style: 'background: var(--text-secondary);',
      title: 'Default',
      onClick: () => {
        selectedColor = null;
        colorRow.querySelectorAll('.icon-picker-color-swatch').forEach(s => s.classList.remove('active'));
        noColor.classList.add('active');
        updateGrid();
      },
    });
    colorRow.appendChild(noColor);

    for (const c of ICON_COLORS) {
      const swatch = el('div', {
        class: `icon-picker-color-swatch${selectedColor === c.id ? ' active' : ''}`,
        style: `background: ${c.hex};`,
        title: c.id,
        onClick: () => {
          selectedColor = c.id;
          colorRow.querySelectorAll('.icon-picker-color-swatch').forEach(s => s.classList.remove('active'));
          swatch.classList.add('active');
          updateGrid();
        },
      });
      colorRow.appendChild(swatch);
    }
    picker.appendChild(colorRow);

    // Icon grid
    const grid = el('div', { class: 'icon-picker-grid' });

    function updateGrid() {
      grid.innerHTML = '';
      const colorHex = selectedColor
        ? ICON_COLORS.find(c => c.id === selectedColor)?.hex || 'currentColor'
        : 'var(--text-secondary)';

      for (const [id, path] of Object.entries(ICONS)) {
        const cell = el('div', {
          class: `icon-picker-cell${selectedIcon === id ? ' active' : ''}`,
          title: id,
          onClick: () => {
            selectedIcon = id;
            grid.querySelectorAll('.icon-picker-cell').forEach(c => c.classList.remove('active'));
            cell.classList.add('active');
          },
        });
        const svg = renderIcon(id, colorHex, 20);
        if (svg) cell.appendChild(svg);
        grid.appendChild(cell);
      }
    }
    updateGrid();
    picker.appendChild(grid);

    // Actions
    const actions = el('div', { class: 'icon-picker-actions' }, [
      el('button', { class: 'btn', text: 'Remove', onClick: () => {
        cleanup();
        resolve({ icon: null, color: null });
      }}),
      el('button', { class: 'btn btn-primary', text: 'Done', onClick: () => {
        cleanup();
        resolve({ icon: selectedIcon, color: selectedColor });
      }}),
    ]);
    picker.appendChild(actions);

    // Position
    picker.style.left = `${Math.min(anchorX, window.innerWidth - 290)}px`;
    picker.style.top = `${Math.min(anchorY, window.innerHeight - 400)}px`;
    document.body.appendChild(picker);

    function cleanup() {
      picker.remove();
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    }
    document.addEventListener('keydown', onKey);

    // Close on outside click (after a tick)
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!picker.contains(e.target)) {
          cleanup();
          document.removeEventListener('click', handler);
          resolve(null);
        }
      });
    }, 10);
  });
}
