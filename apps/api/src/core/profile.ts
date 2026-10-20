/**
 * Профиль: анкета первого запуска (по ней считается план калорий) и ручная правка норм.
 * План считают формулы из @bortjournal/core — те же, что в старом журнале.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ACTIVITY, computePlan, GOALS, localNow, waterGoal, weeksTo, type ActivityLevel, type Goal, type Pace } from '@bortjournal/core';
import type { DB } from '../db/index.js';
import { setBodyDay } from '../modules/body/index.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import { activityWeeks, profiles, users } from './schema.js';

const num = (v: unknown, lo: number, hi: number, name: string) => { const n = Number(String(v ?? '').replace(',', '.')); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name}: от ${lo} до ${hi}.`); return n; };
const mondayOf = (day: string) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export async function profileRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/profile', { preHandler: requireUser }, async req => {
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    return { profile: p ?? null };
  });

  // анкета: считает план, сохраняет профиль и нормы, вес — в «Тело» как вес сегодня
  app.post('/api/profile/onboarding', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sex = b.sex === 'f' ? 'f' : b.sex === 'm' ? 'm' : null; if (!sex) throw bad('Выбери пол — от него зависит обмен веществ.');
    const age = Math.round(num(b.age, 14, 100, 'Возраст')), height = Math.round(num(b.height, 120, 230, 'Рост')), weight = num(b.weight, 30, 300, 'Вес');
    const goal = (b.goal as Goal) in GOALS ? (b.goal as Goal) : 'maintain', pace = (['soft', 'mid', 'hard'].includes(String(b.pace)) ? b.pace : 'mid') as Pace;
    const level = (String(b.activity) in ACTIVITY ? b.activity : 'sed') as ActivityLevel, steps = Math.round(num(b.steps ?? 6000, 0, 40000, 'Шаги'));
    const target = goal === 'maintain' || b.target === undefined || b.target === null || b.target === '' ? null : num(b.target, 30, 300, 'Желаемый вес');
    const prof = { sex, age, height, goal, pace, steps } as const;
    const plan = computePlan(prof, weight, level, steps);
    const weeks = target ? weeksTo(prof, weight, plan.kcal, level, target, steps) : null;
    const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, req.userId!));
    const today = localNow(u!.tz).day;
    const [cur] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    const settings = { ...(cur?.settings ?? {}), kcal: plan.kcal, protein: plan.protein, fat: plan.fat, carbs: plan.carbs, steps: Math.max(6000, Math.round(steps / 1000) * 1000 + 2000), water: waterGoal(sex, level), name: String(b.name ?? '').trim().slice(0, 40) || (cur?.settings as any)?.name || null, onboarded: true };
    const v = { sex, age, ageMeasuredOn: today, heightCm: height, goal, pace, targetKg: target, startWeightKg: weight, startedOn: today, plannedSteps: steps, settings, updatedAt: new Date() };
    await db.transaction(async tx => {
      await tx.insert(profiles).values({ userId: req.userId!, ...v }).onConflictDoUpdate({ target: profiles.userId, set: v });
      await tx.insert(activityWeeks).values({ userId: req.userId!, weekStart: mondayOf(today), level }).onConflictDoUpdate({ target: [activityWeeks.userId, activityWeeks.weekStart], set: { level } });
      await setBodyDay(tx, req.userId!, today, { weightKg: weight });
    });
    return { plan: { ...plan, weeks, water: settings.water, steps: settings.steps } };
  });

  // ручная правка норм и имени
  app.put('/api/profile/settings', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const [cur] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    const s: Record<string, unknown> = { ...(cur?.settings ?? {}) };
    if (b.name !== undefined) s.name = String(b.name).trim().slice(0, 40) || null;
    if (b.kcal !== undefined) s.kcal = Math.round(num(b.kcal, 800, 6000, 'Калории'));
    if (b.protein !== undefined) s.protein = Math.round(num(b.protein, 0, 400, 'Белок'));
    if (b.steps !== undefined) s.steps = Math.round(num(b.steps, 1000, 50000, 'Шаги'));
    if (b.water !== undefined) s.water = Math.round(num(b.water, 500, 6000, 'Вода'));
    // оформление общее для всех устройств: system — как в настройках телефона или компьютера
    if (b.theme !== undefined) { if (!['system', 'light', 'dark'].includes(String(b.theme))) throw bad('Тема: system, light или dark.'); s.theme = b.theme; }
    await db.insert(profiles).values({ userId: req.userId!, settings: s }).onConflictDoUpdate({ target: profiles.userId, set: { settings: s, updatedAt: new Date() } });
    return { settings: s };
  });
}
