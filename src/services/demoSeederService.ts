import type { InsertDto, Row } from '@/dal/types/database';
import { deriveClientKey } from '@/lib/clientKeys';
import { repos } from '@/lib/repositories';
import { ensureChartOfAccounts } from '@/services/seedChartOfAccounts';
import { processSale, calculateCartTotals } from '@/services/posService';
import type { PosSalePayload } from '@/types/pos';

/** Only this seeded tenant may be changed by the developer seeder. */
export const TARGET_DEMO_BUSINESS_ID = 'd38e4ce8-324b-4d27-b42d-74c25c5288a7'; // Demo company Ltd

const REQUIRED_OPERATING_MODELS = [
  'PRODUCT_SALES',
  'SERVICE_SALES',
  'RETAIL',
  'PROJECT_BASED',
  'CONSTRUCTION',
  'MANUFACTURING',
] as const;

const CLIENT_KEY_PREFIX = 'DEMO-SEED';
const TODAY = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const monthStart = () => `${TODAY().slice(0, 7)}-01`;
const stableReference = (kind: string, id: string) => `${CLIENT_KEY_PREFIX}:${kind}:${id}`;

/** Convert a readable demo identity into the UUID required by client_key columns and RPCs. */
export function stableDemoClientKey(kind: string, id: string): string {
  return deriveClientKey(stableReference(kind, id));
}

