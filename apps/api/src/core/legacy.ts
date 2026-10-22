/** Помощники для переноса из старого журнала: старые данные никто не проверял, поэтому всё — с защитой */
import { and, eq, isNotNull, type Column } from 'drizzle-orm';
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const hm = (s: unknown) => (typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, '0') : null);
export const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const optNum = (v: unknown) => (v === undefined || v === null || v === '' ? null : num(v));
export const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).slice(0, max));
export const optStr = (v: unknown, max = 2000) => { const s = str(v, max); return s ? s : null; };
export const inRange = (v: number | null, lo: number, hi: number) => (v !== null && v >= lo && v <= hi ? v : null);
export const list = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : []);
export const dict = <T = any>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {});
export const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
/** записи с повторяющимся id в старом журнале: оставляем последнюю, как и при записи в базу */
export const uniqById = <T extends { id?: unknown }>(xs: T[]): T[] => [...new Map(xs.map((x, i) => [x?.id == null ? `#${i}` : String(x.id), x])).values()];

/** записи человека для сверки; при импорте в живой аккаунт (legacyOnly) — только перенесённые, у которых есть legacy_id */
export const owned = (ctx: { userId: string; legacyOnly?: boolean }, user: Column, legacy?: Column) =>
  ctx.legacyOnly && legacy ? and(eq(user, ctx.userId), isNotNull(legacy)) : eq(user, ctx.userId);
