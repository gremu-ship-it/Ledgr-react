// Read-only verification for the demo seed. Works against any PostgreSQL
// database that has the repository schema applied (local replay or hosted).
import { Client } from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';

const businessId = process.argv[2] || process.env.LEDGR_BUSINESS_ID || '487334df-a057-45c3-b088-85e6c0a6aeb3';
const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 55432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  connectionString: process.env.DATABASE_URL || undefined,
});
await client.connect();

const q = async (sql, params = [businessId]) => (await client.query(sql, sql.includes('$1') ? params : [])).rows;
const num = (v) => (v == null ? null : Number(v));
const results = { businessId, generatedAt: new Date().toISOString(), discovery: {}, checks: [] };

// ── Discovery ───────────────────────────────────────────────────────────────
results.discovery.business = (await q(`select id,name,operating_models,capability_overrides,plan_tier,base_currency as currency from businesses where id=$1`))[0] || null;
results.discovery.members = await q(`select user_id,role,created_at from business_users where business_id=$1 order by created_at`);
results.discovery.products = await q(`select id,name,product_type,purchase_price,sale_price as selling_price,unit_of_measure as unit from products where business_id=$1 order by product_type,name`);
results.discovery.locations = await q(`select id,name,location_type from inventory_locations where business_id=$1 order by location_type`);
results.discovery.projects = await q(`select id,name,status,contract_sum,retention_pct from construction_projects where business_id=$1 order by name`);
results.discovery.boms = await q(`select id,product_id,version,status,bom_locked_at from manufacturing_boms where business_id=$1 order by product_id,version`);
results.discovery.workOrders = await q(`select id,work_order_number,status,planned_quantity,completed_quantity from manufacturing_work_orders where business_id=$1 order by created_at`);
results.discovery.accounts = await q(`select id,code,name,account_type as type,account_subtype as subtype from accounts where business_id=$1 and (name ilike '%wip%' or name ilike '%retention%' or name ilike '%raw material%' or name ilike '%finished good%' or name ilike '%trading%' or name ilike '%inventory%' or name ilike '%revenue%' or name ilike '%cost of%' or name ilike '%payable%' or name ilike '%receivable%' or name ilike '%cash%' or name ilike '%bank%') order by code`);
results.discovery.journalTables = await q(`select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%journal%' or table_name ilike '%ledger%' or table_name ilike '%entry%' or table_name ilike '%posting%') order by table_name`);
results.discovery.stockMovementColumns = await q(`select column_name,data_type from information_schema.columns where table_schema='public' and table_name='stock_movements' order by ordinal_position`);
results.discovery.movementSummary = await q(`select count(*)::int total_movements, count(distinct movement_type)::int distinct_types, min(created_at) earliest, max(created_at) latest from stock_movements where business_id=$1`);
results.discovery.balanceSummary = await q(`select count(*)::int total_balances, sum(case when quantity_on_hand < 0 then 1 else 0 end)::int negative_balances from inventory_balances where business_id=$1`);

// ── Helpers ─────────────────────────────────────────────────────────────────
function add(id, phase, title, status, summary, evidence, note) {
  results.checks.push({ id, phase, title, status, summary, evidence, note: note || null });
}

// 5a
{
  const rows = await q(`select product_type, count(*)::int count from products where business_id=$1 group by 1 order by 2 desc,1`);
  const valid = new Set(['product','service','inventory','goods','raw_material','wip','finished_good','trading_good']);
  const bad = rows.filter(r => !valid.has(r.product_type));
  add('5a','Data integrity','Product type constraint', bad.length ? 'FAIL' : 'PASS',
    bad.length ? `${bad.length} invalid product_type value(s)` : `All ${rows.length} product types are in the valid vocabulary`,
    rows);
}

// 5b
{
  const rows = await q(`select ib.product_id,p.name,p.product_type,l.name as location,l.location_type,ib.quantity_on_hand as quantity
    from inventory_balances ib join products p on p.id=ib.product_id join inventory_locations l on l.id=ib.location_id
    where ib.business_id=$1 and ib.quantity_on_hand <> 0 order by l.location_type,p.name`);
  const negative = rows.filter(r => num(r.quantity) < 0);
  const misplaced = rows.filter(r => (r.product_type === 'raw_material' && r.location_type !== 'raw_materials_store') || (r.product_type === 'finished_good' && r.location_type !== 'finished_goods_store'));
  add('5b','Data integrity','Inventory balance sanity', negative.length || misplaced.length ? 'FAIL' : 'PASS',
    `${rows.length} non-zero balances; ${negative.length} negative; ${misplaced.length} misplaced by product type`,
    rows);
}

