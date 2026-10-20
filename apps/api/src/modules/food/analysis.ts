/**
 * Анализ еды (Pro) — как в старом журнале: календарь питания (попадание в норму и белок), клетчатка/сахар/соль,
 * вода и кофеин, баланс БЖУ против AMDR, когда ешь за 7 дней, отчёт за неделю и «чем закрыть норму».
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { addDays, drinkName, drinkTotals } from '@bortjournal/core';
import type { Norms } from '../../core/context.js';
import type { Tx } from '../../db/index.js';
import { drinks, meals, userFoods } from './schema.js';

const CAF_MAX = 400;
export const AMDR = { protein: [10, 35], fat: [20, 35], carbs: [45, 65] } as const;
const SLOTS = [{ key: 'morning', name: 'Утро', hint: 'до 11:00', from: 0, to: 660 }, { key: 'day', name: 'День', hint: '11–16', from: 660, to: 960 }, { key: 'evening', name: 'Вечер', hint: '16–21', from: 960, to: 1260 }, { key: 'late', name: 'Поздно', hint: 'после 21:00', from: 1260, to: 1440 }];
const SUGGEST = [
  { name: 'Творог 5%, 200 г', kcal: 242, protein: 34, fat: 10, carbs: 6 }, { name: 'Куриная грудка, 150 г', kcal: 165, protein: 35, fat: 2.5, carbs: 0 },
  { name: 'Яйца варёные, 2 шт.', kcal: 157, protein: 13, fat: 11, carbs: 1 }, { name: 'Греческий йогурт 2%, 150 г', kcal: 110, protein: 15, fat: 3, carbs: 6 },
  { name: 'Тунец в собственном соку, 120 г', kcal: 125, protein: 28, fat: 1, carbs: 0 }, { name: 'Кефир 1%, 500 мл', kcal: 200, protein: 15, fat: 5, carbs: 20 },
  { name: 'Креветки варёные, 150 г', kcal: 150, protein: 30, fat: 2, carbs: 0 }, { name: 'Сыр 17%, 50 г', kcal: 135, protein: 14, fat: 8.5, carbs: 0 },
  { name: 'Чечевица варёная, 200 г', kcal: 232, protein: 18, fat: 1, carbs: 40 }, { name: 'Овощной салат без масла, 250 г', kcal: 60, protein: 3, fat: 0.5, carbs: 11 }
];
const hm = (t: string | null) => t && /^\d{2}:\d{2}$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : null;
const baseName = (n: string) => n.replace(/,\s*\d[\d\s.,]*\s*(г|мл)\s*$/i, '').trim();
const r1 = (n: number) => Math.round(n * 10) / 10;
/** уровень калорий дня; сегодняшний день не судим — он ещё идёт */
export const kcalLevel = (kcal: number, norm: number) => { const r = norm ? kcal / norm : 0; return !kcal ? 'none' : r > 1.1 ? 'bad' : r > 1.03 ? 'warn' : r < 0.7 ? 'low' : 'good'; };
const proteinOk = (p: number, norm: number) => norm > 0 && p / norm >= 0.9 && p / norm <= 1.6;

async function entries(db: Tx, userId: string, from: string, to: string) {
  const ms = await db.select().from(meals).where(and(eq(meals.userId, userId), gte(meals.day, from), lte(meals.day, to)));
  const ds = (await db.select().from(drinks).where(and(eq(drinks.userId, userId), gte(drinks.day, from), lte(drinks.day, to)))).map(d => ({ ...d, t: drinkTotals(d), name: drinkName(d) }));
  return { ms, ds };
}
type E = Awaited<ReturnType<typeof entries>>;
function dayTotals(e: E, day: string) {
  const ms = e.ms.filter(m => m.day === day), ds = e.ds.filter(d => d.day === day);
  const sum = (f: (m: typeof ms[number]) => number) => ms.reduce((a, m) => a + f(m), 0);
  const nutMeals = ms.filter(m => m.fiber !== null || m.sugar !== null || m.salt !== null);
  return {
    meals: ms.length, kcal: Math.round(sum(m => m.kcal) + ds.reduce((a, d) => a + d.t.kcal, 0)),
    protein: r1(sum(m => m.protein) + ds.reduce((a, d) => a + d.t.p, 0)), fat: r1(sum(m => m.fat) + ds.reduce((a, d) => a + d.t.f, 0)), carbs: r1(sum(m => m.carbs) + ds.reduce((a, d) => a + d.t.c, 0)),
    fiber: r1(sum(m => m.fiber ?? 0)), sugar: r1(sum(m => m.sugar ?? 0) + ds.reduce((a, d) => a + d.t.sugar, 0)), salt: r1(sum(m => m.salt ?? 0)),
    nut: nutMeals.length + ds.filter(d => d.t.kcal > 0).length, entries: ms.length + ds.filter(d => d.t.kcal > 0).length,
    waterMl: Math.round(ds.reduce((a, d) => a + d.t.hyd, 0)), caffeine: Math.round(ds.reduce((a, d) => a + d.t.caf, 0))
  };
}

