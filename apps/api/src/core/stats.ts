/**
 * Статистика, итог недели и достижения (Pro). Всё считается из фактов по дням, которые отдают модули (AppModule.daily),
 * по правилам старого журнала: оценка дня — из того, что человек реально ведёт (направление считается, если за 30 дней
 * в нём были записи); зал и чтение — бонус. Достижения — 4 ступени; открытые ступени сохраняются с датой.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, parseDay } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { topMeals } from '../modules/food/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { requirePro } from './billing.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import type { DayFacts, Totals } from './module.js';
import { achievements, dayJournal } from './schema.js';
import { userContext, type Norms } from './context.js';

type F = DayFacts & { day: string };
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const days = (n: number, end: string) => Array.from({ length: n }, (_, k) => addDays(end, k - n + 1));
const pct = (v: number) => Math.round(v * 100);
const wdIdx = (d: string) => (parseDay(d).getUTCDay() + 6) % 7;

/* ---------- факты ---------- */
async function collect(db: Tx, userId: string, from: string, to: string) {
  const map = new Map<string, F>();
  for (const m of MODULES_LIST) if (m.daily) for (const r of await m.daily(db, userId, from, to)) {
    const cur = map.get(r.day) ?? { day: r.day };
    for (const [k, v] of Object.entries(r)) if (k !== 'day' && v !== undefined && v !== null) (cur as any)[k] = typeof v === 'number' ? ((cur as any)[k] ?? 0) + v : v;
    map.set(r.day, cur);
  }
  return map;
}
async function totals(db: Tx, userId: string) {
  const t: Totals = {};
  for (const m of MODULES_LIST) if (m.totals) Object.assign(t, await m.totals(db, userId));
  return t;
}
const context = userContext;

/* ---------- оценка дня ---------- */
const hasAny = (f?: F) => !!f && !!((f.meals ?? 0) || (f.studyMin ?? 0) || (f.workouts ?? 0) || (f.steps ?? 0));
type Areas = Record<'food' | 'water' | 'steps' | 'study' | 'tasks' | 'quiz', boolean>;
function tracked(F: Map<string, F>, today: string): Areas {
  const ds = days(30, today).map(d => F.get(d)).filter(Boolean) as F[], has = (f: (x: F) => boolean) => ds.some(f);
  return { food: has(x => (x.meals ?? 0) > 0), water: has(x => (x.waterMl ?? 0) > 0), steps: has(x => (x.steps ?? 0) > 0), study: has(x => (x.studyMin ?? 0) > 0), tasks: has(x => (x.tasks ?? 0) > 0), quiz: has(x => (x.quizAnswered ?? 0) > 0) };
}
export const AREA_NAMES: Record<string, string> = { food: 'еда в норме', protein: 'белок', water: 'вода', steps: 'шаги', study: 'учёба', tasks: 'задачи', quiz: 'вопросы', gym: 'зал', read: 'чтение' };
function parts(f: F | undefined, A: Areas, N: Norms): Array<[string, number]> {
  const out: Array<[string, number]> = [], kcal = f?.kcal ?? 0, meals = f?.meals ?? 0;
  if (A.food) {
    out.push(['food', meals ? Math.max(0, 1 - Math.max(0, Math.abs(kcal / N.kcal - 1) - 0.1) * 3) : 0]);
    if (N.protein) out.push(['protein', meals ? Math.min(1, (f?.protein ?? 0) / (N.protein * 0.9)) : 0]);
  }
  if (A.water) out.push(['water', Math.min(1, (f?.waterMl ?? 0) / N.water)]);
  if (A.steps) out.push(['steps', Math.min(1, (f?.steps ?? 0) / N.steps)]);
  if (A.study) out.push(['study', Math.min(1, (f?.studyMin ?? 0) / N.study)]);
  if (A.tasks && f?.tasks) out.push(['tasks', (f.tasksDone ?? 0) / f.tasks]);
  if (A.quiz && f?.quizTotal) out.push(['quiz', (f.quizAnswered ?? 0) / f.quizTotal]);
  return out;
}
function score(f: F | undefined, A: Areas, N: Norms) {
  const ps = parts(f, A, N), bonus = ((f?.workouts ?? 0) ? 0.1 : 0) + ((f?.pages ?? 0) ? 0.1 : 0);
  if (!ps.length) return bonus ? Math.min(1, bonus * 3) : 0;
  return Math.min(1, ps.reduce((a, [, v]) => a + v, 0) / ps.length + bonus);
}
/** калории дня — как в старом журнале: в норме, если от 70% до 103% */
const kcalLevel = (kcal: number, norm: number) => { const r = norm ? kcal / norm : 0; return !kcal ? 'none' : r > 1.1 ? 'bad' : r > 1.03 ? 'warn' : r < 0.7 ? 'low' : 'good'; };

