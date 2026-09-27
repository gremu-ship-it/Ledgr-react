import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFinancialRestResource, FINANCIAL_REST_PATH_SOURCE } from '../swApiCachePolicy';

/** IC 2026-09-25 P8 — financial REST reads are never served from the SW cache. */
describe('service-worker API cache policy (IC P8)', () => {
  it.each([
    'invoices?select=*', 'invoice_lines?x=1', 'invoice_payments', 'expenses', 'expense_payments',
    'journal_entries', 'journal_lines', 'accounts', 'inventory_balances', 'stock_movements',
    'stock_transfers', 'bank_statements', 'payroll_runs', 'pos_shifts', 'tax_returns',
    'v_trial_balance', 'v_ar_ageing', 'rpc/ai_context', 'loans', 'fixed_assets', 'budgets',
    'exchange_rates', 'recurring_invoices', 'accounting_periods', 'audit_log',
  ])('%s is financial → NetworkOnly', (path) => {
    expect(isFinancialRestResource(path)).toBe(true);
  });

  it.each(['products?select=id', 'contacts', 'branches', 'businesses', 'product_categories', 'departments', 'profiles'])(
    '%s is reference data → may use the NetworkFirst cache',
    (path) => {
      expect(isFinancialRestResource(path)).toBe(false);
    },
  );

  it('vite.config registers the financial NetworkOnly route BEFORE the generic cached /rest/v1/ route', () => {
    const src = readFileSync('vite.config.ts', 'utf8');
    const financial = src.indexOf('supabaseUrlPattern(`/rest/v1/${FINANCIAL_REST_PATH_SOURCE}`)');
    const generic = src.indexOf("supabaseUrlPattern('/rest/v1/')");
    expect(financial).toBeGreaterThan(0);
    expect(generic).toBeGreaterThan(financial);
    expect(src.slice(financial, generic)).toContain("handler: 'NetworkOnly'");
  });

  it('the RegExp source is valid and anchors on resource prefixes', () => {
    expect(() => new RegExp(FINANCIAL_REST_PATH_SOURCE)).not.toThrow();
    expect(isFinancialRestResource('xinvoices')).toBe(false);
  });
});
