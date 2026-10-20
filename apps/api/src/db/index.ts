import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../schema.js';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/bortjournal';

export function connect(url = DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
export type DB = ReturnType<typeof connect>['db'];
/** транзакция или сама база — сервисы модулей принимают любое из двух */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0] | DB;
