/**
 * Зал: обзор, тренировки по подходам, рекорды, история упражнения, планы, свои упражнения и идущая тренировка.
 * Упражнение в тренировке ссылается на каталог (@bortjournal/core) или на своё упражнение; у старых записей — только
 * название, его узнаём по каталогу и другим названиям. Тренировок у одного человека немного — считаем в памяти.
 */
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { addDays, e1rm, EXERCISES, exById, exByName, GYM_GROUPS, weekday, workoutTitle, type Exercise, type GymKind, type GymSet } from '@bortjournal/core';
import { recordEvent, removeEvents } from '../../core/events.js';
import { bad } from '../../core/http.js';
import type { Tx } from '../../db/index.js';
import { liveWorkouts, userExercises, workoutExercises, workoutPlans, workoutSets, workouts } from './schema.js';

export interface WSet extends GymSet { }
export interface WEx { key: string; name: string; ex: Exercise; sets: WSet[] }
export interface Workout { id: string; day: string; time: string | null; title: string; minutes: number | null; note: string | null; planId: string | null; exercises: WEx[] }

async function mine(db: Tx, userId: string) {
  const rows = await db.select().from(userExercises).where(eq(userExercises.userId, userId)).orderBy(asc(userExercises.createdAt));
  return rows.map(r => ({ ex: { id: r.id, name: r.name, group: r.muscleGroup, kind: r.kind as GymKind, icon: r.icon, equip: r.equipment ?? '' } satisfies Exercise, legacy: r.legacyId }));
}
type Mine = Awaited<ReturnType<typeof mine>>;
/** упражнение записи: каталог → своё (по id или старому id) → по названию → догадка по подходам */
function resolve(key: string | null, name: string, sets: WSet[], my: Mine): Exercise {
  const own = my.map(m => m.ex);
  const byKey = exById(key, own) ?? (key ? my.find(m => m.legacy === key)?.ex : undefined);
  if (byKey) return byKey;
  const byName = exByName(name, own);
  if (byName) return byName;
  const cardio = sets.some(s => s.minutes || s.km);
  return { id: `n:${name.trim().toLowerCase()}`, name, group: cardio ? 'cardio' : 'full', kind: cardio ? 'c' : sets.some(s => s.kg) ? 'w' : sets.length ? 'bw' : 'w', icon: cardio ? 'heart' : 'dumbbell', equip: '' };
}

export async function loadWorkouts(db: Tx, userId: string, from?: string): Promise<{ list: Workout[]; my: Mine }> {
  const my = await mine(db, userId);
  const ws = await db.select().from(workouts).where(from ? and(eq(workouts.userId, userId), gte(workouts.day, from)) : eq(workouts.userId, userId)).orderBy(desc(workouts.day), sql`${workouts.time} desc nulls last`);
  if (!ws.length) return { list: [], my };
  const exs = await db.select().from(workoutExercises).where(inArray(workoutExercises.workoutId, ws.map(w => w.id))).orderBy(asc(workoutExercises.position));
  const sets = exs.length ? await db.select().from(workoutSets).where(inArray(workoutSets.workoutExerciseId, exs.map(e => e.id))).orderBy(asc(workoutSets.position)) : [];
  const setsBy = new Map<string, WSet[]>();
  for (const s of sets) { const l = setsBy.get(s.workoutExerciseId) ?? []; l.push({ kg: s.kg, reps: s.reps, seconds: s.seconds, minutes: s.minutes, km: s.km }); setsBy.set(s.workoutExerciseId, l); }
  const exBy = new Map<string, WEx[]>();
  for (const e of exs) { const ss = setsBy.get(e.id) ?? [], ex = resolve(e.exerciseKey, e.name, ss, my), l = exBy.get(e.workoutId) ?? []; l.push({ key: ex.id, name: ex.name, ex, sets: ss }); exBy.set(e.workoutId, l); }
  return { list: ws.map(w => ({ id: w.id, day: w.day, time: w.time, title: w.title, minutes: w.minutes, note: w.note, planId: w.planId, exercises: exBy.get(w.id) ?? [] })), my };
}

