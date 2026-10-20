/** Напитки: на 100 мл. hyd — доля, которая идёт в норму воды (пиво не поит) */
export interface DrinkKind { name: string; kcal: number; p: number; f: number; c: number; sugar: number; caf: number; hyd: number; color: string }
export const DRINKS: Record<string, DrinkKind> = {
  water: { name: 'Вода без газа', kcal: 0, p: 0, f: 0, c: 0, sugar: 0, caf: 0, hyd: 1, color: '#5B9BD1' },
  soda: { name: 'Вода с газом', kcal: 0, p: 0, f: 0, c: 0, sugar: 0, caf: 0, hyd: 1, color: '#7FB3DD' },
  tea: { name: 'Чай без сахара', kcal: 1, p: 0, f: 0, c: 0.2, sugar: 0, caf: 15, hyd: 1, color: '#A3742A' },
  coffee: { name: 'Кофе чёрный', kcal: 2, p: 0.1, f: 0, c: 0.3, sugar: 0, caf: 40, hyd: 1, color: '#5A3A22' },
  latte: { name: 'Кофе с молоком', kcal: 45, p: 2.7, f: 2.3, c: 3.8, sugar: 3.8, caf: 25, hyd: 1, color: '#B0835A' },
  juice: { name: 'Сок', kcal: 45, p: 0.7, f: 0.2, c: 10.4, sugar: 8.4, caf: 0, hyd: 1, color: '#E89A2C' },
  cola: { name: 'Газировка', kcal: 42, p: 0, f: 0, c: 10.6, sugar: 10.6, caf: 10, hyd: 1, color: '#B8432E' },
  zero: { name: 'Газировка без сахара', kcal: 0, p: 0, f: 0, c: 0, sugar: 0, caf: 10, hyd: 1, color: '#6B6457' },
  milk: { name: 'Молоко 2,5%', kcal: 52, p: 2.9, f: 2.5, c: 4.7, sugar: 4.7, caf: 0, hyd: 1, color: '#D8CBB0' },
  kefir: { name: 'Кефир 1%', kcal: 40, p: 3, f: 1, c: 4, sugar: 4, caf: 0, hyd: 1, color: '#C9C0AE' },
  energy: { name: 'Энергетик', kcal: 45, p: 0, f: 0, c: 11, sugar: 11, caf: 32, hyd: 1, color: '#3C9A4E' },
  beer: { name: 'Пиво', kcal: 43, p: 0.5, f: 0, c: 3.6, sugar: 0, caf: 0, hyd: 0, color: '#C99A2E' },
  custom: { name: 'Своё', kcal: 0, p: 0, f: 0, c: 0, sugar: 0, caf: 0, hyd: 1, color: '#A19682' }
};

export interface DrinkRecord { type: string; ml: number; name?: string | null; kcalPer100?: number | null; sugarPer100?: number | null }
export function drinkTotals(x: DrinkRecord) {
  const t = DRINKS[x.type] ?? DRINKS.custom!, k = x.ml / 100;
  const per = x.type === 'custom' ? { ...t, kcal: x.kcalPer100 ?? 0, c: x.sugarPer100 ?? 0, sugar: x.sugarPer100 ?? 0 } : t;
  return { kcal: Math.round(per.kcal * k), p: per.p * k, f: per.f * k, c: per.c * k, sugar: per.sugar * k, caf: per.caf * k, hyd: x.ml * per.hyd };
}
export const drinkName = (x: DrinkRecord) => (x.type === 'custom' ? x.name || 'Напиток' : DRINKS[x.type]?.name ?? 'Напиток');

/** Норма воды: база по полу + активность недели (как в старом журнале) */
export function waterNorm(sex: string | null | undefined, level: string | null | undefined) {
  const base = sex === 'f' ? 1600 : 2000;
  const bonus = ({ sed: 0, light: 250, mod: 400, high: 600, ath: 800 } as Record<string, number>)[level ?? 'sed'] ?? 0;
  return base + bonus;
}
