// Local-only disposable PostgreSQL for validating demo seed SQL against the
// repository migration chain. Never connects to a hosted database.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, '.cache', 'ledgr-demo');
await mkdir(dir, { recursive: true });
const port = Number(process.env.LEDGR_LOCAL_PG_PORT || 55432);
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, 'data'), port, user: 'postgres', password: 'postgres',
  persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1', '-k', dir, '-c', 'statement_timeout=120000'],
  onLog() {}, onError() {},
});
if (!existsSync(join(dir, 'data', 'PG_VERSION'))) await pg.initialise();
await pg.start();
console.log('local postgres listening on', port);
const stop = async () => { try { await pg.stop(); } catch {} process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
await new Promise(() => {});
