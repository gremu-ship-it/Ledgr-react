/**
 * insuranceService.ts
 *
 * Insurance directory, split-billing math, claims and remittance reconciliation
 * for the Healthcare vertical (Phase 3).
 *
 * The pure money helpers at the top are the single source of truth for the
 * patient/insurer split; the database only stores the resulting amounts. Every
 * claim is tenant-scoped on `business_id`, and claim-settlement adjustments are
 * posted through `post_financial_journal` rather than writing journal tables
 * directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  ClaimServiceCategory,
  ClaimStatus,
  InsuranceClaim,
  InsuranceClaimItem,
  InsuranceProvider,
  InsuranceProviderInput,
  SplitBillBreakdown,
  SplitBillItem,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

const CLAIM_STATUSES: readonly ClaimStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'settled',
  'disputed',
];

export const CLAIM_NUMBER_PREFIX = 'CLM';

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMoney(value: unknown): number {
  return roundMoney(toNumber(value));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

/** Normalise a stored provider row (numeric columns arrive as strings). */
export function normalizeInsuranceProvider(row: Partial<InsuranceProvider>): InsuranceProvider {
  return {
    id: String(row.id ?? ''),
    business_id: String(row.business_id ?? ''),
    name: String(row.name ?? ''),
    payer_code: row.payer_code ?? null,
    contact_person: row.contact_person ?? null,
    contact_email: row.contact_email ?? null,
    contact_phone: row.contact_phone ?? null,
    billing_address: row.billing_address ?? null,
    default_copay_percent: toNumber(row.default_copay_percent),
    credit_period_days: toNumber(row.credit_period_days, 30),
    receivable_account_id: row.receivable_account_id ?? null,
    settlement_account_id: row.settlement_account_id ?? null,
    write_off_account_id: row.write_off_account_id ?? null,
    is_active: row.is_active !== false,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/**
 * Split a gross bill into patient co-pay and insurer liability.
 *
 * Each line is rounded to cents before the totals are accumulated, so the line
 * breakdown always adds back to its header. `copayCap` caps the *header*
 * patient total exactly as entered; callers that also render line shares should
 * pass the result through `applyCopayCap`, which redistributes the cap across
 * the lines without changing the gross amounts.
 */
export function calculateSplitBill(
  items: Array<{
    category: ClaimServiceCategory;
    description: string;
    amount: number;
  }>,
  copayPercent: number,
  copayCap?: number,
): SplitBillBreakdown {
  const safeCopayRate = clampPercent(copayPercent) / 100;

  let totalGross = 0;
  let rawPatientTotal = 0;

  const calculatedItems = items.map((item) => {
    const amount = toMoney(item.amount);
    totalGross += amount;
    const patientShare = toMoney(amount * safeCopayRate);
    const insurerShare = toMoney(amount - patientShare);
    rawPatientTotal += patientShare;
    return {
      category: item.category,
      description: item.description,
      grossAmount: amount,
      patientShare,
      insurerShare,
    };
  });

  let finalPatientCopay = rawPatientTotal;
  if (copayCap !== undefined && copayCap > 0 && finalPatientCopay > copayCap) {
    finalPatientCopay = copayCap;
  }

  return {
    totalGross: toMoney(totalGross),
    patientCopay: toMoney(finalPatientCopay),
    insurerClaim: toMoney(totalGross - finalPatientCopay),
    items: calculatedItems,
  };
}

/**
 * Distribute an already-applied header cap across the split lines.
 *
 * The cap is shared in proportion to each line's raw patient share; the final
 * line absorbs the rounding remainder so the lines sum exactly to the header.
 * Without a cap (or when the cap is not binding) the breakdown is returned
 * unchanged.
 */
export function applyCopayCap(
  breakdown: SplitBillBreakdown,
  copayCap?: number,
): SplitBillBreakdown {
  if (
    copayCap === undefined ||
    !Number.isFinite(copayCap) ||
    copayCap <= 0 ||
    breakdown.patientCopay <= copayCap ||
    breakdown.items.length === 0
  ) {
    return breakdown;
  }

  const rawPatientTotal = breakdown.items.reduce(
    (total, item) => total + item.patientShare,
    0,
  );
  if (rawPatientTotal <= 0) return breakdown;

  const target = Math.min(copayCap, breakdown.totalGross);
  const factor = target / rawPatientTotal;
  const items: SplitBillItem[] = [];
  let allocated = 0;

  breakdown.items.forEach((item, index) => {
    const isLast = index === breakdown.items.length - 1;
    let patientShare = isLast
      ? toMoney(target - allocated)
      : toMoney(item.patientShare * factor);
    patientShare = Math.max(0, Math.min(item.grossAmount, patientShare));
    allocated = toMoney(allocated + patientShare);
    items.push({
      ...item,
      patientShare,
      insurerShare: toMoney(item.grossAmount - patientShare),
    });
  });

  return {
    totalGross: toMoney(breakdown.totalGross),
    patientCopay: toMoney(target),
    insurerClaim: toMoney(breakdown.totalGross - target),
    items,
  };
}

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === 'string' && (CLAIM_STATUSES as readonly string[]).includes(value);
}

export function normalizeClaim(row: Partial<InsuranceClaim>): InsuranceClaim {
  return {
    ...(row as InsuranceClaim),
    id: String(row.id ?? ''),
    business_id: String(row.business_id ?? ''),
    visit_id: String(row.visit_id ?? ''),
    patient_id: String(row.patient_id ?? ''),
    provider_id: String(row.provider_id ?? ''),
    invoice_id: row.invoice_id ?? null,
    claim_number: String(row.claim_number ?? ''),
    total_bill_amount: toMoney(row.total_bill_amount),
    patient_copay_amount: toMoney(row.patient_copay_amount),
    insurer_claim_amount: toMoney(row.insurer_claim_amount),
    approved_amount: toMoney(row.approved_amount),
    settled_amount: toMoney(row.settled_amount),
    disallowance_amount: toMoney(row.disallowance_amount),
    status: isClaimStatus(row.status) ? row.status : 'draft',
    provider: row.provider ? normalizeInsuranceProvider(row.provider) : null,
    items: (row.items ?? []).map((item) => ({
      ...item,
      gross_amount: toMoney(item.gross_amount),
      patient_share: toMoney(item.patient_share),
      insurer_share: toMoney(item.insurer_share),
    })),
  };
}

/** Claim numbers are `CLM-YYYY-NNNN`, scoped to a business and calendar year. */
export async function generateClaimNumber(businessId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${CLAIM_NUMBER_PREFIX}-${year}-`;

  const { data, error } = await db
    .from('insurance_claims')
    .select('claim_number')
    .eq('business_id', businessId)
    .like('claim_number', `${prefix}%`)
    .order('claim_number', { ascending: false })
    .limit(1);

  if (error) throw error;

  let nextSequence = 1;
  const latest = (data?.[0] as { claim_number?: string } | undefined)?.claim_number;
  if (latest) {
    const parts = String(latest).split('-');
    const currentSequence = Number.parseInt(parts[parts.length - 1] ?? '', 10);
    if (Number.isFinite(currentSequence)) nextSequence = currentSequence + 1;
  }

  return `${prefix}${String(Math.max(1, nextSequence)).padStart(4, '0')}`;
}

export async function getInsuranceProviders(businessId: string): Promise<InsuranceProvider[]> {
  const { data, error } = await db
    .from('insurance_providers')
    .select('*')
    .eq('business_id', businessId)
    .order('name', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Partial<InsuranceProvider>[]).map(normalizeInsuranceProvider);
}

export async function createInsuranceProvider(
  businessId: string,
  payload: Omit<InsuranceProvider, 'id' | 'business_id' | 'created_at' | 'updated_at'>,
): Promise<InsuranceProvider> {
  const { data, error } = await db
    .from('insurance_providers')
    .insert({
      business_id: businessId,
      ...payload,
      default_copay_percent: clampPercent(toNumber(payload.default_copay_percent)),
      credit_period_days: Math.max(0, Math.trunc(toNumber(payload.credit_period_days, 30))),
    })
    .select()
    .single();

  if (error) throw error;
  return normalizeInsuranceProvider(data as Partial<InsuranceProvider>);
}

export async function updateInsuranceProvider(
  businessId: string,
  providerId: string,
  patch: Partial<InsuranceProviderInput>,
): Promise<InsuranceProvider> {
  const payload: Record<string, unknown> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (patch.default_copay_percent !== undefined) {
    payload.default_copay_percent = clampPercent(toNumber(patch.default_copay_percent));
  }
  if (patch.credit_period_days !== undefined) {
    payload.credit_period_days = Math.max(
      0,
      Math.trunc(toNumber(patch.credit_period_days, 30)),
    );
  }

  const { data, error } = await db
    .from('insurance_providers')
    .update(payload)
    .eq('id', providerId)
    .eq('business_id', businessId)
    .select()
    .single();

  if (error) throw error;
  return normalizeInsuranceProvider(data as Partial<InsuranceProvider>);
}

export async function setInsuranceProviderActive(
  businessId: string,
  providerId: string,
  isActive: boolean,
): Promise<InsuranceProvider> {
  return updateInsuranceProvider(businessId, providerId, { is_active: isActive });
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code) === '23505',
  );
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateClaimForVisitInput {
  visitId: string;
  patientId: string;
  providerId: string;
  invoiceId?: string;
  policyNumber?: string;
  memberId?: string;
  preAuthCode?: string;
  splitBreakdown: SplitBillBreakdown;
}

/**
 * Create a submitted claim and its line breakdown in one call.
 *
 * The number is allocated client-side, then re-allocated on a rare unique-key
 * race. If the lines fail, the header is removed so a retry cannot leave an
 * empty claim behind.
 */
export async function createClaimForVisit(
  businessId: string,
  payload: CreateClaimForVisitInput,
): Promise<InsuranceClaim> {
  const breakdown = payload.splitBreakdown;
  if (!breakdown.items.length) {
    throw new Error('A claim needs at least one billable line.');
  }

  let claim: Record<string, unknown> | null = null;
  let claimError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claimNumber = await generateClaimNumber(businessId);
    const response = await db
      .from('insurance_claims')
      .insert({
        business_id: businessId,
        visit_id: payload.visitId,
        patient_id: payload.patientId,
        provider_id: payload.providerId,
        claim_number: claimNumber,
        policy_number: payload.policyNumber,
        member_id: payload.memberId,
        pre_auth_code: payload.preAuthCode,
        total_bill_amount: toMoney(breakdown.totalGross),
        patient_copay_amount: toMoney(breakdown.patientCopay),
        insurer_claim_amount: toMoney(breakdown.insurerClaim),
        status: 'submitted',
        submission_date: todayIsoDate(),
        ...(payload.invoiceId ? { invoice_id: payload.invoiceId } : {}),
      })
      .select()
      .single();

    if (!response.error) {
      claim = response.data as Record<string, unknown>;
      claimError = null;
      break;
    }

    claimError = response.error;
    if (!isUniqueViolation(response.error)) break;
  }

  if (!claim) throw claimError ?? new Error('Could not create the insurance claim.');

  const claimId = String(claim.id);
  const claimLines = breakdown.items.map((item) => ({
    business_id: businessId,
    claim_id: claimId,
    service_category: item.category,
    item_description: item.description,
    gross_amount: toMoney(item.grossAmount),
    patient_share: toMoney(item.patientShare),
    insurer_share: toMoney(item.insurerShare),
    status: 'approved',
  }));

  const { error: lineError } = await db.from('insurance_claim_items').insert(claimLines);
  if (lineError) {
    // Compensating delete: a header without lines cannot be settled and would
    // block the claim number until someone cleaned it up by hand.
    await db.from('insurance_claims').delete().eq('id', claimId).eq('business_id', businessId);
    throw lineError;
  }

  return normalizeClaim({
    ...(claim as unknown as InsuranceClaim),
    ...(payload.invoiceId ? { invoice_id: payload.invoiceId } : {}),
  });
}

const CLAIM_SELECT =
  '*, provider:insurance_providers(*), patient:patients(first_name,last_name,mrn), items:insurance_claim_items(*)';

export async function listInsuranceClaims(
  businessId: string,
  status?: ClaimStatus | 'all',
): Promise<InsuranceClaim[]> {
  let query = db
    .from('insurance_claims')
    .select(CLAIM_SELECT)
    .eq('business_id', businessId);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Partial<InsuranceClaim>[]).map(normalizeClaim);
}

export async function getInsuranceClaim(
  businessId: string,
  claimId: string,
): Promise<InsuranceClaim> {
  const { data, error } = await db
    .from('insurance_claims')
    .select(CLAIM_SELECT)
    .eq('id', claimId)
    .eq('business_id', businessId)
    .single();

  if (error) throw error;
  return normalizeClaim(data as Partial<InsuranceClaim>);
}

export async function getClaimForVisit(
  businessId: string,
  visitId: string,
): Promise<InsuranceClaim | null> {
  const { data, error } = await db
    .from('insurance_claims')
    .select(CLAIM_SELECT)
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeClaim(data as Partial<InsuranceClaim>) : null;
}

export async function updateClaimStatus(
  businessId: string,
  claimId: string,
  status: ClaimStatus,
  rejectionReason?: string | null,
): Promise<InsuranceClaim> {
  const payload: Record<string, unknown> = {
    status,
    rejection_reason: status === 'rejected' ? rejectionReason ?? null : null,
    updated_at: new Date().toISOString(),
  };
  if (status === 'submitted') payload.submission_date = todayIsoDate();
  if (status === 'settled') payload.settlement_date = todayIsoDate();

  const { error } = await db
    .from('insurance_claims')
    .update(payload)
    .eq('id', claimId)
    .eq('business_id', businessId);

  if (error) throw error;
  // PostgREST cannot reliably embed relations on UPDATE…SELECT, so re-read the
  // canonical claim shape through the select path.
  return getInsuranceClaim(businessId, claimId);
}

export interface ClaimSettlementJournal {
  /** The payer AR control account being credited. */
  receivableAccountId: string;
  /** Bank/cash account receiving the remittance. */
  depositAccountId: string;
  /** Expense account absorbing the disallowed amount (when there is one). */
  writeOffAccountId?: string | null;
}

export interface SettleInsuranceClaimInput {
  settledAmount: number;
  remittanceReference: string;
  disallowanceReason?: string;
  /** Omit only for legacy callers; the station always supplies it. */
  journal?: ClaimSettlementJournal;
}

export interface ClaimSettlementJournalLine {
  account_id: string;
  debit: number;
  credit: number;
  description: string;
}

/**
 * Build the balanced journal for a remittance:
 *
 *   Dr Bank / cash                 settled amount
 *   Dr Contractual write-off       disallowed amount
 *       Cr Insurance receivable    insurer claim amount
 *
 * The lines are pure data so the math is unit-tested without a database.
 */
export function buildClaimSettlementLines(input: {
  insurerClaimAmount: number;
  settledAmount: number;
  disallowanceAmount: number;
  claimNumber: string;
  receivableAccountId: string;
  depositAccountId: string;
  writeOffAccountId?: string | null;
}): ClaimSettlementJournalLine[] {
  const receivable = input.receivableAccountId;
  const deposit = input.depositAccountId;
  if (!receivable || !deposit) {
    throw new Error('Select the receivable and settlement accounts first.');
  }

  const settled = toMoney(input.settledAmount);
  const disallowance = toMoney(input.disallowanceAmount);
  const insurerClaim = toMoney(input.insurerClaimAmount);
  if (toMoney(settled + disallowance) !== insurerClaim) {
    throw new Error('Settlement and disallowance must add up to the insurer claim.');
  }

  const lines: ClaimSettlementJournalLine[] = [];
  if (settled > 0) {
    lines.push({
      account_id: deposit,
      debit: settled,
      credit: 0,
      description: `Insurance remittance ${input.claimNumber}`,
    });
  }
  if (disallowance > 0) {
    if (!input.writeOffAccountId) {
      throw new Error('Select a write-off account for the disallowed amount.');
    }
    lines.push({
      account_id: input.writeOffAccountId,
      debit: disallowance,
      credit: 0,
      description: `Claim disallowance ${input.claimNumber}`,
    });
  }
  if (insurerClaim > 0) {
    lines.push({
      account_id: receivable,
      debit: 0,
      credit: insurerClaim,
      description: `Clear insurance receivable ${input.claimNumber}`,
    });
  }

  return lines;
}

async function postClaimSettlementJournal(
  businessId: string,
  claimId: string,
  claimNumber: string,
  insurerClaimAmount: number,
  settledAmount: number,
  disallowanceAmount: number,
  remittanceReference: string,
  journal: ClaimSettlementJournal,
): Promise<string> {
  const lines = buildClaimSettlementLines({
    insurerClaimAmount,
    settledAmount,
    disallowanceAmount,
    claimNumber,
    receivableAccountId: journal.receivableAccountId,
    depositAccountId: journal.depositAccountId,
    writeOffAccountId: journal.writeOffAccountId ?? null,
  });

  if (lines.length < 2) {
    throw new Error('A settlement journal requires both a debit and a credit.');
  }

  const { data, error } = await db.rpc('post_financial_journal', {
    p_business_id: businessId,
    p_entry_date: todayIsoDate(),
    p_description: `Insurance claim settlement ${claimNumber}`,
    p_reference: remittanceReference,
    p_source_type: 'insurance_claim',
    p_source_id: claimId,
    p_lines: lines,
    p_posting_key: `insurance-claim-settlement:${claimId}`,
  });

  if (error) throw error;
  if (!data) throw new Error('The settlement journal was not posted.');
  return String(data);
}

/**
 * Reconcile a remittance.
 *
 * When `journal` is supplied (the Insurance Station always does), the
 * settlement/adjustment journal is posted first through
 * `post_financial_journal`, then the claim is marked settled. The posting key
 * is derived from the claim id, so retrying a failed claim update returns the
 * same journal instead of double-posting.
 */
export async function settleInsuranceClaim(
  businessId: string,
  claimId: string,
  payload: SettleInsuranceClaimInput,
): Promise<void> {
  const { data: claim, error: fetchError } = await db
    .from('insurance_claims')
    .select('*, provider:insurance_providers(*)')
    .eq('id', claimId)
    .eq('business_id', businessId)
    .single();

  if (fetchError || !claim) throw new Error('Claim not found.');

  const row = claim as Partial<InsuranceClaim>;
  if (row.status === 'settled') {
    throw new Error('This claim has already been settled.');
  }

  const insurerClaimAmount = toMoney(row.insurer_claim_amount);
  const settledAmount = toMoney(payload.settledAmount);
  if (settledAmount < 0) throw new Error('A settlement cannot be negative.');
  if (settledAmount > insurerClaimAmount) {
    throw new Error('The settled amount cannot exceed the insurer claim.');
  }
  if (!payload.remittanceReference?.trim()) {
    throw new Error('A remittance reference is required.');
  }

  const disallowance = toMoney(insurerClaimAmount - settledAmount);

  // Prefer explicit account choices from the remittance screen. When callers
  // omit them (older integrations), fall back to the provider's configured
  // defaults so the adjustment still goes through post_financial_journal.
  const provider = row.provider;
  const fallbackJournal: ClaimSettlementJournal | null =
    provider?.receivable_account_id &&
    provider?.settlement_account_id &&
    (disallowance <= 0 || provider.write_off_account_id)
      ? {
          receivableAccountId: provider.receivable_account_id,
          depositAccountId: provider.settlement_account_id,
          writeOffAccountId: provider.write_off_account_id ?? null,
        }
      : null;
  const journal = payload.journal ?? fallbackJournal;

  let journalId: string | null = null;
  if (journal) {
    journalId = await postClaimSettlementJournal(
      businessId,
      claimId,
      String(row.claim_number ?? ''),
      insurerClaimAmount,
      settledAmount,
      disallowance,
      payload.remittanceReference.trim(),
      journal,
    );
  }

  const update: Record<string, unknown> = {
    settled_amount: settledAmount,
    approved_amount: settledAmount,
    disallowance_amount: Math.max(0, disallowance),
    remittance_reference: payload.remittanceReference.trim(),
    rejection_reason: disallowance > 0 ? payload.disallowanceReason ?? null : null,
    status: 'settled',
    settlement_date: todayIsoDate(),
    updated_at: new Date().toISOString(),
  };
  if (journalId) update.settlement_journal_entry_id = journalId;

  const { error } = await db
    .from('insurance_claims')
    .update(update)
    .eq('id', claimId)
    .eq('business_id', businessId);

  if (error) throw error;
}

/** CSV headers exactly as remittance clerks and HMO portals expect them. */
export const CLAIM_CSV_HEADERS = [
  'Claim Number',
  'Submission Date',
  'Patient MRN',
  'Patient Name',
  'Provider',
  'Policy #',
  'Member ID',
  'Total Bill',
  'Co-Pay',
  'Claim Amount',
  'Settled Amount',
  'Status',
] as const;

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Pure CSV builder (also used by the unit tests). */
export function buildClaimsCsv(claims: readonly InsuranceClaim[]): string {
  const rows = claims.map((claim) => {
    const patientName = [claim.patient?.first_name, claim.patient?.last_name]
      .filter(Boolean)
      .join(' ');
    return [
      claim.claim_number,
      claim.submission_date ?? '',
      claim.patient?.mrn ?? '',
      patientName,
      claim.provider?.name ?? '',
      claim.policy_number ?? '',
      claim.member_id ?? '',
      toMoney(claim.total_bill_amount).toFixed(2),
      toMoney(claim.patient_copay_amount).toFixed(2),
      toMoney(claim.insurer_claim_amount).toFixed(2),
      toMoney(claim.settled_amount).toFixed(2),
      String(claim.status).toUpperCase(),
    ].map(csvCell).join(',');
  });

  return [CLAIM_CSV_HEADERS.map(csvCell).join(','), ...rows].join('\n');
}

/** Download the current batch as a UTF-8 CSV using native Blob APIs. */
export function exportClaimsToCsv(claims: InsuranceClaim[]): void {
  const csvContent = buildClaimsCsv(claims);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Claims_Batch_${todayIsoDate()}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Small helper for the worklist filter chips. */
export function filterClaimsByStatus(
  claims: readonly InsuranceClaim[],
  status: ClaimStatus | 'all',
): InsuranceClaim[] {
  return status === 'all' ? [...claims] : claims.filter((claim) => claim.status === status);
}

/** Outstanding + settled roll-up shown on the station dashboard. */
export function summarizeClaims(claims: readonly InsuranceClaim[]) {
  let outstanding = 0;
  let settled = 0;
  let disallowed = 0;
  let openClaims = 0;

  for (const claim of claims) {
    outstanding += toMoney(claim.insurer_claim_amount) - toMoney(claim.settled_amount);
    settled += toMoney(claim.settled_amount);
    disallowed += toMoney(claim.disallowance_amount);
    if (claim.status !== 'settled' && claim.status !== 'rejected') openClaims += 1;
  }

  return {
    outstanding: toMoney(outstanding),
    settled: toMoney(settled),
    disallowed: toMoney(disallowed),
    openClaims,
  };
}

/** Claim items for a specific claim (used by exports or audits). */
export function summarizeClaimItems(items: readonly InsuranceClaimItem[]) {
  return {
    gross: toMoney(items.reduce((total, item) => total + toMoney(item.gross_amount), 0)),
    patient: toMoney(items.reduce((total, item) => total + toMoney(item.patient_share), 0)),
    insurer: toMoney(items.reduce((total, item) => total + toMoney(item.insurer_share), 0)),
  };
}
