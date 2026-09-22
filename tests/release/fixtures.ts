/** Synthetic fixture contract shared by DB/Edge/offline tests. Never customer data. */
export const DAY = '2026-09-21';
export const roles = ['owner', 'admin', 'accountant', 'viewer', 'cashier', 'stock_clerk', 'branch_manager'] as const;
export const identities = Object.fromEntries(['A', 'B'].flatMap((org, orgIndex) =>
  roles.map((role, i) => [`${org}_${role}`, {
    id: `13000000-0000-4000-8000-${String(orgIndex * 100 + i + 1).padStart(12, '0')}`,
    email: `r13-${org.toLowerCase()}-${role}@example.invalid`, org, role,
  }]),
));
export const subscriptionStates = [
  { name: 'free', tier: 'free', expires: null },
  { name: 'starter', tier: 'starter', expires: '2099-01-01' },
  { name: 'growth', tier: 'growth', expires: '2099-01-01' },
  { name: 'pro', tier: 'pro', expires: '2099-01-01' },
  { name: 'enterprise', tier: 'enterprise', expires: '2099-01-01' },
  { name: 'expired', tier: 'growth', expires: '2000-01-01' },
];
export const expected = {
  openingStock: 100, saleQuantity: 1, sale: 1500, cost: 900, expense: 200,
  stockAfterSale: 99, grossProfit: 600, netProfit: 400, netCash: 1300,
};
export const key = (n: number) => `13000000-1000-4000-8000-${String(n).padStart(12, '0')}`;
export interface SaleContext { business: string; customer: string; product: string; branch: string; shift: string }
export function saleFixture(c: SaleContext, n = 1) {
  return {
    business_id: c.business, client_key: key(n), receipt_number: `R13-${n}`,
    shift_id: c.shift, cash_sales: expected.sale, other_sales: 0, is_credit_sale: false,
    customer: { name: 'R13 synthetic customer' },
    invoice: {
      contact_id: c.customer, branch_id: c.branch, invoice_type: 'sales', status: 'paid',
      issue_date: DAY, due_date: DAY, currency: 'MWK', original_currency: 'MWK',
      exchange_rate: 1, original_amount: expected.sale, functional_currency: 'MWK',
      functional_amount: expected.sale, subtotal: expected.sale, taxable_amount: expected.sale,
      discount_amount: 0, discount_percent: 0, vat_amount: 0, wht_amount: 0,
      total_amount: expected.sale, rate_date: DAY, rate_is_stale: false,
    },
    lines: [{ line_number: 1, description: 'R13 synthetic stock item', quantity: expected.saleQuantity,
      unit_price: expected.sale, discount_percent: 0, discount_amount: 0, tax_code: 'none',
      tax_rate: 0, tax_amount: 0, line_total: expected.sale, product_id: c.product }],
    payments: [{ amount: expected.sale, payment_method: 'cash', currency: 'MWK', exchange_rate: 1,
      functional_amount: expected.sale, payment_date: DAY, client_key: key(1000 + n) }],
  };
}

