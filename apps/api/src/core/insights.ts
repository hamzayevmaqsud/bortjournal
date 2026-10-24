/**
 * Совет дня и итог недели. Совет — правила без случайностей: из фактов дня (AppModule.daily, как в статистике)
 * собираются кандидаты с весом, главный — самый полезный, ещё до двух — в запас. Учитываются только разделы,
 * которые человек ведёт (settings.sections) и которые открыты тарифом; советы про цели из анкеты (settings.goals) — выше. Если есть ключ Gemini, согласие на ИИ
 * и лимит — главный совет переписывается одной дружелюбной фразой; любой сбой — остаётся текст правила.
 * Итог недели — тот же, что в статистике (review), плюс цифры по включённым разделам.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, aimsOf, diffDays, hasFeature, isDay, localNow, nWord, ordinal, parseDay, plural } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { takeAi } from './ai-quota.js';
import { requireUser } from './auth.js';
import { subscription } from './billing.js';
import { userContext, type Norms } from './context.js';
import { aiEnabled, gemini } from './gemini.js';
import { bad } from './http.js';
import type { DayFacts } from './module.js';
import { SECTION_KEYS } from './profile.js';
import { profiles, users } from './schema.js';
import { collect, hasAny, review, score, tracked } from './stats.js';

export type Area = (typeof SECTION_KEYS)[number];
export type TipAction = 'meal' | 'water' | 'steps' | 'plans' | 'gym' | 'study' | 'quiz';
export interface Tip { key: string; text: string; tone: 'nudge' | 'good'; action?: TipAction; weight: number }
export interface TipInput {
  /** местный день и минуты от полуночи */
  day: string; minutes: number;
  /** разделы, которые человек ведёт и которые ему открыты */
  on: ReadonlySet<Area>;
  norms: Norms;
  today: DayFacts;
  /** дни до сегодняшнего (до месяца назад) */
  past: Array<DayFacts & { day: string }>;
  /** оценка дня 0…1, идеальных дней в этом месяце до сегодня, серия до вчера включительно */
  score: number; perfectMonth: number; streak: number;
  /** цели из анкеты (settings.goals): советы про них поднимаются выше */
  goals?: ReadonlySet<string>;
}

const fmtN = (n: number) => Math.round(n).toLocaleString('ru-RU');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const EVENING = 17 * 60;
/** к каким целям анкеты относится совет; совпало — вес совета +GOAL_BOOST */
const TIP_GOALS: Record<string, readonly string[]> = {
  'food-empty': ['weight', 'muscle'], 'kcal-over': ['weight'], 'kcal-low': ['weight', 'muscle'], protein: ['muscle', 'weight'],
  water: ['water', 'weight'], steps: ['move', 'weight'], gym: ['muscle', 'move'], tasks: ['plans', 'routine'], quiz: ['study'], study: ['study']
};
export const GOAL_BOOST = 15;

