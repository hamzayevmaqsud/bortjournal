/**
 * Воркер: фоновые задания модулей (разбор фото еды и т. п.) в отдельном процессе, чтобы долгие вызовы ИИ
 * не занимали API. Очереди живут в таблицах модулей (ADR-0002); воркер по кругу вызывает AppModule.work.
 * Несколько воркеров безопасны: модули забирают задания через `for update skip locked`.
 */
import { fileURLToPath } from 'node:url';
import { connect, type DB } from './db/index.js';
import { MODULES_LIST } from './modules/index.js';

/** один проход по всем модулям; тесты вызывают его напрямую. Возвращает число обработанных заданий */
export async function runJobsOnce(db: DB, at?: Date) {
  let n = 0;
  for (const m of MODULES_LIST) if (m.work) n += await m.work(db, at);
  return n;
}

const IDLE_MS = 2000;
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (await import('./core/env.js')).loadEnv();
  const { db, pool } = connect(process.env.DATABASE_URL);
  let stop = false;
  const quit = () => { stop = true; };
  process.on('SIGINT', quit); process.on('SIGTERM', quit);
  console.log(`${stamp()} воркер запущен`);
  while (!stop) {
    try { const n = await runJobsOnce(db); if (n) console.log(`${stamp()} обработано заданий: ${n}`); }
    catch (e) { console.error(`${stamp()} ошибка воркера: ${(e as Error).message}`); }
    await new Promise(r => setTimeout(r, IDLE_MS));
  }
  await pool.end();
}
