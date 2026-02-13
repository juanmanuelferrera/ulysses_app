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
    updateGoalDisplay();
  });

  bus.on('editor:stats', (stats) => {
    currentStats = stats;
    if (currentGoal) updateGoalDisplay();
  });

  bus.on('sheet:none', () => {
    currentSheetId = null;
    currentGoal = null;
    currentStats = null;
    clearGoalUI();
  });
}

function getCurrentValue() {
  if (!currentStats || !currentGoal) return 0;
  const t = currentGoal.targetType;
  if (t === 'pages') return Math.ceil(currentStats.words / 250);
  return currentStats[t] || 0;
}

function getGoalStatus() {
  if (!currentGoal || !currentStats) return null;
  const current = getCurrentValue();
  const target = currentGoal.targetValue;
  const mode = currentGoal.mode || 'about';
  const pct = target > 0 ? current / target : 0;

  let color = 'var(--accent)'; // blue = in progress
  let complete = false;

  if (mode === 'atLeast') {
    complete = current >= target;
    color = complete ? 'var(--success)' : 'var(--accent)';
  } else if (mode === 'atMost') {
    complete = current <= target;
    color = current > target ? 'var(--danger)' : 'var(--success)';
  } else { // about
    const tolerance = target * 0.1;
    complete = Math.abs(current - target) <= tolerance;
    if (current > target + tolerance) color = 'var(--danger)';
    else if (complete) color = 'var(--success)';
    else color = 'var(--accent)';
  }

  return { current, target, pct: Math.min(pct, 1), color, complete, mode };
}

function updateGoalDisplay() {
  const statusEl = document.getElementById('goal-status');
  const goalBtnEl = document.getElementById('goal-btn');
  if (!statusEl) return;

  if (!currentGoal) {
    clearGoalUI();
    return;
  }

  const status = getGoalStatus();
  if (!status) return;

  const r = 12;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - status.pct);
  const modeLabel = GOAL_MODES.find(m => m.value === status.mode)?.label || 'About';
  const typeLabel = GOAL_TYPES.find(t => t.value === currentGoal.targetType)?.label || currentGoal.targetType;

  let deadlineInfo = '';
  if (currentGoal.deadline) {
    const daysLeft = Math.ceil((new Date(currentGoal.deadline) - new Date()) / (1000 * 60 * 60 * 24));
    const remaining = Math.max(0, currentGoal.targetValue - status.current);
    const perDay = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;
    deadlineInfo = daysLeft > 0
      ? `\n${daysLeft} days left · ${perDay} ${currentGoal.targetType}/day`
      : '\nDeadline passed';
  }

  statusEl.innerHTML = '';

  // Ulysses-style: ring + count display
  const indicator = el('div', {
    class: 'goal-indicator',
    title: `${modeLabel} ${status.target} ${typeLabel}${deadlineInfo}`,
    onClick: () => showGoalModal(),
  });

  const ring = el('div', { class: 'goal-ring' });
  ring.innerHTML = `
    <svg viewBox="0 0 32 32">
      <circle class="track" cx="16" cy="16" r="${r}"/>
      <circle class="progress" cx="16" cy="16" r="${r}"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        style="stroke: ${status.color}"/>
    </svg>
  `;

  // Short type label for display
  const shortType = { words: 'Words', chars: 'Chars', charsNoSpaces: 'Chars', sentences: 'Sentences', paragraphs: 'Paragraphs', pages: 'Pages' };
  const countEl = el('div', { class: 'goal-count' });
  countEl.innerHTML = `<span class="goal-current" style="color: ${status.color}">${status.current}</span> / ${status.target} ${shortType[currentGoal.targetType] || ''}`;

  indicator.appendChild(ring);
  indicator.appendChild(countEl);
  statusEl.appendChild(indicator);

  // Highlight goal button when active
  if (goalBtnEl) goalBtnEl.classList.add('active-toggle');
}

function clearGoalUI() {
  const statusEl = document.getElementById('goal-status');
  if (statusEl) statusEl.innerHTML = '';
  document.getElementById('goal-btn')?.classList.remove('active-toggle');
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
        clearGoalUI();
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
        updateGoalDisplay();
        overlay.remove();
      }}),
    ].filter(Boolean)),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  valueInput.focus();
}
