// Supabase Edge Function: generate-vat-returns
//
// Runs monthly (see 20260727000011_schedule_tax_jobs.sql) to auto-generate a
// VAT return for every VAT-registered business for the prior calendar month,
// and to schedule its 14 / 7 / 1 day + due-date alerts.
//
// Deploy: supabase functions deploy generate-vat-returns
// Test:   supabase functions invoke generate-vat-returns --no-verify-jwt \
//           --header 'x-cron-secret: <CRON_SECRET>'
//
// NOTE: the VAT summation below intentionally mirrors
// TaxReturnRepository.computeVatBreakdown(). Edge Functions run in Deno and
// cannot import the React app's src/dal tree without a shared package, so
// the logic is duplicated. If the calculation changes, update BOTH.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');

/** Revenue invoice types only — quotes and proformas are not supplies. */
const VATABLE_INVOICE_TYPES = ['invoice', 'credit_note', 'debit_note'];
/** Never include void or draft documents in a statutory return. */
const EXCLUDED_STATUSES = '(void,draft)';

/** Due-date rules by jurisdiction. Mirrors src/lib/taxRules.ts. */
const VAT_DUE_DAY: Record<string, number> = { MW: 25, ZM: 18 };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC-only date arithmetic — mirrors src/lib/taxDates.ts. */
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function sumLineTax(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  linesTable: 'invoice_lines' | 'expense_lines',
  fkColumn: string,
  parentIds: string[],
): Promise<number> {
  if (parentIds.length === 0) return 0;
  const CHUNK = 200;
  let total = 0;
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(linesTable)
      .select('tax_amount')
      .eq('business_id', businessId)
      .eq('tax_code', 'vat_standard')
      .in(fkColumn, parentIds.slice(i, i + CHUNK));
    if (error) throw new Error(`${linesTable}: ${error.message}`);
    total += (data ?? []).reduce(
      (s: number, l: { tax_amount: number }) => s + Number(l.tax_amount), 0,
    );
  }
  return Math.round(total * 100) / 100;
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Prior calendar month, computed in UTC. Run on 2026-07-01 -> targets 2026-06.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed current month
  const periodStartDate = new Date(Date.UTC(y, m - 1, 1));
  const periodEndDate = new Date(Date.UTC(y, m, 0)); // day 0 = last day of prior month
  const periodStartStr = periodStartDate.toISOString().slice(0, 10);
  const periodEndStr = periodEndDate.toISOString().slice(0, 10);
  const periodLabel = periodStartStr.slice(0, 7);

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, country')
    .eq('vat_registered', true)
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch VAT-registered businesses:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: {
    business_id: string;
    status: 'created' | 'skipped' | 'error';
    detail?: string;
  }[] = [];

  for (const business of businesses ?? []) {
    try {
      const { data: existing } = await supabase
        .from('tax_returns')
        .select('id')
        .eq('business_id', business.id)
        .eq('tax_code', 'vat_standard')
        .eq('period_label', periodLabel)
        .maybeSingle();

      if (existing) {
        results.push({ business_id: business.id, status: 'skipped', detail: 'already exists' });
        continue;
      }

      // Output VAT — revenue invoices only, excluding void/draft/deleted.
      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('id')
        .eq('business_id', business.id)
        .in('invoice_type', VATABLE_INVOICE_TYPES)
        .not('status', 'in', EXCLUDED_STATUSES)
        .is('deleted_at', null)
        .gte('issue_date', periodStartStr)
        .lte('issue_date', periodEndStr);
      if (invErr) throw new Error(`invoices: ${invErr.message}`);

      const outputTax = await sumLineTax(
        supabase, business.id, 'invoice_lines', 'invoice_id',
        (invoices ?? []).map((i: { id: string }) => i.id),
      );

      // Input VAT — errors propagate rather than being swallowed as zero,
      // which would overstate the amount payable to the revenue authority.
      const { data: expenses, error: expErr } = await supabase
        .from('expenses')
        .select('id')
        .eq('business_id', business.id)
        .not('status', 'in', EXCLUDED_STATUSES)
        .is('deleted_at', null)
        .gte('expense_date', periodStartStr)
        .lte('expense_date', periodEndStr);
      if (expErr) throw new Error(`expenses: ${expErr.message}`);

      const inputTax = await sumLineTax(
        supabase, business.id, 'expense_lines', 'expense_id',
        (expenses ?? []).map((e: { id: string }) => e.id),
      );

      // Credit positions are preserved as a negative amount_due, not clamped
      // to zero — Form VAT 3 has a repayment box that needs the figure.
      const net = Math.round((outputTax - inputTax) * 100) / 100;

      const country = (business.country ?? '').toUpperCase();
      const dueDay = VAT_DUE_DAY[country === 'ZAMBIA' ? 'ZM' : country] ?? VAT_DUE_DAY.MW;
      // Due day of the month FOLLOWING the period end.
      const dueMonth = new Date(Date.UTC(y, m, 1));
      const dueDate = isoDate(dueMonth.getUTCFullYear(), dueMonth.getUTCMonth() + 1, dueDay);

      const { data: created, error: insertErr } = await supabase
        .from('tax_returns')
        .insert({
          business_id: business.id,
          tax_code: 'vat_standard',
          period_label: periodLabel,
          period_start: periodStartStr,
          period_end: periodEndStr,
          due_date: dueDate,
          output_tax: outputTax,
          input_tax: inputTax,
          gross_amount: 0,
          amount_due: net,
          amount_paid: 0,
          status: 'pending',
          source_type: 'vat_period',
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Schedule alerts — mirrors TaxReturnRepository.scheduleAlerts.
      const today = new Date().toISOString().slice(0, 10);
      const offsets = [
        { days: -14, type: '14_day' },
        { days: -7, type: '7_day' },
        { days: -1, type: '1_day' },
        { days: 0, type: 'due_date' },
      ];
      const alertRows = offsets
        .map((o) => ({
          business_id: business.id,
          tax_return_id: created.id,
          alert_type: o.type,
          scheduled_for: addDaysIso(dueDate, o.days),
          channel: 'email',
          status: 'pending',
        }))
        .filter((r) => r.scheduled_for >= today);

      if (alertRows.length > 0) {
        const { error: alertErr } = await supabase.from('tax_alerts').insert(alertRows);
        if (alertErr) console.error(`Failed to schedule alerts for ${business.id}:`, alertErr);
      }

      results.push({ business_id: business.id, status: 'created' });
    } catch (err) {
      console.error(`Failed to generate VAT return for business ${business.id}:`, err);
      results.push({ business_id: business.id, status: 'error', detail: String(err) });
    }
  }

  return new Response(JSON.stringify({ period: periodLabel, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