/** все подходящие советы, самый полезный первым */
export function rankTips(x: TipInput): Tip[] {
  const out: Tip[] = [], on = (a: Area) => x.on.has(a), t = x.today, N = x.norms;
  const add = (key: string, weight: number, text: string, action?: TipAction, tone: Tip['tone'] = 'nudge') => out.push({ key, text, tone, action, weight });
  const meals = t.meals ?? 0, kcal = t.kcal ?? 0, prot = Math.round(t.protein ?? 0), water = t.waterMl ?? 0, steps = t.steps ?? 0;

  // пустой день при живой серии — главное, что можно сделать сегодня
  if (!hasAny({ day: x.day, ...t }) && x.streak >= 2) add('empty', 80, `Сегодня пока пусто — запиши хоть что-нибудь, и серия станет ${nWord(x.streak + 1, 'день', 'дня', 'дней')}`, on('food') ? 'meal' : undefined);
  if (on('food')) {
    if (!meals) { if (x.minutes >= EVENING) add('food-empty', 68, 'Еды сегодня не записано — запиши хотя бы ужин, чтобы день засчитался', 'meal'); }
    else {
      if (kcal > N.kcal * 1.1) add('kcal-over', 55, `Калорий уже ${fmtN(kcal)} из ${fmtN(N.kcal)} — на вечер лучше лёгкое: овощи, кефир, чай`);
      else if (kcal < N.kcal * 0.6 && x.minutes >= 19 * 60) add('kcal-low', 35, `Сегодня всего ${fmtN(kcal)} ккал из ${fmtN(N.kcal)} — не пропускай ужин`, 'meal');
      if (N.protein && prot < N.protein * 0.75) add('protein', 40 + (1 - prot / N.protein) * 40, `Белок сегодня ${prot} из ${fmtN(N.protein)} г — на ужин творог или курица`, 'meal');
      else if (N.protein && prot >= N.protein * 0.9) add('protein-ok', 8, `Белок закрыт: ${prot} из ${fmtN(N.protein)} г`, undefined, 'good');
    }
  }
  if (on('water') && N.water) {
    if (water < N.water * 0.8) {
      const glasses = Math.ceil((N.water - water) / 250);
      add('water', 30 + (1 - water / N.water) * 35, water ? `Воды ${fmt1(water / 1000)} л из ${fmt1(N.water / 1000)} — ещё ${nWord(glasses, 'стакан', 'стакана', 'стаканов')} до сна` : `Воды сегодня не записано — норма ${fmt1(N.water / 1000)} л, начни со стакана`, 'water');
    } else if (water >= N.water) add('water-ok', 7, `Норма воды выпита — ${fmt1(water / 1000)} л`, undefined, 'good');
  }
  // шаги без записи не трогаем: их часто вносят разом перед сном
  if (on('steps') && steps > 0 && N.steps && steps < N.steps * 0.7) {
    const walk = Math.min(60, Math.max(10, Math.round((N.steps - steps) / 100 / 5) * 5));
    add('steps', 20 + (1 - steps / N.steps) * 30, `Шагов ${fmtN(steps)} из ${fmtN(N.steps)} — прогулка ${walk} минут добавит ≈ ${fmtN(walk * 100)}`, 'steps');
  }
  if (on('gym') && !(t.workouts ?? 0)) {
    const last = x.past.filter(d => (d.workouts ?? 0) > 0).map(d => d.day).sort().at(-1);
    const gap = last ? diffDays(last, x.day) : 0;
    if (gap >= 3) add('gym', 25 + Math.min(gap, 7) * 4, gap <= 10 ? `${cap(ordinal(gap))} день без зала — даже 20 минут засчитаются` : `Уже ${nWord(gap, 'день', 'дня', 'дней')} без зала — начни с короткой тренировки на 20 минут`, 'gym');
  }
  if (on('tasks') && (t.tasks ?? 0) > 0) {
    const all = t.tasks!, done = t.tasksDone ?? 0, left = all - done;
    if (left > 0 && x.minutes >= EVENING) add('tasks', 20 + left / all * 25, `Задачи: ${done} из ${all} — перенеси ${left === 1 ? 'оставшуюся' : 'оставшиеся'} на завтра?`, 'plans');
    else if (!left && all >= 3) add('tasks-ok', 15, `Все задачи на сегодня закрыты — ${done} из ${all}`, undefined, 'good');
  }
  if (on('study')) {
    const quizLeft = (t.quizTotal ?? 0) - (t.quizAnswered ?? 0), min = t.studyMin ?? 0;
    if (quizLeft > 0) add('quiz', 22, `${cap(plural(quizLeft, 'остался', 'осталось', 'осталось'))} ${nWord(quizLeft, 'вопрос', 'вопроса', 'вопросов')} дня — это пара минут`, 'quiz');
    // учёба — только если человек на самом деле учится (были занятия за две недели)
    const studies = x.past.some(d => (d.studyMin ?? 0) > 0 && diffDays(d.day, x.day) <= 14);
    if (studies && N.study && min < N.study * 0.5) add('study', 18, min ? `Учёбы сегодня ${min} из ${N.study} мин — ещё 20 минут перед сном тоже считаются` : 'Сегодня без учёбы — 20 минут перед сном сохранят ритм', 'study');
  }
  if (x.score >= 0.95) add('perfect', 90, `Идеальный день — ${x.perfectMonth + 1}-й за месяц`, undefined, 'good');
  else if (x.score >= 0.8) add('strong', 12, `Сильный день: ${Math.round(x.score * 100)}%. Ещё немного — и будет идеальный`, undefined, 'good');
  if (x.goals?.size) for (const t of out) if (TIP_GOALS[t.key]?.some(g => x.goals!.has(g))) t.weight += GOAL_BOOST;
  return out.sort((a, b) => b.weight - a.weight);
}

