/**
 * Jurisdiction-aware tax rules: rates, filing frequencies and due dates.
 *
 * Everything that used to be hardcoded in TypeScript method bodies (the 25th,
 * "last day of month", "+15 days") or duplicated across page components
 * (VAT_RATE = 0.175 in five files) lives here as data, keyed by jurisdiction.
 *
 * Adding a jurisdiction is a data change, not a code change.
 *
 * NOTE ON RATES: these are fallback defaults used when a business has no
 * tax_configurations row for the code. The database remains the source of
 * truth — TaxRepository.getVatRate() reads it. These constants exist so the
 * UI has something correct to show before configs are seeded, and so the
 * seeding itself has a canonical source.
 */

import { addDays, addMonthsSetDay, lastDayOfMonth } from './taxDates';

export type Jurisdiction = 'MW' | 'ZM';

export type TaxKind = 'vat' | 'paye' | 'pension' | 'wht';

export interface DueDateRule {
  /**
   * How the due date is derived from the period end.
   * - 'day_of_following_month': the Nth day of the month after period end
   * - 'last_day_of_following_month': final day of the month after period end
   * - 'days_after_period_end': period end + N days
   */
  kind: 'day_of_following_month' | 'last_day_of_following_month' | 'days_after_period_end';
  value?: number;
}

export interface TaxTypeRule {
  taxKind: TaxKind;
  /** tax_code enum value this maps to in the database. */
  taxCode: 'vat_standard' | 'paye' | 'tpr_pension';
  label: string;
  /** Short form used in tables and badges. */
  shortLabel: string;
  /** Statutory return/form name, if one exists. */
  formName?: string;
  /** Standard rate as a percentage, e.g. 17.5 means 17.5%. */
  rate?: number;
  /** Split rates for contribution-style taxes. */
  employerRate?: number;
  employeeRate?: number;
  dueDate: DueDateRule;
  authority: string;
  /** Statutory reference for the tax. */
  reference?: string;
  /** Longer explanation surfaced in the UI. */
  description?: string;
}

export interface JurisdictionRules {
  code: Jurisdiction;
  name: string;
  authority: string;
  authorityName: string;
  currency: string;
  portalUrl: string;
  taxes: TaxTypeRule[];
  /** Annual PAYE bands. `to: null` means the top, open-ended band. */
  payeBands: { from: number; to: number | null; rate: number; label: string }[];
}

/**
 * MALAWI — Malawi Revenue Authority
 *
 * VAT: 17.5% from 1 January 2026 (raised from 16.5% by the VAT (Amendment)
 * Act 2025, assented 20 Dec 2025, gazetted 30 Dec 2025). Returns and payment
 * due by the 25th of the month following the tax period.
 *
 * PAYE: progressive. The Taxation (Amendment) Act effective 1 January 2026
 * raised the zero-rate threshold to K170,000/month and set marginal rates of
 * 30% / 35% / 40%. Bands below are annualised (monthly figure x 12) because
 * calculatePAYE works on annual gross.
 *
 * Remittance is due within 14 days of the month end.
 *
 * TPR Pension: Pension Act — 10% employer, 5% employee, remitted within 14
 * days of month end.
 */
const MALAWI: JurisdictionRules = {
  code: 'MW',
  name: 'Malawi',
  authority: 'MRA',
  authorityName: 'Malawi Revenue Authority',
  currency: 'MWK',
  portalUrl: 'https://www.mra.mw',
  taxes: [
    {
      taxKind: 'vat',
      taxCode: 'vat_standard',
      label: 'Value Added Tax',
      shortLabel: 'VAT',
      formName: 'Form VAT 3',
      rate: 17.5,
      dueDate: { kind: 'day_of_following_month', value: 25 },
      authority: 'MRA',
      reference: 'VAT Act',
      description: 'Standard-rated VAT. 17.5% from 1 January 2026 (previously 16.5%).',
    },
    {
      taxKind: 'paye',
      taxCode: 'paye',
      label: 'Pay As You Earn',
      shortLabel: 'PAYE',
      formName: 'PAYE Monthly Return',
      dueDate: { kind: 'days_after_period_end', value: 14 },
      authority: 'MRA',
      reference: 'Taxation Act',
      description: 'Progressive employment tax withheld from employees, due within 14 days of month end.',
    },
    {
      taxKind: 'pension',
      taxCode: 'tpr_pension',
      label: 'TPR Pension Contribution',
      shortLabel: 'TPR',
      formName: 'TPR Remittance Schedule',
      employerRate: 10,
      employeeRate: 5,
      dueDate: { kind: 'days_after_period_end', value: 14 },
      authority: 'Pension Regulator',
      reference: 'Pension Act',
      description: 'Mandatory pension contribution — 10% employer, 5% employee.',
    },
  ],
  payeBands: [
    { from: 0,          to: 2_040_000,  rate: 0,  label: 'Tax free (K170,000/mo)' },
    { from: 2_040_000,  to: 18_840_000, rate: 30, label: '30% band' },
    { from: 18_840_000, to: 120_000_000, rate: 35, label: '35% band' },
    { from: 120_000_000, to: null,      rate: 40, label: '40% band' },
  ],
};

