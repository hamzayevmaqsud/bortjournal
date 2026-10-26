/** Выбор модели под задачу: свои модели и уровень обдумывания, запасная модель при перегрузке, GEMINI_MODEL главнее */
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI, gemini } from '../src/core/gemini.js';

let srv: http.Server, calls: Array<{ model: string; body: any }> = [], busy = new Set<string>();
beforeAll(async () => {
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const model = decodeURIComponent(String(req.url).match(/models\/([^:]+):/)![1]!);
      calls.push({ model, body: JSON.parse(b) });
      if (busy.has(model)) return res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'high demand' } }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: model }) }] } }] }));
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { GEMINI_API_KEY: 'k', GEMINI_BASE_URL: `http://127.0.0.1:${(srv.address() as any).port}`, GEMINI_RETRY_MS: '0' });
  delete process.env.GEMINI_MODEL;
});
afterAll(() => { for (const k of ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_RETRY_MS', 'GEMINI_MODEL']) delete process.env[k]; srv?.close(); });
beforeEach(() => { calls = []; busy = new Set(); delete process.env.GEMINI_MODEL; });

describe('модели под задачу', () => {
  it('еда: быстрая flash с коротким обдумыванием', async () => {
    expect(await gemini([{ text: 'x' }], {}, AI.food)).toEqual({ ok: 'gemini-3.5-flash' });
    expect(calls[0]!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
  it('перегрузка: повтор, потом запасная; lite — без уровня обдумывания', async () => {
    busy = new Set(['gemini-3.5-flash', 'gemini-3.8-flash']);
    expect(await gemini([{ text: 'x' }], {}, AI.food)).toEqual({ ok: 'gemini-3.1-flash-lite' });
    expect(calls.map(c => c.model)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']);
    expect(calls.at(-1)!.body.generationConfig.thinkingConfig).toBeUndefined();
  });
  it('вопросы: сначала pro', async () => {
    expect(await gemini([{ text: 'x' }], {}, AI.quiz)).toEqual({ ok: 'gemini-3.1-pro-preview' });
  });
  it('GEMINI_MODEL в .env главнее модели задачи', async () => {
    process.env.GEMINI_MODEL = 'my-model';
    expect(await gemini([{ text: 'x' }], {}, AI.quiz)).toEqual({ ok: 'my-model' });
    expect(calls[0]!.body.generationConfig.thinkingConfig).toBeUndefined();
  });
});
