// Supabase Edge Function: generate-vat-returns
// Runs monthly (schedule via pg_cron, see bottom of file) to auto-generate
// a VAT return for every VAT-registered business for the prior calendar month.
//
// Deploy: supabase functions deploy generate-vat-returns
// Test manually: supabase functions invoke generate-vat-returns

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role: bypasses RLS, runs for all businesses
  );

  // Prior calendar month, e.g. if run on 2026-07-01, targets 2026-06.
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const periodStartStr = periodStart.toISOString().slice(0, 10);
  const periodEndStr = periodEnd.toISOString().slice(0, 10);

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id')
    .eq('vat_registered', true)
    .eq('is_active', true);

  if (error) {
    console.error('Failed to fetch VAT-registered businesses:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: { business_id: string; status: 'created' | 'skipped' | 'error'; detail?: string }[] = [];

  for (const business of businesses ?? []) {
    try {
      // NOTE: this duplicates a slimmed-down version of
      // TaxReturnRepository.generateVatReturn's output/input tax summation
      // rather than importing the TS repository directly, since Edge
      // Functions run in Deno and importing from the React app's src/dal
      // tree requires either a shared package or a copy-paste. For a
      // small business app this duplication is acceptable; if the calc
      // logic changes, remember to update BOTH places, or invest in a
      // shared `packages/tax-core` module Phase 2 onward.
      const periodLabel = periodStartStr.slice(0, 7);

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

      const { data: invoices } = await supabase
        .from('invoices')
        .select('id')
        .eq('business_id', business.id)
        .gte('issue_date', periodStartStr)
        .lte('issue_date', periodEndStr);
      const invoiceIds = (invoices ?? []).map((i) => i.id);

      let outputTax = 0;
      if (invoiceIds.length > 0) {
        const { data: lines } = await supabase
          .from('invoice_lines')
          .select('tax_amount')
          .eq('business_id', business.id)
          .eq('tax_code', 'vat_standard')
          .in('invoice_id', invoiceIds);
        outputTax = (lines ?? []).reduce((s: number, l: { tax_amount: number }) => s + Number(l.tax_amount), 0);
      }

      // FLAGGED: expenses date column name not confirmed — same caveat as
      // TaxReturnRepository.sumLineTax. Adjust 'expense_date' if wrong.
      const { data: expenses } = await supabase
        .from('expenses')
        .select('id')
        .eq('business_id', business.id)
        .gte('expense_date', periodStartStr)
        .lte('expense_date', periodEndStr);
      const expenseIds = (expenses ?? []).map((e) => e.id);

      let inputTax = 0;
      if (expenseIds.length > 0) {
        const { data: lines } = await supabase
          .from('expense_lines')
          .select('tax_amount')
          .eq('business_id', business.id)
          .eq('tax_code', 'vat_standard')
          .in('expense_id', expenseIds);
        inputTax = (lines ?? []).reduce((s: number, l: { tax_amount: number }) => s + Number(l.tax_amount), 0);
      }

      const amountDue = Math.max(Math.round((outputTax - inputTax) * 100) / 100, 0);
      const dueDate = new Date(now.getFullYear(), now.getMonth(), 25).toISOString().slice(0, 10);

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
          amount_due: amountDue,
          amount_paid: 0,
          status: 'pending',
          source_type: 'vat_period',
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Schedule alerts (14/7/1 day + due-date) — mirrors TaxReturnRepository.scheduleAlerts.
      const offsets = [
        { days: -14, type: '14_day' },
        { days: -7, type: '7_day' },
        { days: -1, type: '1_day' },
        { days: 0, type: 'due_date' },
      ];
      const alertRows = offsets.map((o) => {
        const d = new Date(dueDate);
        d.setDate(d.getDate() + o.days);
        return {
          business_id: business.id,
          tax_return_id: created.id,
          alert_type: o.type,
          scheduled_for: d.toISOString().slice(0, 10),
          channel: 'email',
          status: 'pending',
        };
      });
      await supabase.from('tax_alerts').insert(alertRows);

      results.push({ business_id: business.id, status: 'created' });
    } catch (err) {
      console.error(`Failed to generate VAT return for business ${business.id}:`, err);
      results.push({ business_id: business.id, status: 'error', detail: String(err) });
    }
  }

  return new Response(JSON.stringify({ period: periodStartStr.slice(0, 7), results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/* ============================================================================
 * To schedule this monthly (run in Supabase SQL Editor, once pg_cron and
 * pg_net extensions are enabled — Database > Extensions in the dashboard):
 *
 * select cron.schedule(
 *   'generate-vat-returns-monthly',
 *   '0 6 1 * *',  -- 06:00 on the 1st of every month
 *   $$
 *   select net.http_post(
 *     url := 'https://<your-project-ref>.supabase.co/functions/v1/generate-vat-returns',
 *     headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
 *   );
 *   $$
 * );
 *
 * This wiring is optional right now — the function works standalone via
 * manual invoke until you're ready to turn on the schedule.
 * ========================================================================= */