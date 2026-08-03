/**
 * Golden structural tests for the seeded Chart of Accounts.
 *
 * This data is the foundation every posting service hard-codes account codes
 * against (journalService, inventoryJournalService, payroll): 1110 Cash,
 * 1131 Trade Debtors, 2114 GRNI, 4230/7300 FX gain/loss, etc. A bad edit —
 * duplicated code, dangling parent, group flipped to postable, normal balance
 * flipped — produces silently wrong postings in every business.
 *
 * These tests validate the template data itself: no database needed.
 */
import { describe, it, expect } from 'vitest';
import {
  getCoaTemplate,
  isDebitNature,
  isPostable,
  validateDebitCredit,
  type AccountSeed,
} from '@/services/seedChartOfAccounts';

const IFRS = getCoaTemplate('ifrs');
const GAAP = getCoaTemplate('gaap');

/** Codes every posting service dereferences — must exist, postable, in both templates. */
const SERVICE_CRITICAL_CODES = [
  '1110', // Cash on Hand
  '1131', // Trade Debtors
  '1135', // VAT Receivable (Input Tax)
  '1141', // Trading Stock
  '2111', // Trade Creditors
  '2114', // Goods Received Not Invoiced
  '2121', // VAT Payable (Output Tax)
  '2122', // PAYE Payable
  '2131', // Salaries & Wages Payable
  '4112', // Service Revenue
  '4230', // FX Gain (realised)
  '5100', // Cost of Goods Sold
  '5180', // Inventory Adjustments & Shrinkage
  '6110', // Basic Salaries
  '7300', // FX Loss (realised)
];

/**
 * Contra accounts legitimately carry a normal balance OPPOSITE to their
 * account type (e.g. Accumulated Depreciation is credit-normal under Assets).
 * Any entry outside this list whose normal balance doesn't match its type's
 * nature is a data error, not a contra account.
 */
const KNOWN_CONTRA_CODES = [
  '1134', // Provision for Bad Debts (contra-asset)
  '1520', '1521', '1522', '1523', '1524', '1525', // Accumulated Depreciation
  '1533', // Accum. Amortisation — Intangibles
  '1546', // Accum. Depr. — Right-of-Use (IFRS, template-restricted)
  '3140', // Drawings / Dividends Paid (contra-equity)
  '4120', '4130', // Sales Returns / Discounts (contra-revenue)
  '5170', // Purchase Returns & Allowances (contra-expense)
];

function byCode(seeds: AccountSeed[]): Map<string, AccountSeed> {
  return new Map(seeds.map((s) => [s.code, s]));
}

describe.each([
  ['ifrs', IFRS],
  ['gaap', GAAP],
] as const)('getCoaTemplate(%s) — structural integrity', (_name, seeds) => {
  it('has no duplicate account codes', () => {
    const codes = seeds.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has no duplicate code+name leaf accounts under the same parent', () => {
    const keys = seeds.map((s) => `${s.parent_code ?? 'ROOT'}|${s.code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every parent_code resolves to an account in the same template', () => {
    const map = byCode(seeds);
    for (const s of seeds) {
      if (!s.parent_code) continue;
      expect(map.has(s.parent_code), `${s.code} has dangling parent ${s.parent_code}`).toBe(true);
    }
  });

  it('every parent is a GROUP account (never post into a leaf as parent)', () => {
    const map = byCode(seeds);
    for (const s of seeds) {
      if (!s.parent_code) continue;
      const parent = map.get(s.parent_code)!;
      expect(parent.is_group, `${s.code} parents into non-group ${parent.code}`).toBe(true);
    }
  });

  it('parent and child share the same account_type', () => {
    const map = byCode(seeds);
    for (const s of seeds) {
      if (!s.parent_code) continue;
      const parent = map.get(s.parent_code)!;
      expect(
        parent.account_type,
        `${s.code} (${s.account_type}) sits under ${parent.code} (${parent.account_type})`,
      ).toBe(s.account_type);
    }
  });

  it('normal_balance matches account-type nature except documented contra accounts', () => {
    for (const s of seeds) {
      const natural = isDebitNature(s.account_type) ? 'debit' : 'credit';
      if (s.normal_balance === natural) continue;
      expect(
        KNOWN_CONTRA_CODES.includes(s.code),
        `${s.code} ${s.name} is ${s.normal_balance}-normal under ${s.account_type} ` +
        `but is not a registered contra account`,
      ).toBe(true);
    }
  });

  it('contains all service-critical accounts as postable (non-group) rows', () => {
    const map = byCode(seeds);
    for (const code of SERVICE_CRITICAL_CODES) {
      const acc = map.get(code);
      expect(acc, `critical account ${code} missing from template`).toBeDefined();
      expect(acc!.is_group, `critical account ${code} must be postable`).toBe(false);
    }
  });

  it('keeps template switch safety: no template-restricted row is is_system', () => {
    for (const s of seeds) {
      if (s.templates) {
        expect(s.is_system, `${s.code} is template-restricted AND is_system`).toBe(false);
      }
    }
  });

  it('GRNI (2114) stays a system liability — warehouse receipts depend on it', () => {
    const grni = byCode(seeds).get('2114');
    expect(grni).toMatchObject({ is_system: true, account_type: 'liability', normal_balance: 'credit' });
  });
});

describe('getCoaTemplate — template behaviour', () => {
  it('gaap (default) contains only unrestricted accounts', () => {
    const restricted = GAAP.filter((s) => s.templates != null);
    expect(restricted).toEqual([]);
  });

  it('ifrs is a superset of the unrestricted accounts', () => {
    const ifrsCodes = new Set(IFRS.map((s) => s.code));
    for (const s of GAAP) {
      expect(ifrsCodes.has(s.code), `${s.code} missing from ifrs template`).toBe(true);
    }
  });

  it('ifrs adds its documented IFRS-only accounts (IFRS 16 leases, share premium)', () => {
    const ifrsOnly = IFRS.filter((s) => s.templates?.includes('ifrs')).map((s) => s.code);
    expect(ifrsOnly).toEqual(expect.arrayContaining(['1545', '1546', '2145', '2515', '3105']));
  });
});

describe('validation helpers', () => {
  it('isDebitNature: assets and expenses are debit-natured', () => {
    expect(isDebitNature('asset')).toBe(true);
    expect(isDebitNature('expense')).toBe(true);
    expect(isDebitNature('liability')).toBe(false);
    expect(isDebitNature('equity')).toBe(false);
    expect(isDebitNature('income')).toBe(false);
  });

  it('isPostable only allows non-group accounts', () => {
    expect(isPostable({ is_group: false })).toBe(true);
    expect(isPostable({ is_group: true })).toBe(false);
  });

  it('validateDebitCredit warns on against-nature postings but never blocks', () => {
    expect(validateDebitCredit('income', true).warning).toMatch(/against natural balance/i);
    expect(validateDebitCredit('income', false)).toEqual({ valid: true, warning: null });
    expect(validateDebitCredit('asset', true)).toEqual({ valid: true, warning: null });
  });
});
