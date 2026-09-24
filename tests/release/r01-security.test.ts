import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, key } from './fixtures';
import { evidenceSuite, Blocked, ObservedFailure, safeError } from './evidence';
import { loadEdge, mockClient } from './edge-loader.mjs';

const test = evidenceSuite('r01-security');
const migration = 'supabase/migrations/20260926000000_r01_privileged_write_boundaries.sql';
const meta = (id: string, expected: string, source = migration) => ({ id: `R01.${id}`, expected, source,
  remediation: 'R01', layer: 'real PostgreSQL17 roles/RLS; explicit three-table conditional ACL fixture, NOT deployed ACL parity' });
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let setupError = '';
beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
    // Synthetic Auth attributes for database-side current-account checks, NOT a live Auth service.
    await db.client.query('alter table auth.users add column banned_until timestamptz, add column deleted_at timestamptz');
    orgs = await seedFixture(db.client);
    // Adversarial effective-ACL assumption, NOT changes to the migration-only R13 bootstrap.
    // Selected-table DML allows actual RLS/guards to be exercised instead of passing on missing grants.
    await db.client.query(`grant select,insert,update,delete on public.user_profiles,
      public.business_users,public.business_invitations to authenticated,service_role`);
    // Trusted synthetic platform operator: never self-promoted by the application principal.
    await db.client.query('update public.user_profiles set is_platform_admin=true where id=$1', [identities.A_stock_clerk.id]);
  } catch (e) { setupError = safeError(e); }
});
afterAll(async () => { if (db) await db.cleanup(); });
function ready() { if (!orgs || setupError) throw new Blocked(`Owned R01 fixture unavailable: ${setupError}`); }
async function deny(run: () => Promise<unknown>) {
  let code: string | undefined;
  try { await run(); } catch (e) { code = (e as {code?: string}).code; }
  if (!code) throw new ObservedFailure('Forbidden operation completed without permission denial.');
  expect(code).toBe('42501'); // Constraint/syntax errors do not count as security denials.
}
const actor = (name: string, sql: string, values: unknown[] = []) => db.asRole('authenticated', identities[name].id, sql, values);
const snapshot = async () => (await db.client.query(`select
  (select jsonb_agg(to_jsonb(p) order by id) from public.user_profiles p) profiles,
  (select jsonb_agg(to_jsonb(m) order by id) from public.business_users m) memberships,
  (select jsonb_agg(to_jsonb(i) order by id) from public.business_invitations i) invitations`)).rows[0];
async function unchangedDenial(run: () => Promise<unknown>) {
  ready(); const before = await snapshot(); await deny(run); expect(await snapshot()).toEqual(before);
}

test(meta('PROFILE.BENIGN', 'Own name, avatar, language, currency and update timestamp remain editable'), async () => {
  ready(); const r = await actor('A_viewer', `update public.user_profiles set full_name='R01 name',
    avatar_url='https://example.invalid/avatar',preferred_language='ny',preferred_currency='MWK',updated_at=now()
    where id=$1 returning full_name,preferred_language`, [identities.A_viewer.id]);
  expect(r.rows).toEqual([{full_name:'R01 name',preferred_language:'ny'}]);
});
for (const [field, value] of [
  ['is_platform_admin', 'true'], ['phone', "'+265990000009'"],
  ['deletion_requested_at', 'now()'], ['deletion_finalized_at', 'now()'], ['created_at', "'2000-01-01'"],
]) test(meta(`PROFILE.PROTECTED.${field}`, `Own ${field} cannot be self-asserted; denied statement preserves all rows`),
  () => unchangedDenial(() => actor('A_viewer', `update public.user_profiles set ${field}=${value} where id=$1 returning id`, [identities.A_viewer.id])));
test(meta('PROFILE.MIXED-ATOMIC', 'Combining a legitimate name edit and privileged flag change is wholly denied'),
  () => unchangedDenial(() => actor('A_viewer', "update public.user_profiles set full_name='not saved',is_platform_admin=true where id=$1", [identities.A_viewer.id])));
test(meta('PROFILE.CLAIM-NOT-ROLE', 'A service_role claim string cannot turn authenticated SQL execution into trusted service execution'),
  () => unchangedDenial(() => db.asRole('authenticated', identities.A_viewer.id, async (c: typeof db.client) => {
    await c.query("select set_config('request.jwt.claim.role','service_role',true)");
    await c.query('update public.user_profiles set is_platform_admin=true where id=$1', [identities.A_viewer.id]);
  })));
test(meta('PROFILE.UPSERT', 'Whole-row upsert cannot set own privileged flag through INSERT/ON CONFLICT'),
  () => unchangedDenial(() => actor('A_viewer', `insert into public.user_profiles(id,full_name,is_platform_admin)
    values($1,'R01 forbidden',true) on conflict(id) do update set is_platform_admin=excluded.is_platform_admin`, [identities.A_viewer.id])));