export async function foodAnalysis(db: Tx, userId: string, ctx: { today: string; norms: Norms; goal: string | null; sex: string | null }, day: string, month?: string) {
  const N = ctx.norms, t = ctx.today, cur = month && /^\d{4}-\d{2}$/.test(month) ? month : day.slice(0, 7);
  const [y, m] = cur.split('-').map(Number) as [number, number], len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthFrom = `${cur}-01`, monthTo = `${cur}-${String(len).padStart(2, '0')}`;
  const from = [monthFrom, addDays(day, -6), addDays(t, -7)].sort()[0]!, to = [monthTo, day, t].sort().at(-1)!;
  const e = await entries(db, userId, from, to);

  // 1. календарь питания
  let good = 0, logged = 0, prot = 0;
  const cells = Array.from({ length: len }, (_, k) => {
    const d = `${cur}-${String(k + 1).padStart(2, '0')}`, x = dayTotals(e, d), live = d === t, fut = d > t;
    const level = x.kcal && !live ? kcalLevel(x.kcal, N.kcal) : 'none', pOk = !!x.kcal && proteinOk(x.protein, N.protein);
    if (x.kcal && !live && !fut) { logged++; if (level === 'good') good++; if (pOk) prot++; }
    return { day: d, kcal: x.kcal, protein: Math.round(x.protein), level, proteinOk: pOk, live, fut };
  });
  const lead = (new Date(`${monthFrom}T12:00:00Z`).getUTCDay() + 6) % 7;

  // 2. выбранный день: нормы питательных веществ, вода, кофеин, доли БЖУ
  const dt = dayTotals(e, day), live = day === t;
  const nn = { fiber: ctx.sex === 'f' ? 25 : 30, sugar: Math.round(N.kcal * 0.1 / 4), salt: 5 };
  const en = { protein: dt.protein * 4, fat: dt.fat * 9, carbs: dt.carbs * 4 }, eSum = en.protein + en.fat + en.carbs;
  const split = eSum ? (Object.keys(en) as Array<keyof typeof en>).map(k => ({ key: k, kcal: Math.round(en[k]), pct: Math.round(en[k] / eSum * 100), range: AMDR[k] })) : null;

  // 3. когда ешь — 7 дней до выбранного
  const acc = SLOTS.map(() => 0), days7 = new Set<string>();
  for (const x of e.ms) if (x.day > addDays(day, -7) && x.day <= day) { const mm = hm(x.time); if (mm === null) continue; const i = SLOTS.findIndex(s => mm >= s.from && mm < s.to); if (i >= 0) { acc[i]! += x.kcal; days7.add(x.day); } }
  const accT = acc.reduce((a, b) => a + b, 0);
  const timing = accT ? { days: days7.size, slots: SLOTS.map((s, i) => ({ key: s.key, name: s.name, hint: s.hint, pct: Math.round(acc[i]! / accT * 100), perDay: Math.round(acc[i]! / days7.size) })), late: acc[3]! / accT } : null;

  // 4. отчёт за неделю: 7 дней до сегодня, без сегодняшнего
  const wd = Array.from({ length: 7 }, (_, k) => addDays(t, -7 + k)).filter(d => e.ms.some(x => x.day === d));
  let report = null;
  if (wd.length >= 2) {
    const rows = wd.map(d => ({ d, x: dayTotals(e, d) })), n = rows.length, avg = (f: (x: typeof rows[number]['x']) => number) => rows.reduce((a, r) => a + f(r.x), 0) / n;
    const aK = avg(x => x.kcal), aP = avg(x => x.protein), ok = rows.filter(r => kcalLevel(r.x.kcal, N.kcal) === 'good').length, okP = rows.filter(r => proteinOk(r.x.protein, N.protein)).length;
    const best = rows.slice().sort((a, b) => Math.abs(a.x.kcal - N.kcal) - Math.abs(b.x.kcal - N.kcal))[0]!, worst = rows.slice().sort((a, b) => b.x.kcal - a.x.kcal)[0]!;
    const src = new Map<string, number>(); let all = 0, late = 0, drinkK = 0;
    for (const x of e.ms) if (wd.includes(x.day)) { const k = baseName(x.name); src.set(k, (src.get(k) ?? 0) + x.kcal); all += x.kcal; const mm = hm(x.time); if (mm !== null && mm >= 1260) late += x.kcal; }
    for (const x of e.ds) if (wd.includes(x.day) && x.t.kcal) { src.set(x.name, (src.get(x.name) ?? 0) + x.t.kcal); all += x.t.kcal; drinkK += x.t.kcal; }
    const top = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, kcal]) => ({ name, pct: all ? Math.round(kcal / all * 100) : 0, kcal: Math.round(kcal) }));
    const notes: string[] = [];
    const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU'), f2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString('ru-RU');
    notes.push(aK > N.kcal * 1.05 ? `В среднем на ${fmt(aK - N.kcal)} ккал в день больше нормы — это ≈${f2((aK - N.kcal) * 7 / 7700)} кг лишнего за неделю.` : aK < N.kcal * 0.8 ? `В среднем сильно меньше нормы (−${fmt(N.kcal - aK)} ккал). Проверь, всё ли записываешь: сильный недобор тормозит обмен.` : 'По калориям в среднем — в норме.');
    if (aP < N.protein * 0.9) notes.push(`Белка в среднем ${fmt(aP)} г из ${N.protein}. Добавь белковый продукт в 1–2 приёма — подсказки в «Чем закрыть норму».`);
    if (top[0] && all && top[0].kcal / all > 0.15) notes.push(`«${top[0].name}» дал ${top[0].pct}% всех калорий недели.`);
    if (all && drinkK / all > 0.1) notes.push(`Напитки — ${Math.round(drinkK / all * 100)}% калорий. Замена на воду или «без сахара» — самый простой резерв.`);
    if (all && late / all > 0.25) notes.push(`После 21:00 съедается ${Math.round(late / all * 100)}% калорий.`);
    const nutRows = rows.filter(r => r.x.nut); if (nutRows.length >= 2) { const fi = nutRows.reduce((a, r) => a + r.x.fiber, 0) / nutRows.length; if (fi < nn.fiber * 0.7) notes.push(`Клетчатки в среднем ${r1(fi).toLocaleString('ru-RU')} г из ${nn.fiber} — больше овощей, круп, бобовых.`); }
    report = { days: n, avgKcal: Math.round(aK), avgProtein: Math.round(aP), ok, okP, top, notes, best: best.d !== worst.d ? { best: { day: best.d, kcal: best.x.kcal }, worst: { day: worst.d, kcal: worst.x.kcal } } : null };
  }

  // 5. чем закрыть норму — только для сегодня
  let gap = null;
  if (day === t && dt.kcal) {
    const remK = N.kcal - dt.kcal, remP = N.protein - dt.protein;
    const mine = (await db.select().from(userFoods).where(eq(userFoods.userId, userId))).filter(f => f.kcal > 30).map(f => ({ name: f.name, kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs, mine: true }));
    const pool = [...new Map([...SUGGEST.map(s => ({ ...s, mine: false })), ...mine].map(x => [baseName(x.name).toLowerCase(), x])).values()];
    type Item = typeof pool[number];
    const sumK = (c: Item[]) => c.reduce((a, x) => a + x.kcal, 0), sumP = (c: Item[]) => c.reduce((a, x) => a + x.protein, 0);
    let opts: Item[][] = [];
    if (remK <= 50) { const lean = pool.filter(x => x.protein >= 10).sort((a, b) => a.kcal / a.protein - b.kcal / b.protein)[0]; if (remP > 10 && lean) opts = [[lean]]; }
    else if (remP > 8) {
      const c = pool.filter(x => x.protein >= 5 && x.kcal <= remK + 60), combos: Item[][] = [];
      for (let a = 0; a < c.length; a++) { combos.push([c[a]!]); for (let b = a + 1; b < c.length; b++) if (c[a]!.kcal + c[b]!.kcal <= remK + 60) combos.push([c[a]!, c[b]!]); }
      const score = (x: Item[]) => Math.min(sumP(x), remP) / remP * 100 - Math.max(0, sumK(x) - remK) / 5 - Math.max(0, sumP(x) - remP * 1.3) * 0.5 - (x.length - 1) * 4 + (x.some(i => i.mine) ? 6 : 0);
      opts = combos.sort((p, q) => score(q) - score(p)).filter((x, i, arr) => arr.findIndex(o => o[0]!.name === x[0]!.name) === i).slice(0, 3);
    } else opts = pool.filter(x => x.kcal <= remK && x.kcal >= Math.min(remK * 0.4, 150)).sort((a, b) => Number(b.mine) - Number(a.mine) || b.kcal - a.kcal).slice(0, 3).map(x => [x]);
    gap = { remKcal: Math.round(remK), remProtein: Math.round(remP), options: opts.map(c => ({ items: c.map(({ mine: _m, ...x }) => x), kcal: Math.round(sumK(c)), protein: r1(sumP(c)), mine: c.some(x => x.mine) })) };
  }

  return {
    day, today: t, live, norms: N, nutNorms: nn, cafMax: CAF_MAX,
    calendar: { month: cur, lead, cells, good, logged, protein: prot, isCurrent: cur >= t.slice(0, 7) },
    totals: dt, split, timing, report, gap, goal: ctx.goal
  };
}