async function world(db: Tx, userId: string) {
  const c = await context(db, userId);
  const F = await collect(db, userId, addDays(c.today, -1095), c.today);
  const first = [...F.keys()].filter(d => hasAny(F.get(d)) || F.get(d)?.waterMl || F.get(d)?.pages).sort()[0] ?? c.today;
  const A = tracked(F, c.today), sc = (d: string) => score(F.get(d), A, c.norms);
  const hist: string[] = []; for (let d = first; d <= c.today; d = addDays(d, 1)) hist.push(d);
  return { ...c, F, A, sc, first, hist };
}
type World = Awaited<ReturnType<typeof world>>;
function streaks(w: World) {
  let best = 0, cur = 0; for (const d of w.hist) { if (hasAny(w.F.get(d))) { cur++; best = Math.max(best, cur); } else cur = 0; }
  let d = hasAny(w.F.get(w.today)) ? w.today : addDays(w.today, -1), now = 0;
  while (hasAny(w.F.get(d)) && now < 3650) { now++; d = addDays(d, -1); }
  return { now, best };
}

/* ---------- достижения ---------- */
export const TIERS = ['Бронза', 'Серебро', 'Золото', 'Легенда'];
interface Ach { k: string; n: string; u: string; ic: string; c: string; t: number[]; v: (w: World, T: Totals, notes: number) => number; hide?: (w: World) => boolean }
const sumF = (w: World, f: (x: F) => number) => [...w.F.values()].reduce((a, x) => a + f(x), 0);
const countF = (w: World, f: (x: F) => boolean, past = false) => [...w.F.values()].filter(x => (!past || x.day < w.today) && f(x)).length;
const ACH: Ach[] = [
  { k: 'streak', n: 'Не сдаваться', u: 'дней подряд с записями', ic: 'flame', c: 'orange', t: [3, 7, 30, 100], v: w => streaks(w).best },
  { k: 'perfect', n: 'Идеальный день', u: 'дней с оценкой 95%+', ic: 'star', c: 'mustard', t: [1, 7, 30, 100], v: w => w.hist.filter(d => d < w.today && w.sc(d) >= 0.95).length },
  { k: 'food', n: 'Дневник еды', u: 'дней с записанной едой', ic: 'food', c: 'food', t: [7, 30, 100, 365], v: w => countF(w, x => (x.meals ?? 0) > 0) },
  { k: 'norm', n: 'В яблочко', u: 'дней в норме калорий', ic: 'target', c: 'food', t: [5, 20, 60, 150], v: w => countF(w, x => (x.meals ?? 0) > 0 && kcalLevel(x.kcal ?? 0, w.norms.kcal) === 'good', true) },
  { k: 'protein', n: 'Белковый', u: 'дней с закрытым белком', ic: 'check', c: 'food', t: [5, 20, 60, 150], v: w => w.norms.protein ? countF(w, x => (x.protein ?? 0) >= w.norms.protein * 0.9, true) : 0 },
  { k: 'water', n: 'Водный баланс', u: 'дней с нормой воды', ic: 'drop', c: 'water', t: [7, 30, 100, 250], v: w => countF(w, x => (x.waterMl ?? 0) >= w.norms.water) },
  { k: 'steps', n: 'Ходок', u: 'дней с целью по шагам', ic: 'steps', c: 'steps', t: [1, 10, 50, 150], v: w => countF(w, x => (x.steps ?? 0) >= w.norms.steps) },
  { k: 'stepsTot', n: 'Марафонец', u: 'шагов всего', ic: 'steps', c: 'steps', t: [100000, 1000000, 3000000, 10000000], v: w => sumF(w, x => x.steps ?? 0) },
  { k: 'study', n: 'Учёный', u: 'часов учёбы', ic: 'study', c: 'study', t: [5, 25, 100, 300], v: w => Math.floor(sumF(w, x => x.studyMin ?? 0) / 60) },
  { k: 'quiz', n: 'Память', u: 'верных ответов', ic: 'quiz', c: 'quiz', t: [10, 100, 500, 2000], v: w => sumF(w, x => x.quizGood ?? 0) },
  { k: 'gym', n: 'Железо', u: 'тренировок', ic: 'gym', c: 'gym', t: [1, 10, 50, 150], v: w => sumF(w, x => x.workouts ?? 0) },
  { k: 'tasks', n: 'Делаю', u: 'задач выполнено', ic: 'plans', c: 'navy', t: [10, 50, 200, 1000], v: (_w, T) => T.tasksDone ?? 0 },
  { k: 'books', n: 'Книжный червь', u: 'книг прочитано', ic: 'books', c: 'books', t: [1, 5, 12, 50], v: (_w, T) => T.booksDone ?? 0 },
  { k: 'pages', n: 'Страница за страницей', u: 'страниц прочитано', ic: 'books', c: 'books', t: [300, 2000, 10000, 30000], v: (_w, T) => T.pagesTotal ?? 0 },
  { k: 'shelf', n: 'Библиотека', u: 'книг в коллекции', ic: 'books', c: 'books', t: [5, 25, 100, 300], v: (_w, T) => T.booksOwned ?? 0 },
  { k: 'quotes', n: 'Собиратель цитат', u: 'цитат сохранено', ic: 'star', c: 'books', t: [3, 15, 50, 150], v: (_w, T) => T.quotes ?? 0 },
  { k: 'budget', n: 'Финансист', u: 'дней в рамках бюджета', ic: 'money', c: 'money', t: [7, 30, 90, 250], v: w => countF(w, x => x.budgetOk === true, true) },
  { k: 'notes', n: 'Летописец', u: 'дней с заметкой', ic: 'edit', c: 'navy', t: [7, 30, 100, 365], v: (_w, _T, notes) => notes },
  { k: 'weight', n: 'Минус', u: 'кг сброшено', ic: 'target', c: 'gym', t: [1, 5, 10, 20], hide: w => w.goal !== 'lose',
    v: w => { const ws = [...w.F.values()].filter(x => x.weightKg).sort((a, b) => a.day.localeCompare(b.day)); return ws.length > 1 ? Math.max(0, Math.floor(Math.max(...ws.map(x => x.weightKg!)) - ws.at(-1)!.weightKg!)) : 0; } }
];

