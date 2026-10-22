/**
 * Черновики приёма: фото еды разбирается в фоне. Таблица food_drafts — и сущность, и очередь (ADR-0002).
 * queued → working → ready | failed. Воркер берёт черновики через workDrafts.
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DB, Tx } from '../../db/index.js';
import { pushToUser } from '../../core/push.js';
import { recognizeFood, type AiResult } from './ai.js';
import { drafts } from './schema.js';

type Draft = typeof drafts.$inferSelect;
export interface DraftInput { day: string; time: string | null; slot: string | null; image: string; mime: string; note: string; scale: string }

/** то, что видит человек: без фото */
export function draftView(d: Draft) {
  const r = d.result;
  return { id: d.id, state: d.state, day: d.day, time: d.time, slot: d.slot, note: d.note, scale: d.scale, answers: d.answers,
    isFood: r?.isFood ?? null, items: r?.items ?? [], questions: r?.questions ?? [], comment: r?.comment ?? '', error: d.error, attempts: d.attempts, createdAt: d.createdAt };
}

type Sum = { kcal: number; protein: number; fat: number; carbs: number };
const ZERO: Sum = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
/** предварительные калории и БЖУ черновика: только у разобранного (ready) */
export function draftSum(d: Pick<Draft, 'state' | 'result'>): Sum {
  if (d.state !== 'ready' || !d.result?.isFood) return { ...ZERO };
  return (d.result.items as Array<Partial<Sum>>).reduce<Sum>((a, it) => ({ kcal: a.kcal + (Number(it.kcal) || 0), protein: a.protein + (Number(it.protein) || 0), fat: a.fat + (Number(it.fat) || 0), carbs: a.carbs + (Number(it.carbs) || 0) }), { ...ZERO });
}
const owned = (userId: string, id: string) => and(eq(drafts.userId, userId), eq(drafts.id, id));

/** черновики дня (для дня еды и итогов) */
export async function dayDrafts(db: Tx, userId: string, day: string) {
  return db.select().from(drafts).where(and(eq(drafts.userId, userId), eq(drafts.day, day))).orderBy(sql`${drafts.time} nulls last`, asc(drafts.createdAt));
}
/** черновики за период — для дневных рядов статистики */
export async function rangeDrafts(db: Tx, userId: string, from: string, to: string) {
  return db.select({ day: drafts.day, state: drafts.state, result: drafts.result }).from(drafts).where(and(eq(drafts.userId, userId), gte(drafts.day, from), lte(drafts.day, to)));
}
export async function deleteDraft(db: Tx, userId: string, id: string) {
  return (await db.delete(drafts).where(owned(userId, id)).returning({ id: drafts.id })).length > 0;
}
/** подтверждение: черновик забирается (удаляется вместе с фото) и отдаёт день и время фото. Только разобранный */
export async function takeReadyDraft(db: Tx, userId: string, id: string) {
  const [row] = await db.delete(drafts).where(and(owned(userId, id), eq(drafts.state, 'ready'))).returning({ day: drafts.day, time: drafts.time });
  return row ?? null;
}

/** ответы на уточнения: только у разобранного черновика; он возвращается в очередь. null — нет такого, 'busy' — не разобран */
export async function answerDraft(db: Tx, userId: string, id: string, answers: string[]) {
  const [row] = await db.update(drafts).set({ answers, state: 'queued', attempts: 0, nextAt: sql`now()`, error: null })
    .where(and(owned(userId, id), eq(drafts.state, 'ready'))).returning();
  if (row) return draftView(row);
  return (await db.select({ id: drafts.id }).from(drafts).where(owned(userId, id))).length ? 'busy' as const : null;
}

/** «Повторить»: только неудавшийся черновик, попытки с нуля, лимит ИИ не тратится. null — нет такого, 'busy' — не неудавшийся */
export async function retryDraft(db: Tx, userId: string, id: string) {
  const [row] = await db.update(drafts).set({ state: 'queued', attempts: 0, nextAt: sql`now()`, error: null })
    .where(and(owned(userId, id), eq(drafts.state, 'failed'))).returning();
  if (row) return draftView(row);
  return (await db.select({ id: drafts.id }).from(drafts).where(owned(userId, id))).length ? 'busy' as const : null;
}

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
  const kcal = Math.round(draftSum({ state: 'ready', result: r }).kcal), names = r.items.map(i => i.name).slice(0, 3).join(', ');
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