test(meta('PROFILE.PLATFORM-BENIGN', 'Flagged platform operator can edit name with unchanged privileged fields'), async () => {
  ready(); const r = await actor('A_stock_clerk', "update public.user_profiles set full_name='R01 operator',is_platform_admin=true where id=$1 returning id", [identities.A_stock_clerk.id]);
  expect(r.rows).toHaveLength(1);
});
test(meta('PROFILE.PLATFORM-NO-DELEGATION', 'Platform UI flag does not grant arbitrary profile mutation authority'), async () => {
  ready(); const r = await actor('A_stock_clerk', 'update public.user_profiles set is_platform_admin=true where id=$1 returning id', [identities.B_viewer.id]);
  expect(r.rows).toHaveLength(0);
});
test(meta('PROFILE.SERVICE-LIFECYCLE', 'Real service SQL role retains privileged profile write, request/cancel/finalize capability'), async () => {
  ready(); await db.asRole('service_role', null, async (c: typeof db.client) => {
    const r = await c.query(`update public.user_profiles set is_platform_admin=true,phone='+265990000009',deletion_requested_at=now()
      where id=$1 returning is_platform_admin`, [identities.A_viewer.id]);
    expect(r.rows[0].is_platform_admin).toBe(true);
    await c.query('update public.user_profiles set deletion_requested_at=null,deletion_finalized_at=now() where id=$1', [identities.A_viewer.id]);
  });
});
for (const [own, foreign] of [['A','B'],['B','A']]) {
  for (const operation of ['read','update','delete']) test(meta(`TENANT.${own}.${operation}`, `Legitimate own profile access; ${own} cannot ${operation} ${foreign} profile or membership`), async () => {
    ready(); const user = identities[`${own}_admin`];
    expect((await actor(`${own}_admin`, 'select id from public.user_profiles where id=$1', [user.id])).rows).toHaveLength(1);
    for (const [table, field, id] of [['user_profiles','id',identities[`${foreign}_viewer`].id], ['business_users','user_id',identities[`${foreign}_viewer`].id]]) {
      const sql = operation === 'read' ? `select id from public.${table} where ${field}=$1`
        : operation === 'update' ? `update public.${table} set updated_at=now() where ${field}=$1 returning id`
          : `delete from public.${table} where ${field}=$1 returning id`;
      expect((await actor(`${own}_admin`, sql, [id])).rows).toHaveLength(0);
    }
  });
  test(meta(`TENANT.${own}.PRIVILEGED`, `${own} manager cannot insert an owner membership into ${foreign}`),
    () => unchangedDenial(() => actor(`${own}_owner`, "insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'owner',true)", [orgs[foreign].business,identities[`${own}_viewer`].id])));
}
for (const role of ['owner','admin']) {
  test(meta(`MEMBER.ADMIN-ASSIGN.${role}`, `Admin cannot assign ${role} by UPDATE`),
    () => unchangedDenial(() => actor('A_admin', `update public.business_users set role='${role}' where business_id=$1 and user_id=$2`, [orgs.A.business,identities.A_viewer.id])));
  test(meta(`MEMBER.ADMIN-INSERT.${role}`, `Admin cannot insert ${role} membership for another identity`),
    () => unchangedDenial(() => actor('A_admin', `insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'${role}',true)`, [orgs.A.business,identities.B_viewer.id])));
  test(meta(`MEMBER.ADMIN-TARGET.${role}`, `Admin cannot demote existing ${role}`),
    () => unchangedDenial(() => actor('A_admin', "update public.business_users set role='viewer' where business_id=$1 and user_id=$2", [orgs.A.business,identities[`A_${role}`].id])));
  test(meta(`MEMBER.ADMIN-DELETE.${role}`, `Admin cannot delete existing ${role}`),
    () => unchangedDenial(() => actor('A_admin', 'delete from public.business_users where business_id=$1 and user_id=$2', [orgs.A.business,identities[`A_${role}`].id])));
}
test(meta('MEMBER.ADMIN-SELF', 'Admin cannot promote own membership to owner'),
  () => unchangedDenial(() => actor('A_admin', "update public.business_users set role='owner' where business_id=$1 and user_id=$2", [orgs.A.business,identities.A_admin.id])));
test(meta('MEMBER.ADMIN-UPSERT', 'Admin cannot bypass privileged assignment by ON CONFLICT'),
  () => unchangedDenial(() => actor('A_admin', `insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'owner',true)
    on conflict(business_id,user_id) do update set role=excluded.role`, [orgs.A.business,identities.A_viewer.id])));
for (const [name, role] of [['A_admin','accountant'],['A_owner','admin'],['A_owner','owner']]) {
  test(meta(`MEMBER.ALLOW.${name}.${role}`, `Authorized ${name} can assign ${role} in own business`), async () => {
    ready(); expect((await actor(name, `update public.business_users set role=$1 where business_id=$2 and user_id=$3 returning role`, [role,orgs.A.business,identities.A_viewer.id])).rows[0].role).toBe(role);
  });
}
test(meta('MEMBER.ADMIN-REMOVE-ORDINARY', 'Admin retains ordinary member soft removal, token clearing and hard removal'), async () => {
  ready(); for (const sql of ["update public.business_users set is_active=false,invitation_token=null,invitation_expires_at=null,updated_at=now() where business_id=$1 and user_id=$2 returning id", 'delete from public.business_users where business_id=$1 and user_id=$2 returning id']) {
    expect((await actor('A_admin', sql, [orgs.A.business,identities.A_viewer.id])).rows).toHaveLength(1);
  }
});
test(meta('MEMBER.IDENTITY', 'Even a manager of both businesses cannot relocate a membership row'),
  () => unchangedDenial(() => db.asRole('authenticated', identities.A_owner.id, async (c: typeof db.client) => {
    // Explicit privileged SETUP, followed by actual-role mutation. Entire probe rolls back.
    await c.query('reset role');
    await c.query("insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'owner',true)", [orgs.B.business,identities.A_owner.id]);
    await c.query('set local role authenticated');
    await c.query('update public.business_users set business_id=$1 where business_id=$2 and user_id=$3', [orgs.B.business,orgs.A.business,identities.A_viewer.id]);
  })));

