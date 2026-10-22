/** Перенос зала: тренировки (упражнения и подходы), свои упражнения, планы, идущая тренировка */
import { count, eq, inArray, sql } from 'drizzle-orm';
import { recordEvents } from '../../core/events.js';
import { hm, isDay, list, num, optNum, optStr, owned, str, uniqById } from '../../core/legacy.js';
import type { ImportCheck, ImportContext, LegacyState } from '../../core/module.js';
import { upsertByLegacy } from '../../db/upsert.js';
import { liveWorkouts, userExercises, workoutExercises, workoutPlans, workoutSets, workouts } from './schema.js';

const validWorkouts = (st: LegacyState) => uniqById(list(st.workouts)).filter(w => isDay(w?.date));
const setRow = (s: any) => ({ kg: optNum(s?.kg), reps: s?.reps == null ? null : Math.round(num(s.reps)), seconds: s?.sec == null ? null : Math.round(num(s.sec)), minutes: optNum(s?.min), km: optNum(s?.km) });

export async function importGym({ db, userId, warn }: ImportContext, st: LegacyState) {
  await upsertByLegacy(db, userExercises, list(st.exercises).filter(x => str(x?.name)).map(x => ({
    userId, legacyId: String(x.id), name: str(x.name, 60), muscleGroup: str(x.group) || 'full', kind: str(x.kind) || 'w', icon: str(x.icon) || 'dumbbell', equipment: optStr(x.equip)
  })));
  const ws = validWorkouts(st);
  { const n = uniqById(list(st.workouts)).length - ws.length; if (n) warn(`зал: пропущено тренировок без даты — ${n}`); }
  const ids = await upsertByLegacy(db, workouts, ws.map(w => ({
    userId, legacyId: String(w.id), day: w.date, time: hm(w.time), title: str(w.type, 60) || 'Тренировка', minutes: w.minutes ? Math.round(num(w.minutes)) : null, note: optStr(w.note, 1000)
  })));
  // упражнения и подходы пересоздаём целиком — перенос идемпотентен
  const wIds = [...ids.values()];
  if (wIds.length) await db.delete(workoutExercises).where(inArray(workoutExercises.workoutId, wIds));
  for (const w of ws) {
    const workoutId = ids.get(String(w.id)); if (!workoutId) continue;
    const exs = list(w.exercises).filter(e => str(e?.name));
    if (!exs.length) continue;
    const exRows = await db.insert(workoutExercises).values(exs.map((e, i) => ({ workoutId, position: i, exerciseKey: optStr(e.ex), name: str(e.name, 80) }))).returning({ id: workoutExercises.id, position: workoutExercises.position });
    const sets = exRows.flatMap(r => list(exs[r.position]!.sets).map((s, j) => ({ workoutExerciseId: r.id, position: j, ...setRow(s) })));
    if (sets.length) await db.insert(workoutSets).values(sets);
  }
  await upsertByLegacy(db, workoutPlans, list(st.gymPlans).filter(p => str(p?.name)).map(p => ({
    userId, legacyId: String(p.id), name: str(p.name, 40), weekdays: list<number>(p.days).filter(d => Number.isInteger(d) && d >= 0 && d <= 6), time: hm(p.time),
    exercises: list(p.ex).map(e => ({ exerciseKey: optStr(e.ex), name: str(e.name, 80), sets: Math.max(1, Math.round(num(e.n) || 3)) }))
  })));
  if (st.gymLive && typeof st.gymLive === 'object') await db.insert(liveWorkouts).values({ userId, data: st.gymLive }).onConflictDoUpdate({ target: liveWorkouts.userId, set: { data: st.gymLive, updatedAt: sql`now()` } });
  await recordEvents(db, ws.map(w => ({ userId, module: 'gym' as const, kind: 'workout', refId: ids.get(String(w.id)), day: w.date, time: hm(w.time), title: str(w.type, 60) || 'Тренировка', value: w.minutes ? num(w.minutes) : null, unit: 'min' })));
}

export async function verifyGym(ctx: ImportContext, st: LegacyState): Promise<ImportCheck[]> {
  const { db } = ctx;
  const ws = validWorkouts(st);
  const [w] = await db.select({ n: count() }).from(workouts).where(owned(ctx, workouts.userId, workouts.legacyId));
  const [s] = await db.select({ n: count(), vol: sql<number>`coalesce(round(sum(coalesce(${workoutSets.kg},0) * coalesce(${workoutSets.reps},0))::numeric, 2), 0)::float` })
    .from(workoutSets).innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id)).innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id)).where(owned(ctx, workouts.userId, workouts.legacyId));
  const srcSets = ws.flatMap(x => list(x.exercises).filter(e => str(e?.name)).flatMap(e => list(e.sets)));
  return [
    { name: 'тренировок', source: ws.length, db: w!.n },
    { name: 'подходов', source: srcSets.length, db: s!.n },
    { name: 'объём, кг×повт', source: Math.round(srcSets.reduce((a, x) => a + num(x?.kg) * Math.round(num(x?.reps)), 0) * 100) / 100, db: Number(s!.vol) }
  ];
}
