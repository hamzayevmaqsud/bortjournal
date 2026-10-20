/** Оценка значения против нормы — те же пороги и слова, что в старом журнале. live — день ещё идёт */
import { fmt, fmt1 } from './format';

export type Lvl = 'good' | 'warn' | 'bad' | 'low' | 'info';
export interface Verdict { lvl: Lvl; icon: string; text: string }
const V = (lvl: Lvl, text: string, icon = { good: '✓', warn: '▲', bad: '▲', low: '▼', info: '•' }[lvl]): Verdict => ({ lvl, icon, text });
export const MAC = { kcal: { name: 'Калории', unit: 'ккал', color: 'var(--c-kcal)' }, protein: { name: 'Белки', unit: 'г', color: 'var(--c-prot)' }, fat: { name: 'Жиры', unit: 'г', color: 'var(--c-fat)' }, carbs: { name: 'Углеводы', unit: 'г', color: 'var(--c-carb)' } } as const;

export function judge(key: 'kcal' | 'protein' | 'fat' | 'carbs', val: number, norm: number, live: boolean): Verdict {
  const r = norm ? val / norm : 0, d = Math.abs(val - norm), u = MAC[key].unit, n = key === 'kcal' ? fmt(d) : fmt1(d);
  if (!val) return V('info', live ? 'пока ничего' : 'нет записей');
  if (key === 'kcal') {
    if (r > 1.1) return V('bad', `перебор +${n} ${u}`);
    if (r > 1.03) return V('warn', `чуть больше нормы, +${n}`);
    if (live) return V('info', `осталось ${n} ${u}`);
    if (r < 0.7) return V('low', `мало: −${n} ${u}. Сильный недобор тормозит обмен`);
    return V('good', 'в норме');
  }
  if (key === 'protein') {
    if (r > 1.6) return V('warn', `много: +${n} ${u}`);
    if (r >= 0.9) return V('good', 'норма закрыта');
    if (live) return V('info', `ещё ${n} ${u}`);
    return r >= 0.7 ? V('low', `маловато, −${n} ${u}`) : V('bad', `мало белка, −${n} ${u}`);
  }
  if (key === 'fat') {
    if (r > 1.3) return V('bad', `много жиров, +${n} ${u}`);
    if (r > 1.15) return V('warn', `выше нормы, +${n} ${u}`);
    if (live) return V('info', `осталось ${n} ${u}`);
    return r < 0.6 ? V('low', `мало жиров, −${n} ${u}: нужны для гормонов`) : V('good', 'в норме');
  }
  if (r > 1.3) return V('bad', `много углеводов, +${n} ${u}`);
  if (r > 1.15) return V('warn', `выше нормы, +${n} ${u}`);
  return live ? V('info', `осталось ${n} ${u}`) : V('good', 'в норме');
}
export function judgeNut(k: 'fiber' | 'sugar' | 'salt', v: number, norm: number, live: boolean): Verdict {
  const r = norm ? v / norm : 0, n = fmt1(Math.abs(v - norm));
  if (k === 'fiber') return r >= 1 ? V('good', 'норма есть') : live ? V('info', `ещё ${n} г`) : r >= 0.7 ? V('low', `маловато, −${n} г`) : V('bad', `мало клетчатки, −${n} г`);
  if (r > 1.5) return V('bad', `много, +${n} г`);
  if (r > 1) return V('warn', `выше предела, +${n} г`);
  return V('good', live ? `можно ещё ${n} г` : 'в пределах');
}
export function judgeWater(ml: number, norm: number, live: boolean): Verdict {
  const r = ml / norm;
  if (!ml) return V('info', live ? 'пока ничего' : 'нет записей');
  if (r >= 1) return V('good', 'норма выпита');
  if (live) return V('info', `ещё ${fmt1((norm - ml) / 1000)} л`);
  return r >= 0.75 ? V('low', `чуть меньше, −${fmt(norm - ml)} мл`) : V('bad', `мало воды, −${fmt(norm - ml)} мл`);
}
export const judgeCaf = (mg: number, max: number): Verdict => mg > max ? V('bad', `больше ${max} мг`) : mg > max * 0.75 ? V('warn', 'близко к пределу') : V('good', mg ? 'в пределах' : 'без кофеина');
