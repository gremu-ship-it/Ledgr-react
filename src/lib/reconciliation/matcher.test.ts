import { describe, expect, it } from 'vitest';
import { autoMatch, type BankStatementMatchLine, type GlMatchLine } from './matcher';

const bankLine = (overrides: Partial<BankStatementMatchLine> = {}): BankStatementMatchLine => ({
  id: 'bank-1', transaction_date: '2026-01-15', description: 'Customer payment', reference: 'INV-001', amount: 100,
  ...overrides,
});
const glLine = (overrides: Partial<GlMatchLine> = {}): GlMatchLine => ({
  id: 'gl-1', entry_date: '2026-01-15', description: 'Payment INV-001', entry_number: 'JE-001', is_debit: true, amount: 100,
  ...overrides,
});

describe('autoMatch', () => {
  it('assigns 100% confidence to exact amount, date, and reference matches', () => {
    const result = autoMatch([bankLine()], [glLine({ entry_number: 'INV-001-JE' })]);
    expect(result.matches).toEqual([{ bankLineId: 'bank-1', glLineId: 'gl-1', amount: 100, confidence: 100, reason: 'exact' }]);
  });

  it('matches equal amounts within the configured date tolerance at 90%', () => {
    const result = autoMatch([bankLine({ reference: null })], [glLine({ entry_date: '2026-01-18', description: 'Unrelated', entry_number: 'JE-009' })]);
    expect(result.matches[0]).toMatchObject({ confidence: 90, reason: 'amount_date' });
    expect(autoMatch([bankLine({ reference: null })], [glLine({ entry_date: '2026-01-19', description: 'Unrelated' })]).matches[0]).toMatchObject({ confidence: 60, reason: 'amount_unique' });
  });

  it('uses reference similarity when dates are too far apart at 80%', () => {
    const result = autoMatch([bankLine()], [glLine({ entry_date: '2026-02-20', description: 'Supplier invoice INV-001', entry_number: 'JE-009' })]);
    expect(result.matches[0]).toMatchObject({ confidence: 80, reason: 'amount_ref' });
  });

  it('uses a unique amount-only match at 60%', () => {
    const result = autoMatch([bankLine({ reference: null })], [glLine({ entry_date: '2026-02-20', description: 'Unrelated', entry_number: 'JE-009' })]);
    expect(result.matches[0]).toMatchObject({ confidence: 60, reason: 'amount_unique' });
  });

  it('does not auto-match duplicate amounts that are ambiguous on either side', () => {
    const result = autoMatch(
      [bankLine({ id: 'b1', reference: null }), bankLine({ id: 'b2', reference: null })],
      [glLine({ id: 'g1', entry_date: '2026-02-20', description: 'Other', entry_number: 'JE-001' }), glLine({ id: 'g2', entry_date: '2026-02-20', description: 'Other', entry_number: 'JE-002' })],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedBank).toEqual(['b1', 'b2']);
    expect(result.unmatchedGl).toEqual(['g1', 'g2']);
  });

  it('suggests multi-line groups without auto-matching them', () => {
    const result = autoMatch(
      [bankLine({ reference: null })],
      [glLine({ id: 'g60', amount: 60, description: 'Part A', entry_number: 'JE-A' }), glLine({ id: 'g40', amount: 40, description: 'Part B', entry_number: 'JE-B' })],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.suggestedGroups).toEqual([{ bankLineId: 'bank-1', glLineIds: ['g60', 'g40'], bankAmount: 100, glTotal: 100 }]);
  });

  it('handles empty inputs and excludes fully matched lines', () => {
    expect(autoMatch([], []).matches).toEqual([]);
    const result = autoMatch([bankLine({ matchedAmount: 100 })], [glLine({ matchedAmount: 100 })]);
    expect(result).toMatchObject({ matches: [], unmatchedBank: [], unmatchedGl: [], suggestedGroups: [] });
  });

  it('matches withdrawals only to GL credits and uses remaining amounts for partial matches', () => {
    const result = autoMatch(
      [bankLine({ amount: -100, matchedAmount: 40, reference: null })],
      [glLine({ amount: 100, is_debit: false, matchedAmount: 40, entry_date: '2026-02-20', description: 'Other' })],
    );
    expect(result.matches[0]).toMatchObject({ amount: 60, confidence: 60, reason: 'amount_unique' });
    expect(autoMatch([bankLine({ amount: -100 })], [glLine({ amount: 100, is_debit: true })]).matches).toHaveLength(0);
  });
});
