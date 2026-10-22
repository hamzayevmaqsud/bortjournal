/**
 * Черновики приёма: фото еды разбирается в фоне. Таблица food_drafts — и сущность, и очередь (ADR-0002).
 * queued → working → ready | failed. Воркер берёт черновики через workDrafts.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DB, Tx } from '../../db/index.js';
import { recognizeFood } from './ai.js';
import { drafts } from './schema.js';

type Draft = typeof drafts.$inferSelect;
export interface DraftInput { day: string; time: string | null; slot: string | null; image: string; mime: string; note: string; scale: string }

/** то, что видит человек: без фото */
export function draftView(d: Draft) {
  const r = d.result;
  return { id: d.id, state: d.state, day: d.day, time: d.time, slot: d.slot, note: d.note, scale: d.scale, answers: d.answers,
    isFood: r?.isFood ?? null, items: r?.items ?? [], questions: r?.questions ?? [], comment: r?.comment ?? '', error: d.error, attempts: d.attempts, createdAt: d.createdAt };
}

export async function createDraft(db: Tx, userId: string, v: DraftInput) {
  const [row] = await db.insert(drafts).values({ userId, ...v }).returning();
  return draftView(row!);
}
export async function getDraft(db: Tx, userId: string, id: string) {
  const [row] = await db.select().from(drafts).where(and(eq(drafts.userId, userId), eq(drafts.id, id)));
  return row ? draftView(row) : null;
}
export async function listDrafts(db: Tx, userId: string) {
  return (await db.select().from(drafts).where(eq(drafts.userId, userId)).orderBy(asc(drafts.createdAt))).map(draftView);
}

/** забрать один черновик из очереди: queued, время пришло; skip locked — два воркера не возьмут один и тот же */
async function claim(db: DB, at: Date) {
  const res = await db.execute<{ id: string }>(sql`
    update ${drafts} set state = 'working', attempts = ${drafts.attempts} + 1, started_at = ${at.toISOString()}::timestamptz
    where ${drafts.id} = (select id from ${drafts} where ${drafts.state} = 'queued' and ${drafts.nextAt} <= ${at.toISOString()}::timestamptz
      order by ${drafts.nextAt} for update skip locked limit 1)
    returning ${drafts.id} as id`);
  const id = res.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
  return row ?? null;
}

/** один проход: разобрать все черновики, которым пора. Возвращает, сколько обработано */
export async function workDrafts(db: DB, at = new Date()) {
  let n = 0;
  for (let d = await claim(db, at); d; d = await claim(db, at)) {
    const result = await recognizeFood({ image: d.image, mime: d.mime, note: d.note, scale: d.scale, answers: d.answers });
    await db.update(drafts).set({ state: 'ready', result, error: null }).where(eq(drafts.id, d.id));
    n++;
  }
  return n;
}
