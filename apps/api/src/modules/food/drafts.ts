/**
 * Черновики приёма: фото еды разбирается в фоне. Таблица food_drafts — и сущность, и очередь (ADR-0002).
 * queued → working → ready | failed. Воркер берёт черновики через workDrafts.
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DB, Tx } from '../../db/index.js';
import { pushToUser } from '../../core/push.js';
import { recognizeFood, type AiResult } from './ai.js';
import { drafts, type DraftState } from './schema.js';

type Draft = typeof drafts.$inferSelect;
export interface DraftInput { day: string; time: string | null; slot: string | null; image: string; mime: string; note: string; scale: string }

/** то, что видит человек: без фото */
export function draftView(d: Draft) {
  const r = d.result;
  return { id: d.id, state: d.state, day: d.day, time: d.time, slot: d.slot, note: d.note, scale: d.scale, answers: d.answers,
    isFood: r?.isFood ?? null, items: r?.items ?? [], questions: r?.questions ?? [], comment: r?.comment ?? '', error: d.error, attempts: d.attempts, createdAt: d.createdAt };
}

/** калории и БЖУ — то, что черновик добавляет к итогам дня */
export type Macros = { kcal: number; protein: number; fat: number; carbs: number };
export const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
export const addMacros = (a: Macros, b: Partial<Macros>): Macros => ({ kcal: a.kcal + (Number(b.kcal) || 0), protein: a.protein + (Number(b.protein) || 0), fat: a.fat + (Number(b.fat) || 0), carbs: a.carbs + (Number(b.carbs) || 0) });
/** предварительные калории и БЖУ черновика: по последнему разбору, в том числе пока идёт пересчёт после ответа на уточнение */
export function draftMacros(d: Pick<Draft, 'result'>): Macros {
  return d.result?.isFood ? (d.result.items as Array<Partial<Macros>>).reduce(addMacros, { ...ZERO }) : { ...ZERO };
}
/** черновик уже разобран и что-то добавляет к дню — в статистике он считается приёмом */
export const draftCounts = (d: Pick<Draft, 'result'>) => !!d.result?.isFood;
const owned = (userId: string, id: string) => and(eq(drafts.userId, userId), eq(drafts.id, id));

/** черновики дня (для дня еды и итогов) */
export async function dayDrafts(db: Tx, userId: string, day: string) {
  return db.select().from(drafts).where(and(eq(drafts.userId, userId), eq(drafts.day, day))).orderBy(sql`${drafts.time} nulls last`, asc(drafts.createdAt));
}
/** дни с черновиками — для серии: фото, ждущее подтверждения, уже запись */
export async function draftDays(db: Tx, userId: string, since: string) {
  return (await db.selectDistinct({ day: drafts.day }).from(drafts).where(and(eq(drafts.userId, userId), gte(drafts.day, since)))).map(r => r.day);
}
/** черновики за период — для дневных рядов статистики */
export async function rangeDrafts(db: Tx, userId: string, from: string, to: string) {
  return db.select({ day: drafts.day, result: drafts.result }).from(drafts).where(and(eq(drafts.userId, userId), gte(drafts.day, from), lte(drafts.day, to)));
}
export async function deleteDraft(db: Tx, userId: string, id: string) {
  return (await db.delete(drafts).where(owned(userId, id)).returning({ id: drafts.id })).length > 0;
}
/** подтверждение: черновик забирается (удаляется вместе с фото) и отдаёт день и время фото. Только разобранный */
export async function takeReadyDraft(db: Tx, userId: string, id: string) {
  const [row] = await db.delete(drafts).where(and(owned(userId, id), eq(drafts.state, 'ready'))).returning({ day: drafts.day, time: drafts.time, slot: drafts.slot });
  return row ?? null;
}

/** перевести черновик в очередь, если он в состоянии from. Результат: черновик, «нет такого» или «не в том состоянии» */
type Requeue = { ok: true; draft: ReturnType<typeof draftView> } | { ok: false; reason: 'missing' | 'wrong-state' };
async function requeue(db: Tx, userId: string, id: string, from: DraftState, set: Partial<typeof drafts.$inferInsert> = {}): Promise<Requeue> {
  const [row] = await db.update(drafts).set({ ...set, state: 'queued', attempts: 0, nextAt: sql`now()`, error: null })
    .where(and(owned(userId, id), eq(drafts.state, from))).returning();
  if (row) return { ok: true, draft: draftView(row) };
  return { ok: false, reason: (await db.select({ id: drafts.id }).from(drafts).where(owned(userId, id))).length ? 'wrong-state' : 'missing' };
}
/** ответы на уточнения: только у разобранного черновика; пересчёт идёт в фоне */
export const answerDraft = (db: Tx, userId: string, id: string, answers: string[]) => requeue(db, userId, id, 'ready', { answers });
/** «Повторить»: только неудавшийся черновик, попытки с нуля, лимит ИИ не тратится */
export const retryDraft = (db: Tx, userId: string, id: string) => requeue(db, userId, id, 'failed');

