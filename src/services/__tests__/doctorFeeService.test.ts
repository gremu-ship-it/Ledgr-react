import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorFeeContract } from '@/types/healthcare';

const doc = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (operation: string, values: unknown, filters: Array<[string, unknown[]]>) => {
      data?: unknown;
      error?: unknown;
    }
  >(),
  calls: [] as Array<{
    table: string;
    operation: string;
    values: unknown;
    filters: Array<[string, unknown[]]>;
  }>,
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: unknown = null;
    const filters: Array<[string, unknown[]]> = [];

    const resolve = () => {
      doc.calls.push({ table, operation, values, filters });
      const handler = doc.handlers.get(table);
      return handler ? handler(operation, values, filters) : { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = (name: string) => (...args: unknown[]) => {
      filters.push([name, args]);
      return builder;
    };

    Object.assign(builder, {
      select: (columns?: unknown) => {
        filters.push(['select', [columns]]);
        return builder;
      },
      insert: (input: unknown) => {
        operation = 'insert';
        values = input;
        return builder;
      },
      update: (input: unknown) => {
        operation = 'update';
        values = input;
        return builder;
      },
      upsert: (input: unknown) => {
        operation = 'upsert';
        values = input;
        return builder;
      },
      eq: passthrough('eq'),
      in: passthrough('in'),
      order: passthrough('order'),
      limit: passthrough('limit'),
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    });

    return builder;
  };

  return {
    supabase: {
      from: makeBuilder,
      rpc: (name: string, args: Record<string, unknown>) => {
        doc.rpcCalls.push({ name, args });
        return Promise.resolve(doc.rpc);
      },
    },
  };
});

const {
  accrueDoctorEarnings,
  buildDoctorCommissionLines,
  buildDoctorPayoutLines,
  calculateDoctorCommission,
  getDoctorContract,
  postDoctorCommissionsToLedger,
  postDoctorPayoutToLedger,
  summarizeEarnings,
  upsertDoctorContract,
} = await import('../doctorFeeService');

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const DOCTOR_ID = '33333333-3333-4333-8333-333333333333';
const EARNING_A = '44444444-4444-4444-8444-444444444444';
const EARNING_B = '55555555-5555-4555-8555-555555555555';

function contract(overrides: Partial<DoctorFeeContract> = {}): DoctorFeeContract {
  return {
    id: 'contract-1',
    business_id: BUSINESS_ID,
    doctor_id: DOCTOR_ID,
    contract_type: 'percentage',
    consultation_share_percent: 40,
    fixed_consultation_fee: 0,
    lab_procedure_share_percent: 10,
    pharmacy_share_percent: 5,
    expense_account_id: 'account-expense',
    payable_account_id: 'account-payable',
    is_active: true,
    ...overrides,
  };
}

beforeEach(() => {
  doc.handlers.clear();
  doc.calls.length = 0;
  doc.rpcCalls.length = 0;
  doc.rpc = { data: null, error: null };
});

describe('doctor commission math', () => {
  it('pays a fixed consultation fee plus any configured service shares', () => {
    const fixed = contract({
      contract_type: 'fixed',
      fixed_consultation_fee: 5_000,
      lab_procedure_share_percent: 0,
      pharmacy_share_percent: 0,
    });
    expect(
      calculateDoctorCommission(fixed, { consultation: 20_000, lab: 8_000, pharmacy: 4_000 }),
    ).toBe(5_000);

    const fixedWithShares = contract({
      contract_type: 'fixed',
      fixed_consultation_fee: 5_000,
      lab_procedure_share_percent: 10,
      pharmacy_share_percent: 5,
    });
    expect(
      calculateDoctorCommission(fixedWithShares, {
        consultation: 20_000,
        lab: 8_000,
        pharmacy: 4_000,
      }),
    ).toBe(6_000);
  });

  it('pays percentage shares on consultation, lab and pharmacy', () => {
    expect(
      calculateDoctorCommission(contract(), {
        consultation: 20_000,
        lab: 8_000,
        pharmacy: 4_000,
      }),
    ).toBe(9_000); // 8,000 + 800 + 200
  });

  it('pays the better of the fixed fee and percentage on a hybrid contract', () => {
    const hybrid = contract({
      contract_type: 'hybrid',
      fixed_consultation_fee: 12_000,
      consultation_share_percent: 40,
      lab_procedure_share_percent: 0,
      pharmacy_share_percent: 0,
    });
    expect(
      calculateDoctorCommission(hybrid, { consultation: 20_000, lab: 0, pharmacy: 0 }),
    ).toBe(12_000);

    expect(
      calculateDoctorCommission(
        { ...hybrid, consultation_share_percent: 80 },
        { consultation: 20_000, lab: 0, pharmacy: 0 },
      ),
    ).toBe(16_000);
  });

  it('rounds the total to cents', () => {
    const percentage = contract({
      consultation_share_percent: 33.33,
      lab_procedure_share_percent: 0,
      pharmacy_share_percent: 0,
    });
    expect(
      calculateDoctorCommission(percentage, { consultation: 100.01, lab: 0, pharmacy: 0 }),
    ).toBe(33.33);
  });

  it('pays nothing on an inactive contract', () => {
    expect(
      calculateDoctorCommission(contract({ is_active: false }), {
        consultation: 20_000,
        lab: 8_000,
        pharmacy: 4_000,
      }),
    ).toBe(0);
  });
});

