/**
 * Учёба: конспекты из PDF, Word, текста и ссылки; вопросы с вариантами — только по просьбе; ответы двигают повторение;
 * «Сегодня» без вопросов, пока их не попросили; внутренние адреса по ссылке закрыты; занятия и минуты.
 * ИИ — локальный сервер вместо Gemini: на каждый кусок отдаёт 3 вопроса (верный — всегда второй вариант).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localNow } from '@bortjournal/core';
import { hashPassword } from '../src/core/auth.js';
import { grant, grantFree } from '../src/core/entitlements.js';
import * as s from '../src/schema.js';
import { buildApp } from '../src/server.js';
import { grade } from '../src/modules/study/cards.js';
import { chunksOf, htmlToMd, privateIp } from '../src/modules/study/extract.js';
import { cleanQuestion } from '../src/modules/study/mc.js';
import { freshDb } from './db.js';

let conn: Awaited<ReturnType<typeof freshDb>>, app: Awaited<ReturnType<typeof buildApp>>, cookie = '', ai: http.Server, site: http.Server, siteUrl = '', aiCalls = 0;
const H = { host: 'localhost' }, today = localNow(240).day;
const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { ...H, cookie } });
const upload = (name: string, buf: Buffer) => app.inject({ method: 'POST', url: '/api/study/materials/upload', payload: buf, headers: { ...H, cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) } });
const until = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('не дождались'); };

/* настоящий маленький PDF с текстом */
function pdf(lines: string[]) {
  const stream = `BT /F1 12 Tf 40 760 Td 14 TL ${lines.map(l => `(${l}) '`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
/* настоящий .docx: zip без сжатия из трёх частей */
function docx(paras: Array<[string, string?]>) {
  const files: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(([t, st]) => `<w:p>${st ? `<w:pPr><w:pStyle w:val="${st}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`]
  ];
  const local: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text), n = Buffer.from(name), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

beforeAll(async () => {
  ai = http.createServer((r, res) => { r.resume(); r.on('end', () => { aiCalls++; const questions = [0, 1, 2].map(k => ({ q: `Вопрос ${aiCalls}.${k} по конспекту?`, options: ['Первый вариант', 'Верный вариант', 'Третий вариант', 'Четвёртый вариант'], correct: 1, explain: 'Потому что так в конспекте.' }));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions }) }] } }] })); }); });
  site = http.createServer((r, res) => {
    if (r.url === '/article') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<html><head><title>Как работает DNS</title><script>evil()</script></head><body><nav>Меню сайта</nav><article><h1>Как работает DNS</h1><p>${'DNS переводит имена в адреса. '.repeat(20)}</p><h2>Кэширование</h2><ul><li>TTL задаёт срок</li><li>резолвер хранит ответ</li></ul></article><footer>подвал</footer></body></html>`);
    if (r.url === '/go') return res.writeHead(302, { location: '/article' }).end();
    res.writeHead(404).end();
  });
  await Promise.all([new Promise<void>(ok => ai.listen(0, '127.0.0.1', ok)), new Promise<void>(ok => site.listen(0, '127.0.0.1', ok))]);
  siteUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  Object.assign(process.env, { GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${(ai.address() as { port: number }).port}`, STUDY_FILES_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bj-files-')) });
  conn = await freshDb();
  const [u] = await conn.db.insert(s.users).values({ username: 'student', passwordHash: await hashPassword('secret12'), tzOffset: 240 }).returning();
  await grantFree(conn.db, u!.id); await grant(conn.db, u!.id, 'pro', 'free');
  await conn.db.insert(s.profiles).values({ userId: u!.id, settings: { aiConsent: true } });
  app = await buildApp({ db: conn.db, serveWeb: false });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'student', password: 'secret12' } })).headers['set-cookie']).split(';')[0]!;
}, 60000);
afterAll(async () => { await app?.close(); await conn?.pool.end(); ai?.close(); site?.close(); delete process.env.GEMINI_API_KEY; delete process.env.STUDY_ALLOW_PRIVATE; });