/* ---------- данные человека ---------- */
async function person(db: Tx, userId: string, at: number) {
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const now = localNow(u?.tz ?? 0, at);
  const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
  const chosen = (p?.s as Record<string, unknown> | undefined)?.sections, goals = new Set<string>(aimsOf((p?.s as Record<string, unknown> | undefined)?.goals));
  const sub = await subscription(db, userId);
  const open = (a: Area) => !['gym', 'study', 'budget', 'books'].includes(a) || hasFeature(sub, a as 'gym');
  // ничего не выбрано — ведёт всё, что открыто
  const on = new Set<Area>(SECTION_KEYS.filter(a => (!Array.isArray(chosen) || chosen.includes(a)) && open(a)));
  return { now, on, goals };
}

/** вход для правил: факты за месяц до сегодня включительно, оценка, серия, идеальные дни месяца */
export async function tipInput(db: Tx, userId: string, at = Date.now()): Promise<TipInput> {
  const { now, on, goals } = await person(db, userId, at);
  const { norms } = await userContext(db, userId, at);
  const from = addDays(now.day, -35), F = await collect(db, userId, from, now.day), A = tracked(F, now.day);
  const past = [...F.values()].filter(f => f.day < now.day);
  let streak = 0; for (let d = addDays(now.day, -1); hasAny(F.get(d)) && d >= from; d = addDays(d, -1)) streak++;
  const month = now.day.slice(0, 7), perfectMonth = past.filter(f => f.day.startsWith(month) && score(f, A, norms) >= 0.95).length;
  const { day: _d, ...today } = F.get(now.day) ?? { day: now.day };
  return { day: now.day, minutes: now.minutes, on, norms, today, past, score: score(F.get(now.day), A, norms), perfectMonth, streak, goals };
}

/* ---------- ИИ: одна фраза вместо текста правила ---------- */
const polished = new Map<string, { base: string; text: string }>();
const digits = (s: string) => (s.match(/\d+/g) ?? []).join(' ');
/** переписанный ИИ текст, если он уже есть (напоминания новых обращений к ИИ не делают) */
export const polishedOf = (userId: string, day: string, base: string) => { const h = polished.get(`${userId}:${day}`); return h && h.base === base ? h.text : base; };
async function polish(db: Tx, userId: string, day: string, base: string) {
  const k = `${userId}:${day}`, hit = polished.get(k);
  if (hit && hit.base === base) return hit.text;
  if (!aiEnabled()) return base;
  let text = base;
  try {
    await takeAi(db, userId, 'tip');
    const r = await gemini([{ text: `Перепиши совет для дневника здоровья одной дружелюбной фразой на «ты», до 120 символов. Сохрани все числа как есть, ничего не выдумывай, без эмодзи и кавычек.\nСовет: ${base}` }],
      { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] }, { timeout: 8000 });
    const s = String(r?.text ?? '').replace(/\s+/g, ' ').trim();
    // ИИ не должен терять или менять цифры
    if (s.length >= 10 && s.length <= 180 && digits(s) === digits(base)) text = s;
  } catch { /* нет согласия, лимит или сбой — остаётся текст правила */ }
  if (polished.size > 5000) polished.clear();
  polished.set(k, { base, text });
  return text;
}

const view = ({ weight: _w, ...t }: Tip) => t;
/** совет дня: главный и до двух запасных; ai — переписать главный (только вечером, когда его покажут) */
export async function dayTips(db: Tx, userId: string, { at = Date.now(), ai = false } = {}) {
  const x = await tipInput(db, userId, at), list = rankTips(x);
  const top = list[0] ? { ...list[0], text: ai && x.minutes >= EVENING ? await polish(db, userId, x.day, list[0].text) : polishedOf(userId, x.day, list[0].text) } : null;
  return { day: x.day, evening: x.minutes >= EVENING, tip: top && view(top), more: list.slice(1, 3).map(view), base: list[0]?.text ?? null };
}

