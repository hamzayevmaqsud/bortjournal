/** Тестовая база: схема пересоздаётся с нуля перед набором тестов — тесты не трогают рабочую базу */
import pg from 'pg';
import { connect } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_URL = process.env.DATABASE_URL_TEST ?? 'postgres://localhost:5432/bortjournal_test';
if (!/_test\b/.test(TEST_URL)) throw new Error('Тесты запускаются только на базе с суффиксом _test');

export async function freshDb() {
  const c = new pg.Client({ connectionString: TEST_URL });
  await c.connect();
  await c.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await c.end();
  await runMigrations(TEST_URL);
  return connect(TEST_URL);
}
