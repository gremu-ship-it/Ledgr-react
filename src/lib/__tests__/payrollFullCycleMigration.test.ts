import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../../supabase/migrations/20261206000000_payroll_full_cycle.sql');
const sql = readFileSync(migrationPath, 'utf8');

describe('Phase 6D-1 payroll migration contract', () => {
  it('extends the existing employee schema and creates the new full-cycle tables', () => {
    expect(sql).toMatch(/ALTER TABLE public\.employees ADD COLUMN IF NOT EXISTS tax_id/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_contracts/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pay_components/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_pay_components/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.tax_bands/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pay_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pay_run_lines/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pay_run_component_details/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.leave_types/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.leave_balances/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.leave_requests/i);
    expect(sql).toMatch(/CREATE TYPE public\.employee_status AS ENUM/i);
    expect(sql).toMatch(/CREATE TYPE public\.pay_run_status AS ENUM/i);
  });

  it('keeps the payroll RPCs tenant-authorized and includes the mandated payroll source type', () => {
    expect(sql).toMatch(/FUNCTION public\.calculate_pay_run/i);
    expect(sql).toMatch(/FUNCTION public\.post_pay_run/i);
    expect(sql).toMatch(/FUNCTION public\.accrue_leave/i);
    expect(sql).toMatch(/can_write_business_data\(p_business_id\)/i);
    expect(sql).toMatch(/source_type,\s*source_id/i);
    expect(sql).toMatch(/'payroll',\s*v_run\.id::text/i);
  });

  it('seeds the four Malawi 2026 progressive rates and uses a leave-accrual idempotency marker', () => {
    expect(sql).toContain('170000::numeric, 0::numeric');
    expect(sql).toContain('1570000::numeric, 0.30::numeric');
    expect(sql).toContain('10000000::numeric, 0.35::numeric');
    expect(sql).toContain('0.40::numeric');
    expect(sql).toMatch(/pension ON true\s+CROSS JOIN LATERAL \(VALUES[\s\S]*pension\.employee_rate/i);
    expect(sql).toMatch(/last_accrued_month date/i);
    expect(sql).toMatch(/last_accrued_month IS NULL OR leave_balances\.last_accrued_month < EXCLUDED\.last_accrued_month/i);
  });

  it('does not drop the existing PAYE band, payroll run, or allowance/deduction tables', () => {
    expect(sql).not.toMatch(/DROP TABLE\s+(?:IF EXISTS\s+)?public\.(?:paye_bands|tax_bands|payroll_runs|payroll_employee_lines|employee_allowances|employee_deductions)/i);
    expect(sql).toMatch(/2026\/27 PAYE reference bands in paye_bands are not[\s\S]*overwritten/i);
  });
});
