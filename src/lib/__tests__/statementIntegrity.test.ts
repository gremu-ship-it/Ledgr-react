/**
 * Tests for the pure statement-integrity check builders that replaced the
 * `auditFixedAssetsAndReconciliation() { return true; }` stub — a function
 * that claimed fixed-asset, bank-reconciliation and FX checks had been
 * implemented while verifying nothing.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBankReconciliationCheck,
  buildFixedAssetCheck,
  buildFxIntegrityCheck,
} from '../statementIntegrity';

describe('buildFixedAssetCheck', () => {
  it('passes when the register ties to the GL', () => {
    const check = buildFixedAssetCheck({
      glAssetCost: 100_000,
      glAccumulatedDepreciation: 10_000,
      registerAssetCost: 100_000,
      registerAccumulatedDepreciation: 10_000,
      registerAssetCount: 3,
    });
    expect(check.ok).toBe(true);
    expect(check.findings).toHaveLength(0);
  });

  it('fails when register depreciation diverges from the GL', () => {
    // A depreciation journal posted to the GL but recordDepreciation never
    // updated the register (or vice versa).
    const check = buildFixedAssetCheck({
      glAssetCost: 100_000,
      glAccumulatedDepreciation: 12_000,
      registerAssetCost: 100_000,
      registerAccumulatedDepreciation: 10_000,
      registerAssetCount: 3,
    });
    expect(check.ok).toBe(false);
    expect(check.findings.join(' ')).toContain('Accumulated depreciation');
    expect(check.findings.join(' ')).toContain('2000.00');
  });

  it('reports but does not fail a cost variance (legitimate after revaluation)', () => {
    const check = buildFixedAssetCheck({
      glAssetCost: 120_000, // GL carries a 20,000 revaluation uplift
      glAccumulatedDepreciation: 10_000,
      registerAssetCost: 100_000, // register stores uplift in revalued_amount
      registerAccumulatedDepreciation: 10_000,
      registerAssetCount: 3,
    });
    expect(check.ok).toBe(true);
    expect(check.summary).toContain('register cost differs');
    expect(check.findings.join(' ')).toContain('Asset cost');
  });
});

describe('buildBankReconciliationCheck', () => {
  it('passes when every bank account ties to its latest locked statement', () => {
    const check = buildBankReconciliationCheck([
      { accountCode: '1121', accountName: 'National Bank', glBalance: 50_000, statementDate: '2026-06-30', statementClosing: 50_000 },
    ]);
    expect(check.ok).toBe(true);
  });

  it('flags an unreconciled variance against the statement closing balance', () => {
    const check = buildBankReconciliationCheck([
      { accountCode: '1122', accountName: 'Standard Bank', glBalance: 52_500, statementDate: '2026-06-30', statementClosing: 50_000 },
    ]);
    expect(check.ok).toBe(false);
    expect(check.findings[0]).toContain('Standard Bank');
    expect(check.findings[0]).toContain('2500.00');
  });

  it('flags an account that has never been reconciled', () => {
    const check = buildBankReconciliationCheck([
      { accountCode: '1123', accountName: 'FDH Bank', glBalance: 10_000, statementDate: null, statementClosing: null },
    ]);
    expect(check.ok).toBe(false);
    expect(check.findings[0]).toContain('no locked bank statement');
  });
});

describe('buildFxIntegrityCheck', () => {
  const functionalCurrency = 'MWK';

  it('passes when all foreign lines carry a rate snapshot', () => {
    const check = buildFxIntegrityCheck({
      functionalCurrency,
      staleRateCount: 0,
      foreignLines: [
        { entryNumber: 'JNL-1', currency: 'USD', amountBase: 175_000, exchangeRate: 1750 },
      ],
    });
    expect(check.ok).toBe(true);
  });

  it('fails when a foreign line is missing its exchange-rate snapshot', () => {
    const check = buildFxIntegrityCheck({
      functionalCurrency,
      staleRateCount: 0,
      foreignLines: [
        { entryNumber: 'JNL-9', currency: 'USD', amountBase: 175_000, exchangeRate: null },
        { entryNumber: 'JNL-10', currency: 'ZAR', amountBase: 5_000, exchangeRate: 0 },
      ],
    });
    expect(check.ok).toBe(false);
    expect(check.summary).toContain('2 foreign-currency line(s)');
  });

  it('treats functional-currency lines as irrelevant and stale rates as informational', () => {
    const check = buildFxIntegrityCheck({
      functionalCurrency,
      staleRateCount: 1,
      foreignLines: [
        { entryNumber: 'JNL-2', currency: 'MWK', amountBase: 1_000, exchangeRate: null },
        { entryNumber: 'JNL-3', currency: 'USD', amountBase: 86_500, exchangeRate: 1730 },
      ],
    });
    expect(check.ok).toBe(true);
    expect(check.summary).toContain('stale rate');
  });
});