const volume = (w: Workout) => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.kg ?? 0) * (s.reps ?? 0), 0), 0);
function best(list: Workout[], key: string, skip?: string) {
  let kg = 0, rm = 0, reps = 0, seconds = 0, km = 0;
  for (const w of list) if (w.id !== skip) for (const e of w.exercises) if (e.key === key) for (const s of e.sets) {
    kg = Math.max(kg, s.kg ?? 0); rm = Math.max(rm, e1rm(s)); reps = Math.max(reps, s.reps ?? 0); seconds = Math.max(seconds, s.seconds ?? 0); km = Math.max(km, s.km ?? 0);
  }
  return { kg, rm: Math.round(rm * 2) / 2, reps, seconds, km };
}
/** история упражнения: от новых к старым */
const history = (list: Workout[], key: string, skip?: string) => list.filter(w => w.id !== skip).flatMap(w => w.exercises.filter(e => e.key === key && e.sets.length).map(e => ({ day: w.day, workoutId: w.id, sets: e.sets })));
const titleOf = (exs: WEx[]) => workoutTitle(exs.map(e => ({ group: e.ex.group, sets: e.sets.length })));

export async function gymOverview(db: Tx, userId: string, today: string) {
  const { list, my } = await loadWorkouts(db, userId);
  const from30 = addDays(today, -29), from7 = addDays(today, -6);
  const w30 = list.filter(w => w.day >= from30), w7 = list.filter(w => w.day >= from7);
  // тренировок по неделям, 12 недель (понедельник — начало)
  const mon = addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, k) => { const s = addDays(mon, -7 * (11 - k)), e = addDays(s, 6); return { from: s, n: list.filter(w => w.day >= s && w.day <= e).length }; });
  const groups: Record<string, number> = {};
  for (const w of w30) for (const e of w.exercises) groups[e.ex.group] = (groups[e.ex.group] ?? 0) + Math.max(1, e.sets.length);
  // свои упражнения: последний раз, лучший результат, сколько раз
  const seen = new Map<string, { ex: Exercise; day: string; times: number }>();
  for (const w of list) for (const e of w.exercises) { const c = seen.get(e.key); if (c) c.times++; else seen.set(e.key, { ex: e.ex, day: w.day, times: 1 }); }
  const myEx = [...seen.entries()].map(([key, v]) => ({ key, ...v, best: best(list, key) })).sort((a, b) => b.day.localeCompare(a.day));
  // новые рекорды за 30 дней: тренировка, где лучший вес выше всего, что было до неё
  let newPr = 0;
  for (const m of myEx) if (m.ex.kind === 'w') { let top = 0; for (const h of history(list, m.key).reverse()) { const t = Math.max(0, ...h.sets.map(s => s.kg ?? 0)); if (top && t > top && h.day >= from30) newPr++; top = Math.max(top, t); } }
  // повторить: разные тренировки по названию, последние три
  const repeat: Workout[] = [];
  for (const w of list) { if (w.exercises.length && !repeat.some(r => r.title === w.title)) repeat.push(w); if (repeat.length >= 3) break; }
  const plans = await db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).orderBy(asc(workoutPlans.createdAt));
  const wd = weekday(today), [live] = await db.select().from(liveWorkouts).where(eq(liveWorkouts.userId, userId));
  const own = my.map(m => m.ex);
  return {
    today, total: list.length,
    kpi: { week: w7.length, month: w30.length, perWeek: Math.round(w30.length / 30 * 7 * 10) / 10, volumeWeek: Math.round(w7.reduce((a, w) => a + volume(w), 0)), newPr },
    weeks, groups: Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => ({ group: g, name: GYM_GROUPS[g]?.[0] ?? g, color: GYM_GROUPS[g]?.[1] ?? '#3C5B38', sets: n })),
    missing: Object.keys(GYM_GROUPS).filter(g => g !== 'cardio' && g !== 'full' && !groups[g]).map(g => GYM_GROUPS[g]![0]),
    plans: plans.map(p => ({ id: p.id, name: p.name, weekdays: p.weekdays, time: p.time, exercises: p.exercises.map(e => ({ ...e, ex: resolve(e.exerciseKey, e.name, [], my) })), today: p.weekdays.includes(wd) })),
    myExercises: myEx.slice(0, 30), custom: own,
    recent: list.slice(0, 30).map(w => ({ ...w, volume: Math.round(volume(w)) })),
    repeat: repeat.map(w => ({ id: w.id, title: w.title, day: w.day, exercises: w.exercises.map(e => ({ key: e.key, icon: e.ex.icon, group: e.ex.group })) })),
    trainedToday: list.some(w => w.day === today), live: live?.data ?? null
  };
}