describe('разбор', () => {
  it('HTML → Markdown без меню и скриптов', () => {
    const { title, md } = htmlToMd('<html><head><title>T</title></head><body><nav>меню</nav><h2>Раздел</h2><p>Текст &amp; ещё</p><script>x()</script><ul><li>один</li></ul></body></html>');
    expect(title).toBe('T');
    expect(md).toContain('## Раздел'); expect(md).toContain('Текст & ещё'); expect(md).toContain('- один');
    expect(md).not.toMatch(/меню|x\(\)/);
  });
  it('внутренние адреса закрыты', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '100.101.2.3', '169.254.1.1', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(privateIp(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4001::1']) expect(privateIp(ip)).toBe(false);
  });
  it('куски по заголовкам, вопрос проверяется', () => {
    const md = ['# A', 'x'.repeat(3000), '## B', 'y'.repeat(9000), '## C', 'короткий раздел из нескольких слов и букв'].join('\n\n');
    const parts = chunksOf(md);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.every(p => p.length <= 12000)).toBe(true);
    expect(cleanQuestion({ q: 'Что такое DNS?', options: ['a', 'b', 'c', 'd'], correct: 2, explain: '' })).toMatchObject({ correct: 2 });
    expect(cleanQuestion({ q: 'Что такое DNS?', options: ['a', 'a', 'c', 'd'], correct: 2 })).toBeNull();
    expect(cleanQuestion({ q: 'Что такое DNS?', options: ['a', 'b', 'c', 'Все варианты верны'], correct: 0 })).toBeNull();
    expect(cleanQuestion({ q: 'Что такое DNS?', options: ['a', 'b', 'c', 'd'], correct: 4 })).toBeNull();
  });
  it('интервалы: верно 2 → 5 → ×лёгкость, неверно — завтра', () => {
    let st = { interval: 0, ease: 2.5, reps: 0, due: today };
    st = grade(st, 'good', today); expect(st).toMatchObject({ interval: 2, due: addDays(today, 2) });
    st = grade(st, 'good', today); expect(st.interval).toBe(5);
    st = grade(st, 'again', today); expect(st).toMatchObject({ interval: 1, due: addDays(today, 1) });
  });
});

