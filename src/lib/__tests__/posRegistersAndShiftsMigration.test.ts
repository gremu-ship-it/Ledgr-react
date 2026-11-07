import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261209000000_pos_registers_and_shifts.sql', 'utf8');

describe('POS registers and shifts migration contract', () => {
  it('extends canonical R08 terminals instead of creating parallel register or shift tables', () => {
    expect(sql).toContain('ALTER TABLE public.pos_terminals');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS code text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS default_cash_account_id uuid');
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public\.pos_(registers|shifts)/i);
  });

  it('keeps register codes business-unique and same-business cash-account references', () => {
    expect(sql).toContain('pos_terminals_business_code_uidx');
    expect(sql).toContain('pos_terminals_business_cash_account_fkey');
    expect(sql).toContain('REFERENCES public.accounts (business_id, id)');
  });

  it('retains the existing one-open-shift-per-terminal and one-open-shift-per-cashier indexes', () => {
    expect(sql).toContain('pos_shifts_one_open_per_terminal');
    expect(sql).toContain('pos_shifts_one_open_per_cashier');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(open_pos_shift_command|close_pos_shift_command)/i);
  });
});