// 5c
{
  const rows = await q(`select ib.product_id,p.name,ib.location_id,ib.quantity_on_hand as recorded,
      coalesce(sum(sm.quantity),0) as computed, ib.quantity_on_hand - coalesce(sum(sm.quantity),0) as discrepancy
    from inventory_balances ib join products p on p.id=ib.product_id
    left join stock_movements sm on sm.business_id=ib.business_id and sm.product_id=ib.product_id and sm.location_id=ib.location_id
    where ib.business_id=$1 group by ib.product_id,p.name,ib.location_id,ib.quantity_on_hand
    having ib.quantity_on_hand <> coalesce(sum(sm.quantity),0)`);
  add('5c','Data integrity','Stock movement vs balance reconciliation', rows.length ? 'FAIL' : 'PASS',
    rows.length ? `${rows.length} discrepancies` : 'Every balance equals the sum of its signed stock movements', rows);
}

// 5d
{
  const rows = await q(`select b.id,p.name as output,b.version,b.status,
      (select count(*)::int from manufacturing_bom_lines bl where bl.bom_id=b.id) as lines,
      manufacturing_bom_cost(b.id) as cost
    from manufacturing_boms b join products p on p.id=b.product_id
    where b.business_id=$1 order by p.name,b.version`);
  const active = rows.filter(r => r.status === 'active');
  const activeCostBad = active.filter(r => num(r.cost) <= 0);
  const missing = await q(`select p.name from products p
    where p.business_id=$1 and p.product_type='finished_good' and not exists
      (select 1 from manufacturing_boms b where b.business_id=p.business_id and b.product_id=p.id and b.status='active')
    order by p.name`);
  const multi = await q(`select p.name, count(*)::int active_boms from manufacturing_boms b join products p on p.id=b.product_id
    where b.business_id=$1 and b.status='active' group by p.name having count(*)>1`);
  const ok = !activeCostBad.length && !missing.length && !multi.length;
  add('5d','Data integrity','BOM integrity', ok ? 'PASS' : 'FAIL',
    `${active.length} active BOMs; ${missing.length} finished goods without an active BOM; ${multi.length} with multiple active BOMs; ${activeCostBad.length} with non-positive cost`,
    rows);
}

// 5e
{
  const rows = await q(`select wo.work_order_number,p.name,wo.status,wo.planned_quantity,wo.completed_quantity,wo.scrapped_quantity,
      case when wo.completed_quantity+wo.scrapped_quantity>0 then round(wo.completed_quantity::numeric/(wo.completed_quantity+wo.scrapped_quantity)*100,1) else null end as yield_pct,
      (select count(*)::int from manufacturing_production_runs pr where pr.work_order_id=wo.id) as runs,
      (select count(*)::int from manufacturing_material_transactions mt where mt.work_order_id=wo.id) as material_txns
    from manufacturing_work_orders wo join products p on p.id=wo.product_id
    where wo.business_id=$1 order by wo.work_order_number`);
  const issues = [];
  for (const r of rows) {
    if (num(r.completed_quantity) > num(r.planned_quantity) * 1.10) issues.push(`${r.work_order_number}: overproduction >10%`);
    if (['completed','in_progress'].includes(r.status) && (num(r.yield_pct) < 85 || num(r.yield_pct) > 100)) issues.push(`${r.work_order_number}: yield ${r.yield_pct}% outside 85-100%`);
    if (r.status === 'completed' && (r.runs === 0 || r.material_txns === 0)) issues.push(`${r.work_order_number}: completed without runs/material transactions`);
  }
  add('5e','Data integrity','Work order lifecycle integrity', issues.length ? 'FAIL' : 'PASS',
    issues.length ? issues.join('; ') : `${rows.length} work orders; lifecycle, yield and overproduction limits hold`, rows);
}

// 5f
{
  const rows = await q(`select wo.work_order_number,p.name as component,wol.planned_quantity,wol.actual_quantity_consumed,
      wol.actual_quantity_consumed-wol.planned_quantity as variance,
      round((wol.actual_quantity_consumed-wol.planned_quantity)/nullif(wol.planned_quantity,0)*100,1) as variance_pct
    from manufacturing_work_order_lines wol join manufacturing_work_orders wo on wo.id=wol.work_order_id
    join products p on p.id=wol.component_product_id
    where wo.business_id=$1 and wo.status in ('completed','closed')
    order by abs(wol.actual_quantity_consumed-wol.planned_quantity) desc`);
  const bad = rows.filter(r => Math.abs(num(r.variance_pct)) >= 15);
  add('5f','Data integrity','Material consumption variance', bad.length ? 'FAIL' : 'PASS',
    bad.length ? `${bad.length} line(s) at or above 15% variance` : `${rows.length} completed-order lines; max absolute variance ${rows.length ? Math.max(...rows.map(r=>Math.abs(num(r.variance_pct)))) : 0}%`, rows);
}

