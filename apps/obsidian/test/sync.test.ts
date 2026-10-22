/** Модуль синхронизации плагина: задержка после правки, папка, переименование, удаление, повтор после ошибки сети */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpTransport, Sync, type Fetcher } from '../src/sync';

type Call = { method: string; url: string; body?: any };
let calls: Call[], files: Record<string, string>, reply: (c: Call) => number;
const fetcher: Fetcher = async (url, init) => {
  const c = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(c);
  const status = reply(c);
  if (status === 0) throw new Error('network down');
  return { status, json: { error: status >= 400 ? `ошибка ${status}` : undefined } };
};
const make = (folder = 'Учёба') => new Sync({
  folder, delayMs: 3000, retryMs: 30000,
  read: async p => { if (!(p in files)) throw new Error('нет файла'); return files[p]!; },
  transport: httpTransport('https://lumi.example/', 'bjo_key', fetcher)
});
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => { vi.useFakeTimers(); calls = []; files = { 'Учёба/Делегаты.md': '## A\nтекст', 'Учёба/Лямбды.md': '## B\nтекст', 'Личное/Дневник.md': 'секрет' }; reply = () => 200; });
afterEach(() => { vi.useRealTimers(); });

describe('отправка правок', () => {
  it('отправляет через несколько секунд после последней правки, одной отправкой и с последним текстом', async () => {
    const s = make();
    s.changed('Учёба/Делегаты.md');
    await settle(2000);
    files['Учёба/Делегаты.md'] = '## A\nновый текст';
    s.changed('Учёба/Делегаты.md');
    await settle(2999);
    expect(calls).toHaveLength(0);
    await settle(1);
    expect(calls).toEqual([{ method: 'PUT', url: 'https://lumi.example/api/study/obsidian/notes', body: { path: 'Учёба/Делегаты.md', title: 'Делегаты', markdown: '## A\nновый текст' } }]);
    expect(s.state).toMatchObject({ pending: 0, error: null });
    expect(s.state.lastSync).not.toBeNull();
  });

  it('заметки вне выбранной папки и не-Markdown не отправляются', async () => {
    const s = make();
    s.changed('Личное/Дневник.md'); s.changed('Учёба/схема.png'); s.changed('Учёбник/x.md');
    await settle(5000);
    expect(calls).toHaveLength(0);
  });

  it('пустая папка — всё хранилище', async () => {
    const s = make('');
    s.changed('Личное/Дневник.md');
    await settle(3000);
    expect(calls.map(c => c.body.path)).toEqual(['Личное/Дневник.md']);
  });

  it('ключ уходит в Authorization: Bearer', async () => {
    const seen: any[] = [];
    const s = new Sync({ folder: 'Учёба', read: async () => 'x', transport: httpTransport('https://lumi.example', 'bjo_key', async (url, init) => { seen.push(init.headers); return { status: 200, json: {} }; }) });
    s.changed('Учёба/Делегаты.md'); await settle(3000);
    expect(seen[0]).toMatchObject({ Authorization: 'Bearer bjo_key', 'Content-Type': 'application/json' });
  });
});

describe('переименование и удаление', () => {
  it('переименование внутри папки — тот же конспект; правка, ждавшая отправки, уходит под новым путём', async () => {
    const s = make();
    s.changed('Учёба/Делегаты.md');
    files['Учёба/События.md'] = files['Учёба/Делегаты.md']!; delete files['Учёба/Делегаты.md'];
    s.renamed('Учёба/Делегаты.md', 'Учёба/События.md');
    await settle(3000);
    expect(calls.map(c => [c.method, c.body?.from ?? c.body?.path, c.body?.to])).toEqual([['POST', 'Учёба/Делегаты.md', 'Учёба/События.md'], ['PUT', 'Учёба/События.md', undefined]]);
  });

  it('вынесли из папки — архив; занесли в папку — отправка', async () => {
    const s = make();
    s.renamed('Учёба/Лямбды.md', 'Личное/Лямбды.md');
    files['Учёба/Новое.md'] = 'текст';
    s.renamed('Личное/Новое.md', 'Учёба/Новое.md');
    await settle(3000);
    expect(calls.map(c => `${c.method} ${decodeURIComponent(c.url.split('?path=')[1] ?? '') || c.body?.path}`)).toEqual(['DELETE Учёба/Лямбды.md', 'PUT Учёба/Новое.md']);
  });

  it('переименование заметки, которой нет в Lumi (404), — отправляем её целиком', async () => {
    reply = c => (c.method === 'POST' ? 404 : 200);
    const s = make();
    s.renamed('Учёба/Старое.md', 'Учёба/Делегаты.md');
    await settle(0);
    expect(calls.map(c => c.method)).toEqual(['POST', 'PUT']);
    expect(s.state.error).toBeNull();
  });

  it('удаление — архив; правка, ждавшая отправки, отменяется', async () => {
    const s = make();
    s.changed('Учёба/Делегаты.md');
    s.deleted('Учёба/Делегаты.md');
    await settle(5000);
    expect(calls.map(c => c.method)).toEqual(['DELETE']);
    expect(calls[0]!.url).toBe(`https://lumi.example/api/study/obsidian/notes?path=${encodeURIComponent('Учёба/Делегаты.md')}`);
  });
});

describe('ошибки', () => {
  it('сеть недоступна — ошибка в состоянии и повтор позже; потом отправляется', async () => {
    let down = true; reply = () => (down ? 0 : 200);
    const s = make();
    s.changed('Учёба/Делегаты.md');
    await settle(3000);
    expect(s.state).toMatchObject({ pending: 1 });
    expect(s.state.error).toMatch(/сеть|связ/i);
    down = false;
    await settle(29999);
    expect(calls).toHaveLength(1);
    await settle(1);
    expect(calls).toHaveLength(2);
    expect(s.state).toMatchObject({ pending: 0, error: null });
  });

  it('сервер отвечает 5xx — тоже повтор', async () => {
    let n = 0; reply = () => (n++ === 0 ? 503 : 200);
    const s = make();
    s.changed('Учёба/Делегаты.md');
    await settle(3000 + 30000);
    expect(calls).toHaveLength(2);
    expect(s.state.pending).toBe(0);
  });

  it('ключ не подошёл (401) — ошибка с текстом сервера, без повторов', async () => {
    reply = () => 401;
    const s = make();
    s.changed('Учёба/Делегаты.md');
    await settle(3000 + 120000);
    expect(calls).toHaveLength(1);
    expect(s.state).toMatchObject({ pending: 0, error: 'ошибка 401' });
  });

  it('очередь не теряет порядок: после сбоя сначала переименование, затем правка', async () => {
    let down = true; reply = () => (down ? 0 : 200);
    const s = make();
    s.renamed('Учёба/Делегаты.md', 'Учёба/События.md');
    files['Учёба/События.md'] = 'новое';
    s.changed('Учёба/События.md');
    await settle(3000);
    down = false;
    await settle(30000);
    const ok = calls.slice(-2).map(c => c.method);
    expect(ok).toEqual(['POST', 'PUT']);
  });
});

describe('«Отправить всё сейчас»', () => {
  it('отправляет все заметки папки сразу, без задержки', async () => {
    const s = make();
    s.sendAll(Object.keys(files));
    await settle(0);
    expect(calls.map(c => c.body.path).sort()).toEqual(['Учёба/Делегаты.md', 'Учёба/Лямбды.md']);
  });
});