describe('contracts and accruals', () => {
  it('loads a tenant-scoped contract', async () => {
    doc.handlers.set('doctor_fee_contracts', () => ({
      data: {
        ...contract(),
        consultation_share_percent: '40.00',
        fixed_consultation_fee: '0',
      },
      error: null,
    }));

    const result = await getDoctorContract(BUSINESS_ID, DOCTOR_ID);
    expect(result?.consultation_share_percent).toBe(40);
    const call = doc.calls.find((item) => item.table === 'doctor_fee_contracts');
    expect(call?.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call?.filters).toContainEqual(['eq', ['doctor_id', DOCTOR_ID]]);
  });

  it('upserts a contract on the business/doctor unique key', async () => {
    doc.handlers.set('doctor_fee_contracts', () => ({
      data: contract({ contract_type: 'hybrid', fixed_consultation_fee: 4_000 }),
      error: null,
    }));

    const saved = await upsertDoctorContract(BUSINESS_ID, {
      doctor_id: DOCTOR_ID,
      contract_type: 'hybrid',
      consultation_share_percent: 40,
      fixed_consultation_fee: 4_000,
      lab_procedure_share_percent: 10,
      pharmacy_share_percent: 5,
      expense_account_id: 'account-expense',
      payable_account_id: 'account-payable',
      is_active: true,
    });

    expect(saved.contract_type).toBe('hybrid');
    const call = doc.calls.find(
      (item) => item.table === 'doctor_fee_contracts' && item.operation === 'upsert',
    );
    expect(call?.values).toMatchObject({
      business_id: BUSINESS_ID,
      doctor_id: DOCTOR_ID,
      contract_type: 'hybrid',
      fixed_consultation_fee: 4_000,
    });
  });

  it('accrues the calculated commission for an invoiced visit', async () => {
    doc.handlers.set('doctor_fee_contracts', () => ({ data: contract(), error: null }));
    doc.handlers.set('doctor_fee_earnings', (operation) =>
      operation === 'insert'
        ? {
            data: {
              id: EARNING_A,
              business_id: BUSINESS_ID,
              doctor_id: DOCTOR_ID,
              visit_id: 'visit-1',
              invoice_id: 'invoice-1',
              consultation_amount: 20_000,
              lab_amount: 8_000,
              pharmacy_amount: 4_000,
              earned_commission: 9_000,
              status: 'pending',
              created_at: '2026-11-27T10:00:00Z',
            },
            error: null,
          }
        : { data: null, error: null },
    );

    const earning = await accrueDoctorEarnings(
      BUSINESS_ID,
      'visit-1',
      DOCTOR_ID,
      'invoice-1',
      { consultation: 20_000, lab: 8_000, pharmacy: 4_000 },
    );

    expect(earning?.earned_commission).toBe(9_000);
    const insert = doc.calls.find(
      (call) => call.table === 'doctor_fee_earnings' && call.operation === 'insert',
    );
    expect(insert?.values).toMatchObject({
      business_id: BUSINESS_ID,
      doctor_id: DOCTOR_ID,
      visit_id: 'visit-1',
      invoice_id: 'invoice-1',
      consultation_amount: 20_000,
      lab_amount: 8_000,
      pharmacy_amount: 4_000,
      earned_commission: 9_000,
      status: 'pending',
    });
  });

  it('does not accrue when the doctor has no contract', async () => {
    doc.handlers.set('doctor_fee_contracts', () => ({ data: null, error: null }));
    const earning = await accrueDoctorEarnings(
      BUSINESS_ID,
      'visit-1',
      DOCTOR_ID,
      'invoice-1',
      { consultation: 20_000, lab: 0, pharmacy: 0 },
    );
    expect(earning).toBeNull();
    expect(
      doc.calls.some(
        (call) => call.table === 'doctor_fee_earnings' && call.operation === 'insert',
      ),
    ).toBe(false);
  });
});