/** состояние достижений; новые ступени сохраняются с сегодняшней датой и возвращаются в fresh */
export async function awardsState(db: Tx, userId: string, w?: World) {
  w ??= await world(db, userId);
  const T = await totals(db, userId);
  const notes = (await db.select({ note: dayJournal.note }).from(dayJournal).where(eq(dayJournal.userId, userId))).filter(n => String(n.note ?? '').trim().length > 10).length;
  const list = ACH.filter(a => !a.hide?.(w!)).map(a => {
    const val = a.v(w!, T, notes), tier = a.t.filter(t => val >= t).length, prev = tier ? a.t[tier - 1]! : 0, next = a.t[tier] ?? null;
    return { key: a.k, name: a.n, unit: a.u, icon: a.ic, color: a.c, thresholds: a.t, value: val, tier, next, progress: next ? (val - prev) / (next - prev) : 1 };
  });
  const got = await db.select().from(achievements).where(eq(achievements.userId, userId));
  const have = new Set(got.map(g => `${g.key}:${g.tier}`)), fresh: Array<{ key: string; name: string; tier: number }> = [];
  for (const x of list) for (let t = 0; t < x.tier; t++) if (!have.has(`${x.key}:${t}`)) fresh.push({ key: x.key, name: x.name, tier: t });
  if (fresh.length) await db.insert(achievements).values(fresh.map(f => ({ userId, key: f.key, tier: f.tier, unlockedOn: w!.today }))).onConflictDoNothing();
  const unlocked = [...got.map(g => ({ key: g.key, tier: g.tier, day: g.unlockedOn })), ...fresh.map(f => ({ key: f.key, tier: f.tier, day: w!.today }))];
  return { list, unlocked, fresh, total: list.reduce((a, x) => a + x.tier, 0), max: list.length * 4 };
}