/**
 * ZAMBIA — Zambia Revenue Authority
 *
 * VAT: 16% standard rate. Returns due by the 18th of the following month.
 * PAYE: progressive, due by the 10th of the following month.
 * NAPSA: 5% employer / 5% employee, subject to a statutory monthly ceiling.
 */
const ZAMBIA: JurisdictionRules = {
  code: 'ZM',
  name: 'Zambia',
  authority: 'ZRA',
  authorityName: 'Zambia Revenue Authority',
  currency: 'ZMW',
  portalUrl: 'https://www.zra.org.zm',
  taxes: [
    {
      taxKind: 'vat',
      taxCode: 'vat_standard',
      label: 'Value Added Tax',
      shortLabel: 'VAT',
      formName: 'VAT Return',
      rate: 16,
      dueDate: { kind: 'day_of_following_month', value: 18 },
      authority: 'ZRA',
      reference: 'VAT Act (Zambia)',
      description: 'Zambian standard-rated VAT at 16%.',
    },
    {
      taxKind: 'paye',
      taxCode: 'paye',
      label: 'Pay As You Earn',
      shortLabel: 'PAYE',
      formName: 'PAYE Return',
      dueDate: { kind: 'day_of_following_month', value: 10 },
      authority: 'ZRA',
      reference: 'Income Tax Act (Zambia)',
      description: 'Progressive employment tax, due by the 10th of the following month.',
    },
    {
      taxKind: 'pension',
      taxCode: 'tpr_pension',
      label: 'NAPSA Contribution',
      shortLabel: 'NAPSA',
      formName: 'NAPSA Remittance',
      employerRate: 5,
      employeeRate: 5,
      dueDate: { kind: 'day_of_following_month', value: 10 },
      authority: 'NAPSA',
      reference: 'NAPSA Act',
      description: 'National Pension Scheme Authority contribution — 5% employer, 5% employee.',
    },
  ],
  payeBands: [
    { from: 0,       to: 61_200,  rate: 0,    label: 'Tax free' },
    { from: 61_200,  to: 85_200,  rate: 20,   label: '20% band' },
    { from: 85_200,  to: 110_400, rate: 30,   label: '30% band' },
    { from: 110_400, to: null,    rate: 37.5, label: '37.5% band' },
  ],
};

const REGISTRY: Record<Jurisdiction, JurisdictionRules> = {
  MW: MALAWI,
  ZM: ZAMBIA,
};

export const JURISDICTIONS: JurisdictionRules[] = [MALAWI, ZAMBIA];

/** Map a business's country field to a supported jurisdiction. Defaults to Malawi. */
export function resolveJurisdiction(country?: string | null): Jurisdiction {
  const c = (country ?? '').trim().toUpperCase();
  if (c === 'ZM' || c === 'ZAMBIA') return 'ZM';
  return 'MW';
}

export function getJurisdictionRules(jurisdiction: Jurisdiction): JurisdictionRules {
  return REGISTRY[jurisdiction] ?? MALAWI;
}

export function getTaxRule(jurisdiction: Jurisdiction, taxKind: TaxKind): TaxTypeRule | undefined {
  return getJurisdictionRules(jurisdiction).taxes.find((t) => t.taxKind === taxKind);
}

/**
 * Resolve a statutory due date from a period end.
 *
 * This is THE single source of truth. Previously three different answers
 * lived in the codebase for PAYE alone: "last day of the period's own month"
 * (TaxReturnRepository), "the 14th" (useTaxData + en.json), and "last day of
 * month" (the spec). The correct MRA rule is 14 days after month end.
 */
export function resolveDueDate(rule: DueDateRule, periodEndIso: string): string {
  switch (rule.kind) {
    case 'day_of_following_month':
      return addMonthsSetDay(periodEndIso, 1, rule.value ?? 1);
    case 'last_day_of_following_month':
      return lastDayOfMonth(addMonthsSetDay(periodEndIso, 1, 1));
    case 'days_after_period_end':
      return addDays(lastDayOfMonth(periodEndIso), rule.value ?? 0);
  }
}

/** Convenience: due date for a given jurisdiction + tax kind + period end. */
export function dueDateFor(
  jurisdiction: Jurisdiction,
  taxKind: TaxKind,
  periodEndIso: string,
): string {
  const rule = getTaxRule(jurisdiction, taxKind);
  if (!rule) throw new Error(`No ${taxKind} rule defined for jurisdiction ${jurisdiction}.`);
  return resolveDueDate(rule.dueDate, periodEndIso);
}

/** Standard VAT rate as a percentage for a jurisdiction (fallback only). */
export function defaultVatRate(jurisdiction: Jurisdiction): number {
  return getTaxRule(jurisdiction, 'vat')?.rate ?? 0;
}
