import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261207000000_payroll_leave_and_reversal.sql'), 'utf8');

describe('Phase 6D-4 payroll leave and reversal migration', () => {
  it('persists the reversal link and creates a tenant-authorized reversing journal entry', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid/i);
    expect(sql).toMatch(/FUNCTION public\.reverse_pay_run\(p_pay_run_id uuid\)/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(/can_write_business_data\(v_run\.business_id\)/i);
    expect(sql).toMatch(/NOT v_line\.is_debit/i);
    expect(sql).toMatch(/reversal_of/i);
    expect(sql).toMatch(/reversed_by = v_reversal_je_id/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reverse_pay_run\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/'reversalJournalEntryId', v_reversal_je_id/i);
  });

  it('creates pending requests through a tenant-authorized RPC and validates their balance', () => {
    expect(sql).toMatch(/FUNCTION public\.submit_leave_request\([\s\S]*?RETURNS jsonb/i);
    expect(sql).toMatch(/can_write_business_data\(p_business_id\)/i);
    expect(sql).toMatch(/Insufficient leave balance/i);
    expect(sql).toMatch(/'status', 'pending'/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_leave_request\(uuid, uuid, uuid, date, date, numeric, text\) TO authenticated, service_role/i);
  });

  it('locks pending decisions, rechecks and deducts balances on approval, and supports rejection', () => {
    expect(sql).toMatch(/FUNCTION public\.approve_leave_request\(\s*p_request_id uuid,\s*p_approved boolean\s*\)/i);
    expect(sql).toMatch(/FROM public\.leave_requests\s+WHERE id = p_request_id\s+FOR UPDATE/i);
    expect(sql).toMatch(/Only pending leave requests can be approved or rejected/i);
    expect(sql).toMatch(/used_days = used_days \+ v_request\.total_days/i);
    expect(sql).toMatch(/status = 'rejected'/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_leave_request\(uuid, boolean\) TO authenticated, service_role/i);
  });
});