/* ---------- обзор ---------- */
const MN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function calendar(w: World, month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number], len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [], scores: Array<[string, number]> = [];
  for (let k = 1; k <= len; k++) {
    const d = `${month}-${String(k).padStart(2, '0')}`, fut = d > w.today, f = w.F.get(d), s = fut ? null : w.sc(d);
    if (!fut && d < w.today && hasAny(f)) scores.push([d, s!]);
    cells.push({ day: d, score: s === null ? null : pct(s), parts: fut ? [] : parts(f, w.A, w.norms).map(([a, v]) => ({ area: a, name: AREA_NAMES[a], v: pct(v) })), gym: !!f?.workouts, pages: f?.pages ?? 0 });
  }
  const pm = new Date(Date.UTC(y, m - 2, 1)), pk = `${pm.getUTCFullYear()}-${String(pm.getUTCMonth() + 1).padStart(2, '0')}`, plen = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).getUTCDate();
  const prev: number[] = []; for (let k = 1; k <= plen; k++) { const d = `${pk}-${String(k).padStart(2, '0')}`; if (d < w.today && hasAny(w.F.get(d))) prev.push(w.sc(d)); }
  const a = avg(scores.map(x => x[1])), pa = avg(prev), best = scores.slice().sort((p, q) => q[1] - p[1])[0] ?? null;
  const line = !scores.length ? 'В этом месяце пока нет завершённых дней — всё впереди.'
    : a >= 0.8 ? 'Сильный месяц. Так держать.' : pa && a > pa + 0.03 ? `Лучше, чем в прошлом месяце, на ${pct(a - pa)} п.` : pa && a < pa - 0.03 ? `Чуть ниже прошлого месяца — ${pct(pa)}% против ${pct(a)}%. Есть куда расти.` : 'Ровный месяц. Один сильный день — и среднее поползёт вверх.';
  return { month, title: `${MN[m - 1]![0]!.toUpperCase()}${MN[m - 1]!.slice(1)} ${y}`, name: MN[m - 1], lead: wdIdx(`${month}-01`), cells, avg: scores.length ? pct(a) : null, prevAvg: prev.length ? pct(pa) : null,
    best: best ? { day: best[0], score: pct(best[1]) } : null, perfect: scores.filter(x => x[1] >= 0.95).length, days: scores.length, line, isCurrent: month >= w.today.slice(0, 7) };
}
async function overview(db: Tx, userId: string, month?: string) {
  const w = await world(db, userId), t = w.today, st = streaks(w);
  const past = w.hist.filter(d => d < t && hasAny(w.F.get(d)));
  const yearDays = w.hist.filter(d => d >= addDays(t, -364) && d < t);
  const wd = [0, 1, 2, 3, 4, 5, 6].map(k => pct(avg(past.filter(d => wdIdx(d) === k).slice(-12).map(w.sc))));
  const rec = (f: (d: string) => number, list = w.hist) => list.reduce((b, d) => { const v = f(d); return v > b.v ? { day: d, v } : b; }, { day: null as string | null, v: 0 });
  const rScore = rec(w.sc, past), rSteps = rec(d => w.F.get(d)?.steps ?? 0), rStudy = rec(d => w.F.get(d)?.studyMin ?? 0), rRead = rec(d => w.F.get(d)?.pages ?? 0);
  const gymDays = w.hist.filter(d => w.F.get(d)?.workouts), workouts = gymDays.reduce((a, d) => a + (w.F.get(d)!.workouts ?? 0), 0);
  const sAvg = (ds: string[]) => avg(ds.filter(d => hasAny(w.F.get(d))).map(w.sc));
  const aw = await awardsState(db, userId, w);
  // год клетками: 53 недели, начиная с понедельника
  const yStart = addDays(t, -wdIdx(t) - 7 * 52);
  const year = []; for (let d = yStart; d <= t; d = addDays(d, 1)) { const f = w.F.get(d), any = hasAny(f) || !!f?.waterMl || !!f?.pages; year.push({ day: d, score: any ? pct(w.sc(d)) : 0 }); }
  return {
    today: t, enough: w.hist.filter(d => hasAny(w.F.get(d))).length >= 2,
    score: { now: pct(w.sc(t)), parts: parts(w.F.get(t), w.A, w.norms).map(([a, v]) => ({ area: a, name: AREA_NAMES[a], v: pct(v) })), avg7: pct(avg(days(7, addDays(t, -1)).map(w.sc))) },
    nums: { active365: yearDays.filter(d => hasAny(w.F.get(d))).length, perfect365: yearDays.filter(d => w.sc(d) >= 0.95).length, streak: st.now, bestStreak: st.best, tiers: aw.total },
    calendar: calendar(w, month && /^\d{4}-\d{2}$/.test(month) && month <= t.slice(0, 7) ? month : t.slice(0, 7)),
    last30: pct(sAvg(days(30, addDays(t, -1)))), prev30: pct(sAvg(days(30, addDays(t, -31)))),
    year, weekdays: past.length >= 7 ? wd : null,
    records: [
      { name: 'Лучшая серия', value: `${st.best}`, unit: 'дн.', sub: `сейчас ${st.now}`, icon: 'flame' },
      rScore.day && { name: 'Лучший день', value: `${pct(rScore.v)}%`, sub: rScore.day, icon: 'star' },
      rSteps.v && { name: 'Больше всего шагов', value: String(rSteps.v), sub: rSteps.day, icon: 'steps' },
      rStudy.v && { name: 'Дольше всего учился', value: `${rStudy.v}`, unit: 'мин', sub: rStudy.day, icon: 'study' },
      rRead.v && { name: 'Больше всего прочитал', value: `${rRead.v}`, unit: 'стр.', sub: rRead.day, icon: 'books' },
      workouts && { name: 'Тренировок всего', value: String(workouts), sub: gymDays[0] ? `с ${gymDays[0]}` : '', icon: 'gym' }
    ].filter(Boolean),
    fresh: aw.fresh
  };
}

