/**
 * doctorFeeService.ts
 *
 * Doctor revenue-share contracts and commission accruals for the Healthcare
 * vertical (Phase 3).
 *
 * Commission math is pure and unit-tested. Accruals are written to the
 * `doctor_fee_earnings` ledger; money only leaves that ledger through
 * `post_financial_journal`, which creates a balanced double-entry journal
 * (Dr Professional Fees / Cr Doctor Commissions Payable). Payouts use the same
 * RPC to clear the payable against the bank/cash account.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  ClinicDoctor,
  DoctorContractType,
  DoctorEarningStatus,
  DoctorFeeContract,
  DoctorFeeEarning,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

export const DOCTOR_EARNING_STATUSES: readonly DoctorEarningStatus[] = [
  'pending',
  'approved',
  'posted',
  'paid',
];

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

function percentage(value: unknown): number {
  return Math.max(0, Math.min(100, toNumber(value)));
}

export function isDoctorEarningStatus(value: unknown): value is DoctorEarningStatus {
  return typeof value === 'string' && (DOCTOR_EARNING_STATUSES as readonly string[]).includes(value);
}

export function normalizeDoctorContract(row: Partial<DoctorFeeContract>): DoctorFeeContract {
  const type: DoctorContractType =
    row.contract_type === 'fixed' || row.contract_type === 'hybrid'
      ? row.contract_type
      : 'percentage';
  return {
    id: String(row.id ?? ''),
    business_id: String(row.business_id ?? ''),
    doctor_id: String(row.doctor_id ?? ''),
    contract_type: type,
    consultation_share_percent: percentage(row.consultation_share_percent),
    fixed_consultation_fee: toMoney(row.fixed_consultation_fee),
    lab_procedure_share_percent: percentage(row.lab_procedure_share_percent),
    pharmacy_share_percent: percentage(row.pharmacy_share_percent),
    expense_account_id: row.expense_account_id ?? null,
    payable_account_id: row.payable_account_id ?? null,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    doctor: row.doctor ?? null,
  };
}

export function normalizeDoctorEarning(row: Partial<DoctorFeeEarning>): DoctorFeeEarning {
  return {
    ...(row as DoctorFeeEarning),
    id: String(row.id ?? ''),
    business_id: String(row.business_id ?? ''),
    doctor_id: String(row.doctor_id ?? ''),
    visit_id: String(row.visit_id ?? ''),
    invoice_id: row.invoice_id ?? null,
    consultation_amount: toMoney(row.consultation_amount),
    lab_amount: toMoney(row.lab_amount),
    pharmacy_amount: toMoney(row.pharmacy_amount),
    earned_commission: toMoney(row.earned_commission),
    status: isDoctorEarningStatus(row.status) ? row.status : 'pending',
    journal_entry_id: row.journal_entry_id ?? null,
    payout_journal_entry_id: row.payout_journal_entry_id ?? null,
    posted_at: row.posted_at ?? null,
    paid_at: row.paid_at ?? null,
    created_at: String(row.created_at ?? ''),
    doctor: row.doctor ?? null,
    visit: row.visit ?? null,
  };
}

export interface CommissionBreakdown {
  consultation: number;
  lab: number;
  pharmacy: number;
}

/**
 * Doctor commission for one visit.
 *
 *   fixed       → fixed consultation fee + lab% + pharmacy%
 *   percentage  → consultation×Sc + lab×Sl + pharmacy×Sp
 *   hybrid      → max(fixed consultation fee, consultation×Sc)
 *                 + lab×Sl + pharmacy×Sp
 *
 * An inactive contract earns nothing.
 */
export function calculateDoctorCommission(
  contract: DoctorFeeContract,
  breakdown: CommissionBreakdown,
): number {
  if (contract.is_active === false) return 0;

  const consultation = Math.max(0, toNumber(breakdown.consultation));
  const lab = Math.max(0, toNumber(breakdown.lab));
  const pharmacy = Math.max(0, toNumber(breakdown.pharmacy));

  let totalCommission = 0;
  const fixedFee = toMoney(contract.fixed_consultation_fee);
  const consultationRate = percentage(contract.consultation_share_percent) / 100;

  if (contract.contract_type === 'fixed') {
    totalCommission += fixedFee;
  } else if (contract.contract_type === 'percentage') {
    totalCommission += consultation * consultationRate;
  } else if (contract.contract_type === 'hybrid') {
    const percentAmount = consultation * consultationRate;
    totalCommission += Math.max(fixedFee, percentAmount);
  }

  totalCommission += lab * (percentage(contract.lab_procedure_share_percent) / 100);
  totalCommission += pharmacy * (percentage(contract.pharmacy_share_percent) / 100);

  return roundMoney(totalCommission);
}

