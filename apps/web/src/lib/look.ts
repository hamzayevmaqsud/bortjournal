/**
 * Внешний вид за уровень на этом устройстве: тема (палитра), шрифт заголовков, праздник за задачу, значок серии.
 * Значения — в <html data-look / data-font / data-celebrate>, цвета — в styles/looks.css.
 * Последний выбор помнится в браузере: при открытии тема ставится сразу, до ответа сервера, без мигания.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_LOOK, type Look } from '@bortjournal/core';

const KEY = 'lumi.look';

export function savedLook(): Look {
  try { return { ...DEFAULT_LOOK, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Look>) }; } catch { return { ...DEFAULT_LOOK }; }
}

export function applyLook(l?: Partial<Look> | null) {
  const x = { ...DEFAULT_LOOK, ...(l ?? {}) }, r = document.documentElement;
  if (x.theme === DEFAULT_LOOK.theme) delete r.dataset.look; else r.dataset.look = x.theme;
  r.dataset.font = x.font; r.dataset.celebrate = x.celebrate;
  try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* приватный режим */ }
  dispatchEvent(new Event('lumi-look'));
}

/** текущий вид — для мелочей, которые рисуются компонентами (значок серии) */
export function useLook() {
  const [l, setL] = useState(savedLook);
  useEffect(() => { const f = () => setL(savedLook()); addEventListener('lumi-look', f); return () => removeEventListener('lumi-look', f); }, []);
  return l;
}

/** праздник за закрытую задачу: из галочки — луч маяка или звёзды (если выбран и не просили меньше движения) */
export function celebrate(from: Element | null) {
  const kind = document.documentElement.dataset.celebrate;
  if (!from || !kind || kind === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect(), box = document.createElement('span');
  box.className = `cele ${kind}`; box.style.left = `${r.left + r.width / 2}px`; box.style.top = `${r.top + r.height / 2}px`;
  const n = kind === 'stars' ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = 28 + Math.random() * 26, dot = document.createElement('i');
    dot.style.setProperty('--dx', `${Math.cos(a) * d}px`); dot.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    box.appendChild(dot);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1000);
}
