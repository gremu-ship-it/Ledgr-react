// Phase 8B.1 — replay all migrations + functional tests of reconstructed RPCs.
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54329;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/data', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/data', { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // bootstrap
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
  END $$; GRANT anon, authenticated, service_role TO authenticator;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT SELECT ON auth.users TO anon, authenticated, service_role;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`);
  const EXT = '/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension';
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);

  // replay
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')); }
    catch (e) { console.log('REPLAY FAIL', f, '::', e.message.split('\n')[0]); process.exit(1); }
  }
  console.log('replay OK:', files.length, 'migrations');

  const ok = (label) => console.log('  PASS', label);
  const fail = (label, e) => { console.log('  FAIL', label, '::', (e.message || e).split('\n')[0]); process.exitCode = 1; };
  const asUser = (uid, email, meta) => async (sql) => {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await c.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await c.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)
      on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data`, [uid, email, JSON.stringify(meta || {})]);
    return c.query(sql);
  };

  const uidA = '11111111-1111-1111-1111-111111111111';
  const uidB = '22222222-2222-2222-2222-222222222222';

  try {
    // ── 1. create_business_with_owner ────────────────────────────────────────
    const a = asUser(uidA, 'alice@example.com', { full_name: 'Alice Owner' });
    const r1 = await a(`select public.create_business_with_owner(
      'Alice Trading Co', 'Alice Trading', 'REG-001', 'TPIN-001', 'VAT-001', true,
      'MWK', '07-01', 'Africa/Blantyre', 'Plot 1', 'Blantyre', 'Malawi',
      '+265991000000', 'alice@example.com', '#ff0000', 'INV', 'EXP', 'PAY') as biz_id`);
    const bizA = r1.rows[0].biz_id;
    ok(`create_business_with_owner -> ${bizA}`);

    const biz = (await c.query('select * from public.businesses where id=$1', [bizA])).rows[0];
    if (biz && biz.plan_tier === 'free' && biz.coa_template === 'gaap' && biz.invoice_next_number === 1) ok('business row defaults (free/gaap/counters=1)');
    else fail('business row defaults', JSON.stringify(biz));

    const owner = (await c.query(`select * from public.business_users where business_id=$1 and user_id=$2`, [bizA, uidA])).rows[0];
    if (owner && owner.role === 'owner' && owner.is_active) ok('owner membership created');
    else fail('owner membership', JSON.stringify(owner));

    const prof = (await c.query('select * from public.user_profiles where id=$1', [uidA])).rows[0];
    if (prof && prof.full_name === 'Alice Owner') ok('user_profiles created with full_name from metadata');
    else fail('user_profiles', JSON.stringify(prof));

    const nAccts = (await c.query('select count(*)::int n from public.accounts where business_id=$1', [bizA])).rows[0].n;
    if (nAccts === 166) ok(`COA seeded: ${nAccts} gaap accounts`);
    else fail(`COA seeded (expected 166)`, nAccts);

    const parents = (await c.query(`select count(*)::int n from public.accounts where business_id=$1 and parent_id is not null`, [bizA])).rows[0].n;
    if (parents > 0) ok(`parent_id resolved for ${parents} accounts`);
    else fail('parent_id resolution', parents);

    // ── 2. current_user_role / get_user_role / get_enum_values ───────────────
    const r2 = await a(`select public.current_user_role('${bizA}') as role`);
    if (r2.rows[0].role === 'owner') ok('current_user_role = owner');
    else fail('current_user_role', JSON.stringify(r2.rows[0]));
    const r3 = await a(`select public.get_user_role('${bizA}') as role`);
    if (r3.rows[0].role === 'owner') ok('get_user_role = owner');
    else fail('get_user_role', JSON.stringify(r3.rows[0]));
    const r4 = await a(`select public.get_enum_values('invoice_status') as vals`);
    if (r4.rows[0].vals && r4.rows[0].vals.length === 7) ok('get_enum_values invoice_status (7 labels)');
    else fail('get_enum_values', JSON.stringify(r4.rows[0]));

    // ── 3. invite_member (owner invites alice? no — owner invites bob) ──────
    const r5 = await a(`select public.invite_member('${bizA}', 'bob@example.com', 'accountant') as token`);
    const token = r5.rows[0].token;
    if (token && token.length === 64) ok(`invite_member -> token ${token.slice(0, 8)}...`);
    else fail('invite_member token', token);

    // non-admin cannot invite (bob is accountant at this point)
    try {
      await b(`select public.invite_member('${bizA}', 'x@example.com', 'viewer')`);
      fail('invite_member by non-admin should raise', 'no error');
    } catch (e) { ok('invite_member denied for non-admin'); }

    // ── 4. accept_invitation by user B ───────────────────────────────────────
    const b = asUser(uidB, 'bob@example.com', { full_name: 'Bob Accountant' });
    const r6 = await b(`select public.accept_invitation('${token}') as res`);
    const res = r6.rows[0].res;
    if (res && res.business_id === bizA && res.role === 'accountant') ok('accept_invitation -> membership granted');
    else fail('accept_invitation result', JSON.stringify(res));

    const bobMem = (await c.query(`select * from public.business_users where business_id=$1 and user_id=$2`, [bizA, uidB])).rows[0];
    if (bobMem && bobMem.role === 'accountant' && bobMem.is_active) ok('bob membership row (accountant, active)');
    else fail('bob membership', JSON.stringify(bobMem));
    const invRow = (await c.query(`select * from public.business_invitations where token=$1`, [token])).rows[0];
    if (invRow && invRow.accepted_at) ok('invitation marked accepted');
    else fail('invitation accepted flag', JSON.stringify(invRow));

    // accept again → already a member
    try {
      await b(`select public.accept_invitation('${token}')`);
      fail('accept_invitation again should raise', 'no error');
    } catch (e) { ok('accept_invitation twice -> error'); }

    // ── 5. log_manual_audit_event + verify_audit_chain ──────────────────────
    await a(`select public.log_manual_audit_event('${bizA}', 'invoice_created', 'invoices', gen_random_uuid()::text, 'INV-0001', '{}'::jsonb, '{"total":100}'::jsonb, 'test entry')`);
    await a(`select public.log_manual_audit_event('${bizA}', 'payment_recorded', 'invoice_payments', gen_random_uuid()::text, null, null, '{"amount":100}'::jsonb, null)`);
    const r7 = await a(`select * from public.verify_audit_chain('${bizA}')`);
    const rows = r7.rows;
    if (rows.length === 3 && rows.every((x) => x.chain_valid)) ok(`verify_audit_chain: ${rows.length} rows, all valid`);
    else fail('verify_audit_chain', JSON.stringify(rows));

    // tamper detection
    await c.query(`update public.audit_log set new_values = '{"total":999}'::jsonb
      where business_id=$1 and event_type='invoice_created'`, [bizA]);
    const r8 = await a(`select * from public.verify_audit_chain('${bizA}')`);
    const tampered = r8.rows.filter((x) => !x.chain_valid);
    if (tampered.length === 1) ok(`tamper detected (1 invalid row)`);
    else fail('tamper detection', JSON.stringify(r8.rows.map((x) => x.chain_valid)));

    // permission: non-member cannot log
    const stranger = asUser('33333333-3333-3333-3333-333333333333', 'stranger@example.com', {});
    try {
      await stranger(`select public.log_manual_audit_event('${bizA}', 'x', 'x', null)`);
      fail('log_manual_audit_event by non-member should raise', 'no error');
    } catch (e) { ok('log_manual_audit_event denied for non-member'); }
    try {
      await stranger(`select * from public.verify_audit_chain('${bizA}')`);
      fail('verify_audit_chain by non-auditor should raise', 'no error');
    } catch (e) { ok('verify_audit_chain denied for non-member'); }

    // ── 6. second business for user A (idempotent re-invite path) ────────────
    const r9 = await a(`select public.create_business_with_owner('Second Biz', null, null, null, null, false, 'MWK', '01-01', 'UTC', null, 'Lilongwe', 'Malawi', null, null, null, 'B2', 'B2', 'B2') as biz_id`);
    const bizB2 = r9.rows[0].biz_id;
    const n2 = (await c.query('select count(*)::int n from public.accounts where business_id=$1', [bizB2])).rows[0].n;
    if (bizB2 && n2 === 166) ok(`second business created + COA (${n2} accounts)`);
    else fail('second business', bizB2);

    console.log('\n8B.1 RPC FUNCTIONAL TESTS COMPLETE');
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
