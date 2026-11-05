import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = [
  '20261210000000_pos_return_tables.sql',
  '20261210000001_pos_return_command.sql',
].map((name) => readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), 'utf8')).join('\n');

describe('POS return workflow migration', () => {
  it('keeps R07 as the only financial and stock correction path', () => {
    expect(migration).toMatch(/public\.refund_pos_sale_command\(jsonb_build_object\([\s\S]*?'tender_account_id', v_tender[\s\S]*?'lines', v_refund_lines/s);
    expect(migration).toContain("public._ledgr_account_by_code(v_business, '1110')");
    expect(migration).toContain("public._ledgr_account_by_code(v_business, '2113')");
    expect(migration).not.toMatch(/update\s+public\.invoices/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.journal_entries/i);
  });

  it('enforces retail, Starter/Growth plan boundaries, active shifts, and unreturned line quantities server-side', () => {
    expect(migration).toContain("'RETAIL' = any(v_models)");
    expect(migration).toContain("public.plan_tier_rank('starter')");
    expect(migration).toContain("public.plan_tier_rank('growth')");
    expect(migration).toContain("v_shift.status <> 'open'");
    expect(migration).toContain('v_invoice_line.quantity');
    expect(migration).toContain('pos_return_lines prl');
    expect(migration).toContain('A sale line may only appear once in a return.');
    expect(migration).toContain('Only the shift cashier or a business manager may process a return on this shift.');
    expect(migration).toContain('v_invoice_id uuid');
  });

  it('records per-line reason/restock audit and derives cross-shift drawer effects from the settlement journal', () => {
    expect(migration).toContain('create table if not exists public.pos_return_lines');
    expect(migration).toContain('reason text not null');
    expect(migration).toContain('restock boolean not null default true');
    expect(migration).toContain("'restock', v_restock");
    expect(migration).toContain('public.journal_lines jl');
    expect(migration).toContain('largest-remainder allocation in cents');
    expect(migration).toContain('round(v_raw_total, 2)');
    expect(migration).toContain("'cash_out', v_cash_out");
    expect(migration).toContain('unique (business_id, command_key)');
  });
});