/* ---------- еда и тело за период ---------- */
async function foodStats(db: Tx, userId: string, n: number) {
  const w = await world(db, userId), t = w.today, ds = days(n, t), N = w.norms;
  const rows = ds.map(d => { const f = w.F.get(d); return { day: d, kcal: f?.kcal ?? 0, protein: Math.round(f?.protein ?? 0), fat: f?.fat ?? 0, carbs: f?.carbs ?? 0, waterMl: f?.waterMl ?? 0, meals: f?.meals ?? 0, level: f?.meals ? kcalLevel(f.kcal ?? 0, N.kcal) : 'none' }; });
  const logged = rows.filter(r => r.meals && r.day < t), prev = days(n, addDays(ds[0]!, -1)).map(d => w.F.get(d)).filter(f => f?.meals) as F[];
  const mk = logged.reduce((a, r) => ({ p: a.p + r.protein * 4, f: a.f + r.fat * 9, c: a.c + r.carbs * 4 }), { p: 0, f: 0, c: 0 }), mt = mk.p + mk.f + mk.c;
  const water = rows.filter(r => r.waterMl);
  const top = await topMeals(db, userId, ds[0]!, t);
  return {
    days: n, norms: N, rows,
    avgKcal: Math.round(avg(logged.map(r => r.kcal))), prevKcal: Math.round(avg(prev.map(f => f.kcal ?? 0))),
    avgProtein: Math.round(avg(logged.map(r => r.protein))), prevProtein: Math.round(avg(prev.map(f => f.protein ?? 0))),
    logged: logged.length, inNorm: logged.filter(r => r.level === 'good').length, over: logged.filter(r => r.level === 'bad').length,
    waterAvg: Math.round(avg(water.map(r => r.waterMl))), waterDays: rows.filter(r => r.waterMl >= N.water).length,
    macro: mt ? { protein: pct(mk.p / mt), fat: pct(mk.f / mt), carbs: pct(mk.c / mt) } : null, top
  };
}
async function bodyStats(db: Tx, userId: string, n: number) {
  const w = await world(db, userId), t = w.today, ds = days(n, t), goal = w.norms.steps;
  const steps = ds.map(d => ({ day: d, steps: w.F.get(d)?.steps ?? 0 })), sd = steps.filter(s => s.steps);
  const prev = days(n, addDays(ds[0]!, -1)).map(d => w.F.get(d)?.steps ?? 0).filter(Boolean);
  const wdAvg = [0, 1, 2, 3, 4, 5, 6].map(k => Math.round(avg(sd.filter(s => wdIdx(s.day) === k).map(s => s.steps))));
  const weights = ds.map(d => ({ day: d, kg: w.F.get(d)?.weightKg })).filter(x => x.kg) as Array<{ day: string; kg: number }>;
  return {
    days: n, goal, steps, avg: Math.round(avg(sd.map(s => s.steps))), prevAvg: Math.round(avg(prev)), hit: sd.filter(s => s.steps >= goal).length, logged: sd.length,
    total: sd.reduce((a, s) => a + s.steps, 0), best: sd.reduce((b, s) => s.steps > b.steps ? s : b, { day: '', steps: 0 }), weekdays: wdAvg,
    weights, change: weights.length > 1 ? Math.round((weights.at(-1)!.kg - weights[0]!.kg) * 10) / 10 : null
  };
}

