/**
 * Перенос данных старого журнала в Postgres.
 *   npm run import:legacy -- [--data ../../data] [--user maqsud] [--db postgres://…]
 * Идемпотентен: повторный запуск обновляет записи, а не дублирует. Для каждого пользователя
 * после переноса сверяет количества и суммы с источником; при расхождении откатывает его целиком.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLegacy } from '../src/core/legacy-import.js';
import { connect } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(arg('data') ?? path.join(here, '../../../data'));
const url = arg('db') ?? process.env.DATABASE_URL;

await runMigrations(url);
const { db, pool } = connect(url);
const t0 = Date.now();
const reports = await importLegacy(db, dataDir, { only: arg('user') });
await pool.end();

let failed = 0;
for (const r of reports) {
  console.log(`\n${r.ok ? '✓' : '✗'} ${r.username}${r.userId ? ` (${r.userId})` : ''}`);
  for (const c of r.checks) console.log(`  ${Math.abs(c.source - c.db) < 0.005 ? '✓' : '✗'} ${c.name}: было ${c.source}, в базе ${c.db}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  if (!r.ok) failed++;
}
console.log(`\nПеренесено пользователей: ${reports.length - failed} из ${reports.length} за ${((Date.now() - t0) / 1000).toFixed(1)} с. Данные: ${dataDir}`);
process.exit(failed ? 1 : 0);
