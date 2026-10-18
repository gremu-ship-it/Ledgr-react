import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const subtypeMigration = readFileSync(
  'supabase/migrations/20261031000000_construction_retention_receivable_subtype.sql',
  'utf8',
);
const sql = readFileSync(
  'supabase/migrations/20261031000001_construction_progress_valuations.sql',
  'utf8',
);

describe('construction valuation migration contract', () => {
  it('adds contra_ar separately before creating Retention Receivable accounts', () => {
    expect(subtypeMigration).toContain("ALTER TYPE public.account_subtype ADD VALUE IF NOT EXISTS 'contra_ar'");
    expect(subtypeMigration).not.toContain('CREATE TABLE');
    expect(sql).toContain("'asset', 'contra_ar', 'debit'");
    expect(sql).toContain('generate_series(1138, 1199)');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE');
    expect(sql).toContain('btrim(a.code) = codes.code::text');
  });

  it('creates the required tables with tenant RLS, invoice links and a positive retention ledger', () => {
    for (const table of [
      'project_valuations',
      'project_valuation_lines',
      'project_retention_ledger',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`${table}_member_grants`);
    }
    expect(sql).toContain('UNIQUE (project_id, valuation_number)');
    expect(sql).toContain('UNIQUE (valuation_id, boq_line_id)');
    expect(sql).toContain('amount > 0 AND amount < \'Infinity\'::numeric');
    expect(sql).toContain('project_valuations_invoice_id_fkey');
    expect(sql).toContain('project_retention_ledger_invoice_id_fkey');
    expect(sql).toContain('construction_procurement_capabilities_for(p.business_id)');
    expect(sql).toContain('GRANT SELECT ON public.project_valuations');
  });

  it('enforces cumulative percentages, correction reasons, sequential drafts and the first-valuation BOQ lock', () => {
    expect(sql).toContain('round(v_boq_value * v_pct / 100, 2)');
    expect(sql).toContain('v_period_value := round(v_cumulative_value - v_previous_value, 2)');
    expect(sql).toContain('A reason is required when a valuation contains a negative period value.');
    expect(sql).toContain('Submit the existing draft valuation before creating another.');
    expect(sql).toContain('SELECT COALESCE(max(v.valuation_number), 0) + 1');
    expect(sql).toContain('IF v_number = 1 THEN');
    expect(sql).toContain('SET boq_locked_at = COALESCE(boq_locked_at, now())');
    expect(sql).toContain('Only draft valuations can be edited.');
    expect(sql).toContain('Only draft valuations can be submitted.');
  });

  it('requires practical completion or later for a capped, invoice-backed manual release', () => {
    expect(sql).toContain("v_project.status NOT IN ('practical_completion', 'defect_liability', 'closed')");
    expect(sql).toContain('IF v_balance < v_release_amount THEN');
    expect(sql).toContain('public.create_invoice_with_lines(');
    expect(sql).toContain('Retention Receivable');
    expect(sql).toContain("a.account_subtype = 'contra_ar'");
  });

  it('generates existing Income invoices and uses the existing credit-note convention for negative net valuations', () => {
    expect(sql).toContain("v_invoice_type := 'credit_note'");
    expect(sql).toContain("'credit_note_for', v_credit_note_for");
    expect(sql).toContain("'functional_amount', v_valuation.net_amount");
    expect(sql).toContain("'total_amount', v_valuation.net_amount");
    const invoiceFunctionStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.generate_invoice_from_valuation');
    const invoiceFunctionEnd = sql.indexOf('CREATE OR REPLACE FUNCTION public.release_retention', invoiceFunctionStart);
    const invoiceFunction = sql.slice(invoiceFunctionStart, invoiceFunctionEnd);
    expect(invoiceFunction).toContain("'unit_price', abs(q.period_value)");
    expect(invoiceFunction).toContain("'line_subtotal', q.period_value");
    expect(invoiceFunction).toContain("'account_id', v_retention_account_id");
    expect(invoiceFunction).toContain("to_jsonb(-((value->>'line_subtotal')::numeric))");
    expect(invoiceFunction).toContain("to_jsonb(-((value->>'line_total')::numeric))");
    expect(sql).toContain('public.create_invoice_with_lines(\n    v_invoice_header, v_invoice_lines, v_valuation.id');
    expect(sql).not.toContain('INSERT INTO public.invoices');
    expect(sql).not.toContain('CREATE TABLE public.construction_invoices');
  });
});
