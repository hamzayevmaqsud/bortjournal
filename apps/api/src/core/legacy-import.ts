/**
 * Перенос из старого журнала (data/users.json + data/state/<user>.json) в Postgres.
 * Ядро переносит аккаунт, профиль, доступ, заметки дня, достижения и подписки;
 * каждый модуль — свои данные через AppModule.importLegacy. Всё по пользователю в одной транзакции:
 * либо пользователь перенесён целиком и сверка сошлась, либо ничего не записано.
 */
import { eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import type { DB, Tx } from '../db/index.js';
import { MODULES_LIST } from '../modules/index.js';
import { grant, grantFree } from './entitlements.js';
import { dict, inRange, isDay, list, num, optNum, optStr, str } from './legacy.js';
import type { ImportCheck, LegacyState } from './module.js';
import { achievements, activityWeeks, dayJournal, profiles, pushSubscriptions, users } from './schema.js';

export interface UserReport { username: string; userId: string; checks: ImportCheck[]; warnings: string[]; ok: boolean }

const readJson = (file: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

export async function importLegacy(db: DB, dataDir: string, opts: { only?: string } = {}): Promise<UserReport[]> {
  const accounts = dict<any>(readJson(path.join(dataDir, 'users.json'), {}));
  const pushDb = dict<any>(readJson(path.join(dataDir, 'push.json'), {}));
  const out: UserReport[] = [];
  for (const [username, acc] of Object.entries(accounts)) {
    if (opts.only && opts.only !== username) continue;
    const st: LegacyState = dict(readJson(path.join(dataDir, 'state', `${username}.json`), {})?.state);
    const warnings: string[] = [];
    // откат при расхождении: бросаем исключение изнутри транзакции
    let report: UserReport | null = null;
    try {
      await db.transaction(async tx => {
        const hash = typeof acc?.salt === 'string' && typeof acc?.hash === 'string' ? `scrypt$16384$8$1$${acc.salt}$${acc.hash}` : null;
        if (!hash) throw new Error('нет хеша пароля');
        const tzOffset = Math.round(num(pushDb[username]?.tz));
        const [found] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${username})`);
        const userId = found
          ? (await tx.update(users).set({ passwordHash: hash, tzOffset }).where(sql`${users.id} = ${found.id}`).returning({ id: users.id }))[0]!.id
          : (await tx.insert(users).values({ username, passwordHash: hash, createdAt: acc.created ? new Date(acc.created) : new Date(), tzOffset }).returning({ id: users.id }))[0]!.id;
        const warn = (m: string) => warnings.push(m);
        await grantFree(tx, userId);
        await grant(tx, userId, 'pro', 'free'); // пользователи старого журнала — Pro навсегда
        for (const sub of list(pushDb[username]?.subs)) if (str(sub?.endpoint) && sub?.keys?.p256dh && sub?.keys?.auth)
          await tx.insert(pushSubscriptions).values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }).onConflictDoNothing();
        const checks = await importState(tx, userId, st, { warn, dataDir, username });
        const ok = checksOk(checks);
        report = { username, userId, checks, warnings, ok };
        if (!ok) throw new RollbackError();
      });
    } catch (e) {
      if (!(e instanceof RollbackError)) { out.push({ username, userId: '', checks: [], warnings: [...warnings, `ошибка: ${(e as any).cause?.message ?? (e as Error).message.slice(0, 300)}`], ok: false }); continue; }
    }
    if (report) out.push(report);
  }
  return out;
}
class RollbackError extends Error {}

/**
 * Перенос состояния старого журнала в аккаунт userId: профиль и настройки, активность, заметки дня, достижения
 * и данные модулей, затем сверка. Доступ (Pro) и подписки на уведомления не трогает — это решает вызывающий.
 * Идемпотентно: записи модулей сопоставляются по legacy_id.
 */
export async function importState(db: Tx, userId: string, st: LegacyState, opts: { warn(m: string): void; dataDir?: string; username?: string; merge?: boolean }) {
  const ctx = { db, userId, warn: opts.warn, dataDir: opts.dataDir, username: opts.username, legacyOnly: !!opts.merge };
  const p = dict(st.profile), s = dict(st.settings);
  const prof = {
    name: optStr(s.name, 60), sex: optStr(p.sex, 1), age: p.age ? Math.round(num(p.age)) : null, ageMeasuredOn: isDay(p.ageDate) ? p.ageDate : null,
    heightCm: p.height ? Math.round(num(p.height)) : null, bodyFat: optNum(p.bodyFat), build: optStr(p.build, 10), experience: optStr(p.experience, 10),
    goal: optStr(p.goal, 10), pace: optStr(p.pace, 10), targetKg: inRange(optNum(p.target), 20, 400), startWeightKg: inRange(optNum(p.startWeight ?? p.weight), 20, 400),
    startedOn: isDay(p.start) ? p.start : null, plannedSteps: p.steps ? Math.round(num(p.steps)) : null,
    settings: { ...s }
  };
  // merge — импорт в живой аккаунт: пустые поля файла не стирают анкету, свои настройки дополняются настройками файла
  if (opts.merge) {
    const [cur] = await db.select({ settings: profiles.settings }).from(profiles).where(eq(profiles.userId, userId));
    prof.settings = { ...dict(cur?.settings), ...s };
  }
  const set = opts.merge ? Object.fromEntries(Object.entries(prof).filter(([, v]) => v !== null)) : prof;
  await db.insert(profiles).values({ userId, ...prof }).onConflictDoUpdate({ target: profiles.userId, set });
  for (const [weekStart, level] of Object.entries(dict(st.activity))) if (isDay(weekStart) && typeof level === 'string')
    await db.insert(activityWeeks).values({ userId, weekStart, level }).onConflictDoUpdate({ target: [activityWeeks.userId, activityWeeks.weekStart], set: { level } });
  for (const [day, r] of Object.entries(dict(st.days))) {
    if (!isDay(day)) continue;
    const v = { note: optStr(r?.note, 5000), mood: inRange(r?.mood == null ? null : Math.round(num(r.mood)), 1, 5) };
    if (v.note || v.mood) await db.insert(dayJournal).values({ userId, day, ...v }).onConflictDoUpdate({ target: [dayJournal.userId, dayJournal.day], set: v });
  }
  for (const [k, day] of Object.entries(dict(st.achieved))) {
    const [key, tier] = k.split(':'); if (!key || !isDay(day) || !/^[0-3]$/.test(tier ?? '')) continue;
    await db.insert(achievements).values({ userId, key, tier: +tier!, unlockedOn: day as string }).onConflictDoNothing();
  }

  for (const k of ['meals', 'drinks', 'workouts', 'study', 'money', 'books', 'readLog', 'tasks', 'goals', 'series']) {
    const xs = list(st[k]), uniq = new Set(xs.map(x => String(x?.id))).size;
    if (xs.length > uniq) opts.warn(`${k}: в старом журнале ${xs.length - uniq} повторов одной записи — оставлена последняя версия`);
  }
  const checks: ImportCheck[] = [];
  for (const m of MODULES_LIST) {
    await m.importLegacy?.(ctx, st);
    checks.push(...((await m.verifyLegacy?.(ctx, st)) ?? []));
  }
  return opts.merge ? checks.map(c => ({ ...c, atLeast: true })) : checks;
}
/** сверка сошлась: суммы до копейки; при atLeast в базе может быть больше, но не меньше */
export const checksOk = (checks: ImportCheck[]) => checks.every(c => c.atLeast ? c.db >= c.source - 0.005 : Math.abs(c.source - c.db) < 0.005);