/* ---------- итог недели ---------- */
const hoursStr = (m: number) => (Math.round(m / 6) / 10).toLocaleString('ru-RU');
const fmtN = (n: number) => Math.round(n).toLocaleString('ru-RU');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const plural = (n: number, a: string, b: string, c: string) => { n = Math.abs(n) % 100; const n1 = n % 10; return n > 10 && n < 20 ? c : n1 > 1 && n1 < 5 ? b : n1 === 1 ? a : c; };
function weekStats(w: World, mon: string, T: Totals, unlocked: Array<{ key: string; tier: number; day: string }>) {
  const all = days(7, addDays(mon, 6)), ds = all.filter(d => d <= w.today), N = w.norms, f = (d: string) => w.F.get(d);
  const logged = ds.filter(d => hasAny(f(d))), food = ds.filter(d => f(d)?.meals);
  const steps = ds.map(d => f(d)?.steps ?? 0), sd = steps.filter(Boolean);
  const ws = days(10, addDays(mon, 6)).map(d => f(d)?.weightKg).filter(Boolean) as number[];
  return {
    n: ds.length, logged: logged.length, score: avg(logged.map(w.sc)), scores: all.map(d => d <= w.today ? pct(w.sc(d)) : null),
    foodDays: food.length, inNorm: food.filter(d => kcalLevel(f(d)!.kcal ?? 0, N.kcal) === 'good').length,
    protein: food.filter(d => N.protein && (f(d)!.protein ?? 0) >= N.protein * 0.9).length,
    water: ds.filter(d => (f(d)?.waterMl ?? 0) >= N.water).length, waterAvg: avg(ds.map(d => f(d)?.waterMl ?? 0).filter(Boolean)),
    stepsAvg: avg(sd), stepsTot: steps.reduce((a, b) => a + b, 0),
    gym: ds.reduce((a, d) => a + (f(d)?.workouts ?? 0), 0), study: ds.reduce((a, d) => a + (f(d)?.studyMin ?? 0), 0),
    tasksAll: ds.reduce((a, d) => a + (f(d)?.tasks ?? 0), 0), tasksDone: ds.reduce((a, d) => a + (f(d)?.tasksDone ?? 0), 0),
    pages: ds.reduce((a, d) => a + (f(d)?.pages ?? 0), 0), booksDone: (T.booksDoneInRange ?? []).filter(b => b.day >= mon && b.day <= addDays(mon, 6)).map(b => b.title),
    weight: ws.length > 1 ? ws.at(-1)! - ws[0]! : null,
    ach: unlocked.filter(u => u.day >= mon && u.day <= addDays(mon, 6)).map(u => `${ACH.find(a => a.k === u.key)?.n ?? u.key} · ${TIERS[u.tier]}`)
  };
}
async function review(db: Tx, userId: string, monArg?: string) {
  const w = await world(db, userId), t = w.today, thisMon = addDays(t, -wdIdx(t));
  // по умолчанию — прошлая неделя; в воскресенье — текущая
  const mon = monArg && /^\d{4}-\d{2}-\d{2}$/.test(monArg) && monArg <= thisMon ? addDays(monArg, -wdIdx(monArg)) : wdIdx(t) === 6 ? thisMon : addDays(thisMon, -7);
  const T = await totals(db, userId), aw = await awardsState(db, userId, w);
  const W = weekStats(w, mon, T, aw.unlocked), P = weekStats(w, addDays(mon, -7), T, aw.unlocked), N = w.norms, A = w.A;
  const wins: string[] = [], misses: string[] = [], focus: string[] = [];
  const add = (ok: boolean | null, win: string, miss: string, tip?: string) => { if (ok === true) wins.push(win); else if (ok === false) { misses.push(miss); if (tip) focus.push(tip); } };
  const goalStudy = N.study * 7;
  if (A.food || W.foodDays) add(W.inNorm >= Math.ceil(W.n * 0.6) ? true : W.foodDays ? false : null, `Калории в норме ${W.inNorm} из ${W.n} дней`, `Калории в норме только ${W.inNorm} из ${W.n} дней${W.foodDays < W.n ? ` (записано ${W.foodDays})` : ''}`, W.foodDays < W.n - 1 ? 'Записывать еду каждый день — хотя бы фото или пару слов' : 'Держать калории в коридоре: план ужина заранее помогает больше всего');
  if (W.foodDays && N.protein) add(W.protein >= Math.ceil(W.n * 0.6), `Белок закрыт ${W.protein} из ${W.n} дней`, `Белка не хватало: закрыт ${W.protein} из ${W.n} дней`, 'Белок в каждый приём: творог, яйца, курица — так проще добрать норму');
  if (A.water || W.waterAvg) add(W.water >= Math.ceil(W.n * 0.6), `Норма воды ${W.water} из ${W.n} дней`, `Воды мало: норма закрыта ${W.water} из ${W.n} дней, в среднем ${fmt1(W.waterAvg / 1000)} л`, 'Стакан воды к каждому приёму пищи — и норма набирается сама');
  if (A.steps || W.stepsAvg) add(W.stepsAvg >= N.steps * 0.9, `${fmtN(W.stepsAvg)} шагов в день — цель держится`, `Шагов в среднем ${fmtN(W.stepsAvg)} при цели ${fmtN(N.steps)}`, 'Добавить прогулку 20 минут — это ≈ +2 500 шагов');
  if (W.gym || P.gym) add(W.gym >= Math.max(1, P.gym), `${W.gym} ${plural(W.gym, 'тренировка', 'тренировки', 'тренировок')}`, `Тренировок меньше, чем неделей раньше: ${W.gym} против ${P.gym}`, 'Поставить тренировки в план «Зала» — придёт напоминание в нужный день');
  if (A.study || W.study) add(W.study >= goalStudy * 0.7, `Учёба: ${hoursStr(W.study)} ч`, `Учёбы ${hoursStr(W.study)} ч при цели ${hoursStr(goalStudy)} ч`, 'Короткие занятия по 20–30 минут каждый день вместо одного длинного');
  if (W.tasksAll) add(W.tasksDone / W.tasksAll >= 0.7, `Задачи: сделано ${W.tasksDone} из ${W.tasksAll}`, `Задачи: сделано только ${W.tasksDone} из ${W.tasksAll}`, 'Не больше трёх главных задач на день — остальное в «без даты»');
  if (W.pages || W.booksDone.length) wins.push(`Прочитано ${W.pages} стр.${W.booksDone.length ? `, дочитано: ${W.booksDone.map(b => `«${b}»`).join(', ')}` : ''}`);
  if (W.weight !== null && w.goal) {
    const dir = w.goal === 'lose' ? -1 : w.goal === 'gain' ? 1 : 0, good = dir ? W.weight * dir > 0.05 : Math.abs(W.weight) < 0.5, s = `${W.weight > 0 ? '+' : W.weight < 0 ? '−' : ''}${fmt1(Math.abs(W.weight))}`;
    add(good, `Вес ${s} кг за неделю — в нужную сторону`, `Вес ${s} кг за неделю`, dir < 0 ? 'Проверить, всё ли записывается: соусы, напитки и перекусы часто теряются' : undefined);
  }
  if (W.ach.length) wins.push(`Новые достижения: ${W.ach.slice(0, 3).join(', ')}${W.ach.length > 3 ? ` и ещё ${W.ach.length - 3}` : ''}`);
  const bestK = W.scores.map((s, k) => [s, k] as const).filter(([s, k]) => s !== null && hasAny(w.F.get(addDays(mon, k)))).sort((a, b) => b[0]! - a[0]!)[0];
  const d = W.score - P.score;
  const motto = !W.logged ? 'На этой неделе записей не было — следующая начнётся с чистого листа.' : W.score >= 0.8 ? 'Сильная неделя. Так держать.' : d > 0.05 ? `Лучше прошлой недели на ${pct(d)} п. Растёшь.` : d < -0.05 ? 'Чуть слабее прошлой недели. Возьми одну вещь из фокуса — и вернёшься.' : 'Ровная неделя. Одна маленькая привычка — и станет лучше.';
  return {
    mon, sun: addDays(mon, 6), isThis: mon === thisMon, canNext: mon < thisMon,
    score: pct(W.score), prevScore: P.logged ? pct(P.score) : null, scores: W.scores, motto,
    best: bestK && bestK[0]! > 0 ? { k: bestK[1], score: bestK[0], parts: parts(w.F.get(addDays(mon, bestK[1])), w.A, N).filter(p => p[1] >= 0.99).map(p => AREA_NAMES[p[0]]) } : null,
    kpis: [
      { name: 'Дней с записями', value: W.logged, of: W.n, prev: P.logged },
      { name: 'Тренировок', value: W.gym, prev: P.gym },
      { name: 'Учёба, ч', value: Math.round(W.study / 6) / 10, prev: Math.round(P.study / 6) / 10 },
      { name: 'Шагов', value: W.stepsTot, prev: P.stepsTot }
    ], prevLogged: P.logged, wins, misses, focus: focus.slice(0, 2)
  };
}

