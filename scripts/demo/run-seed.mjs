// Apply the idempotent demo seed. Local by default; a hosted database requires
// both DATABASE_URL and the explicit --allow-remote flag.
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const allowRemote = args.includes('--allow-remote');
const businessId = args.find(a => !a.startsWith('--')) || process.env.LEDGR_BUSINESS_ID || '487334df-a057-45c3-b088-85e6c0a6aeb3';
const connectionString = process.env.DATABASE_URL;
const host = process.env.PGHOST || '127.0.0.1';
const local = !connectionString && ['127.0.0.1', 'localhost', '::1'].includes(host);
if (!local && !allowRemote) {
  console.error('Refusing a non-local target without --allow-remote. Set DATABASE_URL and pass --allow-remote deliberately.');
  process.exit(2);
}

const client = new Client(connectionString
  ? { connectionString, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } }
  : { host, port: Number(process.env.PGPORT || 55432), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE || 'postgres' });
await client.connect();
try {
  const business = (await client.query('select id,name,operating_models,base_currency from businesses where id=$1', [businessId])).rows[0];
  if (!business) throw new Error(`Business ${businessId} not found.`);
  console.log('target:', business.name, business.operating_models, business.base_currency);
  if (!business.operating_models.includes('CONSTRUCTION') && !business.operating_models.includes('MANUFACTURING')) {
    throw new Error('Business has neither CONSTRUCTION nor MANUFACTURING; nothing to seed.');
  }
  await client.query('begin');
  await client.query("select set_config('ledgr.business_id',$1,true)", [businessId]);
  await client.query(await readFile(new URL('./seed_demo_business.sql', import.meta.url), 'utf8'));
  await client.query('commit');
  console.log('seed committed (idempotent; existing rows untouched)');
} catch (e) {
  try { await client.query('rollback'); } catch {}
  console.error('SEED FAILED:', e.code || '', e.message, e.detail || '', e.hint || '');
  process.exitCode = 1;
} finally { await client.end(); }