describe('конспекты и вопросы', () => {
  let pdfId = '';
  it('PDF: текст по страницам, оригинал сохранён; вопросов нет, пока не попросили', async () => {
    const r = await upload('Сети лекция 3.pdf', pdf(['Lecture about TCP handshake and retransmission.', 'SYN, SYN-ACK and ACK open a connection between two hosts.', 'Lost segments are sent again after a timeout expires.']));
    expect(r.statusCode).toBe(201);
    const m = r.json(); pdfId = m.id;
    expect(m).toMatchObject({ kind: 'pdf', title: 'Сети лекция 3', quiz: false, quizStatus: 'none', questions: 0, hasFile: true });
    const full = (await req('GET', `/api/study/materials/${pdfId}`)).json();
    expect(full.text).toContain('## Стр. 1'); expect(full.text).toContain('SYN-ACK');
    const f = await req('GET', `/api/study/materials/${pdfId}/file`);
    expect(f.headers['content-type']).toBe('application/pdf'); expect(f.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(aiCalls).toBe(0);
    expect((await req('GET', '/api/study/quiz')).json()).toMatchObject({ current: null, materials: 0, left: 0 });
    expect((await req('GET', '/api/today')).json().parts.study.quiz).toBeNull();
  });
  it('Word, текст и ссылка (с переадресацией); плохие файлы — понятная ошибка', async () => {
    const w = (await upload('Алгоритмы.docx', docx([['Сортировки', 'Heading1'], ['Быстрая сортировка делит массив опорным элементом на две части и сортирует их рекурсивно. В среднем это n log n.']]))).json();
    expect(w).toMatchObject({ kind: 'docx', title: 'Алгоритмы' });
    expect((await req('GET', `/api/study/materials/${w.id}`)).json().text).toMatch(/# Сортировки[\s\S]*опорным элементом/);
    const t = (await req('POST', '/api/study/materials/text', { text: '# Английский\n\nPresent Perfect — действие в прошлом с результатом в настоящем. Have + V3.' })).json();
    expect(t).toMatchObject({ kind: 'text', title: 'Английский' });
    expect((await req('POST', '/api/study/materials/link', { url: `${siteUrl}/go` })).statusCode).toBe(400); // без разрешения локальный адрес закрыт
    process.env.STUDY_ALLOW_PRIVATE = '1';
    const l = (await req('POST', '/api/study/materials/link', { url: `${siteUrl}/go` })).json();
    expect(l).toMatchObject({ kind: 'link', title: 'Как работает DNS', source: `${siteUrl}/article` });
    const lt = (await req('GET', `/api/study/materials/${l.id}`)).json().text;
    expect(lt).toContain('## Кэширование'); expect(lt).not.toMatch(/Меню сайта|evil|подвал/);
    expect((await upload('virus.exe', Buffer.from('MZ\u0000\u0000'))).statusCode).toBe(400);
    expect((await upload('old.doc', Buffer.from('x'))).json().error).toMatch(/docx/);
    expect((await req('POST', '/api/study/materials/text', { text: 'мало' })).statusCode).toBe(400);
  });
  it('вопросы по просьбе: ИИ составляет в фоне, варианты перемешаны, верный не раскрыт', async () => {
    expect((await req('POST', `/api/study/materials/${pdfId}/quiz`, { on: true })).json()).toEqual({ ok: true });
    await until(async () => (await req('GET', `/api/study/materials/${pdfId}`)).json().quizStatus === 'ready');
    const m = (await req('GET', `/api/study/materials/${pdfId}`)).json();
    expect(m).toMatchObject({ quiz: true, quizDone: m.quizTotal, questions: 3 * m.quizTotal });
    const q = (await req('GET', '/api/study/quiz')).json();
    expect(q).toMatchObject({ materials: 1, answered: 0 });
    expect(q.current.options).toHaveLength(4);
    expect(q.current.options.map((o: any) => o.i).sort()).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(q.current)).not.toMatch(/correct|explain/);
    expect(q.current.material).toBe('Сети лекция 3');
    expect((await req('GET', '/api/today')).json().parts.study.quiz).toMatchObject({ left: q.left });
  });
  it('ответ: верно — повтор через 2 дня, неверно — завтра; день считается', async () => {
    const a = (await req('GET', '/api/study/quiz')).json().current;
    const r1 = (await req('POST', '/api/study/quiz/answer', { id: a.id, choice: 1 })).json();
    expect(r1).toMatchObject({ correct: true, correctIndex: 1, next: addDays(today, 2) });
    const b = (await req('GET', '/api/study/quiz')).json().current;
    expect(b.id).not.toBe(a.id);
    const r2 = (await req('POST', '/api/study/quiz/answer', { id: b.id, choice: 3 })).json();
    expect(r2).toMatchObject({ correct: false, correctIndex: 1, explain: 'Потому что так в конспекте.', next: addDays(today, 1) });
    const q = (await req('GET', '/api/study/quiz')).json();
    expect(q).toMatchObject({ answered: 2, good: 1 });
    expect(q.history.at(-1)).toMatchObject({ day: today, answered: 2, good: 1 });
    expect((await req('POST', '/api/study/quiz/answer', { id: b.id, choice: 7 })).statusCode).toBe(400);
  });
  it('выключить вопросы — пропадают из повторения, но не удаляются; удалить конспект — вместе с вопросами и файлом', async () => {
    await req('POST', `/api/study/materials/${pdfId}/quiz`, { on: false });
    expect((await req('GET', '/api/study/quiz')).json()).toMatchObject({ current: null, materials: 0 });
    expect((await req('GET', `/api/study/materials/${pdfId}`)).json().questions).toBeGreaterThan(0);
    const file = path.join(process.env.STUDY_FILES_DIR!, (await conn.db.select().from(s.users))[0]!.id, `${pdfId}.pdf`);
    expect(fs.existsSync(file)).toBe(true);
    expect((await req('DELETE', `/api/study/materials/${pdfId}`)).json()).toEqual({ ok: true });
    expect(fs.existsSync(file)).toBe(false);
    expect(await conn.db.select().from(s.questions)).toHaveLength(0);
  });
  it('обзор: конспекты с вопросами и без, занятия и минуты', async () => {
    const day = addDays(today, -1);
    expect((await req('POST', '/api/study/sessions', { topic: 'Делегаты в C#', category: 'C#', minutes: 45, day, theses: 'Делегат — тип метода' })).statusCode).toBe(201);
    await req('PUT', '/api/study/time', { key: 'note-1', day: today, minutes: 20 });
    const o = (await req('GET', '/api/study/overview')).json();
    expect(o.materials.map((m: any) => m.kind).sort()).toEqual(['docx', 'link', 'text']);
    expect(o.kpi).toMatchObject({ materials: 3, sessions: 1 });
    expect(o.days.at(-1).minutes).toBe(20);
    expect(o.diary.find((e: any) => e.src === 'manual')).toMatchObject({ title: 'Делегаты в C#', minutes: 45 });
    // тезисы занятия больше не превращаются в вопросы сами
    expect((await req('GET', '/api/study/quiz')).json().total).toBe(0);
  });
});

describe('ссылки: соединение только на проверенный адрес', () => {
  it('имя, которое смотрит в localhost, не открывается даже без проверки по имени', async () => {
    delete process.env.STUDY_ALLOW_PRIVATE;
    // localhost резолвится в 127.0.0.1 — подключение отклоняет сам lookup
    const r = await req('POST', '/api/study/materials/link', { url: 'http://localhost/' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/внутреннюю сеть/);
  });
});
