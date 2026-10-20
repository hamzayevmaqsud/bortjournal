/** Поиск по справочнику: все слова запроса должны встретиться; выше — где название начинается с запроса (как в старом журнале) */
import { CATALOG } from './catalog-data.js';

export interface CatalogFood { id: string; name: string; kcal: number; protein: number; fat: number; carbs: number; grams: number; unit: string }
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();
const FOODS = CATALOG.map(([name, kcal, protein, fat, carbs, grams, unit, key], i) => ({ id: `d${i}`, name, kcal, protein, fat, carbs, grams, unit, key, n: norm(name) }));

export function searchCatalog(q: string, limit = 12): CatalogFood[] {
  const nq = norm(q), words = nq.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return FOODS.filter(x => words.every(w => x.key.includes(w)))
    .map(x => ({ x, score: (x.n.startsWith(nq) ? 3 : 0) + (x.n.startsWith(words[0]!) ? 2 : 0) + (x.n.includes(nq) ? 1 : 0) - x.n.length / 100 }))
    .sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ x: { key: _k, n: _n, ...f } }) => f);
}
