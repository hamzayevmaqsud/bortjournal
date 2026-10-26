/**
 * Внешний вид за уровень: темы и мелочи интерфейса открываются с уровнем (packages/core/src/looks.ts).
 * Уровень — из достижений (каждые 4 ступени) или выставленный вручную (users.level_override), берётся наибольший.
 * Выбор хранится в profiles.settings.look; закрытое на текущем уровне сервер не сохранит.
 * settings.levelSeen — до какого уровня человек уже видел поздравление «Новый уровень».
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_LOOK, LOOK_EXTRAS, LOOK_THEMES, lookLevel, lookOf, unlockedBetween, type Look } from '@bortjournal/core';
import type { DB, Tx } from '../db/index.js';
import { requireUser } from './auth.js';
import { bad, uid } from './http.js';
import { profiles, users } from './schema.js';
import { patchSettings } from './settings.js';
import { awardsState } from './stats.js';

export async function levelOf(db: DB | Tx, userId: string) {
  const [s, [u]] = await Promise.all([awardsState(db as Tx, userId), db.select({ o: users.levelOverride }).from(users).where(eq(users.id, userId))]);
  const earned = Math.floor(s.total / 4) + 1;
  return { level: Math.max(earned, u?.o ?? 0), earned };
}

async function state(db: DB, userId: string) {
  const [{ level }, [p]] = await Promise.all([levelOf(db, userId), db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, userId))]);
  const st = (p?.s ?? {}) as Record<string, any>;
  // первый заход после появления уровней: набранное раньше — точка отсчёта (без поздравления), дальше — каждый новый уровень
  let seen = st.levelSeen as number;
  if (!Number.isInteger(seen)) { seen = level; await patchSettings(db, userId, { levelSeen: level }); }
  return {
    level, seen, look: lookOf(st.look, level),
    fresh: level > seen ? unlockedBetween(seen, level) : [],
    themes: LOOK_THEMES.map(t => ({ ...t, open: t.level <= level })),
    extras: LOOK_EXTRAS.map(e => ({ ...e, open: e.level <= level }))
  };
}

export async function lookRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/look', { preHandler: requireUser }, async req => state(db, uid(req)));

  app.put('/api/look', { preHandler: requireUser }, async req => {
    const b = (req.body ?? {}) as Record<string, unknown>, { level } = await levelOf(db, uid(req));
    const [p] = await db.select({ s: profiles.settings }).from(profiles).where(eq(profiles.userId, uid(req)));
    const next: Look = lookOf(((p?.s ?? {}) as Record<string, unknown>).look, level);
    for (const k of Object.keys(DEFAULT_LOOK) as Array<keyof Look>) {
      if (b[k] === undefined) continue;
      const v = String(b[k]), need = lookLevel(k, v);
      if (need === null) throw bad('Такого варианта нет.');
      if (need > level) throw bad(`Откроется на уровне ${need}.`);
      next[k] = v;
    }
    await patchSettings(db, uid(req), { look: next });
    return { look: next, level };
  });

  // поздравление «Новый уровень» показано — запомнить, чтобы не повторять
  app.post('/api/look/seen', { preHandler: requireUser }, async req => {
    const { level } = await levelOf(db, uid(req));
    await patchSettings(db, uid(req), { levelSeen: level });
    return { seen: level };
  });
}