// 5g
{
  const rows = await q(`select p.name,v.valuation_number,v.gross_amount,v.retention_amount,v.net_amount,v.previous_cumulative,
      v.gross_amount-v.retention_amount as expected_net, v.net_amount-(v.gross_amount-v.retention_amount) as net_discrepancy,
      round(v.gross_amount*p.retention_pct/100,2) as expected_retention, v.retention_amount-round(v.gross_amount*p.retention_pct/100,2) as retention_discrepancy
    from project_valuations v join construction_projects p on p.id=v.project_id
    where p.business_id=$1 order by p.name,v.valuation_number`);
  const bad = rows.filter(r => num(r.net_discrepancy) !== 0 || num(r.retention_discrepancy) !== 0);
  add('5g','Data integrity','Construction valuation math', bad.length ? 'FAIL' : 'PASS',
    bad.length ? `${bad.length} valuation(s) with arithmetic discrepancies` : `${rows.length} valuations; net = gross - retention and retention = gross × retention %`, rows);
}

// 6a
{
  const rows = await q(`select je.id,je.posting_key,je.description,je.entry_date,
      sum(case when jl.is_debit then jl.amount else 0 end) as debits,
      sum(case when not jl.is_debit then jl.amount else 0 end) as credits,
      sum(case when jl.is_debit then jl.amount else -jl.amount end) as imbalance
    from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id
    where je.business_id=$1 group by je.id,je.posting_key,je.description,je.entry_date
    having sum(case when jl.is_debit then jl.amount else 0 end) <> sum(case when not jl.is_debit then jl.amount else 0 end)`);
  add('6a','Accounting integrity','Journal entry balance check', rows.length ? 'IMBALANCED' : 'BALANCED',
    rows.length ? `${rows.length} unbalanced entries` : 'Every journal entry has equal debits and credits', rows);
}

// 6b
{
  const rows = await q(`select a.code,a.name,a.account_type as type,
      sum(case when jl.is_debit then jl.amount else -jl.amount end) as balance
    from accounts a join journal_lines jl on jl.account_id=a.id join journal_entries je on je.id=jl.journal_entry_id
    where je.business_id=$1 group by a.code,a.name,a.account_type
    having sum(case when jl.is_debit then jl.amount else -jl.amount end) <> 0 order by a.code`);
  const totals = (await q(`select coalesce(sum(case when jl.is_debit then jl.amount else 0 end),0) debits,
      coalesce(sum(case when not jl.is_debit then jl.amount else 0 end),0) credits,
      coalesce(sum(case when jl.is_debit then jl.amount else -jl.amount end),0) difference
    from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1`))[0];
  const signIssues = rows.filter(r => (r.type === 'asset' && num(r.balance) < 0) || (['liability','income'].includes(r.type) && num(r.balance) > 0));
  const ok = num(totals.difference) === 0 && signIssues.length === 0;
  add('6b','Accounting integrity','Trial balance', ok ? 'BALANCED' : 'IMBALANCED',
    `Debits ${num(totals.debits).toLocaleString('en-US')} = Credits ${num(totals.credits).toLocaleString('en-US')}; ${rows.length} accounts with non-zero balances; ${signIssues.length} sign anomalies`,
    { totals, accounts: rows });
}