describe('ledger postings', () => {
  it('posts a balanced accrual journal and marks the earnings posted', async () => {
    doc.handlers.set('doctor_fee_earnings', (operation) =>
      operation === 'select'
        ? {
            data: [
              { id: EARNING_A, earned_commission: '4500', status: 'pending' },
              { id: EARNING_B, earned_commission: '5500', status: 'pending' },
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    doc.rpc = { data: 'journal-1', error: null };

    const journalId = await postDoctorCommissionsToLedger(
      BUSINESS_ID,
      [EARNING_A, EARNING_B],
      'account-expense',
      'account-payable',
    );

    expect(journalId).toBe('journal-1');
    expect(doc.rpcCalls[0].name).toBe('post_financial_journal');
    const args = doc.rpcCalls[0].args;
    expect(args.p_lines).toEqual([
      expect.objectContaining({
        account_id: 'account-expense',
        debit: 10_000,
        credit: 0,
      }),
      expect.objectContaining({
        account_id: 'account-payable',
        debit: 0,
        credit: 10_000,
      }),
    ]);
    expect(args.p_source_type).toBe('doctor_commission');
    expect(String(args.p_posting_key)).toContain('doctor-commission:');

    const update = doc.calls.find(
      (call) => call.table === 'doctor_fee_earnings' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      status: 'posted',
      journal_entry_id: 'journal-1',
    });
    expect(update?.filters).toContainEqual(['in', ['id', [EARNING_A, EARNING_B]]]);
  });

  it('rejects posting without pending earnings', async () => {
    doc.handlers.set('doctor_fee_earnings', () => ({ data: [], error: null }));
    await expect(
      postDoctorCommissionsToLedger(
        BUSINESS_ID,
        [EARNING_A],
        'account-expense',
        'account-payable',
      ),
    ).rejects.toThrow('No pending doctor earnings selected.');
    expect(doc.rpcCalls).toHaveLength(0);
  });

  it('posts a payout journal after clearing the payable', async () => {
    doc.handlers.set('doctor_fee_earnings', (operation) =>
      operation === 'select'
        ? { data: [{ id: EARNING_A, earned_commission: 3_000, status: 'posted' }], error: null }
        : { data: null, error: null },
    );
    doc.rpc = { data: 'journal-2', error: null };

    const journalId = await postDoctorPayoutToLedger(
      BUSINESS_ID,
      [EARNING_A],
      'account-payable',
      'account-bank',
    );

    expect(journalId).toBe('journal-2');
    const args = doc.rpcCalls[0].args;
    expect(args.p_lines).toEqual([
      expect.objectContaining({ account_id: 'account-payable', debit: 3_000 }),
      expect.objectContaining({ account_id: 'account-bank', credit: 3_000 }),
    ]);
    expect(args.p_source_type).toBe('doctor_payout');
    const update = doc.calls.find(
      (call) => call.table === 'doctor_fee_earnings' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      status: 'paid',
      payout_journal_entry_id: 'journal-2',
    });
  });

  it('builders reject zero amounts and missing accounts', () => {
    expect(() => buildDoctorCommissionLines(0, 'a', 'b')).toThrow('no commission');
    expect(() => buildDoctorCommissionLines(100, '', 'b')).toThrow('expense and payable');
    expect(() => buildDoctorPayoutLines(100, 'a', '')).toThrow('payable and payment');
  });
});

describe('summaries', () => {
  it('totals pending, posted and paid commissions', () => {
    const summary = summarizeEarnings([
      {
        id: EARNING_A,
        business_id: BUSINESS_ID,
        doctor_id: DOCTOR_ID,
        visit_id: 'visit-1',
        consultation_amount: 0,
        lab_amount: 0,
        pharmacy_amount: 0,
        earned_commission: 100,
        status: 'pending',
        created_at: '',
      },
      {
        id: EARNING_B,
        business_id: BUSINESS_ID,
        doctor_id: DOCTOR_ID,
        visit_id: 'visit-2',
        consultation_amount: 0,
        lab_amount: 0,
        pharmacy_amount: 0,
        earned_commission: 200,
        status: 'posted',
        created_at: '',
      },
      {
        id: 'earning-c',
        business_id: BUSINESS_ID,
        doctor_id: DOCTOR_ID,
        visit_id: 'visit-3',
        consultation_amount: 0,
        lab_amount: 0,
        pharmacy_amount: 0,
        earned_commission: 300,
        status: 'paid',
        created_at: '',
      },
    ]);

    expect(summary).toMatchObject({
      pendingCount: 1,
      pendingAmount: 100,
      postedCount: 1,
      postedAmount: 200,
      paidCount: 1,
      paidAmount: 300,
    });
  });
});
