/**
 * Вызов Google Gemini с JSON-схемой ответа: перебирает модели (GEMINI_MODEL через запятую), если у первой лимит или сбой.
 * Ключ и адрес читаются при каждом вызове (GEMINI_API_KEY, GEMINI_BASE_URL) — тесты подставляют свой сервер.
 */
import { HttpError } from './http.js';

export const aiEnabled = () => !!process.env.GEMINI_API_KEY;
export async function gemini(parts: unknown[], schema: unknown, { timeout = 60e3 } = {}): Promise<any> {
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const models = (process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } });
  let last: { status: number; message: string } | undefined;
  for (const model of models) {
    let r: Response;
    try {
      r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! }, body, signal: AbortSignal.timeout(timeout) });
    } catch (e) { last = { status: 502, message: (e as Error).name === 'TimeoutError' ? 'ИИ не ответил вовремя.' : 'Нет связи с ИИ.' }; continue; }
    const data = await r.json().catch(() => ({})) as any;
    if (!r.ok) {
      last = { status: r.status, message: data?.error?.message || `HTTP ${r.status}` };
      if ([404, 429, 500, 503].includes(r.status)) continue; // лимит или модель недоступна — следующая
      break;
    }
    const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string' && !p.thought);
    try { return JSON.parse(part?.text || ''); } catch { last = { status: 502, message: 'ИИ вернул непонятный ответ.' }; }
  }
  // upstream — статус ответа Gemini: фоновые задания по нему решают, повторять ли (429/5xx/сеть — да, 400/403 — нет)
  throw Object.assign(new HttpError(last?.status === 429 ? 429 : 502,
    last?.status === 429 ? 'Лимит ИИ на сейчас исчерпан. Попробуй через минуту.' : last?.status === 400 || last?.status === 403 ? `ИИ отклонил запрос: ${last.message}` : last?.message || 'ИИ недоступен.'),
    { upstream: last?.status });
}
