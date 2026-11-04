import { Client } from 'pg';
import { readFileSync } from 'node:fs';
const sql = process.argv[2] === '-f' ? readFileSync(process.argv[3], 'utf8') : process.argv.slice(2).join(' ');
const c = new Client(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55432), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE || 'postgres' });
await c.connect();
try {
  const r = await c.query(sql);
  const rows = Array.isArray(r) ? r.flatMap(x => x.rows) : r.rows;
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('SQL FAILED:', e.code || '', e.message, e.detail || '', e.hint || '');
  process.exitCode = 1;
} finally { await c.end(); }