export async function statsRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const pre = [requireUser, requirePro(db)];
  const n = (v: unknown) => { const x = Number(v ?? 30); if (![7, 30, 90, 365].includes(x)) throw bad('Период: 7, 30, 90 или 365 дней.'); return x; };
  app.get('/api/stats/overview', { preHandler: pre }, async req => overview(db, req.userId!, (req.query as any).month));
  app.get('/api/stats/food', { preHandler: pre }, async req => foodStats(db, req.userId!, n((req.query as any).days)));
  app.get('/api/stats/body', { preHandler: pre }, async req => bodyStats(db, req.userId!, n((req.query as any).days)));
  app.get('/api/stats/week', { preHandler: pre }, async req => review(db, req.userId!, (req.query as any).mon));
  app.get('/api/awards', { preHandler: pre }, async req => {
    const s = await awardsState(db, req.userId!);
    const near = s.list.filter(x => x.next).sort((a, b) => b.progress - a.progress).slice(0, 3);
    const recent = s.unlocked.slice().sort((a, b) => b.day.localeCompare(a.day) || b.tier - a.tier).slice(0, 6).map(u => ({ ...u, name: ACH.find(a => a.k === u.key)?.n ?? u.key }));
    return { ...s, near, recent, level: Math.floor(s.total / 4) + 1, tiers: TIERS };
  });
  // после записи: открылось ли что-то новое — для поздравления
  app.post('/api/awards/check', { preHandler: pre }, async req => ({ fresh: (await awardsState(db, req.userId!)).fresh.map(f => ({ ...f, tierName: TIERS[f.tier] })) }));
}
