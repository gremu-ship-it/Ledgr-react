import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PayrollRepository } from '../PayrollRepository';
import { TaxReturnRepository } from '../TaxReturnRepository';
import type { Database } from '../../types/database';

describe('PayrollRepository approval & TPR pension account linking', () => {
  it('auto-resolves pension payable account from code 2132 if tpr_pension is unlinked', async () => {
    const mockRun = {
      id: 'run-1',
      business_id: 'biz-1',
      run_number: 'PAY-0001',
      payroll_period: '2026-07',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      pay_date: '2026-07-31',
      status: 'draft',
      total_gross: 1000000,
      total_paye: 100000,
      total_other_deductions: 0,
      total_net: 850000,
      lines: [
        {
          id: 'line-1',
          employee_id: 'emp-1',
          gross_pay: 1000000,
          paye_deduction: 100000,
          pension_employer: 100000,
          pension_employee: 50000,
          other_deductions: 0,
          net_pay: 850000,
        },
      ],
    };

    const mockEmployee = {
      id: 'emp-1',
      first_name: 'John',
      last_name: 'Doe',
      employee_number: 'EMP-001',
      salary_account_id: 'acc-salary-exp',
      paye_liability_account_id: 'acc-paye-liab',
    };

    const mockPayeConfig = {
      id: 'cfg-paye',
      business_id: 'biz-1',
      tax_code: 'paye',
      tax_payable_account_id: 'acc-paye-liab',
      is_active: true,
    };

    const mockTprConfig = {
      id: 'cfg-tpr',
      business_id: 'biz-1',
      tax_code: 'tpr_pension',
      tax_payable_account_id: null,
      is_active: true,
    };

    const mockAccounts: Record<string, { id: string; code: string; name: string }> = {
      '2132': { id: 'acc-pension-liab', code: '2132', name: 'Pension Payable' },
      '6110': { id: 'acc-salary-exp', code: '6110', name: 'Basic Salaries' },
      '6112': { id: 'acc-pension-exp', code: '6112', name: 'Employer Pension Contributions' },
    };

    const mockEntry = {
      id: 'je-1',
      business_id: 'biz-1',
      entry_number: 'JNL-001',
      status: 'draft',
      lines: [
        { is_debit: true, amount: 1000000 },
        { is_debit: true, amount: 100000 },
        { is_debit: false, amount: 100000 },
        { is_debit: false, amount: 150000 },
        { is_debit: false, amount: 850000 },
      ],
    };

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'payroll_runs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockRun, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...mockRun, status: 'approved' }, error: null }),
                maybeSingle: async () => ({ data: { ...mockRun, status: 'approved' }, error: null }),
              }),
              maybeSingle: async () => ({ data: { ...mockRun, status: 'approved' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'employees') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockEmployee, error: null }),
            }),
          }),
        };
      }
      if (table === 'tax_configurations') {
        return {
          select: () => ({
            eq: () => ({
              eq: (_col2: string, val2: string) => ({
                eq: () => ({
                  maybeSingle: async () => {
                    if (val2 === 'paye') return { data: mockPayeConfig, error: null };
                    if (val2 === 'tpr_pension') return { data: mockTprConfig, error: null };
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'accounts') {
        // chainable mock supporting eq*4 + is + ilike/or + limit + maybeSingle
        const makeChain = (ref: { code: string | null }) => {
          const chain: any = {};
          chain.eq = (_col: string, val?: unknown) => {
            if (_col === 'code' && typeof val === 'string') ref.code = val;
            return chain;
          };
          chain.is = () => chain;
          chain.ilike = () => chain;
          chain.or = () => chain;
          chain.limit = () => chain;
          chain.maybeSingle = async () => {
            if (ref.code) return { data: mockAccounts[ref.code] ?? null, error: null };
            return { data: { id: 'acc-pension-liab' }, error: null };
          };
          return chain;
        };
        return {
          select: () => ({
            eq: () => ({
              eq: (_col2: string, codeVal: string) => ({
                maybeSingle: async () => ({ data: mockAccounts[codeVal] ?? null, error: null }),
              }),
              is: () => ({
                or: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: 'acc-pension-liab' }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'journal_entries') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockEntry, error: null }),
              maybeSingle: async () => ({ data: mockEntry, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: mockEntry, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { ...mockEntry, status: 'posted' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'journal_lines') {
        return {
          insert: () => ({
            select: async () => ({ data: mockEntry.lines, error: null }),
          }),
        };
      }
      if (table === 'tax_returns') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: 'tr-1', business_id: 'biz-1', due_date: '2026-07-31' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'tax_alerts') {
        return {
          insert: async () => ({ error: null }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    });

    const mockClient = { from: fromMock } as unknown as SupabaseClient<Database>;
    const repo = new PayrollRepository(mockClient);

    // Should auto-link pension account 2132 and succeed
    await expect(repo.approve('run-1', 'user-1', 'JNL-001', 'acc-bank')).resolves.toBeDefined();
  });

  it('throws ValidationError if TPR pension account is not linked and no fallback account is found', async () => {
    const mockRun = {
      id: 'run-2',
      business_id: 'biz-2',
      run_number: 'PAY-0002',
      payroll_period: '2026-07',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      pay_date: '2026-07-31',
      status: 'draft',
      total_gross: 1000000,
      total_paye: 100000,
      total_other_deductions: 0,
      total_net: 850000,
      lines: [
        {
          id: 'line-2',
          employee_id: 'emp-2',
          gross_pay: 1000000,
          paye_deduction: 100000,
          pension_employer: 100000,
          pension_employee: 50000,
          other_deductions: 0,
          net_pay: 850000,
        },
      ],
    };

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'payroll_runs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockRun, error: null }),
            }),
          }),
        };
      }
      if (table === 'tax_configurations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'cfg-tpr-2', business_id: 'biz-2', tax_code: 'tpr_pension', tax_payable_account_id: null, is_active: true },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                or: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    });

    const mockClient = { from: fromMock } as unknown as SupabaseClient<Database>;
    const repo = new PayrollRepository(mockClient);

    await expect(repo.approve('run-2', 'user-2', 'JNL-002', 'acc-bank')).rejects.toThrow(
      /TPR pension payable account is not linked for this business/,
    );
  });
});

describe('TaxReturnRepository auto-fallback', () => {
  it('auto-resolves tax_payable_account_id for pension if unlinked during postToJournal', async () => {
    const mockTaxReturn = {
      id: 'tr-1',
      business_id: 'biz-1',
      tax_code: 'tpr_pension',
      period_label: '2026-07',
      period_end: '2026-07-31',
      amount_due: 150000,
      journal_entry_id: null,
    };

    const mockConfig = {
      id: 'cfg-1',
      business_id: 'biz-1',
      tax_code: 'tpr_pension',
      tax_payable_account_id: null,
    };

    const mockEntry = {
      id: 'je-1',
      business_id: 'biz-1',
      entry_number: 'JNL-100',
      status: 'draft',
      lines: [
        { is_debit: true, amount: 150000 },
        { is_debit: false, amount: 150000 },
      ],
    };

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'tax_returns') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockTaxReturn, error: null }),
              maybeSingle: async () => ({ data: mockTaxReturn, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { ...mockTaxReturn, journal_entry_id: 'je-1' }, error: null }),
              }),
              maybeSingle: async () => ({ data: { ...mockTaxReturn, journal_entry_id: 'je-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'tax_configurations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  lte: () => ({
                    or: () => ({
                      maybeSingle: async () => ({ data: mockConfig, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                or: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: 'acc-pension-2132' }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'journal_entries') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: mockEntry, error: null }),
              maybeSingle: async () => ({ data: mockEntry, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: mockEntry, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { ...mockEntry, status: 'posted' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'journal_lines') {
        return {
          insert: () => ({
            select: async () => ({ data: mockEntry.lines, error: null }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    });

    const mockClient = { from: fromMock } as unknown as SupabaseClient<Database>;
    const repo = new TaxReturnRepository(mockClient);

    await expect(repo.postToJournal('tr-1', 'acc-exp', 'user-1', 'JNL-100')).resolves.toBeDefined();
  });
});
