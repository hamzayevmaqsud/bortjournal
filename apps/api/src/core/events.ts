/**
 * Лента событий. Модуль вызывает recordEvent, когда создаёт или меняет запись,
 * и removeEvents, когда удаляет. Одна запись модуля — одно событие каждого вида (ref_id + kind).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ModuleName } from '@bortjournal/core';
import type { Tx } from '../db/index.js';
import { events } from './schema.js';

export interface EventInput {
  userId: string;
  module: ModuleName;
  kind: string;
  /** запись модуля; undefined — событие не пишется (нет записи, на которую ссылаться) */
  refId?: string | null;
  day: string;
  time?: string | null;
  title: string;
  value?: number | null;
  unit?: string | null;
  data?: Record<string, unknown> | null;
}

export async function recordEvents(db: Tx, list: EventInput[]) {
  // одна запись — одно событие вида: дубли в источнике схлопываем, оставляя последнее
  list = [...new Map(list.filter(e => e.refId !== undefined).map(e => [`${e.refId ?? ''}|${e.kind}|${e.refId === null ? Math.random() : ''}`, e])).values()];
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500).map(e => ({ ...e, refId: e.refId ?? null, time: e.time ?? null, value: e.value ?? null, unit: e.unit ?? null, data: e.data ?? null }));
    await db.insert(events).values(chunk).onConflictDoUpdate({
      target: [events.refId, events.kind], targetWhere: sql`${events.refId} is not null`,
      set: { day: sql`excluded.day`, time: sql`excluded.time`, title: sql`excluded.title`, value: sql`excluded.value`, unit: sql`excluded.unit`, data: sql`excluded.data` }
    });
  }
}
export const recordEvent = (db: Tx, e: EventInput) => recordEvents(db, [e]);

export async function removeEvents(db: Tx, userId: string, refIds: string[]) {
  if (refIds.length) await db.delete(events).where(and(eq(events.userId, userId), inArray(events.refId, refIds)));
}

export async function dayEvents(db: Tx, userId: string, day: string) {
  return db.select().from(events).where(and(eq(events.userId, userId), eq(events.day, day))).orderBy(sql`${events.time} nulls last`, events.id);
}
