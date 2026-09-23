import { defaultThemeId, getTheme, isThemeId, type ThemeId } from './palettes';

const THEME_STORAGE_KEY = 'console-connect.theme';

function applyTheme(id: ThemeId) {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = 'light';
  for (const [token, value] of Object.entries(theme.tokens)) {
    const name = token.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    root.style.setProperty(`--color-${name}`, value);
  }
  return theme;
}

export function loadTheme() {
  let stored: unknown;
  try { stored = localStorage.getItem(THEME_STORAGE_KEY); }
  catch { /* Restricted storage must not prevent the workspace from opening. */ }
  return applyTheme(isThemeId(stored) ? stored : defaultThemeId);
}

export function selectTheme(id: ThemeId) {
  const theme = applyTheme(id);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme.id); }
  catch { /* The selected palette remains usable for the current session. */ }
  return theme;
}
