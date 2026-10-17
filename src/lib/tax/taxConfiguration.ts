/**
 * Effective-dated tax configuration — the read contract for a business's rates.
 *
 * WHY THIS EXISTS
 * public.tax_configurations stores dated periods per (business, tax_code). Before
 * migration 20261022000000 nothing kept two periods apart, and every reader went
 * through TaxRepository.findByCode → maybeSingle(), so an ambiguous schedule did
 * not surface as "two rates" — it surfaced as a lost rate. The database now
 * refuses overlapping periods; this module resolves ONE rate for ONE date from
 * the rows the caller can see, and refuses to answer when it cannot.
 *
 * WHAT IT WILL NOT DO
 *   * It never infers a rate. A date with no stored period resolves to
 *     `unsupported` unless a rate for that date is evidenced in the product
 *     (today that is only the 17.5% standard VAT rate from 1 January 2026), and
 *     the starting date of the 16.5% period is NOT evidenced, so the 16.5%
 *     figure is never applied to anything.
 *   * It never picks one of two conflicting periods: that is `ambiguous`.
 *   * It never computes a tax amount for a stored document. Documents are valued
 *     from the tax amount they record.
 *
 * Stored rates are PERCENTAGES (17.5, 10, 30 — the convention in
 * tax_configurations.rate, expense_lines.tax_rate and the demo dataset). The
 * result therefore carries both `ratePercent` and `rateFraction` explicitly, so
 * no caller has to guess which one a bare number is.
 *
 * `describeTaxConfigurationFailure` is the companion feedback layer: it turns the
 * two refusals the constraints raise (and an authority denial) into something a
 * person can act on. The raw server message is always preserved.
 */
import {
  VAT_STANDARD_RATE_EFFECTIVE_FROM,
  VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
  VAT_STANDARD_RATE_PERCENT,
} from '@/lib/vat';

/** The subset of a tax_configurations row this module needs. */
export interface TaxRatePeriod {
  id: string;
  tax_code: string;
  name?: string | null;
  rate: number | string;
  is_active: boolean;
  /** 'YYYY-MM-DD' */
  effective_from: string;
  /** 'YYYY-MM-DD', or null for an open-ended period ("until superseded"). */
  effective_to: string | null;
  /** The reference the rate relies on. Null only on grandfathered rows. */
  mra_reference: string | null;
}

/** A rate the product itself evidences (not a business's configuration). */
export interface SupportedRate {
  taxCode: string;
  ratePercent: number;
  effectiveFrom: string;
  evidenceReference: string;
}

export const SUPPORTED_TAX_RATES: readonly SupportedRate[] = [
  {
    taxCode: 'vat_standard',
    ratePercent: VAT_STANDARD_RATE_PERCENT,
    effectiveFrom: VAT_STANDARD_RATE_EFFECTIVE_FROM,
    evidenceReference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
  },
];

export function supportedRateFor(taxCode: string): SupportedRate | null {
  return SUPPORTED_TAX_RATES.find((rate) => rate.taxCode === taxCode) ?? null;
}

const toPercent = (rate: number | string): number => Number(rate);
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Half-open coverage: [effective_from, effective_to]. An open end covers everything after the start. */
export function periodCoversDate(period: TaxRatePeriod, asOf: string): boolean {
  if (asOf < period.effective_from) return false;
  return period.effective_to === null || asOf <= period.effective_to;
}

export type PeriodCoverage = 'in_effect' | 'scheduled' | 'ended' | 'inactive';

/** Display-only description of where a stored period sits relative to a date. */
export function describePeriodCoverage(period: TaxRatePeriod, asOf: string): PeriodCoverage {
  if (!period.is_active) return 'inactive';
  if (asOf < period.effective_from) return 'scheduled';
  if (period.effective_to !== null && asOf > period.effective_to) return 'ended';
  return 'in_effect';
}

export type TaxRateResolution =
  | {
      status: 'configured';
      taxCode: string;
      asOf: string;
      /** The rate the business recorded for this date. */
      ratePercent: number;
      rateFraction: number;
      evidenceReference: string | null;
      period: TaxRatePeriod;
    }
  | {
      status: 'supported_default';
      taxCode: string;
      asOf: string;
      /** The evidenced rate for this date in the product; nothing is stored for it. */
      ratePercent: number;
      rateFraction: number;
      evidenceReference: string;
      supportedFrom: string;
    }
  | {
      status: 'unsupported';
      taxCode: string;
      asOf: string;
      reason: 'no-period-for-date';
      /** The date from which the product does evidence a rate, when it has one. */
      supportedFrom: string | null;
    }
  | {
      status: 'ambiguous';
      taxCode: string;
      asOf: string;
      /** Every active period covering the date — the caller must not choose one. */
      periods: TaxRatePeriod[];
    };

/**
 * Resolve the rate that applies to `asOf` for one tax code.
 *
 * `periods` may be any set of stored rows; only active, date-covering rows of the
 * requested code are considered. Two or more covering rows is `ambiguous` (the
 * database refuses that state from 20261022000000 on, so this is defensiveness
 * against a schedule stored before the constraint existed, or read through a
 * client that has not seen it).
 */