const invitation = async (name: string, role: string, issuer = identities[name].id) => actor(name,
  'insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,$3,$4,$5) returning id',
  [orgs.A.business,identities.B_viewer.email,role,'r01-synthetic-token',issuer]);
for (const [name, role] of [['A_viewer','viewer'],['A_viewer','owner'],['A_admin','owner'],['A_admin','admin']]) {
  test(meta(`INVITE.DENY.${name}.${role}`, `${name} cannot directly issue ${role} invitation`), () => unchangedDenial(() => invitation(name,role)));
}
for (const [name, role] of [['A_admin','viewer'],['A_owner','admin'],['A_owner','owner']]) {
  test(meta(`INVITE.ALLOW.${name}.${role}`, `${name} can directly issue authorized ${role} invitation`), async () => {
    ready(); expect((await invitation(name,role)).rows).toHaveLength(1);
  });
}
test(meta('INVITE.FORGED-ISSUER', 'Admin cannot claim that an owner issued its invitation'),
  () => unchangedDenial(() => invitation('A_admin','viewer',identities.A_owner.id)));
for (const field of ['invited_by','business_id']) test(meta(`INVITE.IMMUTABLE.${field}`, `Direct UPDATE cannot replace invitation ${field}`),
  () => unchangedDenial(() => db.asRole('authenticated', identities.A_owner.id, async (c: typeof db.client) => {
    await c.query('reset role');
    const id = (await c.query("insert into public.business_invitations(business_id,role,token,invited_by) values($1,'viewer','r01-mutate',$2) returning id", [orgs.A.business,identities.A_owner.id])).rows[0].id;
    // Both-business management for business_id case; forbid even an otherwise RLS-permitted relocation.
    await c.query("insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'owner',true)", [orgs.B.business,identities.A_owner.id]);
    await c.query('set local role authenticated');
    const values: Record<string, unknown> = {role:'owner',invited_by:identities.A_admin.id,email:identities.A_viewer.email,business_id:orgs.B.business,token:'r01-replaced',accepted_at:'2026-09-21'};
    await c.query(`update public.business_invitations set ${field}=$1 where id=$2`, [values[field],id]);
  })));
test(meta('INVITE.REVOKE', 'Admin can revoke ordinary invitation; only owner may revoke privileged invitation'), async () => {
  ready(); await db.asRole('authenticated', identities.A_admin.id, async (c: typeof db.client) => {
    await c.query('reset role');
    const id = (await c.query("insert into public.business_invitations(business_id,role,token,invited_by) values($1,'viewer','r01-revoke',$2) returning id", [orgs.A.business,identities.A_owner.id])).rows[0].id;
    await c.query('set local role authenticated');
    expect((await c.query('delete from public.business_invitations where id=$1 returning id',[id])).rows).toHaveLength(1);
  });
});
test(meta('RPC.INVITE-PRIVILEGED-DENY', 'Existing invite_member RPC denies admin owner-role invitation'),
  () => unchangedDenial(() => actor('A_admin', "select public.invite_member($1,$2,'owner')", [orgs.A.business,identities.B_viewer.email])));
test(meta('RPC.CREATE-BUSINESS', 'Authenticated provisioning still creates caller-owned business without granting arbitrary old-business ownership'), async () => {
  ready(); await db.asRole('authenticated', identities.B_viewer.id, async (c: typeof db.client) => {
    const id = (await c.query("select public.create_business_with_owner('R01 business','R01',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') id")).rows[0].id;
    const row = (await c.query('select role from public.business_users where business_id=$1 and user_id=$2',[id,identities.B_viewer.id])).rows[0];
    expect(row.role).toBe('owner');
  });
});
for (const fn of ['grant_user_business_access','set_user_business_access']) {
  const sql = fn === 'grant_user_business_access' ? 'select * from public.grant_user_business_access($1,$2,\'viewer\')' : 'select * from public.set_user_business_access($1,array[$2]::uuid[],\'viewer\',false)';
  test(meta(`RPC.SERVICE-ONLY.${fn}`, `${fn} cannot be called by authenticated user with foreign target identifiers`),
    () => unchangedDenial(() => actor('A_owner',sql,[identities.A_viewer.email,orgs.B.business])));
  test(meta(`RPC.SERVICE-ALLOW.${fn}`, `${fn} remains available for intentional service provisioning across businesses`, fn === 'grant_user_business_access' ? 'supabase/migrations/20260728000003_fix_user_business_provisioning.sql' : 'supabase/migrations/20260728000004_replace_eagle_assign_with_safe_access.sql'), async () => {
    ready(); expect((await db.asRole('service_role',null,sql,[identities.A_viewer.email,orgs.B.business])).rows).toHaveLength(1);
  });
}
test(meta('PLATFORM.DIRECTORY', 'Ordinary caller denied; trusted platform operator retains cross-business directory'), async () => {
  ready(); await deny(() => actor('A_viewer','select * from public.list_all_businesses()'));
  expect((await actor('A_stock_clerk','select * from public.list_all_businesses()')).rows).toHaveLength(2);
});
test(meta('MIGRATION.STATE', 'Three invoker guards installed, RLS retained, trigger helpers not publicly callable'), async () => {
  ready(); const r = await db.client.query(`select t.tgname,p.prosecdef,c.relrowsecurity,
    has_function_privilege('authenticated',p.oid,'EXECUTE') executable
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_class c on c.oid=t.tgrelid
    where t.tgname in ('r01_profile_write_guard','r01_membership_write_guard','r01_invitation_write_guard')`);
  expect(r.rows).toHaveLength(3);
  expect((await db.client.query("select count(*)::int n from pg_proc where proname='assign_user_to_eagle_businesses'")).rows[0].n).toBe(0);
  expect(r.rows.every((x: {prosecdef: boolean;relrowsecurity: boolean;executable: boolean}) => !x.prosecdef && x.relrowsecurity && !x.executable)).toBe(true);
});

