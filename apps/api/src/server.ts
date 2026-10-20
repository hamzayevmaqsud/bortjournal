/**
 * HTTP-сервер. buildApp собирает приложение из ядра и модулей — его же используют тесты.
 * Состояния в процессе нет (сессии и данные — в Postgres), поэтому реплик может быть несколько.
 */
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { connect, type DB } from './db/index.js';
import { MODULES_LIST } from './modules/index.js';

export async function buildApp({ db }: { db: DB }) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' } });

  // живость и готовность: база отвечает — можно принимать трафик
  app.get('/health', async (_req, reply) => {
    try { await db.execute(sql`select 1`); return { ok: true }; }
    catch { return reply.code(503).send({ ok: false }); }
  });

  for (const m of MODULES_LIST) if (m.routes) await app.register(async scope => { await m.routes!(scope, { db }); }, { prefix: `/api/${m.name}` });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { db } = connect();
  const app = await buildApp({ db });
  await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: process.env.API_HOST ?? '127.0.0.1' });
}
