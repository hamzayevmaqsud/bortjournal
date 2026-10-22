/** Применяет миграции из ./drizzle. Запускается отдельной джобой до деплоя */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { connect } from './index.js';

export async function runMigrations(url?: string) {
  const { db, pool } = connect(url);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (await import('../core/env.js')).loadEnv();   // как сервер и воркер: DATABASE_URL из .env
  runMigrations().then(() => console.log('Миграции применены'), e => { console.error(e); process.exit(1); });
}
