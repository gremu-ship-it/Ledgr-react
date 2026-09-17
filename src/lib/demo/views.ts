/**
 * Read-only views, computed from the demo tables on demand.
 *
 * Postgres exposes five views to the client (`v_trial_balance`, `v_ar_ageing`,
 * `v_asset_register`, `v_reorder_alerts`, `v_cash_flow`). They are pure
 * functions of the base tables, so demo mode recomputes them from the same
 * seed instead of storing a second copy that could drift.
 *
 * Each builder mirrors the SQL definition in
 * `supabase/migrations/20260815000002_phase8b_reconstruct_views.sql` (and
 * `20260728000006_fix_cash_flow_cash_side.sql` for the cash-flow statement)
 * column-for-column, so pages and repositories cannot tell the difference.
 */

import type { DemoRow, DemoTables } from './dataset';

export type ViewBuilder = (tables: DemoTables, today: Date) => DemoRow[];

const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function rows(tables: DemoTables, name: string): DemoRow[] {
  return tables[name] ?? [];
}

function indexBy(rowsList: DemoRow[], key: string): Map<string, DemoRow> {
  const map = new Map<string, DemoRow>();
  for (const row of rowsList) map.set(str(row[key]), row);
  return map;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── v_trial_balance ──────────────────────────────────────────────────────────

const trialBalance: ViewBuilder = (tables) => {
  const accounts = rows(tables, 'accounts').filter((a) => a.deleted_at == null);
  const entries = indexBy(
    rows(tables, 'journal_entries').filter((e) => ['posted', 'reversed'].includes(str(e.status))),
    'id',
  );
  const lines = rows(tables, 'journal_lines').filter((l) => entries.has(str(l.journal_entry_id)));

  return accounts.map((a) => {
    const accountLines = lines.filter((l) => str(l.account_id) === str(a.id));
    const totalDebits = accountLines.reduce(
      (s, l) => s + (l.is_debit ? num(l.amount_base) : 0),
      0,
    );
    const totalCredits = accountLines.reduce(
      (s, l) => s + (l.is_debit ? 0 : num(l.amount_base)),
      0,
    );
    const raw = accountLines.reduce(
      (s, l) => s + (l.is_debit ? num(l.amount_base) : -num(l.amount_base)),
      0,
    );
    return {
      business_id: a.business_id,
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      account_subtype: a.account_subtype ?? null,
      normal_balance: a.normal_balance,
      total_debits: round2(totalDebits),
      total_credits: round2(totalCredits),
      // Signed per normal_balance: positive = the account's natural side.
      balance: round2(str(a.normal_balance) === 'credit' ? -raw : raw),
    };
  });
};

// ── v_ar_ageing ──────────────────────────────────────────────────────────────

const arAgeing: ViewBuilder = (tables, today) => {
  const contacts = indexBy(rows(tables, 'contacts'), 'id');
  const todayStr = isoDay(today);

  return rows(tables, 'invoices')
    .filter((i) => i.deleted_at == null)
    .filter((i) => str(i.invoice_type) === 'invoice')
    .filter((i) => ['sent', 'partially_paid', 'overdue'].includes(str(i.status)))
    .map((i) => {
      const due = str(i.due_date);
      const daysOverdue = !due || due >= todayStr ? 0 : Math.floor((ms(todayStr) - ms(due)) / DAY_MS);
      const amountDue =
        i.amount_due != null
          ? num(i.amount_due)
          : num(i.functional_amount ?? i.total_amount) - num(i.amount_paid);
      return {
        business_id: i.business_id,
        contact_id: i.contact_id,
        contact_name: str(contacts.get(str(i.contact_id))?.name ?? ''),
        invoice_id: i.id,
        invoice_number: i.invoice_number,
        issue_date: i.issue_date,
        due_date: i.due_date ?? null,
        currency: i.currency,
        total_amount: num(i.total_amount),
        amount_paid: num(i.amount_paid),
        amount_due: round2(amountDue),
        days_overdue: daysOverdue,
        ageing_bucket: bucket(daysOverdue, due, todayStr),
      };
    });
};

function bucket(daysOverdue: number, due: string, todayStr: string): string {
  if (!due || due >= todayStr) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

// ── v_asset_register ─────────────────────────────────────────────────────────

const assetRegister: ViewBuilder = (tables) => {
  const categories = indexBy(rows(tables, 'asset_categories'), 'id');
  const branches = indexBy(rows(tables, 'branches'), 'id');
  const departments = indexBy(rows(tables, 'departments'), 'id');

  return rows(tables, 'fixed_assets')
    .filter((fa) => fa.deleted_at == null)
    .map((fa) => {
      const cost = num(fa.acquisition_cost);
      const accum = num(fa.accumulated_depreciation);
      return {
        business_id: fa.business_id,
        asset_number: fa.asset_number,
        name: fa.name,
        acquisition_cost: cost,
        acquisition_date: fa.acquisition_date,
        depreciable_amount: fa.depreciable_amount != null ? num(fa.depreciable_amount) : cost - num(fa.residual_value),
        residual_value: num(fa.residual_value),
        accumulated_depreciation: accum,
        depreciation_method: fa.depreciation_method,
        last_depreciation_date: fa.last_depreciation_date ?? null,
        net_book_value: fa.net_book_value != null ? num(fa.net_book_value) : round2(cost - accum),
        status: fa.status,
        category: str(categories.get(str(fa.category_id))?.name ?? ''),
        branch: str(branches.get(str(fa.branch_id))?.name ?? ''),
        department: str(departments.get(str(fa.department_id))?.name ?? ''),
      };
    });
};

// ── v_reorder_alerts ─────────────────────────────────────────────────────────

const reorderAlerts: ViewBuilder = (tables) => {
  const products = indexBy(
    rows(tables, 'products').filter(
      (p) => p.track_inventory === true && p.is_active !== false && p.deleted_at == null,
    ),
    'id',
  );
  const locations = indexBy(rows(tables, 'inventory_locations'), 'id');

  return rows(tables, 'inventory_balances')
    .filter((ib) => products.has(str(ib.product_id)))
    .filter((ib) => {
      const product = products.get(str(ib.product_id))!;
      return product.reorder_level != null && num(ib.quantity_available) <= num(product.reorder_level);
    })
    .map((ib) => {
      const product = products.get(str(ib.product_id))!;
      return {
        business_id: ib.business_id,
        product_id: ib.product_id,
        product_name: str(product.name),
        sku: product.sku ?? null,
        location_name: str(locations.get(str(ib.location_id))?.name ?? ''),
        quantity_on_hand: num(ib.quantity_on_hand),
        quantity_reserved: num(ib.quantity_reserved),
        quantity_available: num(ib.quantity_available),
        average_cost: num(ib.average_cost),
        reorder_level: num(product.reorder_level),
        reorder_quantity: product.reorder_quantity != null ? num(product.reorder_quantity) : null,
        estimated_reorder_cost: round2(num(product.reorder_quantity ?? 0) * num(ib.average_cost)),
      };
    });
};

// ── v_cash_flow ──────────────────────────────────────────────────────────────

const CASH_EQUIVALENT_CODES = new Set(['1110', '1115', '1125', '1126']);
const FINANCING_CODES = new Set(['2140', '2145', '2510', '2511', '2512', '2515', '3140']);

const cashFlow: ViewBuilder = (tables) => {
  const accounts = indexBy(rows(tables, 'accounts').filter((a) => a.deleted_at == null), 'id');
  const entries = rows(tables, 'journal_entries').filter((e) =>
    ['posted', 'reversed'].includes(str(e.status)),
  );
  const entryById = indexBy(entries, 'id');
  const lines = rows(tables, 'journal_lines').filter((l) => entryById.has(str(l.journal_entry_id)));

  const isCashEquivalent = (accountId: unknown): boolean => {
    const account = accounts.get(str(accountId));
    if (!account) return false;
    return account.is_bank_account === true || CASH_EQUIVALENT_CODES.has(str(account.code));
  };

  const byEntry = new Map<string, { businessId: string; period: string; netCash: number; allCash: boolean; hasFixedAsset: boolean; hasFinancing: boolean; hasAnyCash: boolean }>();

  for (const line of lines) {
    const entryId = str(line.journal_entry_id);
    const entry = entryById.get(entryId);
    if (!entry) continue;
    const account = accounts.get(str(line.account_id));
    const cash = isCashEquivalent(line.account_id);
    const amount = num(line.amount_base);

    let state = byEntry.get(entryId);
    if (!state) {
      state = {
        businessId: str(entry.business_id),
        period: str(entry.entry_date).slice(0, 7),
        netCash: 0,
        allCash: true,
        hasFixedAsset: false,
        hasFinancing: false,
        hasAnyCash: false,
      };
      byEntry.set(entryId, state);
    }

    if (cash) {
      state.netCash += line.is_debit ? amount : -amount;
      state.hasAnyCash = true;
    } else {
      state.allCash = false;
    }
    if (str(account?.account_subtype) === 'fixed_asset') state.hasFixedAsset = true;
    if (FINANCING_CODES.has(str(account?.code)) || str(account?.account_subtype) === 'share_capital') {
      state.hasFinancing = true;
    }
  }

  const periods = new Map<
    string,
    { business_id: string; period: string; operating: number; investing: number; financing: number }
  >();

  for (const state of byEntry.values()) {
    if (!state.hasAnyCash) continue;
    const classification = state.allCash
      ? 'operating'
      : state.hasFixedAsset
        ? 'investing'
        : state.hasFinancing
          ? 'financing'
          : 'operating';
    const key = `${state.businessId}|${state.period}`;
    let bucketRow = periods.get(key);
    if (!bucketRow) {
      bucketRow = {
        business_id: state.businessId,
        period: state.period,
        operating: 0,
        investing: 0,
        financing: 0,
      };
      periods.set(key, bucketRow);
    }
    if (classification === 'operating') bucketRow.operating += state.netCash;
    else if (classification === 'investing') bucketRow.investing += state.netCash;
    else bucketRow.financing += state.netCash;
  }

  return [...periods.values()]
    .map((p) => ({
      business_id: p.business_id,
      period: p.period,
      operating: round2(p.operating),
      investing: round2(p.investing),
      financing: round2(p.financing),
      net_change: round2(p.operating + p.investing + p.financing),
    }))
    .sort((a, b) => str(a.period).localeCompare(str(b.period)));
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const VIEW_BUILDERS: Record<string, ViewBuilder> = {
  v_trial_balance: trialBalance,
  v_ar_ageing: arAgeing,
  v_asset_register: assetRegister,
  v_reorder_alerts: reorderAlerts,
  v_cash_flow: cashFlow,
};

export function isDemoView(name: string): boolean {
  return name in VIEW_BUILDERS;
}

export function computeDemoView(name: string, tables: DemoTables, today: Date = new Date()): DemoRow[] {
  const builder = VIEW_BUILDERS[name];
  return builder ? builder(tables, today) : [];
}

// ── local helpers ────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function ms(day: string): number {
  return new Date(`${day}T00:00:00`).getTime();
}
