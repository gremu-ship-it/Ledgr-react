/** Integration coverage for the dedicated payroll-only RLS boundary. */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { identities, seedFixture } from './fixtures';
import { Blocked, evidenceSuite, safeError } from './evidence';

const test = evidenceSuite('payroll-rls');
const migration = 'supabase/migrations/20261208000001_payroll_permission_tiers.sql';
const tables = [
  'employees', 'employee_contracts', 'pay_components', 'employee_pay_components',
  'tax_bands', 'pay_runs', 'pay_run_lines', 'pay_run_component_details',
  'leave_types', 'leave_balances', 'leave_requests',
];
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'PAYROLL-RLS-TIERS',
  source: migration,
  layer: 'Isolated PostgreSQL 17 full migration replay; synthetic payroll-manager and cashier identities; authenticated RLS probes; no customer data.',
});

type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

const payrollManagerId = '13000000-0000-4000-8000-0000000000f2';
let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>> | undefined;
let setupError = '';
let employeeId = '';

beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
    orgs = await seedFixture(db.client);
    await db.client.query('insert into auth.users(id,email) values($1,$2)', [
      payrollManagerId, 'r13-payroll-manager@example.invalid',
    ]);
    await db.client.query(
      'insert into public.user_profiles(id,full_name) values($1,$2) on conflict(id) do nothing',
      [payrollManagerId, 'R13 payroll manager'],
    );
    await db.client.query(
      "insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'payroll_manager',true)",
      [orgs.A.business, payrollManagerId],
    );
  } catch (error) {
    setupError = safeError(error);
    await db?.cleanup();
    db = undefined;
  }
});

afterAll(async () => { await db?.cleanup(); });

function ready() {
  if (!db || !orgs) throw new Blocked(`Synthetic payroll RLS fixture unavailable: ${setupError}`);
}

test(meta(
  'PAYROLL.RLS.PAYROLL-MANAGER-CREATE',
  'A payroll_manager can create an employee and the employee salary contract in one authenticated tenant transaction.',
), async () => {
  ready();
  const result = await db!.commitAsRole('authenticated', payrollManagerId, async (client: QueryClient) => {
    const employee = await client.query(
      `insert into public.employees
         (business_id,employee_number,first_name,last_name,employment_type,pay_frequency,
          gross_salary,currency,payment_method,tax_exempt,start_date,hire_date,status,is_active,created_by)
       values($1,'R13-PAYROLL-001','R13','Payroll','permanent','biweekly',250000,'MWK',
              'bank_transfer',false,current_date,current_date,'active',true,$2)
       returning id`,
      [orgs!.A.business, payrollManagerId],
    );
    const id = employee.rows[0].id as string;
    await client.query(
      `insert into public.employee_contracts
         (business_id,employee_id,effective_from,pay_frequency,gross_salary,currency,contract_type)
       values($1,$2,current_date,'biweekly',250000,'MWK','permanent')`,
      [orgs!.A.business, id],
    );
    return id;
  });
  employeeId = result;
  expect(employeeId).toMatch(/^[0-9a-f-]{36}$/i);
  const readback = await db!.asRole(
    'authenticated', payrollManagerId,
    'select employee_number,pay_frequency,gross_salary from public.employees where business_id=$1 and id=$2',
    [orgs!.A.business, employeeId],
  );
  expect(readback.rows).toEqual([{ employee_number: 'R13-PAYROLL-001', pay_frequency: 'biweekly', gross_salary: '250000' }]);
});

test(meta(
  'PAYROLL.RLS.NON-PAYROLL-WRITER-DENIED',
  'A cashier cannot read payroll salary data or insert employees even though the cashier may write ordinary business records.',
), async () => {
  ready();
  const visible = await db!.asRole(
    'authenticated', identities.A_cashier.id,
    'select id from public.employees where business_id=$1 and id=$2',
    [orgs!.A.business, employeeId],
  );
  expect(visible.rows).toHaveLength(0);

  let errorCode = '';
  try {
    await db!.commitAsRole('authenticated', identities.A_cashier.id,
      `insert into public.employees
         (business_id,employee_number,first_name,last_name,employment_type,pay_frequency,
          gross_salary,currency,payment_method,tax_exempt,start_date,hire_date,status,is_active)
       values($1,'R13-CASHIER-EMP','Should','NotSave','permanent','monthly',1,'MWK',
              'cash',false,current_date,current_date,'active',true)`,
      [orgs!.A.business]);
  } catch (error) {
    errorCode = (error as { code?: string }).code ?? '';
  }
  expect(errorCode).toBe('42501');
});

test(meta(
  'PAYROLL.RLS.ALL-TABLES-USE-DEDICATED-TIERS',
  'Every full-cycle payroll table uses payroll-view/read and payroll-write policies, with hard delete restricted to business administrators.',
), async () => {
  ready();
  const result = await db!.client.query(
    `select tablename,cmd,qual,with_check from pg_policies
      where schemaname='public' and tablename = any($1::text[])
      order by tablename,cmd`,
    [tables],
  ) as { rows: Array<{ tablename: string; cmd: string; qual: string | null; with_check: string | null }> };
  const anonPrivileges = await db!.client.query(
    `select table_name,has_table_privilege('anon',format('public.%I',table_name),'SELECT') as can_select
       from unnest($1::text[]) as t(table_name)`,
    [tables],
  ) as { rows: Array<{ table_name: string; can_select: boolean }> };
  expect(anonPrivileges.rows.every((row) => row.can_select === false)).toBe(true);

  for (const table of tables) {
    const policies = result.rows.filter((row) => row.tablename === table);
    expect(policies).toHaveLength(4);
    const byCommand = Object.fromEntries(policies.map((row) => [row.cmd, row]));
    expect(String(byCommand.SELECT?.qual)).toContain('can_view_payroll');
    expect(String(byCommand.INSERT?.with_check)).toContain('can_write_payroll');
    expect(String(byCommand.UPDATE?.qual)).toContain('can_write_payroll');
    expect(String(byCommand.UPDATE?.with_check)).toContain('can_write_payroll');
    expect(String(byCommand.DELETE?.qual)).toContain('can_admin_business_data');
  }
});