export function resolveTaxRate(
  periods: readonly TaxRatePeriod[],
  taxCode: string,
  asOf: string,
): TaxRateResolution {
  const covering = periods.filter(
    (period) => period.tax_code === taxCode && period.is_active && periodCoversDate(period, asOf),
  );
  if (covering.length > 1) return { status: 'ambiguous', taxCode, asOf, periods: covering };
  if (covering.length === 1) {
    const ratePercent = toPercent(covering[0].rate);
    return {
      status: 'configured',
      taxCode,
      asOf,
      ratePercent,
      rateFraction: round2(ratePercent) / 100,
      evidenceReference: covering[0].mra_reference,
      period: covering[0],
    };
  }
  const supported = supportedRateFor(taxCode);
  if (supported && asOf >= supported.effectiveFrom) {
    return {
      status: 'supported_default',
      taxCode,
      asOf,
      ratePercent: supported.ratePercent,
      rateFraction: round2(supported.ratePercent) / 100,
      evidenceReference: supported.evidenceReference,
      supportedFrom: supported.effectiveFrom,
    };
  }
  return {
    status: 'unsupported',
    taxCode,
    asOf,
    reason: 'no-period-for-date',
    supportedFrom: supported?.effectiveFrom ?? null,
  };
}

/** One sentence a person can read, without implying anything the resolver did not decide. */
export function explainTaxRateResolution(resolution: TaxRateResolution): string {
  switch (resolution.status) {
    case 'configured':
      return `This business's own rate for ${resolution.taxCode} on ${resolution.asOf} is ${formatRatePercent(resolution.ratePercent)}.`;
    case 'supported_default':
      return `No rate is configured for this business on ${resolution.asOf}. The evidenced standard rate from ${resolution.supportedFrom} is ${formatRatePercent(resolution.ratePercent)}.`;
    case 'ambiguous':
      return `Two or more of this business's periods for ${resolution.taxCode} cover ${resolution.asOf}, so no single rate can be resolved. The server refuses to choose: close one period where the next one starts and delete any duplicate row.`;
    case 'unsupported':
      return resolution.supportedFrom
        ? `No rate is configured for this business on ${resolution.asOf}, and the product has no evidenced rate before ${resolution.supportedFrom}. Record the period and the reference you are relying on, or value the document from the tax amount it states.`
        : `No rate is configured for this business on ${resolution.asOf}, and the product has no evidenced rate for ${resolution.taxCode}. Record the period and the reference you are relying on.`;
  }
}

export function formatRatePercent(percent: number): string {
  return `${percent.toFixed(2)}%`;
}

// ── Feedback layer ───────────────────────────────────────────────────────────
// Each entry explains a refusal the database already issues. Nothing here decides
// whether an operation is allowed; if a refusal has no entry, the server's own
// wording is what the user sees.

export interface TaxRefusalExplanation {
  /** Short, plain-language statement of what the server refused. */
  summary: string;
  /** What the person should do next, in their terms. */
  action: string;
}

/**
 * Refusals, by the constraint the database names in its message. The keys are
 * exactly the constraints created by
 * 20261022000000_effective_dated_tax_configurations.sql.
 */
export const TAX_REFUSAL_EXPLANATIONS: Record<string, TaxRefusalExplanation> = {
  tax_configurations_no_overlap: {
    summary: 'Another period for this tax code already covers part of these dates for this business.',
    action:
      'Periods are half-open: a period ends the day before the next one starts. Set the earlier period’s end date to the day before this one begins (an open-ended period must be closed first), or correct the dates.',
  },
  tax_configurations_evidence_chk: {
    summary: 'A tax rate above 0 must record the reference it relies on.',
    action:
      'Enter the Act, gazette notice or revenue-authority reference for this rate in “MRA reference”, then save again.',
  },
  tax_configurations_period_chk: {
    summary: 'The end date is not after the start date.',
    action: 'Leave the end date empty for an open-ended period, or set it to a later date.',
  },
  tax_configurations_rate_chk: {
    summary: 'Rates are percentages between 0 and 100.',
    action: 'Enter the rate as a percentage (for example 17.5), not as a fraction.',
  },
};

export interface TaxConfigurationFailure {
  /** SQLSTATE reported by the database, when present. */
  sqlState: string | null;
  /** The constraint the server named, when it named one. */
  constraint: string | null;
  /** The server's own message, unaltered. */
  message: string;
  explanation: TaxRefusalExplanation | null;
  /** True when the caller simply lacked authority for the action. */
  isAuthorityDenial: boolean;
}

/** The constraint name Postgres puts in its message, when there is one. */
export function extractConstraintFromMessage(message: string): string | null {
  const match = /constraint "([a-z0-9_]+)"/i.exec(message);
  return match ? match[1] : null;
}

/**
 * Normalise anything thrown by the repository into a displayable failure, and
 * explain it when the refusal is one the constraints document. The raw message
 * is always kept: the UI shows the server's wording next to the explanation.
 */
export function describeTaxConfigurationFailure(error: unknown): TaxConfigurationFailure {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'The change could not be saved.';
  const sqlState =
    error && typeof error === 'object' && 'code' in error
      ? ((error as { code?: string | null }).code ?? null)
      : error && typeof error === 'object' && 'sqlState' in error
        ? ((error as { sqlState?: string | null }).sqlState ?? null)
        : null;
  const constraint = extractConstraintFromMessage(message);
  return {
    sqlState,
    constraint,
    message,
    explanation: constraint ? TAX_REFUSAL_EXPLANATIONS[constraint] ?? null : null,
    isAuthorityDenial:
      constraint === null && (sqlState === '42501' || /row-level security|permission denied/i.test(message)),
  };
}

/**
 * Shown when a write reports success but changed no row. Row level security hides
 * rows rather than raising: an update addressed at another business's row — or at
 * a row the caller's role may not write — completes without an error, and the
 * caller must not report success. `TaxConfigsTab` reads the affected rows back to
 * detect exactly this, and this is the message it shows.
 */
export const NO_ROW_CHANGED_MESSAGE =
  'Nothing was saved: the stored configuration was not changed. It may belong to another business, or your role may not have authority to change tax configurations for this business.';