function assertTargetBusiness(businessId: string): asserts businessId is typeof TARGET_DEMO_BUSINESS_ID {
  if (businessId !== TARGET_DEMO_BUSINESS_ID) {
    throw new Error('Seeding is strictly prohibited on non-demo accounts.');
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

async function ensureContact(
  businessId: string,
  name: string,
  contactType: 'customer' | 'supplier',
): Promise<Row<'contacts'>> {
  const contacts = await repos.contact.findByBusiness(businessId);
  const found = contacts.find((contact) => contact.name === name && contact.contact_type === contactType);
  if (found) return found;
  return repos.contact.createContact({
    business_id: businessId,
    name,
    contact_type: contactType,
    country: 'Malawi',
    currency: 'MWK',
    credit_terms_days: 30,
    is_active: true,
  });
}

async function ensureBranch(businessId: string) {
  const branches = await repos.branch.findActive(businessId);
  const seeded = branches.find((branch) => branch.code === 'DEMO-MAIN');
  if (seeded) return seeded;
  if (branches[0]) return branches[0];
  const created = await repos.branch.createWithLocation({
    business_id: businessId,
    name: 'Demo Main Branch',
    code: 'DEMO-MAIN',
    is_active: true,
  });
  return created.branch;
}

async function ensureLocation(
  businessId: string,
  branchId: string,
  name: string,
  code: string,
  locationType: 'warehouse' | 'raw_materials_store' | 'finished_goods_store',
  isDefault = false,
) {
  const locations = await repos.location.getAll(businessId);
  const found = locations.find((location) => location.name === name && location.is_active);
  if (found) return found;
  return repos.location.create({
    business_id: businessId,
    branch_id: branchId,
    name,
    code,
    location_type: locationType,
    is_default: isDefault,
  });
}

async function ensureDemoProducts(businessId: string): Promise<Row<'products'>[]> {
  const definitions = [
    { name: 'Cement', sku: 'DEMO-INV-CEMENT', description: 'Test cement inventory.', unit_of_measure: 'bag', purchase_price: 24_000, sale_price: 50_000, reorder_level: 10, reorder_quantity: 30 },
    { name: 'Steel Rebar', sku: 'DEMO-INV-REBAR', description: 'Test reinforcing steel inventory.', unit_of_measure: 'length', purchase_price: 40_000, sale_price: 100_000, reorder_level: 12, reorder_quantity: 40 },
    { name: 'Fuel', sku: 'DEMO-INV-FUEL', description: 'Test fuel inventory.', unit_of_measure: 'litre', purchase_price: 1_200, sale_price: 150_000, reorder_level: 15, reorder_quantity: 50 },
    { name: 'Concrete Slabs', sku: 'DEMO-INV-SLABS', description: 'Test concrete slab stock.', unit_of_measure: 'each', purchase_price: 75_000, sale_price: 200_000, reorder_level: 5, reorder_quantity: 20 },
    { name: 'Structural Steel Truss', sku: 'DEMO-MFG-TRUSS', description: 'Manufactured structural steel truss.', unit_of_measure: 'each', purchase_price: 160_000, sale_price: 250_000, reorder_level: 4, reorder_quantity: 12 },
    { name: 'Precast Concrete Slab', sku: 'DEMO-MFG-SLAB', description: 'Manufactured precast concrete slab.', unit_of_measure: 'each', purchase_price: 110_000, sale_price: 700_000, reorder_level: 4, reorder_quantity: 12 },
  ];
  const products: Row<'products'>[] = [];
  for (const definition of definitions) {
    products.push(await repos.inventory.upsertDemoProduct({
      business_id: businessId,
      ...definition,
      product_type: 'product',
      currency: 'MWK',
      sales_tax_code: 'none',
      purchase_tax_code: 'none',
      track_inventory: true,
      inventory_account_id: null,
      cogs_account_id: null,
      sales_account_id: null,
      purchase_account_id: null,
      is_active: true,
      deleted_at: null,
    }));
  }
  return products;
}

async function ensureStock(
  businessId: string,
  product: Row<'products'>,
  locationId: string,
  quantity: number,
  stockId: string,
): Promise<void> {
  const reference = stableReference('STOCK', stockId);
  const clientKey = stableDemoClientKey('STOCK', stockId);
  const current = await repos.inventory.findBalance(businessId, product.id, locationId);
  if (current && Number(current.quantity_on_hand) >= quantity) return;
  const adjustment = Math.max(0, quantity - Number(current?.quantity_on_hand ?? 0));
  if (!adjustment) return;
  await repos.inventory.recordMovement({
    business_id: businessId,
    product_id: product.id,
    location_id: locationId,
    movement_type: 'opening_balance',
    quantity: adjustment,
    unit_cost: Number(product.purchase_price ?? 0),
    movement_date: TODAY(),
    reference,
    notes: 'Generated by the Demo company Ltd test-data seeder.',
  } as InsertDto<'stock_movements'>, clientKey);
}

async function seedInvoices(
  businessId: string,
  customer: Row<'contacts'>,
  accounts: Row<'accounts'>[],
  bankAccountId: string | null,
): Promise<void> {
  const revenue = accounts.find((account) => account.code === '4112')
    ?? accounts.find((account) => account.account_type === 'income' && !account.is_group);
  const ar = accounts.find((account) => account.code === '1131')
    ?? accounts.find((account) => account.account_type === 'asset' && !account.is_group);
  const revenueAccountId = revenue?.id ?? null;
  const arAccountId = ar?.id ?? null;
  const docs = [
    { suffix: '001', total: 700_000, paid: true },
    { suffix: '002', total: 1_200_000, paid: true },
    { suffix: '003', total: 1_600_000, paid: true },
    { suffix: '004', total: 4_000_000, paid: false },
    { suffix: '005', total: 4_500_000, paid: false },
  ];

  for (const [index, document] of docs.entries()) {
    const clientKey = stableDemoClientKey('INV', document.suffix);
    let existing = await repos.invoice.findByClientKey(businessId, clientKey);
    if (!existing) {
      const issueDate = document.paid ? daysAgo(12 - index) : daysAgo(75 - index * 3);
      const dueDate = document.paid ? issueDate : daysAgo(45 - index * 3);
      const { invoice } = await repos.invoice.createWithLines({
        business_id: businessId,
        client_key: clientKey,
        invoice_number: `DEMO-INV-${document.suffix}`,
        invoice_type: 'invoice',
        status: document.paid ? 'sent' : 'overdue',
        contact_id: customer.id,
        issue_date: issueDate,
        due_date: dueDate,
        currency: 'MWK',
        exchange_rate: 1,
        subtotal: document.total,
        taxable_amount: document.total,
        total_amount: document.total,
        amount_paid: 0,
        vat_amount: 0,
        wht_amount: 0,
        discount_amount: 0,
        discount_percent: 0,
        revenue_account_id: revenueAccountId,
        ar_account_id: arAccountId,
        notes: 'Demo company Ltd test dataset.',
      }, [{
        line_number: 1,
        description: `Demo sale ${document.suffix}`,
        quantity: 1,
        unit_price: document.total,
        line_total: document.total,
        tax_code: 'none',
        tax_rate: 0,
        tax_amount: 0,
        account_id: revenueAccountId,
      }], clientKey);
      existing = invoice;
    }
    if (document.paid) {
      await repos.invoice.recordPayment({
        business_id: businessId,
        invoice_id: existing.id,
        amount: document.total,
        payment_date: TODAY(),
        payment_method: 'bank_transfer',
        currency: 'MWK',
        exchange_rate: 1,
        bank_account_id: bankAccountId,
        reference: `DEMO-INV-PAY-${document.suffix}`,
      } as InsertDto<'invoice_payments'>, stableDemoClientKey('INV-PAY', document.suffix));
    }
  }
}

async function seedExpenses(
  businessId: string,
  supplier: Row<'contacts'>,
  accounts: Row<'accounts'>[],
  bankAccountId: string | null,
): Promise<void> {
  const expenseAccount = accounts.find((account) => account.code === '6110')
    ?? accounts.find((account) => account.account_type === 'expense' && !account.is_group);
  const apAccount = accounts.find((account) => account.code === '2111')
    ?? accounts.find((account) => account.account_type === 'liability' && !account.is_group);
  const expenses = [
    { suffix: '001', amount: 400_000, paid: true },
    { suffix: '002', amount: 600_000, paid: true },
    { suffix: '003', amount: 1_500_000, paid: false },
    { suffix: '004', amount: 1_700_000, paid: false },
  ];
  for (const expense of expenses) {
    const clientKey = stableDemoClientKey('EXP', expense.suffix);
    let existing = await repos.expense.findByClientKey(businessId, clientKey);
    if (!existing) {
      const created = await repos.expense.createWithLines({
        business_id: businessId,
        client_key: clientKey,
        expense_number: `DEMO-EXP-${expense.suffix}`,
        expense_type: 'bill',
        status: 'approved',
        contact_id: supplier.id,
        expense_date: daysAgo(expense.paid ? 10 : 42),
        due_date: daysAgo(expense.paid ? 0 : 12),
        currency: 'MWK',
        exchange_rate: 1,
        subtotal: expense.amount,
        total_amount: expense.amount,
        amount_paid: 0,
        vat_amount: 0,
        wht_amount: 0,
        discount_amount: 0,
        discount_percent: 0,
        ap_account_id: apAccount?.id ?? null,
        reference: `DEMO-SUP-${expense.suffix}`,
        notes: 'Demo company Ltd test dataset.',
      }, [{
        line_number: 1,
        description: `Demo operating bill ${expense.suffix}`,
        quantity: 1,
        unit_price: expense.amount,
        line_total: expense.amount,
        tax_code: 'none',
        tax_rate: 0,
        tax_amount: 0,
        account_id: expenseAccount?.id ?? null,
      }], clientKey);
      existing = created.expense;
    }
    if (expense.paid) {
      await repos.expense.recordPayment({
        business_id: businessId,
        expense_id: existing.id,
        amount: expense.amount,
        payment_date: TODAY(),
        payment_method: 'bank_transfer',
        currency: 'MWK',
        exchange_rate: 1,
        bank_account_id: bankAccountId,
        reference: `DEMO-EXP-PAY-${expense.suffix}`,
      } as InsertDto<'expense_payments'>, stableDemoClientKey('EXP-PAY', expense.suffix));
    }
  }
}

async function seedCashDeposit(
  businessId: string,
  accounts: Row<'accounts'>[],
  bankAccountId: string | null,
): Promise<void> {
  const existing = (await repos.cashDeposit.list(businessId, { search: 'DEMO-CASH-DEP-01' }))
    .find((deposit) => deposit.reference === 'DEMO-CASH-DEP-01');
  if (existing?.status === 'posted') return;
  if (existing?.status === 'draft') {
    await repos.cashDeposit.post(existing.id);
    return;
  }
  const cashAccount = accounts.find((account) => account.code === '1110' && account.id !== bankAccountId)
    ?? accounts.find((account) => account.account_type === 'asset' && !account.is_group && account.id !== bankAccountId);
  if (!bankAccountId || !cashAccount) return;
  const draft = await repos.cashDeposit.createDraft({
    business_id: businessId,
    deposit_date: TODAY(),
    bank_account_id: bankAccountId,
    reference: 'DEMO-CASH-DEP-01',
    notes: 'Demo company Ltd cash deposit test transaction.',
  }, [{
    source_account_id: cashAccount.id,
    amount: 25_000_000,
    description: 'Test cash deposit from till/cash on hand.',
  }]);
  await repos.cashDeposit.post(draft.id);
}

async function ensureProject(businessId: string, input: {
  name: string;
  clientName: string;
  clientId: string;
  contractSum: number;
  retention: number;
  startDate: string;
  endDate: string;
}) {
  const projects = (await repos.projects.list(businessId)).rows;
  const existing = projects.find((project) => project.name === input.name);
  if (existing) return existing;
  return repos.projects.create(businessId, {
    name: input.name,
    client_name: input.clientName,
    client_id: input.clientId,
    contract_sum: input.contractSum,
    retention_pct: input.retention,
    budget: input.contractSum,
    start_date: input.startDate,
    end_date: input.endDate,
  });
}

async function ensureProjectBoq(projectId: string, contractSum: number) {
  const existing = await repos.projects.getBoqLines(projectId);
  const lineAmounts = [0.4, 0.35, 0.25].map((share) => Math.round(contractSum * share));
  const definitions = [
    { line_number: '1', description: 'DEMO-BOQ-01 — Mobilisation and preliminaries', quantity: 1, unit: 'lot', rate: lineAmounts[0], sort_order: 1 },
    { line_number: '2', description: 'DEMO-BOQ-02 — Main structural works', quantity: 1, unit: 'lot', rate: lineAmounts[1], sort_order: 2 },
    { line_number: '3', description: 'DEMO-BOQ-03 — Finishes and commissioning', quantity: 1, unit: 'lot', rate: lineAmounts[2], sort_order: 3 },
  ];
  const lines = definitions.map((definition) => {
    const found = existing.find((line) => line.line_number === definition.line_number && line.description === definition.description);
    return { id: found?.id ?? null, ...definition, _deleted: false };
  });
  const result = await repos.projects.bulkUpsertBoqLines(projectId, lines);
  if (result.length >= 3) return result;
  return repos.projects.getBoqLines(projectId);
}

async function ensureValuation(
  projectId: string,
  lines: Awaited<ReturnType<typeof ensureProjectBoq>>,
  prefix: string,
  grossValue: number,
  contractSum: number,
) {
  const history = await repos.projects.getValuationHistory(projectId);
  const previous = history.valuations.find((document) => document.valuation.notes?.includes(prefix));
  if (previous) {
    return previous.valuation.status === 'draft'
      ? repos.projects.submitValuation(previous.valuation.id)
      : previous;
  }
  const pct = Math.min(100, (grossValue / contractSum) * 100);
  const valuation = await repos.projects.createValuation(projectId, {
    valuation_date: TODAY(),
    period_start: monthStart(),
    period_end: TODAY(),
    lines: lines.map((line) => ({ boq_line_id: line.id, cumulative_pct: pct, notes: prefix })),
    notes: `${prefix} — Demo progress valuation.`,
  });
  return repos.projects.submitValuation(valuation.valuation.id);
}

async function seedConstruction(
  businessId: string,
  customer: Row<'contacts'>,
  supplier: Row<'contacts'>,
  constructionProductId: string,
  branchId: string,
  siteLocationId: string,
): Promise<void> {
  const capital = await ensureProject(businessId, {
    name: 'Capital Commercial Tower', clientName: customer.name, clientId: customer.id,
    contractSum: 150_000_000, retention: 10, startDate: daysAgo(150), endDate: daysAgo(-400),
  });
  const highway = await ensureProject(businessId, {
    name: 'Lilongwe Highway Span', clientName: customer.name, clientId: customer.id,
    contractSum: 85_000_000, retention: 10, startDate: daysAgo(120), endDate: daysAgo(-320),
  });

  const capitalLines = await ensureProjectBoq(capital.id, 150_000_000);
  const highwayLines = await ensureProjectBoq(highway.id, 85_000_000);
  const capitalValuation = await ensureValuation(capital.id, capitalLines, 'DEMO-VAL-01', 20_000_000, 150_000_000);
  await ensureValuation(highway.id, highwayLines, 'DEMO-VAL-02', 12_000_000, 85_000_000);

  const certificates = await repos.certificates.list(businessId, capital.id);
  let certificate = certificates.find((item) => item.valuation_id === capitalValuation.valuation.id);
  if (!certificate) {
    const certificateId = await repos.certificates.create({
      valuationId: capitalValuation.valuation.id,
      retentionPercentage: 10,
      advanceRecovery: 0,
      penaltyDeductions: 0,
      otherDeductions: 0,
    });
    await repos.certificates.issue(certificateId, daysAgo(-30));
    certificate = { id: certificateId } as (typeof certificates)[number];
  }
  if (certificate.status === 'draft') await repos.certificates.issue(certificate.id, daysAgo(-30));

  const rfis = await repos.rfi.listByBusiness(businessId);
  let answered = rfis.find((rfi) => rfi.rfi_number === 'DEMO-RFI-02');
  if (!rfis.some((rfi) => rfi.rfi_number === 'DEMO-RFI-01')) {
    await repos.rfi.create({
      business_id: businessId, project_id: capital.id, site_id: null,
      rfi_number: 'DEMO-RFI-01', title: 'Confirm foundation reinforcement detail',
      question: 'Confirm the reinforcement arrangement for the tower foundation.',
      priority: 'normal', due_date: daysAgo(-7),
    });
  }
  if (!answered) {
    answered = await repos.rfi.create({
      business_id: businessId, project_id: capital.id, site_id: null,
      rfi_number: 'DEMO-RFI-02', title: 'Confirm slab edge detail',
      question: 'Confirm the slab-edge detail for the level-two pour.',
      priority: 'normal', due_date: daysAgo(4),
    });
  }
  if (answered.status !== 'answered' && answered.status !== 'closed') {
    await repos.rfi.transitionStatus(answered.id, 'answered', 'Detail confirmed for the demo dataset.');
  }

  const changeOrders = await repos.changeOrder.list(businessId, { projectId: capital.id });
  let changeOrder = changeOrders.find((item) => item.co_number === 'DEMO-CO-01');
  if (!changeOrder) {
    changeOrder = await repos.changeOrder.create(businessId, {
      project_id: capital.id,
      site_id: null,
      co_number: 'DEMO-CO-01',
      title: 'Additional service riser works',
      description: 'Demo change order for additional riser coordination.',
      reason: 'Design coordination update.',
      cost_impact: 4_500_000,
      time_impact_days: 5,
    });
  }
  if (changeOrder.status === 'draft') await repos.changeOrder.transitionStatus(changeOrder.id, 'submitted');

  // A WBS task carries a visible over-budget marker and the estimate comparison
  // in its description; the current schedule schema has no separate budget and
  // actual-cost columns on task rows.
  const tasks = await repos.schedule.listByProject(businessId, highway.id);
  if (!tasks.some((task) => task.wbs_code === 'DEMO-01')) {
    await repos.schedule.create(businessId, {
      project_id: highway.id,
      wbs_code: 'DEMO-01',
      task_name: 'DEMO — Over-budget earthworks',
      description: 'Demo variance: budget MWK 8,000,000; forecast cost MWK 9,200,000.',
      status: 'in_progress',
      progress_percent: 30,
      planned_start: daysAgo(60),
      planned_finish: daysAgo(-45),
      sort_order: 1,
    });
  }

  const existingSite = (await repos.construction.findSites(businessId))
    .find((site) => site.site_code === 'DEMO-SITE-01')
    ?? (await repos.construction.findSitesForProject(businessId, highway.id))[0];
  let siteId = existingSite?.id;
  if (!siteId) {
    const registered = await repos.construction.registerSite({
      businessId, branchId, locationId: siteLocationId,
      siteCode: 'DEMO-SITE-01', siteName: 'Lilongwe Highway Demo Site', projectRef: highway.name,
    });
    siteId = required(registered.id, 'Demo procurement site was not returned.');
  }
  const existingPo = (await repos.construction.findPurchaseOrders(businessId, highway.id))
    .find((po) => po.notes?.includes('DEMO-PO-01'));
  let purchaseOrderId = existingPo?.id;
  if (!purchaseOrderId) {
    const po = await repos.construction.createPurchaseOrder({
      business_id: businessId,
      site_id: siteId,
      supplier_contact_id: supplier.id,
      currency: 'MWK',
      notes: 'DEMO-PO-01 — test receipt hold.',
      lines: [{ product_id: constructionProductId, uom: 'bag', quantity_ordered: 1, expected_unit_price: 24_000 }],
    }, stableDemoClientKey('PO', '01'), highway.id);
    purchaseOrderId = po.id;
  }
  if (purchaseOrderId) {
    const purchaseOrder = (await repos.construction.findPurchaseOrders(businessId, highway.id))
      .find((po) => po.id === purchaseOrderId);
    if (purchaseOrder?.status === 'draft') await repos.construction.authorizePurchaseOrder(purchaseOrderId);
    const poLines = await repos.construction.findPurchaseOrderLines(purchaseOrderId);
    const poLine = poLines[0];
    if (poLine) {
      await repos.construction.recordGoodsReceipt({
        business_id: businessId,
        po_id: purchaseOrderId,
        receipt_date: TODAY(),
        notes: 'DEMO-GRN-01 — one rejected sample held for inspection.',
        lines: [{
          po_line_id: poLine.id,
          quantity_received: 1,
          quantity_accepted: 0,
          quantity_rejected: 1,
          holds: [{
            hold_type: 'rejected', quantity: 1,
            reason: 'Demo quality hold pending inspection.',
            evidence_reference: 'DEMO-HOLD-01',
          }],
        }],
      }, stableDemoClientKey('GRN', '01'));
    }
  }
}

async function seedManufacturing(
  businessId: string,
  products: Row<'products'>[],
  rawLocationId: string,
  finishedLocationId: string,
): Promise<void> {
  const component = products.find((product) => product.sku === 'DEMO-INV-CEMENT')
    ?? required(products[0], 'Demo raw-material product is missing.');
  const outputProducts = products.filter((product) => product.sku === 'DEMO-MFG-TRUSS' || product.sku === 'DEMO-MFG-SLAB');
  const boms = await repos.bom.listBoms(businessId);
  const bomIds = new Map<string, string>();
  for (const output of outputProducts) {
    const existing = boms.find((bom) => bom.product_id === output.id && bom.status === 'active');
    if (existing) {
      bomIds.set(output.id, existing.id);
      continue;
    }
    const bomId = await repos.bom.saveVersion({
      businessId,
      bomId: null,
      productId: output.id,
      notes: 'Demo active Bill of Materials.',
      components: [{
        component_product_id: component.id,
        component_bom_id: null,
        quantity: 2,
        unit_of_measure: component.unit_of_measure,
        scrap_pct: 0,
        notes: 'DEMO-BOM-LINE-01',
      }],
    });
    await repos.bom.activateVersion(bomId);
    bomIds.set(output.id, bomId);
  }

  const workOrders = await repos.manufacturing.listWorkOrders(businessId);
  const existingInProgress = workOrders.find((order) => order.notes?.includes('DEMO-WO-01'));
  if (!existingInProgress) {
    const output = outputProducts[0];
    const bomId = required(output && bomIds.get(output.id), 'Demo manufacturing BOM is missing.');
    const orderId = await repos.manufacturing.createWorkOrder(businessId, {
      product_id: output.id,
      bom_version_id: bomId,
      quantity: 10,
      reference: 'DEMO-WO-01',
      planned_start: daysAgo(45),
      planned_end: daysAgo(-5),
      from_location_id: rawLocationId,
      to_location_id: finishedLocationId,
      notes: 'DEMO-WO-01 — in-progress work order with WIP aging.',
      priority: 'normal',
    });
    await repos.manufacturing.updateWorkOrderStatus(businessId, orderId, 'released');
    await repos.manufacturing.updateWorkOrderStatus(businessId, orderId, 'in_progress');
  }

  const existingCompleted = workOrders.find((order) => order.notes?.includes('DEMO-WO-02'));
  if (!existingCompleted) {
    const output = outputProducts[1] ?? outputProducts[0];
    const bomId = required(output && bomIds.get(output.id), 'Demo manufacturing BOM is missing.');
    const orderId = await repos.manufacturing.createWorkOrder(businessId, {
      product_id: output.id,
      bom_version_id: bomId,
      quantity: 200,
      reference: 'DEMO-WO-02',
      planned_start: daysAgo(70),
      planned_end: daysAgo(30),
      from_location_id: rawLocationId,
      to_location_id: finishedLocationId,
      notes: 'DEMO-WO-02 — completed work order; 98.5% yield.',
      priority: 'normal',
    });
    await repos.manufacturing.updateWorkOrderStatus(businessId, orderId, 'released');
    await repos.manufacturing.updateWorkOrderStatus(businessId, orderId, 'in_progress');
    const runId = await repos.manufacturing.startRun(businessId, orderId, finishedLocationId);
    await repos.manufacturing.completeRun(businessId, runId, {
      quantity_produced: 197,
      quantity_scrapped: 3,
      scrap_reason: 'Demo process scrap.',
      output_location_id: finishedLocationId,
    });
    await repos.manufacturing.updateWorkOrderStatus(businessId, orderId, 'completed');
  }
}

async function seedPayroll(businessId: string, branchId: string): Promise<void> {
  const now = new Date();
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = previousMonth.getUTCFullYear();
  const monthNumber = previousMonth.getUTCMonth() + 1;
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const payDate = TODAY();
  const employees = [
    { number: 'DEMO-EMP-001', first: 'Tadala', last: 'Phiri', title: 'Manager', salary: 1_500_000 },
    { number: 'DEMO-EMP-002', first: 'Chisomo', last: 'Banda', title: 'Senior Engineer', salary: 800_000 },
    { number: 'DEMO-EMP-003', first: 'Mwayi', last: 'Mbewe', title: 'Accountant', salary: 450_000 },
    { number: 'DEMO-EMP-004', first: 'Thoko', last: 'Zulu', title: 'Site Supervisor', salary: 170_000 },
  ];
  const current = await repos.payrollFullCycle.getEmployees(businessId, { pageSize: 200 });
  for (const [index, employee] of employees.entries()) {
    if (current.rows.some((row) => row.employee_number === employee.number)) continue;
    await repos.payrollFullCycle.createEmployee(businessId, {
      employee_number: employee.number,
      first_name: employee.first,
      last_name: employee.last,
      job_title: employee.title,
      department: employee.title === 'Accountant' ? 'Finance' : 'Operations',
      status: 'active',
      is_active: true,
      hire_date: daysAgo(600),
      start_date: daysAgo(600),
      pay_frequency: 'monthly',
      gross_salary: employee.salary,
      currency: 'MWK',
      payment_method: 'bank_transfer',
      tax_exempt: false,
      tpin: String(91_000_001 + index),
      bank_name: 'National Bank of Malawi',
      bank_account_number: String(100_000_000_001 + index),
      bank_branch: 'Lilongwe',
      created_by: null,
    });
  }

  const fiscalYear = Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < 7 ? 1 : 0);
  const taxBands = await repos.payrollFullCycle.getTaxBands(businessId, fiscalYear);
  if (taxBands.length === 0) {
    await repos.payrollFullCycle.updateTaxBands(businessId, fiscalYear, [
      { band_number: 1, lower_bound: 0, upper_bound: 100_000, rate: 0, currency: 'MWK' },
      { band_number: 2, lower_bound: 100_000, upper_bound: 500_000, rate: 0.2, currency: 'MWK' },
      { band_number: 3, lower_bound: 500_000, upper_bound: 1_000_000, rate: 0.3, currency: 'MWK' },
      { band_number: 4, lower_bound: 1_000_000, upper_bound: null, rate: 0.35, currency: 'MWK' },
    ]);
  }

  const existingRun = await repos.payrollFullCycle.getPayRunByPeriod(businessId, start, end);
  let payRun = existingRun;
  if (!payRun || payRun.status === 'draft') {
    payRun = await repos.payrollFullCycle.calculatePayRun(businessId, start, end, payDate);
  }
  const payRunId = String(payRun?.id ?? payRun?.payRunId ?? '');
  if (!payRunId) throw new Error('Demo payroll run did not return an identifier.');
  const status = String(payRun?.status ?? 'calculated');
  if (status === 'calculated') await repos.payrollFullCycle.approvePayRun(businessId, payRunId);
  if (status === 'calculated' || status === 'approved') await repos.payrollFullCycle.postPayRun(payRunId);

  // The full-cycle employee API does not accept branch_id; update through the
  // existing PayrollRepository after looking the employees up via its read API.
  const employeesAfterSeed = await repos.payrollFullCycle.getEmployees(businessId, { pageSize: 200 });
  for (const row of employeesAfterSeed.rows) {
    if (employees.some((employee) => employee.number === row.employee_number) && typeof row.id === 'string') {
      await repos.payroll.updateEmployee(row.id, { branch_id: branchId } as never);
    }
  }
}

async function seedPos(
  businessId: string,
  branchId: string,
  terminalId: string,
  customer: Row<'contacts'>,
  products: Row<'products'>[],
  actorId: string,
): Promise<void> {
  const db = repos.pos.db;
  const settings = await repos.pos.getSettings(businessId);
  const enabledPaymentMethods = new Set([
    ...settings.enabled_payment_methods,
    'cash', 'card', 'airtel_money', 'tnm_mpamba',
  ]);
  if (enabledPaymentMethods.size !== settings.enabled_payment_methods.length) {
    await repos.pos.updateSettings(businessId, { enabled_payment_methods: [...enabledPaymentMethods] });
  }
  let shift = await repos.pos.findActiveShift(businessId);
  if (!shift) {
    shift = await repos.pos.openShift({ business_id: businessId, terminal_id: terminalId, opening_float: 100_000 });
  }
  const amounts = [50_000, 100_000, 150_000, 200_000, 250_000, 700_000];
  const methods = ['cash', 'card', 'airtel_money', 'tnm_mpamba', 'cash', 'card'] as const;
  for (const [index, amount] of amounts.entries()) {
    const suffix = String(index + 1).padStart(3, '0');
    const clientKey = stableDemoClientKey('POS', suffix);
    const { data: existing, error } = await db.from('invoices').select('id')
      .eq('business_id', businessId).eq('client_key', clientKey).maybeSingle();
    if (error) throw error;
    if (existing) continue;
    const product = required(products[index], 'Demo POS product is missing.');
    const item = {
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      quantity: 1,
      unit_price: amount,
      unit_cost: Number(product.purchase_price),
      line_total: amount,
      tax_code: 'none',
      tax_rate: 0,
    };
    const payload: PosSalePayload = {
      business_id: businessId,
      branch_id: branchId,
      shift_id: shift.id,
      customer_id: customer.id,
      customer_name: customer.name,
      cashier_id: actorId,
      cashier_name: 'Demo Cashier',
      items: [item],
      totals: calculateCartTotals([item]),
      total_paid: amount,
      payments: [{ payment_method: methods[index], amount, reference: `DEMO-POS-${suffix}` }],
      clientKey,
      notes: `DEMO-POS-${suffix}`,
    };
    await processSale(payload, { isOnline: true, userRole: 'owner' });
  }
}

/**
 * Create the complete demo-company test dataset. The guard is deliberately
 * the first operation: no repository query or mutation is possible for any
 * tenant except the immutable demo business ID.
 *
 * Each row uses a stable DEMO key or name. Repository/RPC idempotency keys and
 * lookup-before-create checks make safe retries possible after interrupted runs.
 */
export async function seedDemoCompanyData(businessId: string): Promise<void> {
  assertTargetBusiness(businessId);

  const db = repos.business.db;
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError) throw authError;
  const actorId = required(auth.user?.id, 'Sign in to seed the Demo company test dataset.');
  const business = await repos.business.findById(businessId);
  if (business.id !== TARGET_DEMO_BUSINESS_ID) throw new Error('Seeding is strictly prohibited on non-demo accounts.');
  const membership = await repos.business.findWithRole(businessId, actorId);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new Error('DEMO_SEEDER_ADMIN_REQUIRED');
  }
  const existingModels = (business as Row<'businesses'> & { operating_models?: string[] | null }).operating_models ?? [];
  const models = [...new Set([...existingModels, ...REQUIRED_OPERATING_MODELS])];
  if (models.some((model) => !existingModels.includes(model))) {
    await repos.business.updateOperatingModels(businessId, models);
  }
  // Keep the global navigation in sync immediately rather than waiting for a
  // full page reload after the organisation-profile RPC succeeds.
  const store = (await import('@/store/useAppStore')).useAppStore.getState();
  if (store.currentBusiness?.business.id === businessId) {
    store.setCurrentBusiness({
      ...store.currentBusiness,
      business: { ...store.currentBusiness.business, operating_models: models },
    } as never);
  }
  if (store.businesses.length) {
    store.setBusinesses(store.businesses.map((membership) => (
      membership.business.id === businessId
        ? { ...membership, business: { ...membership.business, operating_models: models } }
        : membership
    )) as never);
  }

  await Promise.all([
    repos.business.provisionConstructionDefaults(businessId, actorId),
    repos.business.provisionManufacturingDefaults(businessId, actorId),
    repos.business.provisionConstructionCoaAccounts(businessId),
    repos.business.provisionManufacturingCoaAccounts(businessId),
  ]);
  await ensureChartOfAccounts(db, businessId);

  const customer = await ensureContact(businessId, 'Demo Test Customer', 'customer');
  const supplier = await ensureContact(businessId, 'Demo Test Supplier', 'supplier');
  const branch = await ensureBranch(businessId);
  const branchId = branch.id;
  const central = await ensureLocation(businessId, branchId, 'Central Warehouse', 'DEMO-CENTRAL', 'warehouse', true);
  const siteDepot = await ensureLocation(businessId, branchId, 'Site A Depot', 'DEMO-SITE-A', 'warehouse');
  const terminal = await repos.pos.ensureDemoTerminal({
    business_id: businessId,
    name: 'DEMO-TILL-01',
    code: 'DEMO-REG-01',
    branch_id: branchId,
    preferred_location_id: central.id,
    is_active: true,
  });
  const products = await ensureDemoProducts(businessId);
  const locations = await repos.location.getAll(businessId);
  const rawStore = locations.find((location) => location.location_type === 'raw_materials_store') ?? central;
  const finishedStore = locations.find((location) => location.location_type === 'finished_goods_store') ?? siteDepot;

  const posLocationId = terminal.preferred_location_id ?? central.id;
  for (const [index, product] of products.entries()) {
    await ensureStock(businessId, product, posLocationId, index === 3 ? 2 : 100, String(index + 1).padStart(2, '0'));
  }
  // Manufacturing consumes this same raw material from the typed input store.
  await ensureStock(businessId, products[0], rawStore.id, 500, 'RAW-CEMENT');

  const accounts = await repos.account.findByBusiness(businessId);
  const bankAccount = await repos.account.findFirstBankAccount(businessId);
  await seedInvoices(businessId, customer, accounts, bankAccount?.id ?? null);
  await seedExpenses(businessId, supplier, accounts, bankAccount?.id ?? null);
  await seedCashDeposit(businessId, accounts, bankAccount?.id ?? null);

  // Link the seeded project locations once project IDs exist.
  const constructionLocations = await repos.location.getAll(businessId);
  const siteLocation = constructionLocations.find((location) => location.name === 'Site A Depot') ?? siteDepot;
  const capitalProject = await ensureProject(businessId, {
    name: 'Capital Commercial Tower', clientName: customer.name, clientId: customer.id,
    contractSum: 150_000_000, retention: 10, startDate: daysAgo(150), endDate: daysAgo(-400),
  });
  const highwayProject = await ensureProject(businessId, {
    name: 'Lilongwe Highway Span', clientName: customer.name, clientId: customer.id,
    contractSum: 85_000_000, retention: 10, startDate: daysAgo(120), endDate: daysAgo(-320),
  });
  for (const [location, project] of [[central, capitalProject], [siteLocation, highwayProject]] as const) {
    if (!location.project_id) await repos.projects.linkSite(location.id, project.id);
  }
  await seedConstruction(businessId, customer, supplier, products[0].id, branchId, siteLocation.id);
  await seedManufacturing(businessId, products, rawStore.id, finishedStore.id);
  await seedPayroll(businessId, branchId);
  await seedPos(businessId, branchId, terminal.id, customer, products, actorId);
}