type DoctorLike = {
  full_name?: string | null;
  email?: string | null;
  raw_user_meta_data?: { full_name?: string | null } | null;
};

export function doctorDisplayName(
  doctor: DoctorLike | null | undefined,
  fallback = '',
): string {
  if (!doctor) return fallback;
  return (
    doctor.full_name?.trim() ||
    doctor.raw_user_meta_data?.full_name?.trim() ||
    doctor.email?.trim() ||
    fallback
  );
}

async function attachDoctorNames<T extends { doctor_id: string; doctor?: unknown }>(
  rows: readonly T[],
): Promise<T[]> {
  const doctorIds = [...new Set(rows.map((row) => row.doctor_id).filter(Boolean))];
  if (doctorIds.length === 0) return [...rows];

  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, full_name')
    .in('id', doctorIds);

  const byId = new Map(
    ((profiles ?? []) as Array<{ id?: string; full_name?: string | null }>)
      .filter((profile) => profile.id)
      .map((profile) => [
        String(profile.id),
        {
          full_name: profile.full_name ?? null,
          email: null,
          raw_user_meta_data: { full_name: profile.full_name ?? null },
        },
      ]),
  );

  return rows.map((row) => ({
    ...row,
    doctor: byId.get(row.doctor_id) ?? null,
  }));
}

export async function getDoctorContract(
  businessId: string,
  doctorId: string,
): Promise<DoctorFeeContract | null> {
  const { data, error } = await db
    .from('doctor_fee_contracts')
    .select('*')
    .eq('business_id', businessId)
    .eq('doctor_id', doctorId)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeDoctorContract(data as Partial<DoctorFeeContract>) : null;
}

export async function listDoctorContracts(businessId: string): Promise<DoctorFeeContract[]> {
  const { data, error } = await db
    .from('doctor_fee_contracts')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const rows = ((data ?? []) as Partial<DoctorFeeContract>[]).map(normalizeDoctorContract);
  return attachDoctorNames(rows);
}

export async function upsertDoctorContract(
  businessId: string,
  payload: Omit<DoctorFeeContract, 'id' | 'business_id'>,
): Promise<DoctorFeeContract> {
  if (!payload.doctor_id) throw new Error('Select the doctor for this contract.');

  const type: DoctorContractType =
    payload.contract_type === 'fixed' || payload.contract_type === 'hybrid'
      ? payload.contract_type
      : 'percentage';

  const { data, error } = await db
    .from('doctor_fee_contracts')
    .upsert(
      {
        business_id: businessId,
        doctor_id: payload.doctor_id,
        contract_type: type,
        consultation_share_percent: percentage(payload.consultation_share_percent),
        fixed_consultation_fee: toMoney(payload.fixed_consultation_fee),
        lab_procedure_share_percent: percentage(payload.lab_procedure_share_percent),
        pharmacy_share_percent: percentage(payload.pharmacy_share_percent),
        expense_account_id: payload.expense_account_id || null,
        payable_account_id: payload.payable_account_id || null,
        is_active: payload.is_active !== false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,doctor_id' },
    )
    .select()
    .single();

  if (error) throw error;
  return normalizeDoctorContract(data as Partial<DoctorFeeContract>);
}

/** Active members who can be selected as clinicians. */
export async function listClinicDoctors(businessId: string): Promise<ClinicDoctor[]> {
  const { data: members, error } = await db
    .from('business_users')
    .select('user_id, role, is_active')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows = (members ?? []) as Array<{ user_id?: string; role?: string | null }>;
  const ids = rows.map((row) => String(row.user_id ?? '')).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, full_name')
    .in('id', ids);

  const byId = new Map(
    ((profiles ?? []) as Array<{ id?: string; full_name?: string | null }>)
      .filter((profile) => profile.id)
      .map((profile) => [String(profile.id), profile]),
  );

  return rows
    .map((row) => {
      const id = String(row.user_id ?? '');
      const profile = byId.get(id);
      return {
        id,
        name: profile?.full_name?.trim() || id.slice(0, 8).toUpperCase(),
        email: null,
        role: row.role ?? null,
      };
    })
    .filter((doctor) => Boolean(doctor.id));
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String((error as { code?: unknown }).code) === '23505',
  );
}

/**
 * Accrue a commission for one invoiced visit. The unique
 * `(business_id, doctor_id, visit_id, invoice_id)` constraint makes retries
 * idempotent — a duplicate insert returns the existing earning.
 */
