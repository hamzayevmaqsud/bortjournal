/**
 * HTTP-сервер. buildApp собирает приложение из ядра и модулей — его же используют тесты.
 * Состояния в процессе нет (сессии и данные — в Postgres), поэтому реплик может быть несколько.
 * Если собран фронт (apps/web/dist), сервер раздаёт и его — один адрес для телефона.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRoutes, sessionHook } from './core/auth.js';
import { billingRoutes } from './core/billing.js';
import { HttpError } from './core/http.js';
import { profileRoutes } from './core/profile.js';
import { goalRoutes } from './core/goal.js';
import { exportRoutes } from './core/export.js';
import { tokenRoutes } from './core/tokens.js';
import { aiQuotaRoutes } from './core/ai-quota.js';
import { adminRoutes } from './core/admin.js';
import { resetRoutes } from './core/reset.js';
import { oauthRoutes } from './core/oauth.js';
import { reminderRoutes, startReminders } from './core/reminders.js';
import { statsRoutes } from './core/stats.js';
import { todayRoutes } from './core/today.js';
import { connect, type DB } from './db/index.js';
import { MODULES_LIST } from './modules/index.js';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
// принимаем только свои адреса: защита от подмены Host (DNS rebinding)
const hostOk = (host = '') => { const h = host.replace(/:\d+$/, '').toLowerCase(); return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.ts.net') || (process.env.ALLOWED_HOSTS ?? '').split(',').map(s => s.trim()).includes(h); };

export async function buildApp({ db, serveWeb = fs.existsSync(WEB_DIST) }: { db: DB; serveWeb?: boolean }) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1_000_000, trustProxy: '127.0.0.1' });

  app.addHook('onRequest', async (req, reply) => {
    if (!hostOk(req.headers.host)) return reply.code(421).send({ error: 'Неизвестный адрес.' });
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) return reply.code((err as { statusCode: number }).statusCode).send({ error: 'Неверный запрос.' });
    app.log.error(err);
    return reply.code(500).send({ error: 'Ошибка сервера. Попробуй ещё раз.' });
  });

  // живость и готовность: база отвечает — можно принимать трафик
  app.get('/health', async (_req, reply) => {
    try { await db.execute(sql`select 1`); return { ok: true }; }
    catch { return reply.code(503).send({ ok: false }); }
  });

  app.addHook('preHandler', sessionHook(db));
  // повтор записи с тем же Idempotency-Key (телефон отправил из очереди, а первый ответ потерялся) — отдаём прежний ответ
  const seen = new Map<string, { status: number; body: string; at: number }>(), DAY = 864e5;
  const idemKey = (req: { method: string; headers: Record<string, unknown>; userId?: string }) => {
    const k = req.headers['idempotency-key'];
    return req.method !== 'GET' && req.userId && typeof k === 'string' && k.length <= 100 ? `${req.userId}:${k}` : null;
  };
  app.addHook('preHandler', async (req, reply) => {
    const k = idemKey(req as any), hit = k ? seen.get(k) : undefined;
    if (hit && Date.now() - hit.at < DAY) return reply.code(hit.status).header('Content-Type', 'application/json; charset=utf-8').header('Idempotent-Replay', '1').send(hit.body);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const k = idemKey(req as any);
    if (k && !reply.getHeader('Idempotent-Replay') && reply.statusCode < 500 && typeof payload === 'string') {
      seen.set(k, { status: reply.statusCode, body: payload, at: Date.now() });
      if (seen.size > 5000) for (const [key, v] of seen) { if (Date.now() - v.at > DAY || seen.size > 4000) seen.delete(key); else break; }
    }
    return payload;
  });
  await app.register(async scope => { await authRoutes(scope, { db }); await todayRoutes(scope, { db }); await billingRoutes(scope, { db }); await profileRoutes(scope, { db }); await goalRoutes(scope, { db }); await statsRoutes(scope, { db }); await reminderRoutes(scope, { db }); await exportRoutes(scope, { db }); await tokenRoutes(scope, { db }); await aiQuotaRoutes(scope, { db }); await adminRoutes(scope, { db }); await resetRoutes(scope, { db }); });
  // вход через Google и Apple — своя область: ей нужен разбор форм (Apple отвечает POST-формой)
  await app.register(async scope => { await oauthRoutes(scope, { db }); });
  for (const m of MODULES_LIST) if (m.routes) await app.register(async scope => { await m.routes!(scope, { db }); }, { prefix: `/api/${m.name}` });

  if (serveWeb) {
    await app.register(fastifyStatic, { root: WEB_DIST, setHeaders: (res, file) => {
      if (file.endsWith('.html')) { res.header('Content-Security-Policy', CSP); res.header('Cache-Control', 'no-cache'); }
      else if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.header('Cache-Control', 'no-cache');
      else if (file.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
    } });
    // приложение одностраничное: неизвестный путь вне /api — это экран фронта
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Нет такого метода.' }) : reply.header('Content-Security-Policy', CSP).header('Cache-Control', 'no-cache').sendFile('index.html'));
  }
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (await import('./core/env.js')).loadEnv();
  const { db } = connect();
  const app = await buildApp({ db });
  await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: process.env.API_HOST ?? '127.0.0.1' });
  if (process.env.REMINDERS !== 'off') startReminders(db, m => app.log.error(m));
}