export async function createDraft(db: Tx, userId: string, v: DraftInput) {
  const [row] = await db.insert(drafts).values({ userId, ...v }).returning();
  return draftView(row!);
}
export async function getDraft(db: Tx, userId: string, id: string) {
  const [row] = await db.select().from(drafts).where(owned(userId, id));
  return row ? draftView(row) : null;
}
export async function listDrafts(db: Tx, userId: string) {
  return (await db.select().from(drafts).where(eq(drafts.userId, userId)).orderBy(asc(drafts.createdAt))).map(draftView);
}

/** попыток разбора и паузы перед повтором (после 1-й и 2-й неудачи); черновик в «разбирается» дольше STALE — воркер упал */
const ATTEMPTS = 3, PAUSE_SEC = [30, 120], STALE_MIN = 5;

/** забрать один черновик: из очереди, когда пришло время, или зависший после падения воркера. skip locked — два воркера не возьмут один.
 *  «Сейчас» — время базы (часы Node и Postgres могут расходиться); at задают тесты, чтобы прокрутить время вперёд */
async function claim(db: DB, now: ReturnType<typeof sql>) {
  const res = await db.execute<{ id: string }>(sql`
    update ${drafts} set state = 'working', attempts = ${drafts.attempts} + 1, started_at = ${now}
    where ${drafts.id} = (select id from ${drafts}
      where (${drafts.state} = 'queued' and ${drafts.nextAt} <= ${now})
         or (${drafts.state} = 'working' and ${drafts.startedAt} < ${now} - make_interval(mins => ${STALE_MIN}))
      order by ${drafts.nextAt} for update skip locked limit 1)
    returning ${drafts.id} as id`);
  const id = res.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  return row ?? null;
}

/** сбой, после которого повтор может помочь: лимит, недоступность, сеть. Отказ по содержимому (400/403) — нет */
const retryable = (e: unknown) => { const st = (e as { upstream?: number }).upstream; return st === undefined || st === 429 || st >= 500; };

/** напоминание «Фото разобрано»: что нашлось и сколько калорий, а если есть вопрос — сам вопрос */
async function notifyReady(db: DB, d: Draft, r: AiResult) {
  const kcal = Math.round(draftMacros({ result: r }).kcal), names = r.items.map(i => i.name).slice(0, 3).join(', ');
  const q = r.questions[0];
  await pushToUser(db, d.userId, {
    title: q ? 'Фото разобрано, есть вопрос' : 'Фото разобрано',
    body: q ? `${q.text} Ответь — и пересчитаю.` : `${names} — ${kcal} ккал. Проверь и сохрани.`,
    url: `/#food?draft=${d.id}`, tag: `draft:${d.id}`
  });
}

/** один проход: разобрать все черновики, которым пора. Возвращает, сколько обработано */
export async function workDrafts(db: DB, at?: Date) {
  const now = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`;
  let n = 0;
  for (let d = await claim(db, now); d; d = await claim(db, now)) {
    n++;
    let result: AiResult;
    try { result = await recognizeFood({ image: d.image, mime: d.mime, note: d.note, scale: d.scale, answers: d.answers }); }
    catch (e) {
      const msg = (e as Error).message || 'ИИ недоступен.';
      if (retryable(e) && d.attempts < ATTEMPTS)
        await db.update(drafts).set({ state: 'queued', error: msg, nextAt: sql`${now} + make_interval(secs => ${PAUSE_SEC[d.attempts - 1] ?? PAUSE_SEC.at(-1)!})` }).where(eq(drafts.id, d.id));
      else await db.update(drafts).set({ state: 'failed', error: msg }).where(eq(drafts.id, d.id));
      continue;
    }
    // «не еда» — повтор не поможет: черновик сразу не удался, с объяснением ИИ
    if (!result.isFood) { await db.update(drafts).set({ state: 'failed', result, error: result.comment || 'На фото не нашлось еды.' }).where(eq(drafts.id, d.id)); continue; }
    await db.update(drafts).set({ state: 'ready', result, error: null }).where(eq(drafts.id, d.id));
    await notifyReady(db, d, result);
  }
  return n;
}