export async function accrueDoctorEarnings(
  businessId: string,
  visitId: string,
  doctorId: string,
  invoiceId: string | null,
  amounts: CommissionBreakdown,
): Promise<DoctorFeeEarning | null> {
  if (!doctorId) return null;
  const contract = await getDoctorContract(businessId, doctorId);
  if (!contract || !contract.is_active) return null;

  const earnedCommission = calculateDoctorCommission(contract, amounts);
  if (earnedCommission <= 0) return null;

  const { data, error } = await db
    .from('doctor_fee_earnings')
    .insert({
      business_id: businessId,
      doctor_id: doctorId,
      visit_id: visitId,
      invoice_id: invoiceId,
      consultation_amount: toMoney(amounts.consultation),
      lab_amount: toMoney(amounts.lab),
      pharmacy_amount: toMoney(amounts.pharmacy),
      earned_commission: earnedCommission,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await db
        .from('doctor_fee_earnings')
        .select('*')
        .eq('business_id', businessId)
        .eq('doctor_id', doctorId)
        .eq('visit_id', visitId)
        .eq('invoice_id', invoiceId)
        .maybeSingle();
      return existing ? normalizeDoctorEarning(existing as Partial<DoctorFeeEarning>) : null;
    }
    throw error;
  }

  return normalizeDoctorEarning(data as Partial<DoctorFeeEarning>);
}

const EARNING_SELECT =
  '*, visit:patient_visits(id,visit_number,visit_date,patient:patients(first_name,last_name,mrn))';

export async function listDoctorEarnings(
  businessId: string,
  status?: DoctorEarningStatus | 'all',
): Promise<DoctorFeeEarning[]> {
  let query = db
    .from('doctor_fee_earnings')
    .select(EARNING_SELECT)
    .eq('business_id', businessId);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  const rows = ((data ?? []) as Partial<DoctorFeeEarning>[]).map(normalizeDoctorEarning);
  return attachDoctorNames(rows);
}

export interface DoctorCommissionJournalLine {
  account_id: string;
  debit: number;
  credit: number;
  description: string;
}

/** Balanced accrual journal lines (pure; tested without a database). */
export function buildDoctorCommissionLines(
  total: number,
  expenseAccountId: string,
  payableAccountId: string,
): DoctorCommissionJournalLine[] {
  const amount = toMoney(total);
  if (amount <= 0) throw new Error('There is no commission to post.');
  if (!expenseAccountId || !payableAccountId) {
    throw new Error('Select both the expense and payable accounts.');
  }
  return [
    {
      account_id: expenseAccountId,
      debit: amount,
      credit: 0,
      description: 'Doctor Professional Fees Expense',
    },
    {
      account_id: payableAccountId,
      debit: 0,
      credit: amount,
      description: 'Accrued Doctor Commissions Payable',
    },
  ];
}

/**
 * Post one accrual journal for a selected set of pending earnings and mark
 * them posted. The posting key is derived from the sorted earning ids, so a
 * retry after a failed status update returns the existing journal.
 */
