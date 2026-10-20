/** Зал: тренировки по подходам, рекорды, обзор, история упражнения, черновик идущей тренировки, планы, свои упражнения */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {}, H = { host: 'localhost' }, today = localNow(240).day;
const as = (who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });

beforeAll(async () => {
  conn = await freshDb();
  for (const name of ['lifter', 'free']) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id);
    if (name === 'lifter') await grant(conn.db, u!.id, 'pro', 'free');
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of ['lifter', 'free']) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('зал', () => {
  it('без раздела «Зал» — 402', async () => { expect((await as('free', 'GET', '/api/gym/overview')).statusCode).toBe(402); });
  it('тренировка: название по мышцам, объём; вторая — новый рекорд', async () => {
    const w1 = await as('lifter', 'POST', '/api/gym/workouts', { day: addDays(today, -3), time: '19:00', minutes: 60, exercises: [
      { key: 'bench', name: 'Жим штанги лёжа', sets: [{ kg: 60, reps: 10 }, { kg: 70, reps: 8 }] },
      { key: 'pushdown', name: 'Разгибание на блоке', sets: [{ kg: 20, reps: 12 }] },
      { key: null, name: 'пустое', sets: [{}] }] });
    expect(w1.statusCode).toBe(201);
    expect(w1.json()).toMatchObject({ title: 'Грудь + Руки', volume: 1400, sets: 3, prs: [] });
    const w2 = (await as('lifter', 'POST', '/api/gym/workouts', { day: today, exercises: [{ key: 'bench', name: 'Жим', sets: [{ kg: '72,5', reps: 5 }] }, { key: null, name: 'Планка', sets: [{ seconds: 90 }] }] })).json();
    expect(w2.prs).toEqual(['Жим штанги лёжа 72,5 кг']);
    expect((await as('lifter', 'POST', '/api/gym/workouts', { day: today, exercises: [{ name: 'x', sets: [] }] })).statusCode).toBe(400);
  });
  it('обзор: счётчики, мышцы, свои упражнения, повторить', async () => {
    const o = (await as('lifter', 'GET', '/api/gym/overview')).json();
    expect(o.kpi).toMatchObject({ week: 2, month: 2, newPr: 1 });
    expect(o.groups[0]).toMatchObject({ group: 'chest', sets: 3 });
    expect(o.missing).toContain('Ноги');
    const bench = o.myExercises.find((m: any) => m.key === 'bench');
    expect(bench).toMatchObject({ times: 2, best: { kg: 72.5 } });
    // «Планка» без ключа узнана по названию из каталога
    expect(o.myExercises.some((m: any) => m.key === 'plank' && m.ex.kind === 't')).toBe(true);
    expect(o.trainedToday).toBe(true);
    expect(o.weeks).toHaveLength(12);
  });
  it('история упражнения и подсказки «прошлый раз»', async () => {
    const e = (await as('lifter', 'GET', '/api/gym/exercise/bench')).json();
    expect(e).toMatchObject({ workouts: 2, sets: 3, best: { kg: 72.5, rm: 88.5 } }); // 70×8 по Эпли тяжелее, чем 72,5×5
    expect(e).toMatchObject({ workouts: 2 });
    expect(e.history[0].day).toBe(today);
    const h = (await as('lifter', 'GET', '/api/gym/hints?keys=bench,squat')).json();
    expect(h.bench.prev.sets[0].kg).toBe(72.5);
    expect(h.squat.prev).toBeNull();
  });
  it('черновик идущей тренировки живёт в базе', async () => {
    await as('lifter', 'PUT', '/api/gym/live', { live: { start: 'x', ex: [{ key: 'squat', sets: [{ kg: 80 }] }] } });
    expect((await as('lifter', 'GET', '/api/gym/live')).json().live.ex[0].key).toBe('squat');
    await as('lifter', 'POST', '/api/gym/workouts', { day: today, fromLive: true, exercises: [{ key: 'squat', name: 'Присед', sets: [{ kg: 80, reps: 5 }] }] });
    expect((await as('lifter', 'GET', '/api/gym/live')).json().live).toBeNull();
  });
  it('планы и свои упражнения', async () => {
    const p = (await as('lifter', 'POST', '/api/gym/plans', { name: 'Грудь', weekdays: [1, 4, 4, 9], time: '19:00', exercises: [{ key: 'bench', name: 'Жим', sets: 4 }] })).json();
    expect(p.weekdays).toEqual([1, 4]);
    const ex = (await as('lifter', 'POST', '/api/gym/exercises', { name: 'Жим Смита', group: 'chest', kind: 'w', icon: 'bench' })).json();
    await as('lifter', 'POST', '/api/gym/workouts', { day: today, exercises: [{ key: ex.id, name: 'Жим Смита', sets: [{ kg: 50, reps: 10 }] }] });
    const o = (await as('lifter', 'GET', '/api/gym/overview')).json();
    expect(o.plans[0]).toMatchObject({ name: 'Грудь', exercises: [{ name: 'Жим', ex: { id: 'bench' } }] });
    expect(o.myExercises.find((m: any) => m.key === ex.id).ex.name).toBe('Жим Смита');
    expect((await as('lifter', 'DELETE', `/api/gym/plans/${p.id}`)).statusCode).toBe(200);
  });
  it('удаление тренировки убирает её из ленты дня', async () => {
    const o = (await as('lifter', 'GET', '/api/gym/overview')).json(), id = o.recent[0].id;
    expect((await as('lifter', 'DELETE', `/api/gym/workouts/${id}`)).statusCode).toBe(200);
    const t = (await as('lifter', 'GET', `/api/today?day=${today}`)).json();
    expect(t.events.some((e: any) => e.id === id)).toBe(false);
  });
});
