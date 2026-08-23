import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';
import { KNOWLEDGE_BASE } from './knowledge';
import { forecast } from './forecast';
import type { AiData, AssistantMode, DataContext } from './types';

const log = createLogger('ai/context');

/**
 * Builds the DataContext both assistants run on.
 *
 * TENANT SCOPING
 *   The only identifier that ever reaches the database is `companyId`, and it
 *   is passed as a bound parameter to `public.ai_context(uuid)`. That function
 *   re-checks membership server-side with `public.is_business_member()`, and
 *   every v_ai_* view is `security_invoker`, so RLS applies to the caller.
 *   A user who passes someone else's business id gets a 42501 error, not data.
 *
 *   `userId` is accepted for logging/telemetry symmetry with the Edge Function
 *   (which derives the company from `business_users` itself) — it is never
 *   used to widen the query.
 */
export async function buildAssistantContext(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  mode: AssistantMode,
): Promise<DataContext> {
  const companyName = await fetchCompanyName(companyId);

  if (mode === 'support') {
    return { companyName, knowledgeBase: KNOWLEDGE_BASE };
  }

  if (!companyId) {
    log.warn('AI context requested without a company id', { userId: userId ?? null });
    return { companyName, knowledgeBase: KNOWLEDGE_BASE };
  }

  const data = await fetchAiData(companyId);
  if (!data) {
    return { companyName, knowledgeBase: KNOWLEDGE_BASE };
  }

  return {
    companyName: data.company?.name ?? companyName,
    data,
    knowledgeBase: KNOWLEDGE_BASE,
    forecast: forecast(data, 3),
  };
}

/**
 * Reads `public.ai_context(company_id)` — one round trip for KPIs, trend,
 * overdue invoices, top expenses/customers, concentration, anomalies and the
 * receivable/payable schedules. Returns null (never throws) so the assistant
 * degrades to knowledge-base answers instead of breaking.
 */
export async function fetchAiData(companyId: string): Promise<AiData | null> {
  try {
    const { data, error } = await supabase.rpc('ai_context' as never, {
      p_business_id: companyId,
    } as never);

    if (error) {
      log.error('ai_context RPC failed', { message: error.message, businessId: companyId });
      return null;
    }
    return normaliseAiData(data);
  } catch (err) {
    log.error('ai_context RPC threw', err as Error, { businessId: companyId });
    return null;
  }
}

