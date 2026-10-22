/**
 * Перенос базы Lumi на другой сервер без pg_dump (у встроенного Postgres его нет).
 *   выгрузка:  DATABASE_URL=… npx tsx scripts/db-transfer.ts dump lumi-transfer.json.gz
 *   загрузка:  DATABASE_URL=… npx tsx scripts/db-transfer.ts restore lumi-transfer.json.gz
 * Загрузка — только в пустую базу после миграций (обе базы на одной версии схемы); всё в одной транзакции.
 * Типы переносятся через json_populate_recordset, внешние ключи на время загрузки не проверяются.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import pg from 'pg';

const [cmd, file] = process.argv.slice(2);
if (!['dump', 'restore'].includes(cmd ?? '') || !file) { console.error('db-transfer.ts dump|restore <файл.json.gz>'); process.exit(2); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const tables = (await client.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map(r => r.t);
const ident = (t: string) => `"${t.replace(/"/g, '""')}"`;

if (cmd === 'dump') {
  const [mig] = (await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows;
  const out: Record<string, unknown> = { format: 'lumi-transfer', version: 1, migrations: mig.n, at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = (await client.query(`select coalesce(json_agg(x), '[]'::json) as rows from ${ident(t)} x`)).rows[0].rows;
    (out.tables as Record<string, unknown>)[t] = rows;
    console.log(`${t}: ${rows.length}`);
  }
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out)));
  console.log(`готово: ${file}`);
} else {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  if (data.format !== 'lumi-transfer') throw new Error('это не файл переноса Lumi');
  const [mig] = (await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows;
  if (mig.n !== data.migrations) throw new Error(`версии схемы разные: в файле ${data.migrations} миграций, в базе ${mig.n}`);
  for (const t of tables) {
    const [c] = (await client.query(`select count(*)::int as n from ${ident(t)}`)).rows;
    if (c.n) throw new Error(`база не пустая: в ${t} уже ${c.n} строк`);
  }
  await client.query('begin');
  try {
    await client.query(`set local session_replication_role = replica`);
    for (const [t, rows] of Object.entries(data.tables as Record<string, unknown[]>)) {
      if (!tables.includes(t)) { console.warn(`${t}: такой таблицы нет — пропущена`); continue; }
      for (let i = 0; i < rows.length; i += 500)
        await client.query(`insert into ${ident(t)} select * from json_populate_recordset(null::${ident(t)}, $1::json)`, [JSON.stringify(rows.slice(i, i + 500))]);
      console.log(`${t}: ${rows.length}`);
    }
    // счётчики bigserial — дальше максимума
    const seqs = (await client.query(`select table_name as t, column_name as c, pg_get_serial_sequence(quote_ident(table_name), column_name) as s from information_schema.columns where table_schema = 'public' and column_default like 'nextval%'`)).rows;
    for (const q of seqs) if (q.s) await client.query(`select setval($1, coalesce((select max(${ident(q.c)}) from ${ident(q.t)}), 0) + 1, false)`, [q.s]);
    await client.query('commit');
    console.log('готово');
  } catch (e) { await client.query('rollback'); throw e; }
}
await client.end();