const edgeMeta = (id: string, expected: string, name: string) => ({...meta(id,expected),source:`supabase/functions/${name}/index.ts`,layer:'actual Edge source in Node VM; mocked Auth/database, no Deno/gateway/provider verification'});
test(edgeMeta('PLATFORM.MANUAL-GRANT', 'Authorized platform operator retains manual-grant handler path', 'grant-manual-subscription'), async () => {
  const client=mockClient({user:{id:identities.A_stock_clerk.id},resolveQuery:c=>({data:c.table==='user_profiles'?{is_platform_admin:true}:c.table==='businesses'?{id:key(992),name:'R01 B'}:null,error:null}),resolveRpc:()=>({data:{target_plan_tier:'growth',plan_expires_at:'2099-01-01'},error:null})});
  const edge=loadEdge('grant-manual-subscription',{client});
  const r=await edge.invoke(new Request('https://r13.invalid/grant',{method:'POST',headers:{Authorization:'Bearer r01-synthetic'},body:JSON.stringify({business_id:key(992),target_plan_tier:'growth',duration_days:30,amount:100000,payment_method:'cash'})}));
  expect(r.status).toBe(200);expect(client.calls.filter((c:{rpc?:string})=>c.rpc==='apply_subscription_payment')).toHaveLength(1);
});


const assignmentRoles = ['owner','admin','accountant','payroll_manager','supervisor','data_entry','inventory_manager',
  'sales_clerk','auditor','viewer','purchasing_officer','warehouse_worker','sales_manager','customer_service_rep',
  'tax_compliance_officer','treasury_manager','asset_manager','board_member','branch_manager','manager','cashier','stock_clerk'];
test(meta('CONTRACT.ENUM', 'Every database membership role is included in the assignment contract matrix'), async () => {
  ready(); const rows=(await db.client.query("select enumlabel from pg_enum where enumtypid='public.user_role'::regtype")).rows;
  expect(rows.map((r:{enumlabel:string})=>r.enumlabel).sort()).toEqual([...assignmentRoles].sort());
});
for(const role of assignmentRoles) for(const sourceRole of ['owner','admin','viewer']) {
  const allowed=sourceRole==='owner'||(sourceRole==='admin'&&!['owner','admin'].includes(role));
  test(meta(`CONTRACT.${sourceRole}.${role}`, `${sourceRole} assigning ${role}: direct membership and invitation creation/acceptance ${allowed?'ALLOWED':'DENIED'}`),async()=>{
    ready(); const name=`A_${sourceRole}`;
    if(!allowed) {
      if(sourceRole==='viewer') expect((await actor(name,'update public.business_users set role=$1 where business_id=$2 and user_id=$3 returning id',[role,orgs.A.business,identities.A_cashier.id])).rows).toHaveLength(0);
      else await unchangedDenial(()=>actor(name,'update public.business_users set role=$1 where business_id=$2 and user_id=$3',[role,orgs.A.business,identities.A_cashier.id]));
      await unchangedDenial(()=>invitation(name,role));
      await unchangedDenial(()=>actor(name,'select public.invite_member($1,$2,$3)',[orgs.A.business,identities.B_viewer.email,role]));
      return;
    }
    await db.asRole('authenticated',identities[name].id,async(c:typeof db.client)=>{
      expect((await c.query('update public.business_users set role=$1 where business_id=$2 and user_id=$3 returning role',[role,orgs.A.business,identities.A_cashier.id])).rows[0].role).toBe(role);
      await c.query('insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,$3,$4,$5)',[orgs.A.business,identities.B_viewer.email,role,'r01-contract',identities[name].id]);
      const issued=(await c.query('select public.invite_member($1,$2,$3) token',[orgs.A.business,identities.B_viewer.email,role])).rows[0].token;
      expect((await c.query('select role from public.business_invitations where token=$1',[issued])).rows[0].role).toBe(role);
      // Simulate the separately authenticated RECIPIENT in the same rollback fixture.
      await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.B_viewer.id]);
      const r=(await c.query("select public.accept_invitation('r01-contract') result")).rows[0].result;
      expect(r.business_id).toBe(orgs.A.business);expect(r.role).toBe(role);
    });
  });
}
for(const [own,foreign] of [['A','B'],['B','A']]) test(meta(`INVITE.CROSS.${own}`, `${own} owner cannot create an invitation belonging to ${foreign}`),()=>unchangedDenial(()=>actor(`${own}_owner`,
  "insert into public.business_invitations(business_id,role,token,invited_by) values($1,'owner','r01-cross',$2)",[orgs[foreign].business,identities[`${own}_owner`].id])));
