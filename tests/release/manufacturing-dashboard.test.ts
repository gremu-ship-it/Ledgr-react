/** Manufacturing Phase D — reporting RPCs on isolated PostgreSQL 17. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite, safeError } from './evidence';

const test = evidenceSuite('manufacturing-dashboard');
const MS = 'supabase/migrations/20261105000002_manufacturing_dashboard.sql';
const LAYER = 'real PostgreSQL 17 roles + JWT claims; synthetic identities; full migration replay; probes as authenticated';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'MANUFACTURING-DASHBOARD-2026-11-05',
  source: MS,
  layer: LAYER,
});

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let replayError = '';
let seedError = '';
const M: Record<string, string> = {};
let sku = 9900;
const nextSku = () => `R13-DASH-${++sku}`;
const scalar = async (sql: string, values: unknown[] = []) => {
  const rows = (await db.client.query(sql, values)).rows;
  return rows.length ? Object.values(rows[0])[0] : null;
};
const rpc = (uid: string, sql: string, values: unknown[] = []) => db.asRole('authenticated', uid, async (client: any) => {
  const result = await (client as C).query(sql, values);
  return result.rows;
});
const attemptAs = (uid: string, sql: string, values: unknown[] = []) => db.asRole('authenticated', uid, async (client: any) => {
  try { await (client as C).query(sql, values); return 'ok'; }
  catch (error) { return (error as { code?: string }).code ?? 'unknown'; }
});

async function product(name: string, type: string, price: number) {
  return await scalar(
    `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
     values($1,$2,$3,0,$4,'MWK',$5,true,'none','none') returning id`,
    [M.id, name, nextSku(), price, type],
  ) as string;
}

async function workOrder({
  productId,
  bomId,
  number,
  status,
  planned = 10,
  completed = 0,
  scrap = 0,
  ageDays = 0,
  daysAgo = 0,
}: {
  productId: string; bomId: string; number: string; status: string;
  planned?: number; completed?: number; scrap?: number; ageDays?: number; daysAgo?: number;
}) {
  const id = await scalar(
    `insert into public.manufacturing_work_orders(
       business_id,work_order_number,product_id,bom_id,planned_quantity,completed_quantity,scrapped_quantity,status,
       actual_start_date,actual_end_date,created_by,created_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,
       CASE WHEN $8 IN ('released','in_progress') THEN now() - ($9::text || ' days')::interval ELSE null END,
       CASE WHEN $8 IN ('completed','closed') THEN current_date - $10::integer ELSE null END,
       $11, now() - ($9::text || ' days')::interval
     ) returning id`,
    [M.id, number, productId, bomId, planned, completed, scrap, status, ageDays, daysAgo, identities.A_owner.id],
  ) as string;
  return id;
}

async function setup() {
  await seedFixture(db.client);
  const owner = identities.A_owner.id;
  M.id = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const result = await (client as C).query(
      `select public.create_business_with_owner(
       'R13 Dashboard Works','R13',null,null,null,false,'MWK','07-01','UTC',
       null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',array['MANUFACTURING']) as id`,
    );
    return result.rows[0].id as string;
  });
  await db.commitAsRole('authenticated', owner, (client: any) =>
    (client as C).query('select public.provision_manufacturing_defaults($1,$2)', [M.id, owner]));
  M.empty = await db.commitAsRole('authenticated', owner, async (client: any) =>
    (await (client as C).query(`select public.create_business_with_owner(
      'R13 Empty Dashboard','R13',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',array['MANUFACTURING']) as id`)).rows[0].id);
  await db.commitAsRole('authenticated', owner, (client: any) =>
    (client as C).query('select public.provision_manufacturing_defaults($1,$2)', [M.empty, owner]));
  await db.client.query(
    `insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'viewer',true)`,
    [M.id, identities.A_viewer.id],
  );

  M.finished = await product('Dashboard Finished Frame', 'finished_good', 0);
  M.finished2 = await product('Dashboard Bolt Assembly', 'finished_good', 0);
  M.raw = await product('Dashboard Steel', 'raw_material', 100);
  M.bom = await scalar(
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'active',$3) returning id`, [M.id, M.finished, owner],
  ) as string;
  M.bom2 = await scalar(
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'active',$3) returning id`, [M.id, M.finished2, owner],
  ) as string;

  const woActive = await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-001', status: 'released', planned: 10, ageDays: 5 });
  const woActive2 = await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-002', status: 'in_progress', planned: 12, completed: 3, ageDays: 10 });
  const woDone = await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-003', status: 'completed', planned: 10, completed: 8, scrap: 2, daysAgo: 0 });
  const woClosed = await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-004', status: 'closed', planned: 5, completed: 5, daysAgo: 0 });
  await workOrder({ productId: M.finished2, bomId: M.bom2, number: 'WO-2026-005', status: 'completed', planned: 4, completed: 0, scrap: 0, daysAgo: 0 });
  const woOld = await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-006', status: 'completed', planned: 5, completed: 4, daysAgo: 45 });
  await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-007', status: 'draft', planned: 3 });
  await workOrder({ productId: M.finished, bomId: M.bom, number: 'WO-2026-008', status: 'cancelled', planned: 3 });

  for (const [wo, planned, consumed] of [[woActive, 10, 3], [woActive2, 12, 2], [woDone, 5, 8], [woClosed, 2, 1], [woOld, 2, 1]] as Array<[string, number, number]>) {
    await db.client.query(
      `insert into public.manufacturing_work_order_lines(work_order_id,component_product_id,planned_quantity,actual_quantity_consumed,unit_of_measure)
       values($1,$2,$3,$4,'kg')`, [wo, M.raw, planned, consumed],
    );
  }
  for (const [wo, quantity] of [[woDone, 8], [woClosed, 1], [woOld, 1]] as Array<[string, number]>) {
    await db.client.query(
      `insert into public.manufacturing_material_transactions(work_order_id,component_product_id,quantity,transaction_type,recorded_by,recorded_at)
       values($1,$2,$3,'consume',$4,now())`, [wo, M.raw, quantity, owner],
    );
  }
  await db.client.query(
    `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,scrap_quantity,status,created_by)
     values($1,1,8,2,'completed',$3),($2,1,5,0,'completed',$3)`, [woDone, woClosed, owner],
  );

  // Backdate active-order starts so every WIP age bucket and its component cost is represented.
  await db.client.query(
    `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,actual_start_date,created_by)
     values($1,'WO-2026-009',$2,$3,6,'in_progress',now()-interval '20 days',$4),
           ($1,'WO-2026-010',$2,$3,6,'in_progress',now()-interval '40 days',$4)`,
    [M.id, M.finished, M.bom, owner],
  );
  await db.client.query(
    `insert into public.manufacturing_work_order_lines(work_order_id,component_product_id,planned_quantity,actual_quantity_consumed,unit_of_measure)
     select id,$2,3,1,'kg' from public.manufacturing_work_orders where business_id=$1 and work_order_number in ('WO-2026-009','WO-2026-010')`,
    [M.id, M.raw],
  );
}

beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (error) { replayError = safeError(error); return; }
  try { await setup(); }
  catch (error) { seedError = safeError(error); console.error('Manufacturing dashboard fixture failed:', seedError); }
}, 900_000);
afterAll(async () => { await db?.cleanup?.(); });

const ready = () => {
  if (replayError) throw new Error(`DATABASE REPLAY BLOCKED: ${replayError}`);
  if (seedError) throw new Error(`FIXTURE SETUP BLOCKED: ${seedError}`);
  if (!db) throw new Error('DATABASE FIXTURE NOT INITIALIZED');
};
const owner = () => identities.A_owner.id;


test(meta('MFG.DASH.METRICS.MIXED', 'Dashboard cards count and aggregate only active and completed orders in the requested business/period'), async () => {
  ready();
  const rows = await rpc(owner(), 'select public.manufacturing_dashboard_metrics($1,current_date,current_date) as r', [M.id]);
  const m = rows[0].r;
  expect(Number(m.active_work_orders)).toBe(4);
  expect(Number(m.completed_this_period)).toBe(3);
  expect(Number(m.total_output_this_period)).toBe(13);
  expect(Number(m.total_scrap_this_period)).toBe(2);
  expect(Number(m.avg_yield_pct)).toBe(86.7);
  expect(Number(m.wip_value)).toBe(700);
  expect(Number(m.total_material_cost_this_period)).toBe(1000);
});

test(meta('MFG.DASH.METRICS.ZERO', 'A valid empty manufacturing business returns zero-valued dashboard metrics'), async () => {
  ready();
  const id = M.empty;
  const rows = await rpc(owner(), 'select public.manufacturing_dashboard_metrics($1,current_date,current_date) as r', [id]);
  expect(await rpc(owner(), 'select * from public.manufacturing_wip_aging($1)', [id])).toEqual([]);
  expect(rows[0].r).toMatchObject({ active_work_orders: 0, completed_this_period: 0, total_output_this_period: 0, total_scrap_this_period: 0, avg_yield_pct: 0, wip_value: 0, total_material_cost_this_period: 0 });
});

test(meta('MFG.DASH.METRICS.DATE', 'Metrics honor both inclusive date boundaries and exclude completed orders outside the selected dates'), async () => {
  ready();
  const rows = await rpc(owner(), `select public.manufacturing_dashboard_metrics($1,current_date-1,current_date-1) as r`, [M.id]);
  expect(Number(rows[0].r.completed_this_period)).toBe(0);
  expect(Number(rows[0].r.total_output_this_period)).toBe(0);
});

test(meta('MFG.DASH.THROUGHPUT.GROUPING', 'Throughput supports daily, ISO-week and month groupings'), async () => {
  ready();
  const day = await rpc(owner(), `select * from public.manufacturing_throughput_trend($1,current_date-60,current_date,'day')`, [M.id]);
  const week = await rpc(owner(), `select * from public.manufacturing_throughput_trend($1,current_date-60,current_date,'week')`, [M.id]);
  const month = await rpc(owner(), `select * from public.manufacturing_throughput_trend($1,current_date-60,current_date,'month')`, [M.id]);
  expect(day.length).toBe(2);
  expect(week.length).toBe(2);
  expect(month.length).toBe(2);
  expect(Number(day.reduce((sum: number, row: any) => sum + Number(row.output_quantity), 0))).toBe(17);
  expect(Number(month.reduce((sum: number, row: any) => sum + Number(row.work_order_count), 0))).toBe(4);
});

test(meta('MFG.DASH.YIELD.ZERO_SAFE', 'Yield aggregates by product and returns zero rather than dividing by zero'), async () => {
  ready();
  const rows = await rpc(owner(), 'select * from public.manufacturing_yield_by_product($1,current_date-1,current_date)', [M.id]);
  const frame = rows.find((row: any) => row.product_id === M.finished);
  const bolt = rows.find((row: any) => row.product_id === M.finished2);
  expect(Number(frame.total_output)).toBe(13);
  expect(Number(frame.total_scrap)).toBe(2);
  expect(Number(frame.yield_pct)).toBe(86.7);
  expect(Number(frame.work_order_count)).toBe(2);
  expect(Number(bolt.yield_pct)).toBe(0);
});

test(meta('MFG.DASH.WIP.AGING', 'WIP aging sorts oldest first and returns correct age buckets and material costs'), async () => {
  ready();
  const rows = await rpc(owner(), 'select * from public.manufacturing_wip_aging($1)', [M.id]);
  expect(rows.length).toBe(4);
  expect(rows.map((row: any) => row.age_bucket)).toEqual(['30+ days', '15-30 days', '8-14 days', '0-7 days']);
  expect(Number(rows[0].wip_cost)).toBe(100);
  const empty = await rpc(owner(), 'select * from public.manufacturing_wip_aging($1)', ['00000000-0000-4000-8000-000000000001']);
  expect(empty).toEqual([]);
});

test(meta('MFG.DASH.COST.VARIANCE.ZERO_SAFE', 'Cost variance compares planned and consumed material costs, orders by absolute variance and handles zero planned cost'), async () => {
  ready();
  const rows = await rpc(owner(), 'select * from public.manufacturing_cost_variance($1,current_date-1,current_date)', [M.id]);
  const completed = rows.find((row: any) => row.work_order_number === 'WO-2026-003');
  expect(Number(completed.planned_cost)).toBe(500);
  expect(Number(completed.actual_cost)).toBe(800);
  expect(Number(completed.variance)).toBe(300);
  expect(Number(completed.variance_pct)).toBe(60);
  const zero = await rpc(owner(), 'select * from public.manufacturing_cost_variance($1,current_date-1,current_date)', [M.id]);
  expect(zero.some((row: any) => Number(row.planned_cost) === 0 && Number(row.variance_pct) === 0)).toBe(true);
});

test(meta('MFG.DASH.PRODUCTION.SUMMARY', 'Production summary aggregates per output product without multiplying work-order totals by production runs'), async () => {
  ready();
  const rows = await rpc(owner(), 'select * from public.manufacturing_production_summary($1,current_date-1,current_date)', [M.id]);
  const frame = rows.find((row: any) => row.product_id === M.finished);
  expect(Number(frame.total_planned)).toBe(15);
  expect(Number(frame.total_completed)).toBe(13);
  expect(Number(frame.total_scrapped)).toBe(2);
  expect(Number(frame.yield_pct)).toBe(86.7);
  expect(Number(frame.total_material_cost)).toBe(900);
  expect(Number(frame.cost_per_unit)).toBe(69.23);
  expect(Number(frame.work_order_count)).toBe(2);
  expect(Number(frame.production_run_count)).toBe(2);
});

test(meta('MFG.DASH.CAPABILITY', 'Dashboard RPCs require the existing manufacturing.bom.manage grant without introducing a new code'), async () => {
  ready();
  const viewer = identities.A_viewer.id;
  for (const sql of [
    'select public.manufacturing_dashboard_metrics($1)',
    'select * from public.manufacturing_throughput_trend($1)',
    'select * from public.manufacturing_yield_by_product($1)',
    'select * from public.manufacturing_wip_aging($1)',
    'select * from public.manufacturing_cost_variance($1)',
    'select * from public.manufacturing_production_summary($1)',
  ]) expect(await attemptAs(viewer, sql, [M.id])).toBe('42501');
  expect(await scalar(`select count(*) from public.manufacturing_capabilities where code='manufacturing.bom.manage'`)).toBe('1');
});

test(meta('MFG.DASH.NONEXISTENT', 'Every dashboard RPC returns empty or zero for a business id that does not exist'), async () => {
  ready();
  const missing = '00000000-0000-4000-8000-000000000099';
  const metrics = await rpc(owner(), 'select public.manufacturing_dashboard_metrics($1) as r', [missing]);
  expect(Number(metrics[0].r.active_work_orders)).toBe(0);
  for (const sql of [
    'select * from public.manufacturing_throughput_trend($1)',
    'select * from public.manufacturing_yield_by_product($1)',
    'select * from public.manufacturing_wip_aging($1)',
    'select * from public.manufacturing_cost_variance($1)',
    'select * from public.manufacturing_production_summary($1)',
  ]) expect(await rpc(owner(), sql, [missing])).toEqual([]);
});

test(meta('MFG.DASH.TENANT.ISOLATION', 'A non-member cannot execute SECURITY DEFINER dashboard RPCs for an existing business'), async () => {
  ready();
  const outsider = identities.B_owner.id;
  for (const sql of [
    'select public.manufacturing_dashboard_metrics($1)',
    'select * from public.manufacturing_throughput_trend($1)',
    'select * from public.manufacturing_yield_by_product($1)',
    'select * from public.manufacturing_wip_aging($1)',
    'select * from public.manufacturing_cost_variance($1)',
    'select * from public.manufacturing_production_summary($1)',
  ]) expect(await attemptAs(outsider, sql, [M.id])).toBe('42501');
  for (const fn of [
    'manufacturing_dashboard_metrics(uuid,date,date)',
    'manufacturing_throughput_trend(uuid,date,date,text)',
    'manufacturing_yield_by_product(uuid,date,date)',
    'manufacturing_wip_aging(uuid)',
    'manufacturing_cost_variance(uuid,date,date)',
    'manufacturing_production_summary(uuid,date,date)',
  ]) {
    expect(await scalar(`select has_function_privilege('anon','public.${fn}','execute')`)).toBe(false);
  }
});
