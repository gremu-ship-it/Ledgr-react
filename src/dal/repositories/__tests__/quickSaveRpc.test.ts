import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Integrity pins for the single-round-trip save RPCs
 * (supabase/migrations/20260911000001_quick_save_rpc.sql).
 *
 * There is no live database in this environment, so — like
 * paymentReversal.test.ts — these assertions pin the load-bearing properties
 * statically. Each check corresponds to a correctness or security property
 * the client relies on:
 *
 *   SECURITY   : SECURITY DEFINER + pinned search_path + explicit tenant
 *                guard (definer functions bypass RLS, so the guard is the
 *                only authorization there is).
 *   ATOMICITY  : validation precedes every write; any error rolls the whole
 *                save back; the caller treats a non-missing-function error
 *                as "nothing was saved".
 *   IDEMPOTENCY: a retried save (same client_key) returns the committed
 *                document instead of duplicating it.
 *   PARITY     : the same account codes, tolerances, usage-limit rule and
 *                stock semantics as the TypeScript path, so either path can
 *                run without divergent ledgers.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260911000001_quick_save_rpc.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

function fnBody(name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start, `${name} exists in the migration`).toBeGreaterThan(-1);
  const end = sql.indexOf('-- ── ', start);
  return sql.slice(start, end === -1 ? sql.length : end);
}

describe('quick-save RPC migration integrity', () => {
  describe('security', () => {
    it.each(['save_quick_expense', 'save_quick_sale'])(
      '%s is SECURITY DEFINER with a pinned search_path and an explicit tenant guard',
      (fn) => {
        const body = fnBody(fn);
        expect(body).toContain('security definer');
        expect(body).toContain('set search_path = public');
        expect(body).toContain('can_write_business_data');
        // The guard must run before the first thing that could succeed.
        expect(body.indexOf('can_write_business_data')).toBeLessThan(
          body.indexOf('reserve_next_document_number'),
        );
      },
    );

    it('revokes execution from public/anon and grants it only to authenticated', () => {
      expect(sql).toMatch(/revoke all on function public\.save_quick_expense\(jsonb\) from public, anon;/);
      expect(sql).toMatch(/revoke all on function public\.save_quick_sale\(jsonb\) from public, anon;/);
      expect(sql).toMatch(/grant execute on function public\.save_quick_expense\(jsonb\) to authenticated;/);
      expect(sql).toMatch(/grant execute on function public\.save_quick_sale\(jsonb\) to authenticated;/);
    });

    it('helper functions are also definer functions with pinned search paths', () => {
      for (const helper of [
        '_ledgr_assert_account',
        '_ledgr_account_by_code',
        '_ledgr_assert_usage_limit',
        '_ledgr_post_entry',
        '_ledgr_stock_location',
        '_ledgr_post_cogs',
      ]) {
        const body = fnBody(helper);
        expect(body).toContain('security definer');
        expect(body).toContain('set search_path = public');
      }
    });
  });

  describe('idempotency', () => {
    it.each(['save_quick_expense', 'save_quick_sale'])(
      '%s resolves retries via client_key before any write',
      (fn) => {
        const body = fnBody(fn);
        const idem = body.indexOf('client_key');
        const firstInsert = body.indexOf('insert into public.');
        expect(idem).toBeGreaterThan(-1);
        expect(firstInsert).toBeGreaterThan(-1);
        expect(idem).toBeLessThan(firstInsert);
        expect(body).toContain("'idempotent', true");
      },
    );
  });

  describe('parity with the TypeScript posting path', () => {
    it('validates allocation totals against net + VAT within 0.01', () => {
      expect(sql).toContain('+ v_vat - v_total) > 0.01');
    });

    it('enforces the functional-currency balance rule within 0.005 before inserting', () => {
      const post = fnBody('_ledgr_post_entry');
      const balanceCheck = post.indexOf('abs(v_debits - v_credits) > 0.005');
      const entryInsert = post.indexOf('insert into public.journal_entries');
      expect(balanceCheck).toBeGreaterThan(-1);
      expect(entryInsert).toBeGreaterThan(balanceCheck);
    });

    it('reserves document numbers through the existing atomic RPC', () => {
      expect(sql).toContain("reserve_next_document_number(v_business_id, 'expense')");
      expect(sql).toContain("reserve_next_document_number(v_business_id, 'invoice')");
    });

    it('mirrors the usage-limit table (free 50 / growth 500 / pro 2000 / enterprise unlimited)', () => {
      const usage = fnBody('_ledgr_assert_usage_limit');
      expect(usage).toContain("when 'free' then 50");
      expect(usage).toContain("when 'growth' then 500");
      expect(usage).toContain("when 'pro' then 2000");
      expect(usage).toContain("when 'enterprise' then null");
      expect(usage).toContain('Please upgrade your plan');
    });

    it('posts to the same GL account codes as journalService', () => {
      // expense: VAT receivable, creditors, cash
      expect(fnBody('save_quick_expense')).toContain("'1135'");
      expect(fnBody('save_quick_expense')).toContain("'2111'");
      expect(fnBody('save_quick_expense')).toContain("'1110'");
      // sale: debtors, cash, revenue, VAT payable; COGS: 5100/1141 defaults
      const sale = fnBody('save_quick_sale');
      expect(sale).toContain("'1131'");
      expect(sale).toContain("'1110'");
      expect(sale).toContain("'4112'");
      expect(sale).toContain("'2121'");
      expect(fnBody('_ledgr_post_cogs')).toContain("'1141'");
      expect(fnBody('_ledgr_post_cogs')).toContain("'5100'");
    });

    it('values sales at the average cost read BEFORE the movement lands', () => {
      const sale = fnBody('save_quick_sale');
      expect(sale.indexOf('from public.inventory_balances')).toBeGreaterThan(-1);
      expect(sale.indexOf('insert into public.stock_movements')).toBeGreaterThan(
        sale.indexOf('from public.inventory_balances'),
      );
      // sales dated at issue date, purchases at current_date (TS parity)
      expect(sale).toContain("(v_invoice->>'issue_date')::date");
      expect(fnBody('save_quick_expense')).toContain('current_date');
    });

    it('does not write inventory_balances (the out-of-band trigger owns them)', () => {
      expect(sql.match(/insert into public\.inventory_balances/g)).toBeNull();
      expect(sql.match(/update public\.inventory_balances/g)).toBeNull();
    });

    it('keeps COGS best-effort like postCogsForSale', () => {
      const sale = fnBody('save_quick_sale');
      expect(sale).toContain('exception when others then');
      expect(sale).toContain("raise warning 'COGS posting failed for invoice");
    });

    it('rejects documents the legacy path posts differently (discounts/VAT sales)', () => {
      expect(fnBody('save_quick_sale')).toContain('Quick-sale RPC handles plain paid invoices only.');
      expect(fnBody('save_quick_expense')).toContain('Quick-save RPC handles undiscounted expenses only.');
    });
  });

  describe('atomicity', () => {
    it('validates the payload before the first insert in both functions', () => {
      for (const fn of ['save_quick_expense', 'save_quick_sale']) {
        const body = fnBody(fn);
        const validation = body.indexOf('raise exception');
        const firstInsert = body.indexOf('insert into public.');
        expect(validation).toBeGreaterThan(-1);
        expect(firstInsert).toBeGreaterThan(validation);
      }
    });

    it('links the posted journal entry back to its document', () => {
      expect(fnBody('save_quick_expense')).toMatch(/update public\.expenses\s+set journal_entry_id/);
      expect(fnBody('save_quick_sale')).toMatch(/update public\.invoices\s+set journal_entry_id/);
    });
  });
});
