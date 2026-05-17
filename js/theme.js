// Theme switcher. Pure presentation: swaps a `data-theme` attribute on <html>,
// which re-points the CSS custom properties in style.css. Cards, buttons and
// the background keep the same structure across every theme — only the palette
// and the background texture change. The choice is persisted in localStorage so
// it works on both the landing page and the calculator with no module wiring.
// Nothing leaves the browser; this stays consistent with the zero-server model.

const LS_KEY = 'adcalc_theme';

// Order here is the order shown in the dropdown. 'classic' is the default
// (no attribute / :root).
export const THEMES = [
  { id: 'classic', name: 'Classic' },
  { id: 'editorial', name: 'Editorial' },
  { id: 'pop', name: 'Pop' },
  { id: 'sketch', name: 'Sketch' },
  { id: 'riso', name: 'Riso' },
  { id: 'terminal', name: 'Terminal' },
];

const ids = new Set(THEMES.map(t => t.id));

export function loadTheme() {
  const t = localStorage.getItem(LS_KEY);
  return ids.has(t) ? t : 'classic';
}

export function applyTheme(id) {
  const theme = ids.has(id) ? id : 'classic';
  if (theme === 'classic') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS_KEY, theme);
}

// Populates any <select id="themeSelect"> and keeps it in sync.
export function initThemeSwitcher() {
  const current = loadTheme();
  applyTheme(current);
  const sel = document.getElementById('themeSelect');
  if (!sel) return;
  sel.innerHTML = THEMES
    .map(t => `<option value="${t.id}">${t.name}</option>`)
    .join('');
  sel.value = current;
  sel.addEventListener('change', e => applyTheme(e.target.value));
}

initThemeSwitcher();
