// LOCAL-ONLY: create a disposable PostgreSQL cluster and replay every
// repository migration. Refuses to touch anything outside .cache/ledgr-demo.
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = join(root, '.cache', 'ledgr-demo');
if (!base.startsWith(join(root, '.cache') + '/')) throw new Error('Unsafe cache path');
if (process.argv.includes('--fresh') && existsSync(base)) await rm(base, { recursive: true, force: true });
await mkdir(base, { recursive: true });

const port = Number(process.env.LEDGR_LOCAL_PG_PORT || 55432);
const pg = new EmbeddedPostgres({
  databaseDir: join(base, 'data'), port, user: 'postgres', password: 'postgres',
  persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1', '-k', base, '-c', 'statement_timeout=120000'],
  onLog() {}, onError() {},
});
if (!existsSync(join(base, 'data', 'PG_VERSION'))) await pg.initialise();
await pg.start();
const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
try {
  const already = await c.query("select count(*)::int n from information_schema.tables where table_schema='public'");
  if (already.rows[0].n === 0) {
    await c.query(await readFile(join(root, 'tests/release/bootstrap.sql'), 'utf8'));
    await c.query('set search_path = public, extensions');
    const files = (await readdir(join(root, 'supabase/migrations'))).filter(f => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      const source = (await readFile(join(root, 'supabase/migrations', file), 'utf8'))
        .replace(/create extension if not exists (pg_cron|pg_net)\s*;/gi, '-- platform extension stubbed by local replay');
      await c.query(source);
      applied += 1;
    }
    console.log(`replayed ${applied}/${files.length} migrations`);
  } else {
    console.log(`existing database has ${already.rows[0].n} public tables; replay skipped`);
  }
} finally {
  await c.end();
  await pg.stop();
}
