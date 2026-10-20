/**
 * «Цель и прогноз» (бесплатно): путь к желаемому весу, вехи, срок по реальному темпу, факт против плана, график, активность недели.
 * Те же формулы, что в старом журнале: план — из анкеты и текущего веса, факт — тренд веса за 4 недели и средняя еда.
 * Нормы дня пересчитываются под текущий вес, активность и средние шаги — и об этом говорится, чтобы цифры не «прыгали» молча.
 */
import { and, desc, eq, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ACTIVITY, addDays, computePlan, diffDays, factTdee, GOALS, localNow, PACE, simulate, trend, weeksTo, type ActivityLevel, type Goal, type Pace, type PlanProfile } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { bodySeries } from '../modules/body/index.js';
import { foodSeries } from '../modules/food/index.js';
import { requireUser } from './auth.js';
import { bad } from './http.js';
import { activityWeeks, profiles, users } from './schema.js';

const mondayOf = (day: string) => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7));
const r1 = (n: number) => Math.round(n * 10) / 10;

async function levelOn(db: Tx, userId: string, day: string): Promise<ActivityLevel> {
  const [a] = await db.select({ level: activityWeeks.level }).from(activityWeeks).where(and(eq(activityWeeks.userId, userId), lte(activityWeeks.weekStart, mondayOf(day)))).orderBy(desc(activityWeeks.weekStart)).limit(1);
  return (a?.level && a.level in ACTIVITY ? a.level : 'sed') as ActivityLevel;
}