// 6c
{
  const literal = await q(`select 'Ledger' as source,
      (select coalesce(sum(case when jl.is_debit then jl.amount else -jl.amount end),0) from journal_lines jl
        join journal_entries je on je.id=jl.journal_entry_id join accounts a on a.id=jl.account_id
        where je.business_id=$1 and a.name ilike '%WIP%') as wip_balance
    union all
    select 'Physical', (select coalesce(sum(wol.actual_quantity_consumed*p.purchase_price),0)
        from manufacturing_work_orders wo join manufacturing_work_order_lines wol on wol.work_order_id=wo.id
        join products p on p.id=wol.component_product_id
        where wo.business_id=$1 and wo.status in ('released','in_progress'))`);
  const corrected = await q(`select
      (select coalesce(sum(case when jl.is_debit then jl.amount else -jl.amount end),0) from journal_lines jl
        join journal_entries je on je.id=jl.journal_entry_id join accounts a on a.id=jl.account_id
        where je.business_id=$1 and a.name ilike '%WIP%') as ledger_wip,
      (select coalesce(sum(case
          when mt.transaction_type='consume' and (mt.notes is null or mt.notes not like 'Backflush%') then mt.quantity*p.purchase_price
          when mt.transaction_type='return' then -mt.quantity*p.purchase_price else 0 end),0)
        from manufacturing_material_transactions mt join manufacturing_work_orders wo on wo.id=mt.work_order_id
        join products p on p.id=mt.component_product_id
        where wo.business_id=$1 and wo.status in ('released','in_progress')) as physical_unpaired_wip`);
  const ledger = num(literal.find(x=>x.source==='Ledger')?.wip_balance);
  const physical = num(literal.find(x=>x.source==='Physical')?.wip_balance);
  const correctedLedger = num(corrected[0]?.ledger_wip);
  const correctedPhysical = num(corrected[0]?.physical_unpaired_wip);
  add('6c','Accounting integrity','WIP reconciliation',
    Math.abs(ledger - physical) < 0.01 ? 'BALANCED' : (Math.abs(correctedLedger - correctedPhysical) < 0.01 ? 'BALANCED (corrected basis)' : 'IMBALANCED'),
    `Ledger ${ledger.toLocaleString('en-US')} vs literal physical ${physical.toLocaleString('en-US')} (gap ${(physical-ledger).toLocaleString('en-US')}). Corrected unpaired-WIP basis: ${correctedPhysical.toLocaleString('en-US')}`,
    { literal, corrected: corrected[0] },
    'The literal query counts the full material cost of an in-progress order, including the portion already received into finished goods by a recorded run. The corrected basis counts only consumption with no matching production receipt (manual issues/returns).');
}

// 6d
{
  const rows = await q(`select 'Contractual' as source, coalesce(sum(v.gross_amount*p.retention_pct/100),0) as retention
      from construction_projects p join project_valuations v on v.project_id=p.id where p.business_id=$1
    union all
    select 'Ledger', coalesce(sum(case when jl.is_debit then jl.amount else -jl.amount end),0)
      from journal_lines jl join journal_entries je on je.id=jl.journal_entry_id join accounts a on a.id=jl.account_id
      where je.business_id=$1 and a.name ilike '%retention%'`);
  const contractual = num(rows.find(x=>x.source==='Contractual')?.retention);
  const ledger = num(rows.find(x=>x.source==='Ledger')?.retention);
  add('6d','Accounting integrity','Retention reconciliation', Math.abs(contractual-ledger) < 0.01 ? 'BALANCED' : 'IMBALANCED',
    `Contractual ${contractual.toLocaleString('en-US')} vs ledger ${ledger.toLocaleString('en-US')}`, rows);
}

// Supporting evidence: entries generated by work-order lifecycle
results.manufacturingJournalEvidence = await q(`select je.posting_key,je.description,je.entry_date,
    sum(case when jl.is_debit then jl.amount else 0 end) as debits,
    sum(case when not jl.is_debit then jl.amount else 0 end) as credits
  from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id
  where je.business_id=$1 and je.source_type='manufacturing_work_order'
  group by je.posting_key,je.description,je.entry_date order by je.entry_date,je.posting_key`);

results.journalSummary = await q(`select je.source_type,count(distinct je.id)::int entries,
    sum(case when jl.is_debit then jl.amount else 0 end) debits,
    sum(case when not jl.is_debit then jl.amount else 0 end) credits
  from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id
  where je.business_id=$1 group by je.source_type order by je.source_type`);

results.counts = (await q(`select
  (select count(*)::int from products where business_id=$1) products,
  (select count(*)::int from inventory_locations where business_id=$1) locations,
  (select count(*)::int from construction_projects where business_id=$1) projects,
  (select count(*)::int from project_valuations v join construction_projects p on p.id=v.project_id where p.business_id=$1) valuations,
  (select count(*)::int from manufacturing_boms where business_id=$1) boms,
  (select count(*)::int from manufacturing_work_orders where business_id=$1) work_orders,
  (select count(*)::int from stock_movements where business_id=$1) stock_movements,
  (select count(*)::int from inventory_balances where business_id=$1) balances,
  (select count(*)::int from journal_entries where business_id=$1) journal_entries,
  (select count(*)::int from journal_lines where business_id=$1) journal_lines`))[0];

await mkdir('.cache/demo-report', { recursive: true });
await writeFile('.cache/demo-report/verification.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ counts: results.counts, checks: results.checks.map(c=>({id:c.id,status:c.status,summary:c.summary})) }, null, 2));
await client.end();
