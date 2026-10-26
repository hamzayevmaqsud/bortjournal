/** Подзадачи: в дне родителя, переезжают с ним, родитель сделан, когда сделаны все, удаляются с ним; в счёт дня не идут */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '';
const H = { host: 'localhost' }, today = localNow(240).day;
const r = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
const day = async (d: string) => (await r('GET', `/api/plans/tasks?from=${d}&to=${d}`)).json().items as any[];

beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'mover', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'mover', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('подзадачи', () => {
  let root = '', a = '', b = '', deep = '';
  it('создаются в дне родителя, вложенность — в несколько уровней', async () => {
    root = (await r('POST', '/api/plans/tasks', { title: 'Переезд', day: today })).json().id;
    a = (await r('POST', '/api/plans/tasks', { title: 'Упаковать кухню', parentId: root, day: addDays(today, 5) })).json().id;
    b = (await r('POST', '/api/plans/tasks', { title: 'Заказать машину', parentId: root })).json().id;
    deep = (await r('POST', '/api/plans/tasks', { title: 'Купить коробки', parentId: a })).json().id;
    const items = await day(today);
    expect(items.filter((t: any) => t.parentId === root).map((t: any) => t.title).sort()).toEqual(['Заказать машину', 'Упаковать кухню']);
    expect(items.find((t: any) => t.id === deep)).toMatchObject({ parentId: a, day: today });
    const t = (await r('GET', `/api/today?day=${today}`)).json();
    const top = t.parts?.plans?.tasks ?? t.plans?.tasks ?? [];
    expect(top.map((x: any) => x.title)).toEqual(['Переезд']); // на «Сегодня» — только верхняя задача
    expect(top[0].sub).toEqual({ n: 2, done: 0 });
  });
  it('перенос родителя переносит всю ветку', async () => {
    await r('PUT', `/api/plans/tasks/${root}`, { title: 'Переезд', day: addDays(today, 1) });
    expect((await day(addDays(today, 1))).map((t: any) => t.id).sort()).toEqual([root, a, b, deep].sort());
    await r('PUT', `/api/plans/tasks/${root}`, { title: 'Переезд', day: today });
  });
  it('родитель сделан, когда сделаны все подзадачи; обратно — снова нет', async () => {
    await r('POST', `/api/plans/tasks/${deep}/toggle`);
    expect((await day(today)).find((t: any) => t.id === a).done).toBe(true); // единственная подзадача «Упаковать» сделана
    await r('POST', `/api/plans/tasks/${b}/toggle`);
    expect((await day(today)).find((t: any) => t.id === root).done).toBe(true);
    await r('POST', `/api/plans/tasks/${b}/toggle`);
    expect((await day(today)).find((t: any) => t.id === root).done).toBe(false);
  });
  it('сделал задачу — сделаны и подзадачи; новая подзадача снова открывает родителя', async () => {
    await r('POST', `/api/plans/tasks/${root}/toggle`);
    expect((await day(today)).filter((t: any) => [root, a, b, deep].includes(t.id)).every((t: any) => t.done)).toBe(true);
    await r('POST', '/api/plans/tasks', { title: 'Сдать ключи', parentId: root });
    expect((await day(today)).find((t: any) => t.id === root).done).toBe(false);
  });
  it('в счёт дня идут только верхние задачи; удаление убирает ветку', async () => {
    const [d] = (await r('GET', `/api/stats/day?day=${today}`)).json().facts ? [(await r('GET', `/api/stats/day?day=${today}`)).json().facts] : [null];
    expect(d.tasks).toBe(1);
    await r('DELETE', `/api/plans/tasks/${root}`);
    expect((await day(today)).length).toBe(0);
  });
  it('глубже пяти уровней — нельзя', async () => {
    let p = (await r('POST', '/api/plans/tasks', { title: 'L0', day: today })).json().id;
    for (let i = 1; i <= 4; i++) p = (await r('POST', '/api/plans/tasks', { title: `L${i}`, parentId: p })).json().id;
    expect((await r('POST', '/api/plans/tasks', { title: 'L5', parentId: p })).statusCode).toBe(400);
  });
});
