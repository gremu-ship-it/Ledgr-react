import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { mkdtemp, writeFile, readFile, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { assertLocalOnly, removeOwnedDirectory } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function createDatabaseFixture() {
  assertLocalOnly();
  if (process.getuid?.() === 0) throw new Error('R13 database requires non-root user; no host user is created.');
  const parent = tmpdir();
  const directory = await mkdtemp(join(parent, 'ledgr-r13-'));
  await chmod(directory, 0o700);
  const nonce = randomUUID();
  await writeFile(join(directory, '.r13-owner'), nonce, { mode: 0o600 });
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const password = randomBytes(32).toString('hex');
  const pg = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), port,
    user: 'postgres', password, authMethod: 'scram-sha-256', persistent: true,
    postgresFlags: ['-h', '127.0.0.1', '-k', directory, '-c', 'statement_timeout=15000', '-c', 'log_statement=none'],
    onLog() {}, onError() {},
  });
  let client;
  const extraClients = new Set();
  let started = false;
  const cleanup = async () => {
    for (const c of extraClients) { try { await c.end(); } catch {} }
    if (client) await client.end();
    if (started) await pg.stop();
    await removeOwnedDirectory(directory, parent, nonce);
  };
  try {
    await pg.initialise();
    await pg.start(); started = true;
    // Explicit connection properties: no environment-derived host/database/credential.
    client = new Client({ host: '127.0.0.1', port, user: 'postgres', password,
      database: 'postgres', connectionTimeoutMillis: 5000 });
    await client.connect();
    const actual = await client.query('show data_directory');
    if (actual.rows[0].data_directory !== join(directory, 'data')) throw new Error('R13 database ownership check failed');
    await client.query(await readFile(join(root, 'tests/release/bootstrap.sql'), 'utf8'));
    await client.query('set search_path = public, extensions');
    const migrations = [];
    for (const name of (await readdir(join(root, 'supabase/migrations'))).filter(n => n.endsWith('.sql')).sort()) {
      const source = await readFile(join(root, 'supabase/migrations', name), 'utf8');
      // Explicitly excluded platform extension installation, NOT a clean Supabase replay.
      // No other SQL edits and no changes to product migrations on disk.
      const sql = source.replace(/create extension if not exists (pg_cron|pg_net)\s*;/gi, '-- R13 platform stub: extension installation excluded');
      try { await client.query(sql); }
      catch (e) { throw new Error(`Migration ${name} SQLSTATE ${e.code ?? 'unknown'} (payload suppressed)`); }
      migrations.push({ name, sha256: createHash('sha256').update(source).digest('hex'), platformSubstitution: sql !== source });
    }
    const asRole = async (role, uid, sql, values = [], commit = false) => {
      if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Invalid test role');
      await client.query('begin');
      try {
        await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
        await client.query(`set local role ${role}`);
        const result = typeof sql === 'function' ? await sql(client) : await client.query(sql, values);
        // Every probe rolls back, including attempted escalations and successful writes.
        await client.query(commit ? 'commit' : 'rollback');
        return result;
      } catch (e) { await client.query('rollback'); throw e; }
    };
    const pgConnectionConfig = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };
    const createSecondClient = async () => {
      const c2 = new Client({ ...pgConnectionConfig, connectionTimeoutMillis: 5000 });
      await c2.connect();
      extraClients.add(c2);
      const asRoleOnSecond = async (role, uid, sql, values = [], commit = false) => {
        if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Invalid test role');
        await c2.query('begin');
        try {
          await c2.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
          await c2.query(`set local role ${role}`);
          const result = typeof sql === 'function' ? await sql(c2) : await c2.query(sql, values);
          await c2.query(commit ? 'commit' : 'rollback');
          return result;
        } catch (e) { try { await c2.query('rollback'); } catch {} throw e; }
      };
      // Low-level transaction handle for true concurrent BEGIN/COMMIT races.
      const beginAsRole = async (role, uid) => {
        if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Invalid test role');
        await c2.query('begin');
        await c2.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
        await c2.query(`set local role ${role}`);
      };
      const commitTx = async () => { await c2.query('commit'); };
      const rollbackTx = async () => { try { await c2.query('rollback'); } catch {} };
      const close = async () => { try { await c2.end(); } catch {} extraClients.delete(c2); };
      return { client: c2, asRole: asRoleOnSecond, commitAsRole: (role, uid, sql, values) => asRoleOnSecond(role, uid, sql, values, true), beginAsRole, commitTx, rollbackTx, close };
    };
    // Also expose helpers on primary client for symmetry (concurrent BEGIN/COMMIT)
    const beginAsRolePrimary = async (role, uid) => {
      if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Invalid test role');
      await client.query('begin');
      await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
      await client.query(`set local role ${role}`);
    };
    const commitTxPrimary = async () => { await client.query('commit'); };
    const rollbackTxPrimary = async () => { try { await client.query('rollback'); } catch {} };
    return { client, asRole, commitAsRole: (role, uid, sql, values) => asRole(role, uid, sql, values, true), beginAsRole: beginAsRolePrimary, commitTx: commitTxPrimary, rollbackTx: rollbackTxPrimary, createSecondClient, pgConnectionConfig, cleanup, migrations,
      version: (await client.query('show server_version')).rows[0].server_version };
  } catch (e) { await cleanup(); throw e; }
}