export async function exerciseInfo(db: Tx, userId: string, key: string) {
  const { list, my } = await loadWorkouts(db, userId);
  const ex = exById(key, my.map(m => m.ex)) ?? list.flatMap(w => w.exercises).find(e => e.key === key)?.ex;
  if (!ex) return null;
  const hist = history(list, key);
  return { ex, best: best(list, key), workouts: hist.length, sets: hist.reduce((a, h) => a + h.sets.length, 0), history: hist.slice(0, 40) };
}

/** прошлый раз и рекорд — для подсказок в идущей тренировке */
export async function hints(db: Tx, userId: string, keys: string[], skip?: string) {
  const { list } = await loadWorkouts(db, userId);
  return Object.fromEntries(keys.map(k => { const h = history(list, k, skip); return [k, { prev: h[0] ? { day: h[0].day, sets: h[0].sets } : null, best: best(list, k, skip) }]; }));
}

/* ---------- запись ---------- */
export interface WorkoutInput { day: string; time: string | null; title: string; minutes: number | null; note: string | null; planId: string | null; exercises: Array<{ key: string | null; name: string; sets: WSet[] }> }
const num = (v: unknown, hi: number) => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 && x <= hi ? Math.round(x * 100) / 100 : null; };
export function workoutBody(b: Record<string, unknown>, day: string, hm: (v: unknown) => string | null): WorkoutInput {
  const exs = (Array.isArray(b.exercises) ? b.exercises : []).slice(0, 40).map((e: any) => ({
    key: typeof e?.key === 'string' && e.key && !e.key.startsWith('n:') ? e.key.slice(0, 80) : null, name: String(e?.name ?? '').trim().slice(0, 80),
    sets: (Array.isArray(e?.sets) ? e.sets : []).slice(0, 30).map((s: any) => ({ kg: num(s?.kg, 1000), reps: s?.reps == null || s.reps === '' ? null : Math.round(num(s.reps, 1000) ?? 0), seconds: s?.seconds == null || s.seconds === '' ? null : Math.round(num(s.seconds, 86400) ?? 0), minutes: num(s?.minutes, 1440), km: num(s?.km, 500) }))
      .filter((s: WSet) => Object.values(s).some(v => v))
  })).filter(e => e.name && e.sets.length);
  if (!exs.length) throw bad('Отметь хотя бы один подход.');
  const m = b.minutes === undefined || b.minutes === null || b.minutes === '' ? null : Math.round(Number(b.minutes));
  return { day, time: hm(b.time), title: String(b.title ?? '').trim().slice(0, 60), minutes: m !== null && m >= 0 && m <= 600 ? m : null, note: String(b.note ?? '').trim().slice(0, 1000) || null, planId: typeof b.planId === 'string' && /^[0-9a-f-]{36}$/.test(b.planId) ? b.planId : null, exercises: exs };
}

