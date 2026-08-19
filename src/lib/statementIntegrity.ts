/**
 * Statement-integrity checks backing
 * FinancialStatementRepository.auditStatementIntegrity().
 *
 * These replace the old `auditFixedAssetsAndReconciliation() { return true; }`
 * stub, which claimed to check fixed-asset depreciation, bank reconciliation
 * and multi-currency FX gaps but verified nothing. Each builder here is a
 * pure function over already-fetched rows so it can be unit-tested without a
 * database (same pattern as inventoryValuation.ts).
 *
 * Tolerances follow the MWK rounding tolerance used by the statements (0.01).
 */

export const INTEGRITY_TOLERANCE = 0.01;
const MAX_SAMPLES = 5;

export interface IntegrityCheck {
  /** Short machine-stable key, e.g. 'fixed-assets', 'bank-reconciliation', 'fx'. */
  key: 'fixed-assets' | 'bank-reconciliation' | 'fx';
  ok: boolean;
  /** One-line human summary, e.g. "Asset register ties to GL (variance MWK 0.00)." */
  summary: string;
  /** Up to MAX_SAMPLES detailed findings for the failed/warned case. */
  findings: string[];
}

const money = (n: number) => n.toFixed(2);

// ── Fixed assets ──────────────────────────────────────────────────────────────

export interface FixedAssetCheckInput {
  /** GL balance of debit-normal fixed_asset accounts (statement side). */
  glAssetCost: number;
  /** GL balance of credit-normal fixed_asset contra accounts, as an absolute. */
  glAccumulatedDepreciation: number;
  /** Asset register Σ acquisition_cost, non-disposed assets. */
  registerAssetCost: number;
  /** Asset register Σ accumulated_depreciation, non-disposed assets. */
  registerAccumulatedDepreciation: number;
  /** Number of non-disposed assets in the register. */
  registerAssetCount: number;
}

/**
 * Ties the fixed-asset register to the general ledger. Accumulated
 * depreciation must match exactly (recordDepreciation keeps the register in
 * lock-step with every posted depreciation journal, and disposals remove the
 * accumulated amount from both). Cost can legitimately differ after a
 * revaluation: the GL is debited for the uplift while the register stores it
 * in `revalued_amount`, so cost variance is reported as a finding, not a
 * failure.
 */
export function buildFixedAssetCheck(input: FixedAssetCheckInput): IntegrityCheck {
  const findings: string[] = [];

  const depVariance = input.registerAccumulatedDepreciation - input.glAccumulatedDepreciation;
  if (Math.abs(depVariance) > INTEGRITY_TOLERANCE) {
    findings.push(
      `Accumulated depreciation: register ${money(input.registerAccumulatedDepreciation)} vs ` +
      `GL ${money(input.glAccumulatedDepreciation)} (variance ${money(depVariance)}). ` +
      `A depreciation run may have posted to the GL without updating the register, or vice versa.`,
    );
  }

  const costVariance = input.registerAssetCost - input.glAssetCost;
  if (Math.abs(costVariance) > INTEGRITY_TOLERANCE) {
    findings.push(
      `Asset cost: register ${money(input.registerAssetCost)} vs GL ${money(input.glAssetCost)} ` +
      `(variance ${money(costVariance)}). Expected to differ by any revaluation uplift; ` +
      `otherwise an asset was capitalised outside the register.`,
    );
  }

  // A cost variance can be legitimate after revaluation, so it remains a
  // warning rather than changing `ok`. It must not, however, be described as
  // a clean tie: the report UI surfaces checks with findings as well as hard
  // failures so missing capitalisation is visible to the reviewer.
  const depreciationTies = Math.abs(depVariance) <= INTEGRITY_TOLERANCE;
  const costTies = Math.abs(costVariance) <= INTEGRITY_TOLERANCE;
  return {
    key: 'fixed-assets',
    ok: depreciationTies,
    summary: !depreciationTies
      ? 'Fixed-asset register does not tie to the general ledger.'
      : !costTies
        ? 'Fixed-asset depreciation ties, but register cost differs from the general ledger.'
        : `Fixed-asset register ties to GL across ${input.registerAssetCount} asset(s).`,
    findings,
  };
}