export async function goalState(db: Tx, userId: string) {
  const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, userId));
  const today = localNow(u?.tz ?? 0).day;
  const [pr] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!pr?.heightCm || !pr.sex || !pr.age) return { ready: false as const };
  const settings = (pr.settings ?? {}) as Record<string, unknown>;

  const body = await bodySeries(db, userId, addDays(today, -180), today);
  const weights = body.filter(b => b.weightKg !== null).map(b => ({ day: b.day, kg: b.weightKg! }));
  const last = weights.at(-1), w = last?.kg ?? pr.startWeightKg ?? 70;
  const level = await levelOn(db, userId, today);
  // шаги для плана: среднее за 7 прошлых дней, если записано хотя бы 3 дня, иначе — из анкеты
  const recent = body.filter(b => b.day >= addDays(today, -7) && b.day < today && b.steps).map(b => b.steps!);
  const stepsInfo = recent.length >= 3 ? { steps: Math.round(recent.reduce((a, b) => a + b, 0) / recent.length), measured: true, days: recent.length } : { steps: pr.plannedSteps ?? 6000, measured: false, days: recent.length };
  // возраст растёт: от даты, когда его указали
  const age = pr.age + (pr.ageMeasuredOn ? Math.floor(diffDays(pr.ageMeasuredOn, today) / 365.25) : 0);
  const goal = (pr.goal && pr.goal in GOALS ? pr.goal : 'maintain') as Goal;
  const prof: PlanProfile = { sex: pr.sex as 'm' | 'f', age, height: pr.heightCm, goal, pace: (pr.pace ?? 'mid') as Pace, build: (pr.build ?? 'mid') as PlanProfile['build'], bodyFat: pr.bodyFat, steps: stepsInfo.steps };
  const plan = computePlan(prof, w, level, stepsInfo.steps);

  // факт за 4 недели: тренд веса и средняя еда (без сегодняшнего, недописанного дня)
  const s28 = addDays(today, -27);
  const tr = trend(weights.filter(x => x.day >= s28).map(x => ({ t: diffDays(s28, x.day), v: x.kg })));
  const eaten = (await foodSeries(db, userId, s28, addDays(today, -1))).filter(d => d.meals > 0);
  const intake = eaten.length ? eaten.reduce((a, d) => a + d.kcal, 0) / eaten.length : 0;
  const weekly = tr ? tr.slope * 7 : 0, now = tr ? tr.at(diffDays(s28, today)) : w;
  const tdee = tr && eaten.length >= 10 ? factTdee(intake, tr.slope) : null;

  // путь к цели
  const start = pr.startWeightKg ?? w, target = goal === 'maintain' ? null : pr.targetKg, dir = goal === 'gain' ? 1 : -1;
  const factOk = !!tr && Math.sign(weekly) === dir && Math.abs(weekly) > 0.03;
  const weeksBy = (m: number) => factOk ? (m - now) / weekly : weeksTo(prof, now, plan.kcal, level, m, stepsInfo.steps);
  let path = null;
  if (target) {
    const total = Math.abs(target - start), passed = Math.max(0, Math.min(total, (now - start) * dir)), reached = (target - now) * dir <= 0;
    const step = total > 12 ? 5 : total > 5 ? 2 : 1, ms: number[] = [];
    for (let m = dir < 0 ? Math.floor((now - 0.01) / step) * step : Math.ceil((now + 0.01) / step) * step; dir < 0 ? m > target : m < target; m += dir * step) ms.push(m);
    ms.push(target);
    path = {
      start: r1(start), target, total: r1(total), passed: r1(passed), pct: total ? Math.round(passed / total * 100) : 0, reached,
      weeks: reached ? null : weeksBy(target), planWeeks: reached ? null : weeksTo(prof, now, plan.kcal, level, target, stepsInfo.steps), byFact: factOk,
      ticks: ms.slice(0, -1).map(m => ({ kg: m, at: total ? Math.abs(m - start) / total * 100 : 0 })),
      milestones: ms.slice(0, 4).map(m => ({ kg: m, weeks: weeksBy(m) }))
    };
  }

  // график: замеры, план от старта, «если так пойдёт дальше»
  const startedOn = pr.startedOn ?? weights[0]?.day ?? today;
  const sim = simulate(prof, start, plan.kcal, level, Math.max(12, Math.ceil(diffDays(startedOn, today) / 7) + 8), stepsInfo.steps);
  const series = {
    history: weights.filter(x => x.day >= addDays(today, -120)),
    plan: goal === 'maintain' ? [] : sim.map((kg, k) => ({ day: addDays(startedOn, k * 7), kg: r1(kg) })).filter(x => x.day <= addDays(today, 56)),
    fact: tr ? [{ day: today, kg: r1(now) }, { day: addDays(today, 56), kg: r1(now + weekly * 8) }] : []
  };

  // нормы дня — под текущий план
  let recalculated: { from: number; to: number } | null = null;
  const old = Number(settings.kcal) || 0;
  if (!old || Math.abs(old - plan.kcal) >= 10) {
    recalculated = old ? { from: old, to: plan.kcal } : null;
    await db.update(profiles).set({ settings: { ...settings, kcal: plan.kcal, protein: plan.protein, fat: plan.fat, carbs: plan.carbs }, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  }

  const todayFood = (await foodSeries(db, userId, today, today))[0], todayBody = body.find(b => b.day === today);
  return {
    ready: true as const, today,
    profile: { sex: prof.sex, age, height: prof.height, goal, goalName: GOALS[goal].name, pace: prof.pace, paceName: goal === 'maintain' ? null : PACE[goal]?.[prof.pace ?? 'mid']?.name ?? null, target, startedOn, start: r1(start), bodyFat: pr.bodyFat },
    weight: { now: r1(now), last: last ? { day: last.day, kg: last.kg } : null, byTrend: !!tr, weekly: Math.round(weekly * 100) / 100, span: tr?.span ?? 0, recentCount: weights.filter(x => x.day >= s28).length },
    plan: { kcal: plan.kcal, protein: plan.protein, fat: plan.fat, carbs: plan.carbs, bmr: Math.round(plan.bmr), tdee: Math.round(plan.tdee), delta: Math.round(plan.delta), weeklyKg: plan.weeklyKg, bmi: r1(plan.bmi), bodyFat: Math.round(plan.bf), lbm: r1(plan.lbm), notes: plan.notes,
      sim4: r1(sim[4] ?? start), sim12: r1(sim[12] ?? start), sim26: r1(simulate(prof, w, plan.kcal, level, 26, stepsInfo.steps)[26]!) },
    steps: { ...stepsInfo, goal: Number(settings.steps) || stepsInfo.steps, today: todayBody?.steps ?? 0, kcalPer3000: Math.round(0.5 * w * (0.415 * prof.height / 100) / 1000 * 3000) },
    fact: { intake: Math.round(intake), intakeDays: eaten.length, tdee: tdee === null ? null : Math.round(tdee) },
    level, levels: (Object.keys(ACTIVITY) as ActivityLevel[]).map(k => ({ level: k, name: ACTIVITY[k].name, hint: ACTIVITY[k].hint, kcal: computePlan(prof, w, k, stepsInfo.steps).kcal })),
    path, series, eatenToday: { kcal: todayFood?.kcal ?? 0, protein: Math.round(todayFood?.protein ?? 0) }, recalculated
  };
}

export async function goalRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/goal', { preHandler: requireUser }, async (req, reply) => {
    const g = await goalState(db, req.userId!);
    return g.ready ? g : reply.code(409).send({ error: 'Сначала пройди анкету — по ней считается план.' });
  });
  // активность этой недели: калории пересчитываются сразу
  app.put('/api/goal/activity', { preHandler: requireUser }, async req => {
    const level = String((req.body as { level?: string } | undefined)?.level ?? '');
    if (!(level in ACTIVITY)) throw bad('Неизвестный уровень активности.');
    const [u] = await db.select({ tz: users.tzOffset }).from(users).where(eq(users.id, req.userId!));
    const weekStart = mondayOf(localNow(u?.tz ?? 0).day);
    await db.insert(activityWeeks).values({ userId: req.userId!, weekStart, level }).onConflictDoUpdate({ target: [activityWeeks.userId, activityWeeks.weekStart], set: { level } });
    return goalState(db, req.userId!);
  });
}