test(meta('MEMBER.ADMIN-DEMOTE-PEER','Admin retains existing permission to demote another admin, not self or owner'),async()=>{
  ready();await db.asRole('authenticated',identities.A_admin.id,async(c:typeof db.client)=>{
    await c.query('reset role');await c.query("update public.business_users set role='admin' where business_id=$1 and user_id=$2",[orgs.A.business,identities.A_cashier.id]);
    await c.query('set local role authenticated');
    expect((await c.query("update public.business_users set role='viewer' where business_id=$1 and user_id=$2 returning id",[orgs.A.business,identities.A_cashier.id])).rows).toHaveLength(1);
  });
});
for(const mode of ['wrong-identity','expired','invalid'] as const) test(meta(`ACCEPT.RPC.${mode}`, `Existing ${mode} invitation is rejected without membership changes`),async()=>{
  ready();const before=await snapshot();let code='';
  try {await db.asRole('authenticated',identities.B_viewer.id,async(c:typeof db.client)=>{
    await c.query('reset role');
    if(mode!=='invalid')await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by,expires_at) values($1,$2,'owner','r01-invalid',$3,$4)",[orgs.A.business,mode==='wrong-identity'?identities.B_cashier.email:identities.B_viewer.email,identities.A_owner.id,mode==='expired'?'2000-01-01':'2099-01-01']);
    await c.query('set local role authenticated');await c.query("select public.accept_invitation('r01-invalid')");
  });}catch(e){code=(e as {code:string}).code;}
  expect(code).toBe(mode==='wrong-identity'?'42501':'P0002');expect(await snapshot()).toEqual(before);
});
test(meta('ACCEPT.LEGACY-PROVENANCE','Unverifiable historical invitation fails closed even when its stored issuer names a current owner'),async()=>{
  ready();await unchangedDenial(()=>db.asRole('authenticated',identities.B_viewer.id,async(c:typeof db.client)=>{
    await c.query('reset role');
    await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'owner','r01-legacy',$3)",[orgs.A.business,identities.B_viewer.email,identities.A_owner.id]);
    const has=(await c.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='business_invitations' and column_name='role_assignment_authorized') present")).rows[0].present;
    // Trusted SETUP models an old row with no verifiable authorization. No fixture default changed.
    if(has)await c.query("update public.business_invitations set role_assignment_authorized=false where token='r01-legacy'");
    await c.query('set local role authenticated');await c.query("select public.accept_invitation('r01-legacy')");
  }));
});
test(meta('ACCEPT.INACTIVE-OWNER','An admin-issued ordinary-role invitation cannot demote an existing inactive owner through acceptance', 'supabase/migrations/20260815000000_phase8b_reconstruct_rpcs.sql'),async()=>{
  ready();await unchangedDenial(()=>db.asRole('authenticated',identities.A_admin.id,async(c:typeof db.client)=>{
    await c.query('reset role');await c.query('update public.business_users set is_active=false where business_id=$1 and user_id=$2',[orgs.A.business,identities.A_owner.id]);
    await c.query('set local role authenticated');
    await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'viewer','r01-owner-reactivation',$3)",[orgs.A.business,identities.A_owner.email,identities.A_admin.id]);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.A_owner.id]);
    await c.query("select public.accept_invitation('r01-owner-reactivation')");
  }));
});
for(const sourceRole of ['owner','admin']) test(edgeMeta(`MEMBER.EDGE-REACTIVATE.${sourceRole}`,'Direct service-backed member invitation cannot bypass owner-target protection','invite-team-member'),async()=>{
  const client=mockClient({user:{id:identities[`A_${sourceRole}`].id},resolveQuery:c=>{
    if(c.table==='phone_accounts')return {data:{user_id:identities.B_owner.id},error:null};
    if(c.table==='business_users')return {data:c.filters.some(f=>f[1]==='user_id'&&f[2]===identities[`A_${sourceRole}`].id)?{role:sourceRole,is_active:true}:{id:key(997),role:'owner',is_active:false},error:null};
    return {data:null,error:null};
  }});
  const edge=loadEdge('invite-team-member',{client});
  const response=await edge.invoke(new Request('https://r13.invalid/invite',{method:'POST',headers:{Authorization:'Bearer r01-synthetic'},body:JSON.stringify({business_id:key(999),phone:'+265990000001',role:'viewer',reset_password:false})}));
  expect(response.status).toBe(sourceRole==='owner'?200:403);
  const writes=client.calls.filter((c:{table?:string;operation?:string})=>c.table==='business_users'&&c.operation==='update');
  expect(writes).toHaveLength(sourceRole==='owner'?1:0);
});


