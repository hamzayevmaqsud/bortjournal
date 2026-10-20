/**
 * Оформление: «как в системе», светлое или тёмное. Выбор хранится в профиле (общий для телефона и компьютера)
 * и дублируется в браузере, чтобы при запуске не мигала чужая тема.
 */
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'bj-theme';
const BG = { light: '#EFE3CE', dark: '#1B1915' };

export function savedTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* приватный режим */ }
  // полоса браузера и статус-бар телефона — в цвет фона
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (t === 'system') { m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? BG.dark : BG.light); } else m.setAttribute('content', dark ? BG.dark : BG.light); });
}