export async function postDoctorCommissionsToLedger(
  businessId: string,
  earningIds: string[],
  expenseAccountId: string,
  payableAccountId: string,
): Promise<string> {
  const uniqueIds = [...new Set(earningIds.filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error('No pending doctor earnings selected.');

  const { data: earnings, error: fetchError } = await db
    .from('doctor_fee_earnings')
    .select('*')
    .in('id', uniqueIds)
    .eq('business_id', businessId)
    .eq('status', 'pending');

  if (fetchError) throw fetchError;
  const pending = (earnings ?? []) as Array<{ id: string; earned_commission?: number }>;
  if (pending.length === 0) throw new Error('No pending doctor earnings selected.');

  const totalAmount = roundMoney(
    pending.reduce((total, earning) => total + toNumber(earning.earned_commission), 0),
  );
  const lines = buildDoctorCommissionLines(totalAmount, expenseAccountId, payableAccountId);
  const postingKey = `doctor-commission:${pending.map((earning) => earning.id).sort().join(',')}`;

  const { data: journalId, error: rpcError } = await db.rpc('post_financial_journal', {
    p_business_id: businessId,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description: `Accrued Doctor Fees for ${pending.length} clinical visits`,
    p_reference: `DOC-COMM-${Date.now()}`,
    p_source_type: 'doctor_commission',
    p_source_id: pending[0]?.id ?? null,
    p_lines: lines,
    p_posting_key: postingKey,
  });

  if (rpcError) throw rpcError;
  if (!journalId) throw new Error('The commission journal was not posted.');

  const { error: updateError } = await db
    .from('doctor_fee_earnings')
    .update({
      status: 'posted',
      journal_entry_id: String(journalId),
      posted_at: new Date().toISOString(),
    })
    .in('id', pending.map((earning) => earning.id))
    .eq('business_id', businessId);

  if (updateError) throw updateError;
  return String(journalId);
}

/** Balanced payout journal: Dr payable, Cr bank/cash. */
export function buildDoctorPayoutLines(
  total: number,
  payableAccountId: string,
  paymentAccountId: string,
): DoctorCommissionJournalLine[] {
  const amount = toMoney(total);
  if (amount <= 0) throw new Error('There is no payout to post.');
  if (!payableAccountId || !paymentAccountId) {
    throw new Error('Select both the payable and payment accounts.');
  }
  return [
    {
      account_id: payableAccountId,
      debit: amount,
      credit: 0,
      description: 'Clear accrued doctor commissions payable',
    },
    {
      account_id: paymentAccountId,
      debit: 0,
      credit: amount,
      description: 'Doctor commission payout',
    },
  ];
}

/** Pay posted earnings and post the settlement journal. */
export async function postDoctorPayoutToLedger(
  businessId: string,
  earningIds: string[],
  payableAccountId: string,
  paymentAccountId: string,
): Promise<string> {
  const uniqueIds = [...new Set(earningIds.filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error('No posted doctor earnings selected.');

  const { data: earnings, error: fetchError } = await db
    .from('doctor_fee_earnings')
    .select('*')
    .in('id', uniqueIds)
    .eq('business_id', businessId)
    .eq('status', 'posted');

  if (fetchError) throw fetchError;
  const posted = (earnings ?? []) as Array<{ id: string; earned_commission?: number }>;
  if (posted.length === 0) throw new Error('No posted doctor earnings selected.');

  const totalAmount = roundMoney(
    posted.reduce((total, earning) => total + toNumber(earning.earned_commission), 0),
  );
  const lines = buildDoctorPayoutLines(totalAmount, payableAccountId, paymentAccountId);
  const postingKey = `doctor-payout:${posted.map((earning) => earning.id).sort().join(',')}`;

  const { data: journalId, error: rpcError } = await db.rpc('post_financial_journal', {
    p_business_id: businessId,
    p_entry_date: new Date().toISOString().slice(0, 10),
    p_description: `Doctor commission payout for ${posted.length} accruals`,
    p_reference: `DOC-PAY-${Date.now()}`,
    p_source_type: 'doctor_payout',
    p_source_id: posted[0]?.id ?? null,
    p_lines: lines,
    p_posting_key: postingKey,
  });

  if (rpcError) throw rpcError;
  if (!journalId) throw new Error('The payout journal was not posted.');

  const { error: updateError } = await db
    .from('doctor_fee_earnings')
    .update({
      status: 'paid',
      payout_journal_entry_id: String(journalId),
      paid_at: new Date().toISOString(),
    })
    .in('id', posted.map((earning) => earning.id))
    .eq('business_id', businessId);

  if (updateError) throw updateError;
  return String(journalId);
}

/** Mark already-paid earnings without a journal (for externally paid cases). */
export async function markDoctorEarningsPaid(
  businessId: string,
  earningIds: string[],
): Promise<void> {
  const ids = [...new Set(earningIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { error } = await db
    .from('doctor_fee_earnings')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .in('id', ids)
    .eq('business_id', businessId);

  if (error) throw error;
}

export function summarizeEarnings(earnings: readonly DoctorFeeEarning[]) {
  const pending = earnings.filter((earning) => earning.status === 'pending');
  const posted = earnings.filter((earning) => earning.status === 'posted');
  const paid = earnings.filter((earning) => earning.status === 'paid');

  return {
    pendingCount: pending.length,
    pendingAmount: roundMoney(
      pending.reduce((total, earning) => total + toMoney(earning.earned_commission), 0),
    ),
    postedCount: posted.length,
    postedAmount: roundMoney(
      posted.reduce((total, earning) => total + toMoney(earning.earned_commission), 0),
    ),
    paidCount: paid.length,
    paidAmount: roundMoney(
      paid.reduce((total, earning) => total + toMoney(earning.earned_commission), 0),
    ),
  };
}

/** Group earnings by doctor for the payout statement selector. */
export function groupEarningsByDoctor(
  earnings: readonly DoctorFeeEarning[],
): Map<string, DoctorFeeEarning[]> {
  const groups = new Map<string, DoctorFeeEarning[]>();
  for (const earning of earnings) {
    const list = groups.get(earning.doctor_id) ?? [];
    list.push(earning);
    groups.set(earning.doctor_id, list);
  }
  return groups;
}
