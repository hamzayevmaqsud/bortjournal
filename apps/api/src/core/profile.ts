/**
 * Профиль: анкета первого запуска (цели → разделы, нормы, привычки, напоминания) и ручная правка норм.
 * План считают формулы из @bortjournal/core — те же, что в старом журнале.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ACTIVITY, aimsOf, computePlan, GOALS, localNow, REMIND_PLAN, sectionsFor, stepsGoal, waterGoal, weeksTo, type ActivityLevel, type Goal, type Pace } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { setBodyDay } from '../modules/body/index.js';
import { activeHabits, addHabit, colorOf, HABITS_LIMIT, iconOf, titleOf } from '../modules/habits/service.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import { activityWeeks, profiles, users } from './schema.js';

/** что человек ведёт: от этого зависят «Сегодня», нижняя панель и нужна ли анкета тела */
export const SECTION_KEYS = ['food', 'water', 'steps', 'tasks', 'gym', 'study', 'budget', 'books'] as const;
const sectionsOf = (v: unknown) => { if (!Array.isArray(v)) throw bad('Разделы — списком.'); const out = SECTION_KEYS.filter(k => v.includes(k)); if (!out.length) throw bad('Выбери хотя бы один раздел.'); return out; };
const goalsOf = (v: unknown) => { if (!Array.isArray(v)) throw bad('Цели — списком.'); return aimsOf(v); };
const num = (v: unknown, lo: number, hi: number, name: string) => { const n = Number(String(v ?? '').replace(',', '.')); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name}: от ${lo} до ${hi}.`); return n; };
const mondayOf = (day: string) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const nameOf = (v: unknown) => String(v ?? '').trim().slice(0, 40) || null;
const REMIND_KEYS = REMIND_PLAN.map(r => r.kind as string);

export async function profileRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/profile', { preHandler: requireUser }, async req => {
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    return { profile: p ?? null };
  });

  // анкета одним запросом: цели и разделы, тело и план (если ведётся еда), нормы, привычки, напоминания.
  // Старый клиент (без goals) шлёт только тело — тогда пол и рост обязательны, как раньше
  app.post('/api/profile/onboarding', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>, userId = req.userId!;
    const fresh = b.goals !== undefined, withBody = !fresh || (b.sex !== undefined && b.sex !== null && b.sex !== '');
    const [cur] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const old = (cur?.settings ?? {}) as Record<string, any>;
    const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
    const today = localNow(u!.tz).day;

    // сначала всё проверить — до первой записи
    const goals = fresh ? goalsOf(b.goals) : undefined;
    const sections = b.sections !== undefined ? sectionsOf(b.sections) : goals ? sectionsFor(goals) : undefined;
    const ideas = b.habits === undefined ? [] : Array.isArray(b.habits) && b.habits.length <= 10 ? b.habits.map(h => { const x = (h ?? {}) as Record<string, unknown>; return { title: titleOf(x.title), icon: iconOf(x.icon), color: colorOf(x.color) }; }) : (() => { throw bad('Привычки — списком, до 10.'); })();
    const N = (b.norms ?? {}) as Record<string, unknown>;
    const norms = {
      kcal: N.kcal === undefined ? undefined : Math.round(num(N.kcal, 800, 6000, 'Калории')),
      protein: N.protein === undefined ? undefined : Math.round(num(N.protein, 0, 400, 'Белок')),
      water: N.water === undefined ? undefined : Math.round(num(N.water, 500, 6000, 'Вода')),
      steps: N.steps === undefined ? undefined : Math.round(num(N.steps, 1000, 50000, 'Шаги'))
    };

    const settings: Record<string, any> = { ...old };
    if (sections) settings.sections = sections;
    if (goals) settings.goals = goals;
    settings.name = fresh && b.name !== undefined ? nameOf(b.name) : nameOf(b.name) ?? old.name ?? null;

    let body: { level: ActivityLevel; weight: number; v: Record<string, unknown> } | null = null, plan = null;
    if (withBody) {
      const sex = b.sex === 'f' ? 'f' : b.sex === 'm' ? 'm' : null; if (!sex) throw bad('Выбери пол — от него зависит обмен веществ.');
      const age = Math.round(num(b.age, 14, 100, 'Возраст')), height = Math.round(num(b.height, 120, 230, 'Рост')), weight = num(b.weight, 30, 300, 'Вес');
      const goal = (b.goal as Goal) in GOALS ? (b.goal as Goal) : 'maintain', pace = (['soft', 'mid', 'hard'].includes(String(b.pace)) ? b.pace : 'mid') as Pace;
      const level = (String(b.activity) in ACTIVITY ? b.activity : 'sed') as ActivityLevel, steps = Math.round(num(b.steps ?? 6000, 0, 40000, 'Шаги'));
      const target = goal === 'maintain' || b.target === undefined || b.target === null || b.target === '' ? null : num(b.target, 30, 300, 'Желаемый вес');
      const prof = { sex, age, height, goal, pace, steps } as const;
      const p = computePlan(prof, weight, level, steps);
      Object.assign(settings, { kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs, steps: stepsGoal(steps), water: waterGoal(sex, level) });
      plan = { ...p, weeks: target ? weeksTo(prof, weight, p.kcal, level, target, steps) : null };
      body = { level, weight, v: { sex, age, ageMeasuredOn: today, heightCm: height, goal, pace, targetKg: target, startWeightKg: weight, startedOn: today, plannedSteps: steps } };
    }
    // нормы, поправленные в анкете руками; калории сменились — углеводы добирают разницу
    for (const k of ['kcal', 'protein', 'water', 'steps'] as const) if (norms[k] !== undefined) settings[k] = norms[k];
    if ((norms.kcal !== undefined || norms.protein !== undefined) && settings.fat !== undefined) settings.carbs = Math.max(0, Math.round((settings.kcal - (settings.protein ?? 0) * 4 - settings.fat * 9) / 4 / 5) * 5);
    if (b.remind !== undefined) {
      const r = (b.remind ?? {}) as { off?: unknown; kinds?: Record<string, unknown> }, R: Record<string, unknown> = { ...(old.remind ?? {}) };
      if (typeof r.off === 'boolean') R.off = r.off;
      for (const k of REMIND_KEYS) if (typeof r.kinds?.[k] === 'boolean') R[k] = r.kinds[k];
      settings.remind = R;
    }
    settings.onboarded = true;

    const created: string[] = [];
    await db.transaction(async tx => {
      const v = { ...(body?.v ?? {}), settings, updatedAt: new Date() };
      await tx.insert(profiles).values({ userId, ...v }).onConflictDoUpdate({ target: profiles.userId, set: v });
      if (body) {
        await tx.insert(activityWeeks).values({ userId, weekStart: mondayOf(today), level: body.level }).onConflictDoUpdate({ target: [activityWeeks.userId, activityWeeks.weekStart], set: { level: body.level } });
        await setBodyDay(tx, userId, today, { weightKg: body.weight });
      }
      // привычки: такие уже есть — пропускаем (анкету проходят заново), лимит — молча останавливаемся
      const have = new Set((await activeHabits(tx, userId)).map(h => h.title.toLowerCase()));
      for (const h of ideas) {
        if (have.has(h.title.toLowerCase())) continue;
        if (have.size >= HABITS_LIMIT) break;
        await addHabit(tx, userId, h); have.add(h.title.toLowerCase()); created.push(h.title);
      }
    });
    return { plan: plan && { ...plan, water: settings.water, steps: settings.steps }, settings, habits: created };
  });

  // ручная правка норм и имени
  app.put('/api/profile/settings', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const [cur] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    const s: Record<string, unknown> = { ...(cur?.settings ?? {}) };
    if (b.name !== undefined) s.name = nameOf(b.name);
    if (b.kcal !== undefined) s.kcal = Math.round(num(b.kcal, 800, 6000, 'Калории'));
    if (b.protein !== undefined) s.protein = Math.round(num(b.protein, 0, 400, 'Белок'));
    if (b.steps !== undefined) s.steps = Math.round(num(b.steps, 1000, 50000, 'Шаги'));
    if (b.water !== undefined) s.water = Math.round(num(b.water, 500, 6000, 'Вода'));
    if (b.sections !== undefined) s.sections = sectionsOf(b.sections);
    if (b.goals !== undefined) s.goals = goalsOf(b.goals);
    if (typeof b.onboarded === 'boolean') s.onboarded = b.onboarded;
    if (typeof b.checklistDone === 'boolean') s.checklistDone = b.checklistDone;
    if (typeof b.remindSeen === 'boolean') s.remindSeen = b.remindSeen;
    if (typeof b.aiConsent === 'boolean') s.aiConsent = b.aiConsent;
    if (b.fat !== undefined) s.fat = Math.round(num(b.fat, 0, 300, 'Жиры'));
    if (b.carbs !== undefined) s.carbs = Math.round(num(b.carbs, 0, 800, 'Углеводы'));
    if (b.study !== undefined) s.study = Math.round(num(b.study, 0, 600, 'Учёба в день'));
    if (b.rest !== undefined) s.rest = Math.round(num(b.rest, 15, 600, 'Отдых между подходами'));
    if (b.booksGoal !== undefined) s.booksGoal = Math.round(num(b.booksGoal, 1, 365, 'Книг в год'));
    // оформление общее для всех устройств: system — как в настройках телефона или компьютера
    if (b.theme !== undefined) { if (!['system', 'light', 'dark'].includes(String(b.theme))) throw bad('Тема: system, light или dark.'); s.theme = b.theme; }
    await db.insert(profiles).values({ userId: req.userId!, settings: s }).onConflictDoUpdate({ target: profiles.userId, set: { settings: s, updatedAt: new Date() } });
    return { settings: s };
  });
}