// ── Bank reconciliation ───────────────────────────────────────────────────────

export interface BankAccountVariance {
  accountCode: string;
  accountName: string;
  /** GL balance of the bank account as at the latest locked statement date. */
  glBalance: number;
  statementDate: string | null;
  /** Closing balance on the latest locked imported statement, if any. */
  statementClosing: number | null;
}

/**
 * Compares each bank account's GL balance with the closing balance on its
 * latest locked bank statement. A variance is not automatically an error —
 * genuine unreconciled items exist — but it is exactly the "bank variance"
 * the old audit comment claimed was included, so it is surfaced per account.
 * Accounts with no locked statement are flagged as unreconciled.
 */
export function buildBankReconciliationCheck(rows: BankAccountVariance[]): IntegrityCheck {
  const findings: string[] = [];
  let ok = true;

  for (const row of rows) {
    if (row.statementDate === null || row.statementClosing === null) {
      ok = false;
      findings.push(`${row.accountCode} ${row.accountName}: no locked bank statement on file — never reconciled.`);
      continue;
    }
    const variance = row.glBalance - row.statementClosing;
    if (Math.abs(variance) > INTEGRITY_TOLERANCE) {
      ok = false;
      findings.push(
        `${row.accountCode} ${row.accountName}: GL ${money(row.glBalance)} vs statement ` +
        `${money(row.statementClosing)} as at ${row.statementDate} — unreconciled variance ${money(variance)}.`,
      );
    }
  }

  return {
    key: 'bank-reconciliation',
    ok,
    summary: ok
      ? `All ${rows.length} bank account(s) tie to their latest locked statement.`
      : 'Bank GL balances differ from the latest locked statements, or accounts were never reconciled.',
    findings: findings.slice(0, MAX_SAMPLES),
  };
}

// ── FX integrity ──────────────────────────────────────────────────────────────

export interface FxLineSample {
  entryNumber: string | null;
  currency: string;
  amountBase: number;
  exchangeRate: number | null;
}

export interface FxCheckInput {
  functionalCurrency: string;
  /** Posted/reversed journal lines in a currency other than functional. */
  foreignLines: FxLineSample[];
  /** Count of foreign-currency lines flagged rate_is_stale (informational). */
  staleRateCount: number;
}

/**
 * FX gap checks for the functional-currency statements:
 *  - every posted foreign-currency line must carry a rate snapshot
 *    (exchange_rate > 0); a missing one means amount_base cannot be trusted;
 *  - stale cached rates (rate_is_stale) are reported so a reviewer knows
 *    which figures rest on out-of-date rates.
 */
export function buildFxIntegrityCheck(input: FxCheckInput): IntegrityCheck {
  const { functionalCurrency, foreignLines, staleRateCount } = input;
  const findings: string[] = [];

  const missingRate = foreignLines.filter(
    (l) => l.currency.toUpperCase() !== functionalCurrency.toUpperCase()
      && (l.exchangeRate === null || !(l.exchangeRate > 0)),
  );

  for (const line of missingRate.slice(0, MAX_SAMPLES)) {
    findings.push(
      `${line.entryNumber ?? 'entry'}: ${line.currency} line has no rate snapshot — ` +
      `functional amount ${money(line.amountBase)} is unverifiable. Re-enter the rate.`,
    );
  }
  if (missingRate.length > MAX_SAMPLES) {
    findings.push(`…and ${missingRate.length - MAX_SAMPLES} more line(s) missing a rate snapshot.`);
  }

  if (staleRateCount > 0) {
    findings.push(
      `${staleRateCount} foreign-currency line(s) used a stale cached rate ` +
      `(transaction saved while live rates were unavailable). Amounts are indicative.`,
    );
  }

  const ok = missingRate.length === 0;
  return {
    key: 'fx',
    ok,
    summary: ok
      ? staleRateCount > 0
        ? `All ${foreignLines.length} foreign-currency line(s) carry a rate snapshot; ${staleRateCount} used a stale rate.`
        : `All ${foreignLines.length} foreign-currency line(s) carry a rate snapshot.`
      : `${missingRate.length} foreign-currency line(s) are missing their exchange-rate snapshot.`,
    findings,
  };
}