/** сохранить тренировку (новую или правку). Возвращает новые рекорды веса — относительно всего, что было до неё */
export async function saveWorkout(db: Tx, userId: string, v: WorkoutInput, id?: string) {
  const { list, my } = await loadWorkouts(db, userId);
  if (id && !list.some(w => w.id === id)) return null;
  const resolved = v.exercises.map(e => ({ ...e, ex: resolve(e.key, e.name, e.sets, my) }));
  const title = v.title || workoutTitle(resolved.map(e => ({ group: e.ex.group, sets: e.sets.length })));
  const prs: string[] = [];
  for (const e of resolved) if (e.ex.kind === 'w') { const before = best(list, e.ex.id, id).kg, now = Math.max(0, ...e.sets.map(s => s.kg ?? 0)); if (before && now > before) prs.push(`${e.ex.name} ${(Math.round(now * 10) / 10).toLocaleString('ru-RU')} кг`); }
  const row = { day: v.day, time: v.time, title, minutes: v.minutes, note: v.note, planId: v.planId };
  const saved = await (async () => {
    const [w] = id ? await db.update(workouts).set({ ...row, updatedAt: new Date() }).where(and(eq(workouts.userId, userId), eq(workouts.id, id))).returning()
      : await db.insert(workouts).values({ userId, ...row }).returning();
    await db.delete(workoutExercises).where(eq(workoutExercises.workoutId, w!.id));
    const exRows = await db.insert(workoutExercises).values(resolved.map((e, i) => ({ workoutId: w!.id, position: i, exerciseKey: e.ex.id.startsWith('n:') ? null : e.ex.id, name: e.ex.name }))).returning({ id: workoutExercises.id, position: workoutExercises.position });
    const sets = exRows.flatMap(r => resolved[r.position]!.sets.map((s, j) => ({ workoutExerciseId: r.id, position: j, ...s })));
    if (sets.length) await db.insert(workoutSets).values(sets);
    await recordEvent(db, { userId, module: 'gym', kind: 'workout', refId: w!.id, day: w!.day, time: w!.time, title, value: w!.minutes, unit: 'min' });
    return w!;
  })();
  const vol = resolved.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.kg ?? 0) * (s.reps ?? 0), 0), 0), sets = resolved.reduce((a, e) => a + e.sets.length, 0);
  return { id: saved.id, title, prs, volume: Math.round(vol), sets };
}
export async function deleteWorkout(db: Tx, userId: string, id: string) {
  const r = await db.delete(workouts).where(and(eq(workouts.userId, userId), eq(workouts.id, id))).returning({ id: workouts.id });
  if (r.length) await removeEvents(db, userId, [id]);
  return r.length > 0;
}

/* ---------- планы, свои упражнения, идущая тренировка ---------- */
export async function savePlan(db: Tx, userId: string, v: { name: string; weekdays: number[]; time: string | null; exercises: Array<{ exerciseKey: string | null; name: string; sets: number }> }, id?: string) {
  if (id) { const [p] = await db.update(workoutPlans).set(v).where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.id, id))).returning(); return p ?? null; }
  const [p] = await db.insert(workoutPlans).values({ userId, ...v }).returning(); return p!;
}
export const deletePlan = async (db: Tx, userId: string, id: string) => (await db.delete(workoutPlans).where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.id, id))).returning({ id: workoutPlans.id })).length > 0;
export async function addExercise(db: Tx, userId: string, v: { name: string; group: string; kind: GymKind; icon: string; equip: string | null }) {
  const [r] = await db.insert(userExercises).values({ userId, name: v.name, muscleGroup: v.group, kind: v.kind, icon: v.icon, equipment: v.equip }).returning();
  return { id: r!.id, name: r!.name, group: r!.muscleGroup, kind: r!.kind as GymKind, icon: r!.icon, equip: r!.equipment ?? '' } satisfies Exercise;
}
export const getLive = async (db: Tx, userId: string) => (await db.select().from(liveWorkouts).where(eq(liveWorkouts.userId, userId)))[0] ?? null;
export async function putLive(db: Tx, userId: string, data: unknown) {
  await db.insert(liveWorkouts).values({ userId, data }).onConflictDoUpdate({ target: liveWorkouts.userId, set: { data, updatedAt: sql`now()` } });
}
export const dropLive = (db: Tx, userId: string) => db.delete(liveWorkouts).where(eq(liveWorkouts.userId, userId));
export const CATALOG = EXERCISES;
