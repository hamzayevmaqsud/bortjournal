/**
 * Небо по времени суток: верх приложения подкрашен в цвет неба за окном — рассвет, день, золотой час, закат, ночь.
 * «Один дневник на весь день» — и цвет дня тоже. Значение — в <html data-sky>, цвета — в styles/color.css.
 */
export type Sky = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

export const skyAt = (h: number): Sky =>
  h >= 5 && h < 9 ? 'dawn' : h >= 9 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'golden' : h >= 19 && h < 22 ? 'dusk' : 'night';

export function startSky() {
  const set = () => { document.documentElement.dataset.sky = skyAt(new Date().getHours()); };
  set();
  setInterval(set, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) set(); });
}
