import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsuranceClaim } from '@/types/healthcare';

const ins = vi.hoisted(() => ({
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
      ins.calls.push({ table, operation, values, filters });
      const handler = ins.handlers.get(table);
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
      delete: () => {
        operation = 'delete';
        return builder;
      },
      eq: passthrough('eq'),
      in: passthrough('in'),
      like: passthrough('like'),
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
        ins.rpcCalls.push({ name, args });
        return Promise.resolve(ins.rpc);
      },
    },
  };
});

const {
  CLAIM_CSV_HEADERS,
  applyCopayCap,
  buildClaimSettlementLines,
  buildClaimsCsv,
  calculateSplitBill,
  createClaimForVisit,
  createInsuranceProvider,
  generateClaimNumber,
  getInsuranceProviders,
  settleInsuranceClaim,
} = await import('../insuranceService');

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';

function claim(overrides: Partial<InsuranceClaim> = {}): InsuranceClaim {
  return {
    id: CLAIM_ID,
    business_id: BUSINESS_ID,
    visit_id: 'visit-1',
    patient_id: 'patient-1',
    provider_id: 'provider-1',
    claim_number: 'CLM-2026-0001',
    total_bill_amount: 10_000,
    patient_copay_amount: 1_000,
    insurer_claim_amount: 9_000,
    approved_amount: 0,
    settled_amount: 0,
    disallowance_amount: 0,
    status: 'submitted',
    submission_date: '2026-11-20',
    created_at: '2026-11-20T08:00:00Z',
    updated_at: '2026-11-20T08:00:00Z',
    provider: {
      id: 'provider-1',
      business_id: BUSINESS_ID,
      name: 'NICO General',
      default_copay_percent: 10,
      credit_period_days: 30,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
    patient: { first_name: 'Tadala', last_name: 'Banda', mrn: 'PAT-2026-0001' },
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  ins.handlers.clear();
  ins.calls.length = 0;
  ins.rpcCalls.length = 0;
  ins.rpc = { data: null, error: null };
});

describe('split-billing math', () => {
  it('splits each line by the co-pay percentage with cent rounding', () => {
    const result = calculateSplitBill(
      [
        { category: 'consultation', description: 'Consultation', amount: 15_000 },
        { category: 'laboratory', description: 'FBC', amount: 8_000 },
        { category: 'medication', description: 'Amoxicillin', amount: 2_000.5 },
      ],
      10,
    );

    expect(result.totalGross).toBe(25_000.5);
    expect(result.patientCopay).toBe(2_500.05);
    expect(result.insurerClaim).toBe(22_500.45);
    expect(result.items[0]).toMatchObject({ patientShare: 1_500, insurerShare: 13_500 });
    expect(result.items[2]).toMatchObject({ patientShare: 200.05, insurerShare: 1_800.45 });
  });

  it('caps the patient co-pay and assigns the balance to the insurer', () => {
    const result = calculateSplitBill(
      [{ category: 'procedure', description: 'Minor surgery', amount: 100_000 }],
      20,
      12_000,
    );

    expect(result.patientCopay).toBe(12_000);
    expect(result.insurerClaim).toBe(88_000);
    expect(result.totalGross).toBe(100_000);
  });

  it('spreads a cap across the lines without changing gross or insurer totals', () => {
    const raw = calculateSplitBill(
      [
        { category: 'consultation', description: 'Consultation', amount: 40_000 },
        { category: 'laboratory', description: 'Labs', amount: 60_000 },
      ],
      20,
    );
    const capped = applyCopayCap(raw, 15_000);

    expect(capped.patientCopay).toBe(15_000);
    expect(capped.insurerClaim).toBe(85_000);
    expect(capped.items.reduce((sum, item) => sum + item.patientShare, 0)).toBe(15_000);
    expect(capped.items.reduce((sum, item) => sum + item.insurerShare, 0)).toBe(85_000);
    expect(capped.items.every((item) => Math.abs(item.patientShare + item.insurerShare - item.grossAmount) < 0.01)).toBe(true);
  });

  it('applies an HMO bed cap and charges the room-upgrade differential to the patient', () => {
    const result = calculateSplitBill(
      [
        {
          category: 'accommodation',
          description: 'Bed stay: Private Wing - Bed 9 (2 nights)',
          amount: 240_000,
          quantity: 2,
          unitPrice: 120_000,
        },
      ],
      10,
      undefined,
      { accommodationDailyCap: 80_000, roomUpgradeChargeToPatient: true },
    );

    expect(result.totalGross).toBe(240_000);
    expect(result.items[0].patientShare).toBe(96_000);
    expect(result.items[0].insurerShare).toBe(144_000);
  });

  it('clamps nonsensical percentages', () => {
    const over = calculateSplitBill(
      [{ category: 'other', description: 'Misc', amount: 500 }],
      150,
    );
    const under = calculateSplitBill(
      [{ category: 'other', description: 'Misc', amount: 500 }],
      -20,
    );
    expect(over.patientCopay).toBe(500);
    expect(under.patientCopay).toBe(0);
  });
});

describe('claim numbering and directory', () => {
  it('continues the CLM-YYYY-NNNN sequence for the year', async () => {
    const year = new Date().getFullYear();
    ins.handlers.set('insurance_claims', () => ({
      data: [{ claim_number: `CLM-${year}-0041` }],
      error: null,
    }));

    await expect(generateClaimNumber(BUSINESS_ID)).resolves.toBe(`CLM-${year}-0042`);
    const query = ins.calls.find((call) => call.table === 'insurance_claims');
    expect(query?.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(query?.filters).toContainEqual(['like', ['claim_number', `CLM-${year}-%`]]);
  });

  it('starts at 0001 when the business has no claim this year', async () => {
    const year = new Date().getFullYear();
    ins.handlers.set('insurance_claims', () => ({ data: [], error: null }));
    await expect(generateClaimNumber(BUSINESS_ID)).resolves.toBe(`CLM-${year}-0001`);
  });

  it('creates a provider with tenant scope and normalised numerics', async () => {
    ins.handlers.set('insurance_providers', (operation) =>
      operation === 'insert'
        ? {
            data: {
              id: 'provider-1',
              business_id: BUSINESS_ID,
              name: 'NICO General',
              default_copay_percent: '15.50',
              credit_period_days: '45',
              is_active: true,
              created_at: '',
              updated_at: '',
            },
            error: null,
          }
        : { data: [], error: null },
    );

    const provider = await createInsuranceProvider(BUSINESS_ID, {
      name: 'NICO General',
      payer_code: 'NICO',
      contact_person: null,
      contact_email: null,
      contact_phone: null,
      billing_address: null,
      default_copay_percent: 15.5,
      credit_period_days: 45,
      receivable_account_id: null,
      settlement_account_id: null,
      write_off_account_id: null,
      is_active: true,
    });

    expect(provider).toMatchObject({
      id: 'provider-1',
      default_copay_percent: 15.5,
      credit_period_days: 45,
    });
    const insert = ins.calls.find(
      (call) => call.table === 'insurance_providers' && call.operation === 'insert',
    );
    expect(insert?.values).toMatchObject({
      business_id: BUSINESS_ID,
      name: 'NICO General',
    });
  });

  it('lists providers alphabetically within the tenant', async () => {
    ins.handlers.set('insurance_providers', () => ({
      data: [
        {
          id: 'provider-1',
          business_id: BUSINESS_ID,
          name: 'NICO General',
          default_copay_percent: '10',
          credit_period_days: 30,
          is_active: true,
          created_at: '',
          updated_at: '',
        },
      ],
      error: null,
    }));

    const providers = await getInsuranceProviders(BUSINESS_ID);
    expect(providers).toHaveLength(1);
    expect(providers[0].default_copay_percent).toBe(10);
    const call = ins.calls.find((item) => item.table === 'insurance_providers');
    expect(call?.filters).toContainEqual(['order', ['name', { ascending: true }]]);
  });
});

describe('claims lifecycle', () => {
  it('creates a submitted claim and its line breakdown', async () => {
    const year = new Date().getFullYear();
    ins.handlers.set('insurance_claims', (operation) => {
      if (operation === 'select') return { data: [], error: null };
      return {
        data: {
          id: CLAIM_ID,
          business_id: BUSINESS_ID,
          visit_id: 'visit-1',
          patient_id: 'patient-1',
          provider_id: 'provider-1',
          claim_number: `CLM-${year}-0001`,
          total_bill_amount: 10_000,
          patient_copay_amount: 1_000,
          insurer_claim_amount: 9_000,
          status: 'submitted',
          created_at: '',
          updated_at: '',
        },
        error: null,
      };
    });
    ins.handlers.set('insurance_claim_items', () => ({ data: null, error: null }));

    const result = await createClaimForVisit(BUSINESS_ID, {
      visitId: 'visit-1',
      patientId: 'patient-1',
      providerId: 'provider-1',
      policyNumber: 'POL-1',
      memberId: 'MEM-1',
      splitBreakdown: calculateSplitBill(
        [{ category: 'consultation', description: 'Consultation', amount: 10_000 }],
        10,
      ),
    });

    expect(result.claim_number).toBe(`CLM-${year}-0001`);
    expect(result.status).toBe('submitted');

    const header = ins.calls.find(
      (call) => call.table === 'insurance_claims' && call.operation === 'insert',
    );
    expect(header?.values).toMatchObject({
      business_id: BUSINESS_ID,
      visit_id: 'visit-1',
      patient_id: 'patient-1',
      provider_id: 'provider-1',
      policy_number: 'POL-1',
      member_id: 'MEM-1',
      total_bill_amount: 10_000,
      patient_copay_amount: 1_000,
      insurer_claim_amount: 9_000,
      status: 'submitted',
    });
    expect(header?.values).toHaveProperty('submission_date');

    const lines = ins.calls.find((call) => call.table === 'insurance_claim_items');
    expect(lines?.values).toEqual([
      expect.objectContaining({
        business_id: BUSINESS_ID,
        claim_id: CLAIM_ID,
        service_category: 'consultation',
        gross_amount: 10_000,
        patient_share: 1_000,
        insurer_share: 9_000,
      }),
    ]);
  });

  it('settles a shortfall and records the disallowance', async () => {
    ins.handlers.set('insurance_claims', (operation) =>
      operation === 'select' ? { data: claim(), error: null } : { data: null, error: null },
    );

    await settleInsuranceClaim(BUSINESS_ID, CLAIM_ID, {
      settledAmount: 8_000,
      remittanceReference: 'EFT-7788',
      disallowanceReason: 'Tariff adjustment',
    });

    const update = ins.calls.find(
      (call) => call.table === 'insurance_claims' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      settled_amount: 8_000,
      approved_amount: 8_000,
      disallowance_amount: 1_000,
      remittance_reference: 'EFT-7788',
      rejection_reason: 'Tariff adjustment',
      status: 'settled',
    });
    expect(update?.values).toHaveProperty('settlement_date');
    expect(ins.rpcCalls).toHaveLength(0);
  });

  it('posts a balanced settlement journal when accounts are supplied', async () => {
    ins.handlers.set('insurance_claims', (operation) =>
      operation === 'select' ? { data: claim(), error: null } : { data: null, error: null },
    );
    ins.rpc = { data: 'journal-1', error: null };

    await settleInsuranceClaim(BUSINESS_ID, CLAIM_ID, {
      settledAmount: 8_500,
      remittanceReference: 'EFT-9911',
      disallowanceReason: 'Contractual discount',
      journal: {
        receivableAccountId: 'account-ar',
        depositAccountId: 'account-bank',
        writeOffAccountId: 'account-writeoff',
      },
    });

    expect(ins.rpcCalls).toHaveLength(1);
    expect(ins.rpcCalls[0].name).toBe('post_financial_journal');
    const lines = ins.rpcCalls[0].args.p_lines as Array<{
      debit: number;
      credit: number;
    }>;
    expect(lines).toHaveLength(3);
    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(9_000);
    expect(lines.reduce((sum, line) => sum + line.credit, 0)).toBe(9_000);
    expect(ins.rpcCalls[0].args.p_posting_key).toBe(
      `insurance-claim-settlement:${CLAIM_ID}`,
    );
    const update = ins.calls.find(
      (call) => call.table === 'insurance_claims' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      settlement_journal_entry_id: 'journal-1',
      disallowance_amount: 500,
    });
  });

  it('refuses an overpayment before posting anything', async () => {
    ins.handlers.set('insurance_claims', () => ({ data: claim(), error: null }));
    await expect(
      settleInsuranceClaim(BUSINESS_ID, CLAIM_ID, {
        settledAmount: 9_500,
        remittanceReference: 'EFT-1',
      }),
    ).rejects.toThrow('cannot exceed');
    expect(ins.rpcCalls).toHaveLength(0);
  });

  it('rejects a settlement without a remittance reference', async () => {
    ins.handlers.set('insurance_claims', () => ({ data: claim(), error: null }));
    await expect(
      settleInsuranceClaim(BUSINESS_ID, CLAIM_ID, {
        settledAmount: 9_000,
        remittanceReference: '   ',
      }),
    ).rejects.toThrow('remittance reference');
  });
});