for(const role of assignmentRoles) for(const sourceRole of ['owner','admin','viewer']) {
  const allowed=sourceRole==='owner'||(sourceRole==='admin'&&!['owner','admin'].includes(role));
  test(edgeMeta(`CREATE.EDGE.${sourceRole}.${role}`,`${sourceRole} ${allowed?'may':'may not'} create ${role} invitation through the existing handler`,'create-invite-link'),async()=>{
    const businessId=key(998);
    const client=mockClient({user:{id:identities[`A_${sourceRole}`].id},resolveQuery:c=>{
      if(c.table==='business_users')return {data:c.filters.some(f=>f[1]==='business_id'&&f[2]===businessId)?{role:sourceRole,is_active:true}:null,error:null};
      return {data:c.table==='businesses'?{id:businessId,name:'R01 A'}:null,error:null};
    }});
    const edge=loadEdge('create-invite-link',{client});
    const r=await edge.invoke(new Request('https://r13.invalid/create-invite',{method:'POST',headers:{Authorization:'Bearer r01-synthetic'},body:JSON.stringify({business_id:businessId,role,email:identities.B_viewer.email})}));
    expect(r.status).toBe(allowed?200:403);
    expect(client.calls.filter((c:{table?:string;operation?:string})=>c.table==='business_invitations'&&c.operation==='insert')).toHaveLength(allowed?1:0);
    expect(edge.effects).toEqual({network:0,mail:0});
  });
}
for(const mode of ['valid','wrong-identity','expired','invalid'] as const) test(edgeMeta(`ACCEPT.EDGE.${mode}`,'Acceptance retains identity/expiry rules and obtains role/organization only from stored invitation','accept-invite-link'),async()=>{
  const a=key(996);const b=key(995);
  const client=mockClient({user:{id:identities.B_viewer.id,email:identities.B_viewer.email},resolveQuery:c=>{
    if(c.table==='business_invitations')return {data:mode==='invalid'?null:{id:key(994),business_id:a,role:'admin',email:mode==='wrong-identity'?identities.A_viewer.email:identities.B_viewer.email,phone:null,invited_by:identities.A_owner.id,accepted_at:null,expires_at:mode==='expired'?'2000-01-01':'2099-01-01'},error:null};
    return {data:c.table==='businesses'?{name:'R01 A'}:null,error:null};
  },resolveRpc:(name)=>name==='accept_invitation_membership'?{data:{success:true,business_id:a,role:'admin',business_name:'R01 A'},error:null}:{data:null,error:{message:'R01 synthetic invitation not found'}}});
  const edge=loadEdge('accept-invite-link',{client});
  const r=await edge.invoke(new Request('https://r13.invalid/accept',{method:'POST',headers:{Authorization:'Bearer r01-synthetic'},body:JSON.stringify({token:'r01-synthetic',business_id:b,role:'owner'})}));
  expect(r.status).toBe(({valid:200,'wrong-identity':403,expired:400,invalid:404})[mode]);
  const writes=client.calls.filter((c:{table?:string;operation?:string})=>c.table==='business_users'&&c.operation==='insert');
  if(mode==='valid'){
    expect(writes).toHaveLength(0);
    const commits=client.calls.filter((c:{rpc?:string})=>c.rpc==='accept_invitation_membership');
    expect(commits).toHaveLength(1);expect((commits[0] as {args:unknown}).args).toMatchObject({p_invitation_id:key(994),p_recipient_id:identities.B_viewer.id});
    expect(await r.json()).toMatchObject({business_id:a,role:'admin'});
  }else expect(writes).toHaveLength(0);
});


