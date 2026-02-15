// goals.js — Full Ulysses-style writing goals
// Modes: about, at least, at most
// Types: words, chars, charsNoSpaces, sentences, paragraphs, pages, readingTime
// Features: deadline with daily calc, progress ring (blue → green → red)
import { bus, el } from './utils.js';
import { getGoal, setGoal, removeGoal, computeStats } from './db.js';

let currentSheetId = null;
let currentGoal = null;
let currentStats = null;

const GOAL_MODES = [
  { value: 'about', label: 'About' },
  { value: 'atLeast', label: 'At least' },
  { value: 'atMost', label: 'At most' },
];

const GOAL_TYPES = [
  { value: 'words', label: 'Words' },
  { value: 'chars', label: 'Characters' },
  { value: 'charsNoSpaces', label: 'Characters (no spaces)' },
  { value: 'sentences', label: 'Sentences' },
  { value: 'paragraphs', label: 'Paragraphs' },
  { value: 'pages', label: 'Pages (~250 words)' },
];

export function initGoals() {
  document.getElementById('goal-btn')?.addEventListener('click', () => {
    if (currentSheetId) showGoalModal();
  });

  bus.on('sheet:loaded', async (sheet) => {
    currentSheetId = sheet.id;
    currentGoal = await getGoal(sheet.id);
    currentStats = computeStats(sheet.content);
    bus.emit('goal:updated', currentGoal);
  });

  bus.on('editor:stats', (stats) => {
    currentStats = stats;
  });

  bus.on('sheet:none', () => {
    currentSheetId = null;
    currentGoal = null;
    currentStats = null;
    bus.emit('goal:updated', null);
  });
}

function showGoalModal() {
  const overlay = el('div', { class: 'modal-overlay' });

  const modeSelect = el('select', { class: 'input' },
    GOAL_MODES.map(m => el('option', { value: m.value, text: m.label }))
  );
  if (currentGoal?.mode) modeSelect.value = currentGoal.mode;

  const typeSelect = el('select', { class: 'input' },
    GOAL_TYPES.map(t => el('option', { value: t.value, text: t.label }))
  );
  if (currentGoal?.targetType) typeSelect.value = currentGoal.targetType;

  const valueInput = el('input', {
    class: 'input',
    type: 'number',
    placeholder: '500',
    min: '1',
  });
  if (currentGoal) valueInput.value = currentGoal.targetValue;

  const deadlineInput = el('input', {
    class: 'input',
    type: 'date',
  });
  if (currentGoal?.deadline) deadlineInput.value = currentGoal.deadline;

  // Current progress preview
  const previewEl = el('div', {
    style: 'margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 13px; color: var(--text-secondary);',
  });

  function updatePreview() {
    if (!currentStats) return;
    const type = typeSelect.value;
    const val = type === 'pages' ? Math.ceil(currentStats.words / 250) : (currentStats[type] || 0);
    const target = parseInt(valueInput.value) || 0;
    const pct = target > 0 ? Math.round((val / target) * 100) : 0;
    previewEl.textContent = `Current: ${val} ${GOAL_TYPES.find(t => t.value === type)?.label || type} (${pct}% of ${target})`;
  }

  typeSelect.addEventListener('change', updatePreview);
  valueInput.addEventListener('input', updatePreview);
  updatePreview();

  const modal = el('div', { class: 'modal' }, [
    el('h3', { text: 'Writing Goal' }),
    el('div', { class: 'goal-setup-grid' }, [
      el('div', { class: 'input-group' }, [
        el('label', { class: 'input-label', text: 'Mode' }),
        modeSelect,
      ]),
      el('div', { class: 'input-group' }, [
        el('label', { class: 'input-label', text: 'Target' }),
        valueInput,
      ]),
      el('div', { class: 'input-group', style: 'grid-column: 1 / -1;' }, [
        el('label', { class: 'input-label', text: 'Measure' }),
        typeSelect,
      ]),
      el('div', { class: 'input-group', style: 'grid-column: 1 / -1;' }, [
        el('label', { class: 'input-label', text: 'Deadline (optional)' }),
        deadlineInput,
      ]),
    ]),
    previewEl,
    el('div', { class: 'modal-actions' }, [
      currentGoal ? el('button', { class: 'btn btn-danger', text: 'Remove Goal', onClick: async () => {
        await removeGoal(currentSheetId);
        currentGoal = null;
        bus.emit('goal:updated', null);
        overlay.remove();
      }}) : null,
      el('button', { class: 'btn', text: 'Cancel', onClick: () => overlay.remove() }),
      el('button', { class: 'btn btn-primary', text: 'Set Goal', onClick: async () => {
        const val = parseInt(valueInput.value);
        if (!val || val < 1) return;
        const mode = modeSelect.value;
        const type = typeSelect.value;
        const deadline = deadlineInput.value || null;
        await setGoal(currentSheetId, type, val, deadline, mode);
        currentGoal = { targetType: type, targetValue: val, mode, deadline };
        bus.emit('goal:updated', currentGoal);
        overlay.remove();
      }}),
    ].filter(Boolean)),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  valueInput.focus();
}