describe('settlement journals and CSV export', () => {
  it('builds debits that equal the insurer claim credit', () => {
    const lines = buildClaimSettlementLines({
      insurerClaimAmount: 9_000,
      settledAmount: 8_000,
      disallowanceAmount: 1_000,
      claimNumber: 'CLM-2026-0001',
      receivableAccountId: 'account-ar',
      depositAccountId: 'account-bank',
      writeOffAccountId: 'account-writeoff',
    });

    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(9_000);
    expect(lines.reduce((sum, line) => sum + line.credit, 0)).toBe(9_000);
    expect(lines.map((line) => line.account_id)).toEqual([
      'account-bank',
      'account-writeoff',
      'account-ar',
    ]);
  });

  it('omits the bank or write-off line when that amount is zero', () => {
    const lines = buildClaimSettlementLines({
      insurerClaimAmount: 5_000,
      settledAmount: 5_000,
      disallowanceAmount: 0,
      claimNumber: 'CLM-2026-0002',
      receivableAccountId: 'account-ar',
      depositAccountId: 'account-bank',
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ account_id: 'account-bank', debit: 5_000 });
    expect(lines[1]).toMatchObject({ account_id: 'account-ar', credit: 5_000 });
  });

  it('exports claim rows with escaped names and stable money columns', () => {
    const csv = buildClaimsCsv([
      claim({
        claim_number: 'CLM-2026-0007',
        provider: { ...claim().provider!, name: 'NICO, General' },
        patient: { first_name: 'Ta"dala', last_name: 'Banda', mrn: 'PAT-2026-0001' },
        settled_amount: 8_000,
        disallowance_amount: 1_000,
        status: 'settled',
      }),
    ]);
    const [header, row] = csv.split('\n');

    expect(header).toBe(CLAIM_CSV_HEADERS.join(','));
    expect(row).toContain('"Ta""dala Banda"');
    expect(row).toContain('"NICO, General"');
    expect(row).toContain('10000.00,1000.00,9000.00,8000.00,SETTLED');
  });
});
