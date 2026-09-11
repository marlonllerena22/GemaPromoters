const STORAGE_KEY = 'estudios-creativos-appearance';
const VALID_THEMES = new Set(['system', 'light', 'dark']);

export function getContentStudioTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.has(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyContentStudioTheme(theme) {
  const selected = VALID_THEMES.has(theme) ? theme : 'system';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    const resolved = selected === 'system' ? (media.matches ? 'dark' : 'light') : selected;
    document.documentElement.dataset.contentStudioTheme = selected;
    document.documentElement.dataset.contentStudioColor = resolved;
    document.documentElement.style.colorScheme = resolved;
  };

  try { window.localStorage.setItem(STORAGE_KEY, selected); } catch { /* Preference remains active for this visit. */ }
  sync();
  if (selected === 'system') media.addEventListener?.('change', sync);
  return () => media.removeEventListener?.('change', sync);
}
