/** Плагин Obsidian: заметки по личному ключу становятся конспектами; дневник разделов, поиск, архив */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { and, eq } from 'drizzle-orm';
import { noteLog } from '../src/modules/study/schema.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {}, keys: Record<string, string> = {};
const H = { host: 'localhost' };
const as = (who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie: cookies[who]! } });
const plugin = (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/study/obsidian${url}`, payload: payload as any, headers: { ...H, ...(who ? { authorization: `Bearer ${keys[who] ?? who}` } : {}) } });

const NOTE = '# Делегаты\n\nВводная.\n\n## Что это\nТип для ссылки на метод.\n\n## Events\nПодписка через +=.\n';

beforeAll(async () => {
  conn = await freshDb();
  for (const [name, pro] of [['writer', true], ['other', true], ['free', false]] as const) {
    const [u] = await conn.db.insert(s.users).values({ username: name, passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
    await grantFree(conn.db, u!.id); if (pro) await grant(conn.db, u!.id, 'pro', 'free');
    await conn.db.insert(s.profiles).values({ userId: u!.id, settings: {} });
  }
  app = await buildApp({ db: conn.db, serveWeb: false });
  for (const name of ['writer', 'other', 'free']) cookies[name] = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: name, password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
  for (const name of ['writer', 'other', 'free']) keys[name] = (await as(name, 'POST', '/api/tokens/obsidian')).json().token;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); });

describe('заметки по ключу плагина', () => {
  it('ключ вида obsidian создаётся; без ключа или с чужим видом ключа — 401, без Pro — 402', async () => {
    expect(keys.writer).toMatch(/^bjo_/);
    expect((await plugin(null, 'PUT', '/notes', { path: 'Учёба/a.md', markdown: NOTE })).statusCode).toBe(401);
    const capture = (await as('writer', 'POST', '/api/tokens/capture')).json().token;
    expect((await plugin(capture, 'PUT', '/notes', { path: 'Учёба/a.md', markdown: NOTE })).statusCode).toBe(401);
    expect((await plugin('free', 'PUT', '/notes', { path: 'Учёба/a.md', markdown: NOTE })).statusCode).toBe(402);
  });

  it('отправка создаёт конспект «Obsidian», тот же текст — «без изменений», новый текст обновляет', async () => {
    const a = await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Делегаты.md', title: 'Делегаты', markdown: NOTE });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ status: 'created' });
    const id = a.json().id;
    const m = (await as('writer', 'GET', `/api/study/materials/${id}`)).json();
    expect(m).toMatchObject({ title: 'Делегаты' });
    expect(m.text).toContain('Подписка через +=');

    expect((await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Делегаты.md', title: 'Делегаты', markdown: NOTE })).json()).toMatchObject({ status: 'unchanged', id });
    const b = await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Делегаты.md', title: 'Делегаты', markdown: NOTE + '\n## Func\nВозвращает значение.\n' });
    expect(b.json()).toMatchObject({ status: 'updated', id });
    // чужой не видит
    expect((await as('other', 'GET', `/api/study/materials/${id}`)).statusCode).toBe(404);
  });

  it('переименование — тот же конспект; удаление — архив, повторная отправка оживляет', async () => {
    const id = (await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Старое.md', title: 'Старое', markdown: '## Раздел\nТекст.' })).json().id;
    expect((await plugin('writer', 'POST', '/rename', { from: 'Учёба/Старое.md', to: 'Учёба/Новое.md' })).statusCode).toBe(200);
    expect((await as('writer', 'GET', `/api/study/materials/${id}`)).json().title).toBe('Новое'); // название из имени файла переехало
    expect((await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Новое.md', title: 'Новое', markdown: '## Раздел\nТекст.' })).json()).toMatchObject({ id });

    expect((await plugin('writer', 'DELETE', `/notes?path=${encodeURIComponent('Учёба/Новое.md')}`)).json()).toMatchObject({ archived: true });
    const st = (await plugin('writer', 'GET', '/status')).json();
    expect(st.notes).toBe(1); // архивный не считается
    expect((await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Новое.md', title: 'Новое', markdown: '## Раздел\nТекст.' })).json()).toMatchObject({ id, status: 'restored' });
    expect((await plugin('writer', 'GET', '/status')).json().notes).toBe(2);
  });

  it('переименование на путь удалённой заметки — тот же конспект, архивный не мешает', async () => {
    await plugin('writer', 'PUT', '/notes', { path: 'Учёба/A.md', markdown: '## A\nстарое' });
    await plugin('writer', 'DELETE', `/notes?path=${encodeURIComponent('Учёба/A.md')}`);
    const b = (await plugin('writer', 'PUT', '/notes', { path: 'Учёба/B.md', markdown: '## B\nновое' })).json().id;
    expect((await plugin('writer', 'POST', '/rename', { from: 'Учёба/B.md', to: 'Учёба/A.md' })).statusCode).toBe(200);
    expect((await plugin('writer', 'PUT', '/notes', { path: 'Учёба/A.md', markdown: '## B\nновое и дописанное' })).json()).toMatchObject({ id: b, status: 'updated' });
  });

  it('ограничения: путь обязателен, заметка не больше 1 МБ', async () => {
    expect((await plugin('writer', 'PUT', '/notes', { markdown: 'x' })).statusCode).toBe(400);
    expect((await plugin('writer', 'PUT', '/notes', { path: 'Учёба/big.md', markdown: 'x'.repeat(1_100_000) })).statusCode).toBe(413);
  });
});

describe('дневник разделов, обзор и поиск из базы', () => {
  const P = 'Учёба/Лямбды.md', BASE = '# Лямбды\n\n## Синтаксис\nx => x * 2.\n\n## Замыкания\nЗахват переменных.\n';
  it('новая заметка — запись «новый конспект» с разделами; в тот же день правки сливаются в неё', async () => {
    const id = (await plugin('writer', 'PUT', '/notes', { path: P, markdown: BASE })).json().id;
    await plugin('writer', 'PUT', '/notes', { path: P, markdown: BASE + '\n## Делегаты\nFunc и Action.\n' });
    const rows = await conn.db.select().from(noteLog).where(eq(noteLog.materialId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'new', added: ['Синтаксис', 'Замыкания', 'Делегаты'], changed: [] });
  });

  it('на другой день — запись с дописанными и изменёнными разделами; без изменений разделов записи нет', async () => {
    const [m] = await conn.db.select().from(s.materials).where(and(eq(s.materials.kind, 'obsidian'), eq(s.materials.source, P)));
    await conn.db.update(noteLog).set({ day: '2020-01-01' }).where(eq(noteLog.materialId, m!.id));
    await plugin('writer', 'PUT', '/notes', { path: P, markdown: m!.text.replace('Захват переменных.', 'Захват переменных по ссылке.') + '\n## Выражения\nExpression<T>.\n' });
    const rows = (await conn.db.select().from(noteLog).where(eq(noteLog.materialId, m!.id))).filter(r => r.day !== '2020-01-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'edit', added: ['Выражения'], changed: ['Замыкания'] });
    // правка только вводной части (до первого ##) разделы не меняет — запись остаётся прежней
    const before = rows[0]!.updatedAt;
    const now = (await conn.db.select().from(s.materials).where(eq(s.materials.id, m!.id)))[0]!.text;
    await plugin('writer', 'PUT', '/notes', { path: P, markdown: now.replace('# Лямбды', '# Лямбды и делегаты') });
    const again = (await conn.db.select().from(noteLog).where(eq(noteLog.materialId, m!.id))).filter(r => r.day !== '2020-01-01');
    expect(again[0]).toMatchObject({ added: ['Выражения'], changed: ['Замыкания'] });
    expect(again[0]!.updatedAt).toEqual(before);
  });

  it('обзор без чтения с диска показывает заметки из базы и записи дневника; архивных нет', async () => {
    await plugin('writer', 'PUT', '/notes', { path: 'Учёба/Удалю.md', markdown: '## A\nТекст.' });
    await plugin('writer', 'DELETE', `/notes?path=${encodeURIComponent('Учёба/Удалю.md')}`);
    const o = (await as('writer', 'GET', '/api/study/overview')).json();
    expect(o.obs).toMatchObject({ enabled: false, plugin: true });
    const n = o.notes.find((x: any) => x.rel === P);
    expect(n).toMatchObject({ title: 'Лямбды и делегаты' });
    expect(n.sections.map((x: any) => x.h)).toContain('Выражения');
    expect(n.material).toMatchObject({ kind: 'obsidian' });
    expect(o.notes.some((x: any) => x.rel === 'Учёба/Удалю.md')).toBe(false);
    expect(o.materials.some((x: any) => x.kind === 'obsidian')).toBe(false);
    const e = o.diary.find((x: any) => x.src === 'obs' && x.title === 'Лямбды и делегаты' && x.kind === 'edit');
    expect(e).toMatchObject({ added: ['Выражения'], changed: ['Замыкания'] });
    // чужие записи не видны
    expect((await as('other', 'GET', '/api/study/overview')).json().notes).toHaveLength(0);
  });

  it('читалка открывает заметку из базы; поиск без учёта регистра с выдержкой и разделом', async () => {
    const r = (await as('writer', 'GET', `/api/study/obsidian/note?rel=${encodeURIComponent(P)}`)).json();
    expect(r).toMatchObject({ rel: P, title: 'Лямбды и делегаты' });
    expect(r.markdown).toContain('Expression<T>');
    const hits = (await as('writer', 'GET', `/api/study/obsidian/search?q=${encodeURIComponent('ЗАХВАТ')}`)).json().hits;
    expect(hits[0]).toMatchObject({ rel: P, h: 'Замыкания' });
    expect(hits[0].snippet).toContain('Захват переменных');
    expect(hits[0].snippet).not.toMatch(/##|Синтаксис/); // только свой раздел, без разметки
    expect((await as('other', 'GET', `/api/study/obsidian/search?q=${encodeURIComponent('захват')}`)).json().hits).toHaveLength(0);
    expect((await as('writer', 'GET', `/api/study/obsidian/note?rel=${encodeURIComponent('Учёба/Удалю.md')}`)).statusCode).toBe(404);
  });
});