async function fetchCompanyName(companyId: string | null | undefined): Promise<string | undefined> {
  if (!companyId) return undefined;
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', companyId)
      .maybeSingle();
    if (error) return undefined;
    return data?.name ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Normalisation ────────────────────────────────────────────────────────────
//
// The RPC returns JSONB. Postgres numerics arrive as JSON numbers, but a
// null-heavy row (new company) can produce nulls anywhere, so every field is
// coerced defensively. This is the single place where `unknown` is narrowed —
// downstream code sees fully-typed AiData.

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/** `{}` is how ai_context() represents an absent row — normalise it to null. */
function nonEmpty(value: Json | null): Json | null {
  return value !== null && Object.keys(value).length > 0 ? value : null;
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((v): v is Json => asRecord(v) !== null) : [];
}

function n(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function s(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function sOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Converts the raw `ai_context()` JSONB into a fully-typed AiData. */
export function normaliseAiData(raw: unknown): AiData | null {
  const root = asRecord(raw);
  if (!root) return null;

  const companyRaw = asRecord(root.company);
  // `ai_context()` coalesces a missing KPI row to `{}` rather than JSON null
  // (see migration 20260823000001), so an empty object means "no row", not
  // "a row of zeros" — treat it as absent or the assistant would confidently
  // report MK 0 for every figure.
  const kpisRaw = nonEmpty(asRecord(root.kpis));
  const concRaw = nonEmpty(asRecord(root.concentration));

  return {
    generated_at: s(root.generated_at, new Date().toISOString()),
    company: companyRaw
      ? {
          id: s(companyRaw.id),
          name: s(companyRaw.name, 'Your business'),
          currency: sOrNull(companyRaw.currency),
          vat_registered: typeof companyRaw.vat_registered === 'boolean' ? companyRaw.vat_registered : null,
          financial_year_start: sOrNull(companyRaw.financial_year_start),
        }
      : null,
    kpis: kpisRaw
      ? {
          period_start: s(kpisRaw.period_start),
          period_end: s(kpisRaw.period_end),
          revenue_mtd: n(kpisRaw.revenue_mtd),
          expenses_mtd: n(kpisRaw.expenses_mtd),
          net_profit_mtd: n(kpisRaw.net_profit_mtd),
          profit_margin_pct: nOrNull(kpisRaw.profit_margin_pct),
          cash_balance: n(kpisRaw.cash_balance),
          receivables_total: n(kpisRaw.receivables_total),
          overdue_total: n(kpisRaw.overdue_total),
          open_invoice_count: n(kpisRaw.open_invoice_count),
          payables_total: n(kpisRaw.payables_total),
          avg_days_to_pay: nOrNull(kpisRaw.avg_days_to_pay),
          expense_ratio_pct: nOrNull(kpisRaw.expense_ratio_pct),
        }
      : null,
    monthlyTrend: asArray(root.monthlyTrend).map((m) => ({
      month: s(m.month),
      month_start: s(m.month_start),
      revenue: n(m.revenue),
      expenses: n(m.expenses),
      profit: n(m.profit),
      cash_in: n(m.cash_in),
      cash_out: n(m.cash_out),
      net_cash: n(m.net_cash),
      cumulative_cash: n(m.cumulative_cash),
    })),
    overdueInvoices: asArray(root.overdueInvoices).map((i) => ({
      invoice_id: s(i.invoice_id),
      invoice_number: s(i.invoice_number),
      customer: s(i.customer, 'Unknown customer'),
      amount_outstanding: n(i.amount_outstanding),
      issue_date: s(i.issue_date),
      due_date: s(i.due_date),
      days_overdue: n(i.days_overdue),
    })),
    topExpenses: asArray(root.topExpenses).map((e) => ({
      category: s(e.category, 'Uncategorised'),
      account_code: s(e.account_code),
      amount: n(e.amount),
      document_count: n(e.document_count),
      period_days: n(e.period_days) || 90,
    })),
    topCustomers: asArray(root.topCustomers).map((c) => ({
      customer: s(c.customer, 'Unknown customer'),
      revenue: n(c.revenue),
      invoice_count: n(c.invoice_count),
      last_invoice_date: sOrNull(c.last_invoice_date),
      outstanding: n(c.outstanding),
      share_pct: nOrNull(c.share_pct),
    })),
    concentration: concRaw
      ? {
          total_revenue: n(concRaw.total_revenue),
          top_customer: s(concRaw.top_customer, 'Unknown customer'),
          top_customer_revenue: n(concRaw.top_customer_revenue),
          concentration_pct: nOrNull(concRaw.concentration_pct),
          customer_count: n(concRaw.customer_count),
        }
      : null,
    anomalies: asArray(root.anomalies).map((a) => {
      const severity = s(a.severity, 'low');
      return {
        type: s(a.type, 'anomaly'),
        severity: severity === 'high' || severity === 'medium' ? severity : 'low',
        occurred_on: s(a.occurred_on),
        amount: n(a.amount),
        reference: s(a.reference),
        description: s(a.description),
      };
    }),
    upcomingReceivables: asArray(root.upcomingReceivables).map((r) => {
      const bucket = s(r.bucket, '60+');
      return {
        invoice_id: s(r.invoice_id),
        invoice_number: s(r.invoice_number),
        customer: s(r.customer, 'Unknown customer'),
        amount_outstanding: n(r.amount_outstanding),
        due_date: s(r.due_date),
        days_until_due: n(r.days_until_due),
        bucket: bucket === '0-30' || bucket === '30-60' ? bucket : '60+',
      };
    }),
    upcomingPayables: asArray(root.upcomingPayables).map((p) => {
      const source = s(p.source, 'bill');
      return {
        source: source === 'payroll' || source === 'tax' ? source : 'bill',
        label: s(p.label, 'Payable'),
        counterparty: s(p.counterparty, 'Supplier'),
        amount: n(p.amount),
        due_date: s(p.due_date),
      };
    }),
  };
}