const currentSource='supabase/migrations/20260926000002_r01_acceptance_current_authority.sql';
for(const role of assignmentRoles) for(const state of ['authorized','inactive','demoted','owner-to-admin','wrong-org','missing','null-issuer','banned','deleted','unverifiable'] as const){
  const allowed=state==='authorized'||(state==='owner-to-admin'&&!['owner','admin'].includes(role));
  test(meta(`CURRENT.${role}.${state}`,`Acceptance of ${role} with ${state} issuer is ${allowed?'ALLOWED':'DENIED'} under current role authority`,currentSource),async()=>{
    ready();const run=()=>db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
      await c.query('insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,$3,$4,$5)',[orgs.A.business,identities.B_viewer.email,role,'r01-current',identities.A_owner.id]);
      // Simulate post-issuance authority changes using SETUP privilege only.
      await c.query('reset role');
      if(state==='inactive')await c.query('update public.business_users set is_active=false where business_id=$1 and user_id=$2',[orgs.A.business,identities.A_owner.id]);
      if(state==='demoted'||state==='owner-to-admin')await c.query('update public.business_users set role=$1 where business_id=$2 and user_id=$3',[state==='demoted'?'viewer':'admin',orgs.A.business,identities.A_owner.id]);
      if(state==='wrong-org')await c.query('update public.business_users set business_id=$1 where business_id=$2 and user_id=$3',[orgs.B.business,orgs.A.business,identities.A_owner.id]);
      if(state==='missing')await c.query('delete from auth.users where id=$1',[identities.A_owner.id]);
      if(state==='banned')await c.query("update auth.users set banned_until='2099-01-01' where id=$1",[identities.A_owner.id]);
      if(state==='deleted')await c.query('update auth.users set deleted_at=now() where id=$1',[identities.A_owner.id]);
      if(state==='unverifiable'){
        const present=(await c.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='business_invitations' and column_name='role_assignment_authorized') present")).rows[0].present;
        if(present)await c.query("update public.business_invitations set role_assignment_authorized=false where token='r01-current'");
      }
      if(state==='null-issuer')await c.query("update public.business_invitations set invited_by=null where token='r01-current'");
      await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.B_viewer.id]);
      await c.query('set local role authenticated');
      const result=(await c.query("select public.accept_invitation('r01-current') result")).rows[0].result;
      expect(result).toMatchObject({role,business_id:orgs.A.business});
      // Observe actual mutation, not only the RPC's returned claim.
      await c.query('reset role');
      expect((await c.query('select role,is_active from public.business_users where business_id=$1 and user_id=$2',[orgs.A.business,identities.B_viewer.id])).rows).toEqual([{role,is_active:true}]);
      const consumed=(await c.query("select accepted_at,accepted_by from public.business_invitations where token='r01-current'")).rows[0];
      expect(consumed.accepted_at).not.toBeNull();expect(consumed.accepted_by).toBe(identities.B_viewer.id);
    });
    if(allowed)await run();else await unchangedDenial(run);
  });
}
const ownerTrace:Record<string,unknown>={initialRole:'owner',initialActive:true,issuerRole:'admin',invitationRole:'viewer',ownerActiveAtAcceptance:false,expected:{role:'owner',is_active:false},actual:null,denial:null};
const ownerMeta={...meta('INVITATION.ACCEPTANCE.INACTIVE_OWNER','Admin issues ordinary invitation while owner active; owner becomes inactive; acceptance denied and owner membership unchanged',currentSource),observations:ownerTrace};
test(ownerMeta,async()=>{
  ready();await db.asRole('authenticated',identities.A_admin.id,async(c:typeof db.client)=>{
    const initial=(await c.query('select role,is_active from public.business_users where business_id=$1 and user_id=$2',[orgs.A.business,identities.A_owner.id])).rows[0];
    expect(initial).toEqual({role:'owner',is_active:true});
    await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'viewer','r01-exact-owner',$3)",[orgs.A.business,identities.A_owner.email,identities.A_admin.id]);
    await c.query('reset role');await c.query('update public.business_users set is_active=false where business_id=$1 and user_id=$2',[orgs.A.business,identities.A_owner.id]);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.A_owner.id]);await c.query('set local role authenticated');
    await c.query('savepoint acceptance_probe');
    try{await c.query("select public.accept_invitation('r01-exact-owner')");}
    catch(e){ownerTrace.denial=(e as {code?:string}).code;await c.query('rollback to savepoint acceptance_probe');}
    await c.query('reset role');ownerTrace.actual=(await c.query('select role,is_active from public.business_users where business_id=$1 and user_id=$2',[orgs.A.business,identities.A_owner.id])).rows[0];
    expect(ownerTrace.denial).toBe('42501');expect(ownerTrace.actual).toEqual(ownerTrace.expected);
    expect((await c.query("select accepted_at from public.business_invitations where token='r01-exact-owner'")).rows[0].accepted_at).toBeNull();
  });
});
for(const mode of ['metadata-name','email-fallback','existing-profile'] as const)test(meta(`PROVISION.${mode}`,'Service provisioning supplies required profile name, preserves existing fields, creates intended business membership and remains idempotent',currentSource),async()=>{
  ready();await db.asRole('service_role',null,async(c:typeof db.client)=>{
    const id=key(88001);
    await c.query('reset role');
    await c.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,'r01-new-user@example.invalid',JSON.stringify(mode==='metadata-name'?{full_name:'R01 legitimate name',is_platform_admin:true}:{})]);
    if(mode==='existing-profile')await c.query("insert into public.user_profiles(id,full_name,preferred_language) values($1,'R01 preserve name','ny')",[id]);
    await c.query('set local role service_role');
    for(let n=0;n<2;n++)expect((await c.query("select * from public.grant_user_business_access($1,$2,'accountant')",[id,orgs.A.business])).rows[0].out_role).toBe('accountant');
    const p=(await c.query('select full_name,is_platform_admin,preferred_language from public.user_profiles where id=$1',[id])).rows[0];
    expect(p.full_name).toBe(mode==='metadata-name'?'R01 legitimate name':mode==='existing-profile'?'R01 preserve name':'r01-new-user');expect(p.is_platform_admin).toBe(false);
    if(mode==='existing-profile')expect(p.preferred_language).toBe('ny');
    const member=(await c.query('select role,is_active,business_id from public.business_users where user_id=$1',[id])).rows;
    expect(member).toEqual([{role:'accountant',is_active:true,business_id:orgs.A.business}]);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await c.query('set local role authenticated');
    expect((await c.query('select id from public.contacts where id=$1',[orgs.A.customer])).rows).toHaveLength(1);
    expect((await c.query('select id from public.contacts where id=$1',[orgs.B.customer])).rows).toHaveLength(0);
  });
});
test(meta('CURRENT.SERVICE-RPC-DENY','Authenticated users cannot invoke the service-only acceptance mutation with forged recipient identifiers',currentSource),()=>unchangedDenial(()=>actor('A_owner','select public.accept_invitation_membership($1,$2,$3::jsonb)',[key(999),identities.B_owner.id,'{}'])));
for(const code of ['42501','P0002','55000'])test(edgeMeta(`ACCEPT.EDGE-CURRENT.${code}`,'Edge rejects failed database authority/state checks without client-side membership or profile writes','accept-invite-link'),async()=>{
  const client=mockClient({user:{id:identities.B_viewer.id,email:identities.B_viewer.email},resolveQuery:c=>({data:c.table==='business_invitations'?{id:key(981),business_id:key(982),role:'owner',email:identities.B_viewer.email,invited_by:identities.A_owner.id,accepted_at:null,expires_at:'2099-01-01'}:c.table==='businesses'?{name:'R01 A'}:null,error:null}),resolveRpc:()=>({data:null,error:{code,message:'R01 controlled rejection'}})});
  const edge=loadEdge('accept-invite-link',{client});const response=await edge.invoke(new Request('https://r13.invalid/accept',{method:'POST',headers:{Authorization:'Bearer r01-synthetic'},body:JSON.stringify({token:'r01-synthetic',user_id:identities.A_owner.id})}));
  expect(response.status).toBe(code==='42501'?403:code==='P0002'?404:400);
  expect(client.calls.filter((c:{operation?:string})=>c.operation&&c.operation!=='select')).toHaveLength(0);
});