/** Setup privileges only. Application probes MUST use db.asRole, never this client. */
export async function seedFixture(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, string>[] }> }) {
  const orgs: Record<string, SaleContext & { branch2: string; location: string; terminal: string }> = {};
  for (const user of Object.values(identities)) {
    await client.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      [user.id, user.email, JSON.stringify({ full_name: `R13 ${user.role}` })]);
  }
  for (const org of ['A', 'B']) {
    const owner = identities[`${org}_owner`];
    await client.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','service_role',false)", [owner.id]);
    const result = await client.query("select public.create_business_with_owner($1,'R13',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id", [`R13 Organisation ${org}`]);
    const business = result.rows[0].id;
    for (const user of Object.values(identities).filter(u => u.org === org && u.role !== 'owner')) {
      await client.query('insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,$3,true)', [business, user.id, user.role]);
      await client.query('insert into public.user_profiles(id,full_name) values($1,$2) on conflict(id) do nothing', [user.id, `R13 ${user.role}`]);
    }
    const insertId = async (sql: string, values: unknown[]) => (await client.query(sql, values)).rows[0].id;
    const branch = await insertId('insert into public.branches(business_id,name,code) values($1,$2,$3) returning id', [business, `${org}1`, `${org}1`]);
    const branch2 = await insertId('insert into public.branches(business_id,name,code) values($1,$2,$3) returning id', [business, `${org}2`, `${org}2`]);
    const customer = await insertId("insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,$2,'customer',true,false) returning id", [business, `R13 ${org} private customer`]);
    const location = await insertId('insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,true,$3) returning id', [business, 'R13 stock', branch]);
    const product = await insertId("insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code) values($1,'R13 item',$2,1500,900,'MWK','product',true,'none','none') returning id", [business, `R13-${org}`]);
    await client.query('insert into public.inventory_balances(business_id,product_id,location_id,quantity_on_hand,quantity_reserved,average_cost) values($1,$2,$3,100,0,900)', [business, product, location]);
    const shift = await insertId("insert into public.pos_shifts(business_id,cashier_id,cashier_name,opening_cash,status,branch_id) values($1,$2,'R13 cashier',50000,'open',$3) returning id", [business, identities[`${org}_cashier`].id, branch]);
    const terminal = await insertId("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till 1',$2) returning id", [business, branch]);
    await client.query("insert into storage.objects(bucket_id,name) values('business-logos',$1)", [`${business}/r13-logo.png`]);
    await client.query("insert into public.subscription_payments(business_id,tx_ref,target_plan_tier,billing_cycle,amount,currency,plan_expires_at,initiated_by) values($1,$2,'growth','monthly',100000,'MWK','2099-01-01',$3)",[business,`r13-payment-${org}`,owner.id]);
    orgs[org] = { business, customer, product, branch, branch2, location, shift, terminal };
  }
  await client.query("select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','service_role',false)");
  return orgs;
}

/** Non-stock expense: oracle expects 200 cash outflow and operating expense. */
export function expenseFixture(c: SaleContext, account: string, n = 100) {
  return { business_id:c.business, client_key:key(n),
    expense:{business_id:c.business,expense_type:'receipt',status:'paid',expense_date:DAY,
      currency:'MWK',exchange_rate:1,original_currency:'MWK',original_amount:expected.expense,
      functional_currency:'MWK',functional_amount:expected.expense,rate_date:DAY,rate_is_stale:false,
      subtotal:expected.expense,vat_amount:0,wht_amount:0,total_amount:expected.expense,amount_paid:expected.expense,
      branch_id:c.branch,department_id:null,reference:'R13 synthetic expense'},
    lines:[{line_number:1,description:'R13 operating expense',quantity:1,unit_price:expected.expense,
      tax_code:'none',tax_rate:0,tax_amount:0,line_total:expected.expense,account_id:account}],
    allocations:[{account_id:account,amount:expected.expense,description:'R13 operating expense'}],vat_amount:0,stock_lines:[],
  };
}

/** Existing quick-income contract; intentionally has no POS shift/till dependency. */
export function incomeFixture(c: SaleContext, receivable: string, revenue: string, n = 200) {
  const sale=saleFixture(c,n);
  return {business_id:c.business,client_key:key(n),
    invoice:{...sale.invoice,business_id:c.business,invoice_type:'invoice',amount_paid:expected.sale,ar_account_id:receivable},
    lines:sale.lines.map(line=>({...line,account_id:revenue})),subtotal:expected.sale,vat_amount:0,
    stock_lines:[{product_id:c.product,quantity:expected.saleQuantity}],
  };
}

/** Inputs match existing client APIs. No unapproved server approval/token schema invented. */
export function correctionFixtures(c: SaleContext, originalInvoiceId: string) {
  const common={businessId:c.business,branchId:c.branch,shiftId:c.shift,cashierName:'R13 cashier',
    approverName:'R13 name is NOT authorization',receiptNumber:'R13-original',reason:'R13 synthetic correction'};
  const refund: import('../../src/types/pos').PosReturnPayload={...common,originalInvoiceId,refundMethod:'cash',
    items:[{productId:c.product,productName:'R13 item',quantity:1,unitPrice:expected.sale,refundAmount:expected.sale}],totalRefund:expected.sale};
  const voidSale: import('../../src/types/pos').PosVoidPayload={...common,invoiceId:originalInvoiceId};
  return {refund,voidSale,expected:{refund:1500,stockRestored:1,originalCostRestored:900,netSaleAfterFullReversal:0}};
}
