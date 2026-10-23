/**
 * Вызов Google Gemini с JSON-схемой ответа: перебирает модели (GEMINI_MODEL через запятую), если у первой лимит или сбой.
 * Ключ и адрес читаются при каждом вызове (GEMINI_API_KEY, GEMINI_BASE_URL) — тесты подставляют свой сервер.
 * timeout — на весь вызов; perTry — сколько ждать одну модель (зависшая модель не съедает всё время, следующая успевает).
 * «Перегружена» (503) — один повтор той же модели через пару секунд, потом следующая.
 */
import { HttpError } from './http.js';

export const aiEnabled = () => !!process.env.GEMINI_API_KEY;
const DEFAULT_MODELS = 'gemini-3.5-flash,gemini-3.8-flash,gemini-3.1-flash-lite';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function gemini(parts: unknown[], schema: unknown, { timeout = 60e3, perTry = timeout }: { timeout?: number; perTry?: number } = {}): Promise<any> {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map(s => s.trim()).filter(Boolean);
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } });
  const deadline = Date.now() + timeout;
  let last: { status: number; message: string } | undefined;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) break;
      let r: Response;
      try {
        r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! }, body, signal: AbortSignal.timeout(Math.min(perTry, left)) });
      } catch (e) { last = { status: 502, message: (e as Error).name === 'TimeoutError' ? 'ИИ не ответил вовремя.' : 'Нет связи с ИИ.' }; break; }
      const data = await r.json().catch(() => ({})) as any;
      if (!r.ok) {
        last = { status: r.status, message: data?.error?.message || `HTTP ${r.status}` };
        if (r.status === 503 && attempt === 0) { await sleep(Number(process.env.GEMINI_RETRY_MS ?? 2000)); continue; } // перегружена — ещё раз
        break;
      }
      const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string' && !p.thought);
      try { return JSON.parse(part?.text || ''); } catch { last = { status: 502, message: 'ИИ вернул непонятный ответ.' }; break; }
    }
    if (last && ![404, 429, 500, 502, 503].includes(last.status)) break; // 400/403 — следующая модель не поможет
    if (deadline - Date.now() < 3000) break;
  }
  // upstream — статус ответа Gemini: фоновые задания по нему решают, повторять ли (429/5xx/сеть — да, 400/403 — нет)
  throw Object.assign(new HttpError(last?.status === 429 ? 429 : 502,
    last?.status === 429 ? 'Лимит ИИ на сейчас исчерпан. Попробуй через минуту.' : last?.status === 503 ? 'ИИ сейчас перегружен. Попробуй через минуту.' : last?.status === 400 || last?.status === 403 ? `ИИ отклонил запрос: ${last.message}` : last?.message || 'ИИ недоступен.'),
    { upstream: last?.status });
}