test(meta('CURRENT.ELIGIBILITY-IMMUTABLE','Even an owner cannot self-certify a legacy marker with a metadata-only direct update',currentSource),async()=>{
  ready();await unchangedDenial(()=>db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
    await c.query('reset role');
    await c.query("insert into public.business_invitations(business_id,role,token,invited_by) values($1,'owner','r01-marker',$2)",[orgs.A.business,identities.A_owner.id]);
    const present=(await c.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='business_invitations' and column_name='role_assignment_authorized') present")).rows[0].present;
    if(!present)throw new ObservedFailure('No eligibility boundary exists before this migration.');
    await c.query("update public.business_invitations set role_assignment_authorized=false where token='r01-marker'");
    await c.query('set local role authenticated');await c.query("update public.business_invitations set role_assignment_authorized=true where token='r01-marker'");
  }));
});
for(const changed of [false,true])test(meta(`CURRENT.SERVICE-SNAPSHOT.${changed?'changed':'valid'}`,'Service-only role mutation requires the identity/role/org snapshot already checked by the handler',currentSource),async()=>{
  ready();const run=()=>db.asRole('service_role',null,async(c:typeof db.client)=>{
    const inv=(await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'admin','r01-snapshot',$3) returning to_jsonb(business_invitations) snapshot",[orgs.A.business,identities.B_viewer.email,identities.A_owner.id])).rows[0].snapshot;
    if(changed)await c.query('update public.business_invitations set email=$1 where id=$2',[identities.B_cashier.email,inv.id]);
    const result=(await c.query('select public.accept_invitation_membership($1,$2,$3::jsonb) result',[inv.id,identities.B_viewer.id,JSON.stringify(inv)])).rows[0].result;
    expect(result).toMatchObject({business_id:orgs.A.business,role:'admin'});
  });if(changed)await unchangedDenial(run);else await run();
});
test(meta('CURRENT.ISSUER-LOCK','Issuer demotion cannot interleave between successful SQL acceptance and transaction commit',currentSource),async()=>{
  ready();
  const params=db.client.connectionParameters;
  // Only connection properties of the verified owned local fixture; never ambient URLs.
  const Peer=Object.getPrototypeOf(db.client).constructor;
  const peer=new Peer({host:'127.0.0.1',port:params.port,user:params.user,password:params.password,database:params.database});
  try{
    await peer.connect();await peer.query("begin");await peer.query("set local lock_timeout='200ms'");
    await db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
      await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'owner','r01-lock',$3)",[orgs.A.business,identities.B_viewer.email,identities.A_owner.id]);
      await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.B_viewer.id]);
      await c.query("select public.accept_invitation('r01-lock')");
      let code='';try{await peer.query("update public.business_users set role='viewer' where business_id=$1 and user_id=$2",[orgs.A.business,identities.A_owner.id]);}catch(e){code=(e as {code:string}).code;}
      expect(code).toBe('55P03');
    });
  }finally{await peer.query("rollback");await peer.end();}
});
test(meta('CURRENT.CATALOG','Acceptance eligibility defaults fail closed, and only service SQL role has direct execution of the atomic membership RPC',currentSource),async()=>{
  ready();const col=(await db.client.query("select is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='business_invitations' and column_name='role_assignment_authorized'")).rows;
  expect(col).toHaveLength(1);expect(col[0]).toMatchObject({is_nullable:'NO',column_default:'false'});
  const acl=(await db.client.query("select has_function_privilege('anon','public.accept_invitation_membership(uuid,uuid,jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.accept_invitation_membership(uuid,uuid,jsonb)','EXECUTE') authenticated,has_function_privilege('service_role','public.accept_invitation_membership(uuid,uuid,jsonb)','EXECUTE') service")).rows[0];
  expect(acl).toEqual({anon:false,authenticated:false,service:true});
});

test(meta('CURRENT.ALREADY-MEMBER','Legacy acceptance acknowledges existing access without changing role, still ensuring required profile fields',currentSource),async()=>{
  ready();await db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
    await c.query("insert into public.business_invitations(business_id,email,role,token,invited_by) values($1,$2,'admin','r01-already',$3)",[orgs.A.business,identities.A_viewer.email,identities.A_owner.id]);
    await c.query('reset role');await c.query('delete from public.user_profiles where id=$1',[identities.A_viewer.id]);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[identities.A_viewer.id]);await c.query('set local role authenticated');
    const result=(await c.query("select public.accept_invitation('r01-already') result")).rows[0].result;
    expect(result).toMatchObject({already_member:true,role:'viewer',business_id:orgs.A.business});
    expect((await c.query('select full_name from public.user_profiles where id=$1',[identities.A_viewer.id])).rows[0].full_name).toBeTruthy();
  });
});
