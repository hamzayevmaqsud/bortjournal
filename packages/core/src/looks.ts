/**
 * Внешний вид, который открывается с уровнем (уровень — из достижений: каждые 4 ступени, «Статистика → Достижения»).
 * Темы — палитры фона, карточек, текста и акцента (у каждой день и ночь, маяк по-прежнему переключает день ↔ ночь);
 * цвета разделов (еда, вода, зал…) общие для всех тем. Остальное — мелочи: праздник при закрытии задачи, значок серии, шрифт заголовков.
 */

export interface LookTheme { id: string; name: string; level: number; hint: string; swatch: [string, string, string] }
export const LOOK_THEMES: LookTheme[] = [
  { id: 'lumi', name: 'Маяк', level: 1, hint: 'тёплая бумага и терракота', swatch: ['#EFE3CE', '#2F3B4F', '#B9501F'] },
  { id: 'sea', name: 'Море', level: 2, hint: 'бирюза и глубокий синий', swatch: ['#E3EEF0', '#1F3F57', '#127A8A'] },
  { id: 'garden', name: 'Сад', level: 3, hint: 'шалфей и мягкая зелень', swatch: ['#E8EDDD', '#2F4A35', '#4F7D3A'] },
  { id: 'sunset', name: 'Закат', level: 4, hint: 'персик, коралл и золото', swatch: ['#F6E3DA', '#4A2E3B', '#D2553F'] },
  { id: 'baku', name: 'Ночь в Баку', level: 5, hint: 'тёмный синий с золотом', swatch: ['#0F1224', '#23284A', '#E2B544'] },
  { id: 'paper', name: 'Бумага', level: 7, hint: 'сепия, как старый блокнот', swatch: ['#EDE4D3', '#4A3B2A', '#8A5A2B'] },
  { id: 'neon', name: 'Неон', level: 8, hint: 'фиолетовый свет на тёмном', swatch: ['#0C0B14', '#1E1A3A', '#B488FF'] }
];

export interface LookOption { id: string; name: string }
export interface LookExtra { key: 'celebrate' | 'streak' | 'font'; name: string; hint: string; level: number; options: LookOption[] }
export const LOOK_EXTRAS: LookExtra[] = [
  { key: 'celebrate', name: 'Праздник за задачу', hint: 'луч маяка, когда закрываешь задачу', level: 2, options: [{ id: 'off', name: 'Без праздника' }, { id: 'beam', name: 'Луч маяка' }, { id: 'stars', name: 'Звёзды' }] },
  { key: 'streak', name: 'Значок серии', hint: 'чем отмечать дни подряд', level: 4, options: [{ id: 'flame', name: 'Пламя' }, { id: 'star', name: 'Звезда' }, { id: 'drop', name: 'Волна' }, { id: 'snow', name: 'Снежинка' }] },
  { key: 'font', name: 'Шрифт заголовков', hint: 'антиква, как на обложке книги', level: 7, options: [{ id: 'sans', name: 'Обычный' }, { id: 'serif', name: 'Антиква' }] }
];

export interface Look { theme: string; celebrate: string; streak: string; font: string }
export const DEFAULT_LOOK: Look = { theme: 'lumi', celebrate: 'off', streak: 'flame', font: 'sans' };

/** уровень, с которого доступно: тема по id или вариант дополнения (первый вариант каждого дополнения доступен всем) */
export function lookLevel(key: keyof Look, value: string): number | null {
  if (key === 'theme') return LOOK_THEMES.find(t => t.id === value)?.level ?? null;
  const x = LOOK_EXTRAS.find(e => e.key === key); if (!x) return null;
  const i = x.options.findIndex(o => o.id === value);
  return i < 0 ? null : i === 0 ? 1 : x.level;
}
/** всё, что открылось на уровнях после from и до to включительно — для поздравления «Новый уровень» */
export function unlockedBetween(from: number, to: number) {
  return [
    ...LOOK_THEMES.filter(t => t.level > from && t.level <= to).map(t => ({ kind: 'theme' as const, id: t.id, name: `Тема «${t.name}»`, level: t.level })),
    ...LOOK_EXTRAS.filter(e => e.level > from && e.level <= to).map(e => ({ kind: 'extra' as const, id: e.key, name: e.name, level: e.level }))
  ].sort((a, b) => a.level - b.level);
}
/** выбор из настроек — с проверкой: неизвестное или закрытое на этом уровне становится значением по умолчанию */
export function lookOf(raw: unknown, level: number): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out = { ...DEFAULT_LOOK };
  for (const k of Object.keys(DEFAULT_LOOK) as Array<keyof Look>) {
    const v = typeof r[k] === 'string' ? r[k] as string : null, need = v ? lookLevel(k, v) : null;
    if (v && need !== null && need <= level) out[k] = v;
  }
  return out;
}