/* ---------- итог недели ---------- */
const mondayOf = (d: string) => addDays(d, -((parseDay(d).getUTCDay() + 6) % 7));
const hours = (m: number) => m >= 60 ? { value: fmt1(m / 60), unit: 'ч' } : { value: String(Math.round(m)), unit: 'мин' };
export async function weekRecap(db: Tx, userId: string, end?: string, at = Date.now()) {
  const { on } = await person(db, userId, at);
  const r = await review(db, userId, end ? mondayOf(end) : undefined, at), W = r.facts, N = W.norms;
  const stats: Array<{ key: string; label: string; value: string; unit: string; note: string; ok: boolean | null }> = [];
  if (on.has('food') && W.foodDays) stats.push({ key: 'kcal', label: 'Калории в день', value: fmtN(W.kcalAvg), unit: 'ккал', note: `норма ${fmtN(N.kcal)} · в норме ${W.inNorm} из ${W.n}`, ok: W.inNorm >= Math.ceil(W.n * 0.6) });
  if (on.has('water') && W.waterAvg) stats.push({ key: 'water', label: 'Вода в день', value: fmt1(W.waterAvg / 1000), unit: 'л', note: `норма ${fmt1(N.water / 1000)} л · ${W.water} из ${W.n} дн.`, ok: W.water >= Math.ceil(W.n * 0.6) });
  if (on.has('steps') && W.stepsAvg) stats.push({ key: 'steps', label: 'Шагов в день', value: fmtN(W.stepsAvg), unit: '', note: `цель ${fmtN(N.steps)}`, ok: W.stepsAvg >= N.steps * 0.9 });
  if (W.weight !== null) stats.push({ key: 'weight', label: 'Вес за неделю', value: `${W.weight > 0 ? '+' : W.weight < 0 ? '−' : ''}${fmt1(Math.abs(W.weight))}`, unit: 'кг', note: 'первое и последнее взвешивание', ok: null });
  if (on.has('tasks') && W.tasksAll) stats.push({ key: 'tasks', label: 'Задачи', value: `${W.tasksDone} из ${W.tasksAll}`, unit: '', note: `сделано ${Math.round(W.tasksDone / W.tasksAll * 100)}%`, ok: W.tasksDone / W.tasksAll >= 0.7 });
  if (on.has('study') && W.study) { const h = hours(W.study); stats.push({ key: 'study', label: 'Учёба', ...h, note: `цель ${fmt1(N.study * 7 / 60)} ч за неделю`, ok: W.study >= N.study * 7 * 0.7 }); }
  if (on.has('gym') && (W.gym || r.kpis[1]!.prev)) stats.push({ key: 'gym', label: 'Тренировки', value: String(W.gym), unit: '', note: plural(W.gym, 'тренировка', 'тренировки', 'тренировок') + ` · неделей раньше ${r.kpis[1]!.prev}`, ok: W.gym > 0 });
  if (on.has('books') && W.pages) stats.push({ key: 'pages', label: 'Прочитано', value: String(W.pages), unit: 'стр.', note: W.booksDone.length ? `дочитано: ${W.booksDone.map(b => `«${b}»`).join(', ')}` : 'за неделю', ok: true });
  const focus = r.focus[0] ?? (!W.logged ? 'Начать с малого: одна запись в день — еда, вода или шаги' : r.score >= 80 ? 'Держать ритм — те же привычки ещё одну неделю' : 'Выбрать одну привычку и закрывать её каждый день');
  return {
    mon: r.mon, sun: r.sun, isThis: r.isThis, today: W.today,
    score: r.score, prevScore: r.prevScore, scores: r.scores,
    days: W.logged, of: W.n, perfect: W.perfect, streak: W.streak,
    best: r.best ? { day: addDays(r.mon, r.best.k), score: r.best.score, parts: r.best.parts } : null,
    stats, verdict: r.motto, focus, wins: r.wins.slice(0, 3)
  };
}

export async function insightsRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/insights/today', { preHandler: requireUser }, async req => {
    const { base: _b, ...r } = await dayTips(db, req.userId!, { ai: true });
    return r;
  });
  app.get('/api/insights/week', { preHandler: requireUser }, async req => {
    const end = (req.query as { end?: string }).end;
    if (end !== undefined && !isDay(end)) throw bad('Нужна дата в формате ГГГГ-ММ-ДД.');
    return weekRecap(db, req.userId!, end);
  });
}
