import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  HandCoins,
  Plus,
  Printer,
  Receipt,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  ErrorNotice,
  LoadingNotice,
} from '@/components/healthcare/healthcareUi';
import { DoctorContractModal } from '@/components/healthcare/DoctorContractModal';
import { DoctorPayoutVoucherModal } from '@/components/healthcare/DoctorPayoutVoucherModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue } from '@/lib/healthcare/format';
import {
  doctorDisplayName,
  listClinicDoctors,
  listDoctorContracts,
  listDoctorEarnings,
  postDoctorCommissionsToLedger,
  summarizeEarnings,
} from '@/services/doctorFeeService';
import type {
  AccountOption,
  DoctorEarningStatus,
  DoctorFeeContract,
  DoctorFeeEarning,
} from '@/types/healthcare';

type CommissionTab = 'earnings' | 'contracts';
type EarningFilter = DoctorEarningStatus | 'all';

const EARNING_STATUSES: EarningFilter[] = ['all', 'pending', 'posted', 'paid'];

const STATUS_STYLES: Record<DoctorEarningStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-sky-200 bg-sky-50 text-sky-700',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paid: 'border-teal-200 bg-teal-50 text-teal-700',
};

function doctorName(earning: DoctorFeeEarning): string {
  return doctorDisplayName(
    earning.doctor,
    earning.doctor_id ? earning.doctor_id.slice(0, 8).toUpperCase() : '',
  );
}

/** Doctor revenue-share desk: accruals, journals, contracts and payouts. */
export function DoctorCommissionsStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [tab, setTab] = useState<CommissionTab>('earnings');
  const [statusFilter, setStatusFilter] = useState<EarningFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [payableAccountId, setPayableAccountId] = useState('');
  const [contractEditor, setContractEditor] = useState<{
    open: boolean;
    contract: DoctorFeeContract | null;
  }>({ open: false, contract: null });
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);

  const earningsQuery = useQuery({
    queryKey: ['healthcare', 'doctorFees', 'earnings', businessId],
    queryFn: () => listDoctorEarnings(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const contractsQuery = useQuery({
    queryKey: ['healthcare', 'doctorFees', 'contracts', businessId],
    queryFn: () => listDoctorContracts(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });

  const doctorsQuery = useQuery({
    queryKey: ['healthcare', 'doctorFees', 'doctors', businessId],
    queryFn: () => listClinicDoctors(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'posting', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });

  const earnings = useMemo(() => earningsQuery.data ?? [], [earningsQuery.data]);
  const contracts = useMemo(() => contractsQuery.data ?? [], [contractsQuery.data]);
  const doctors = useMemo(() => doctorsQuery.data ?? [], [doctorsQuery.data]);
  const accounts: AccountOption[] = useMemo(
    () =>
      (accountsQuery.data ?? []).map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        account_type: account.account_type,
        account_subtype: account.account_subtype,
        is_bank_account: account.is_bank_account,
      })),
    [accountsQuery.data],
  );

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => account.account_type === 'expense'),
    [accounts],
  );
  const payableAccounts = useMemo(
    () => accounts.filter((account) => account.account_type === 'liability'),
    [accounts],
  );

  const defaultExpense =
    contracts.find((contract) => contract.expense_account_id)?.expense_account_id ??
    expenseAccounts[0]?.id ??
    '';
  const defaultPayable =
    contracts.find((contract) => contract.payable_account_id)?.payable_account_id ??
    payableAccounts[0]?.id ??
    '';
  const effectiveExpense = expenseAccountId || defaultExpense;
  const effectivePayable = payableAccountId || defaultPayable;

  const filteredEarnings = useMemo(
    () =>
      statusFilter === 'all'
        ? earnings
        : earnings.filter((earning) => earning.status === statusFilter),
    [earnings, statusFilter],
  );

  const summary = useMemo(() => summarizeEarnings(earnings), [earnings]);
  const selectedEarnings = useMemo(
    () => earnings.filter((earning) => selectedIds.includes(earning.id)),
    [earnings, selectedIds],
  );
  const selectedPending = selectedEarnings.filter((earning) => earning.status === 'pending');
  const selectedDoctorIds = new Set(selectedEarnings.map((earning) => earning.doctor_id));
  const voucherReady =
    selectedEarnings.length > 0 &&
    selectedDoctorIds.size === 1 &&
    selectedEarnings.every((earning) => earning.status !== 'pending');
  const postReady =
    canWrite &&
    selectedPending.length > 0 &&
    Boolean(effectiveExpense) &&
    Boolean(effectivePayable);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'doctorFees'] });
  };

  const toggleSelected = (earningId: string) => {
    setSelectedIds((current) =>
      current.includes(earningId)
        ? current.filter((id) => id !== earningId)
        : [...current, earningId],
    );
  };

  const postCommissions = async () => {
    if (!businessId || !postReady) return;
    setActionError(null);
    setIsPosting(true);
    try {
      await postDoctorCommissionsToLedger(
        businessId,
        selectedPending.map((earning) => earning.id),
        effectiveExpense,
        effectivePayable,
      );
      setSelectedIds([]);
      invalidate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('healthcare.doctorFees.postError'),
      );
    } finally {
      setIsPosting(false);
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.doctorFees.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <HandCoins className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.doctorFees.title')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.doctorFees.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setVoucherOpen(true)}
            disabled={!voucherReady}
          >
            <Printer className="h-4 w-4" aria-hidden />
            {t('healthcare.doctorFees.printVoucher')}
          </Button>
          <Button variant="secondary" onClick={() => setContractEditor({ open: true, contract: null })} disabled={!canWrite}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.doctorFees.contract.createTitle')}
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.doctorFees.metrics.pending')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCurrency(summary.pendingAmount, currency)}
          </p>
          <p className="text-[11px] text-gray-400">
            {t('healthcare.doctorFees.metrics.accruals', { total: summary.pendingCount })}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.doctorFees.metrics.posted')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">
            {formatCurrency(summary.postedAmount, currency)}
          </p>
          <p className="text-[11px] text-gray-400">
            {t('healthcare.doctorFees.metrics.accruals', { total: summary.postedCount })}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.doctorFees.metrics.paid')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-teal-700">
            {formatCurrency(summary.paidAmount, currency)}
          </p>
          <p className="text-[11px] text-gray-400">
            {t('healthcare.doctorFees.metrics.accruals', { total: summary.paidCount })}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200">
        {(['earnings', 'contracts'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            aria-pressed={tab === option}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition ${
              tab === option
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {option === 'earnings' ? <Receipt className="h-4 w-4" aria-hidden /> : null}
            {option === 'contracts' ? <BookOpen className="h-4 w-4" aria-hidden /> : null}
            {t(`healthcare.doctorFees.tabs.${option}`)}
          </button>
        ))}
      </div>

      {actionError ? <div className="mb-3"><ErrorNotice message={actionError} /></div> : null}
      {earningsQuery.isLoading ? <LoadingNotice label={t('healthcare.doctorFees.loading')} /> : null}
      {earningsQuery.isError ? (
        <ErrorNotice
          message={
            earningsQuery.error instanceof Error
              ? earningsQuery.error.message
              : t('healthcare.doctorFees.loadError')
          }
        />
      ) : null}

      {tab === 'earnings' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label>
              <span className="sr-only">{t('healthcare.doctorFees.filterStatus')}</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as EarningFilter)}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              >
                {EARNING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all'
                      ? t('healthcare.doctorFees.allStatuses')
                      : t(`healthcare.doctorFees.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" size="sm" onClick={() => void earningsQuery.refetch()}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.doctorFees.refresh')}
            </Button>
            <div className="ml-auto flex flex-wrap items-end gap-2">
              <label className="min-w-[180px]">
                <span className="block text-[11px] font-semibold text-gray-500">
                  {t('healthcare.doctorFees.contract.expenseAccount')}
                </span>
                <select
                  value={effectiveExpense}
                  onChange={(event) => setExpenseAccountId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800"
                  disabled={!canWrite}
                >
                  <option value="">{t('healthcare.doctorFees.contract.selectAccount')}</option>
                  {expenseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[180px]">
                <span className="block text-[11px] font-semibold text-gray-500">
                  {t('healthcare.doctorFees.contract.payableAccount')}
                </span>
                <select
                  value={effectivePayable}
                  onChange={(event) => setPayableAccountId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-800"
                  disabled={!canWrite}
                >
                  <option value="">{t('healthcare.doctorFees.contract.selectAccount')}</option>
                  {payableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={() => void postCommissions()} isLoading={isPosting} disabled={!postReady}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {isPosting ? t('healthcare.doctorFees.posting') : t('healthcare.doctorFees.postToLedger')}
              </Button>
            </div>
          </div>

          {filteredEarnings.length === 0 && earningsQuery.isSuccess ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <HandCoins className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.doctorFees.emptyEarnings')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.doctorFees.emptyEarningsHint')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <caption className="sr-only">{t('healthcare.doctorFees.earningsTab')}</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">{t('healthcare.doctorFees.select')}</span>
                    </th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.doctorName')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.visit')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.voucher.consultation')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.voucher.laboratory')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.voucher.pharmacy')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.earnedCommission')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.statusLabel')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredEarnings.map((earning) => (
                    <tr key={earning.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(earning.id)}
                          onChange={() => toggleSelected(earning.id)}
                          aria-label={t('healthcare.doctorFees.selectEarning')}
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{doctorName(earning)}</td>
                      <td className="px-3 py-2">
                        <p className="font-mono text-[11px] text-gray-600">
                          {earning.visit?.visit_number ?? earning.visit_id.slice(0, 8).toUpperCase()}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {formatDateValue(earning.visit?.visit_date ?? earning.created_at)}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(earning.consultation_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(earning.lab_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(earning.pharmacy_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">
                        {formatCurrency(earning.earned_commission, currency)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[earning.status]}`}
                        >
                          {t(`healthcare.doctorFees.status.${earning.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-400">{t('healthcare.doctorFees.selectionHint')}</p>
        </section>
      ) : null}

      {tab === 'contracts' ? (
        <section className="space-y-3">
          {contractsQuery.isLoading ? (
            <LoadingNotice label={t('healthcare.doctorFees.loading')} />
          ) : null}
          {contracts.length === 0 && contractsQuery.isSuccess ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <BadgeCheck className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.doctorFees.emptyContracts')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.doctorFees.emptyContractsHint')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <caption className="sr-only">{t('healthcare.doctorFees.contractsTab')}</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.doctorName')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.contractType')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.contract.consultationShare')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.fixedFee')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.contract.labShare')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.contract.pharmacyShare')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.doctorFees.statusLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.doctorFees.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contracts.map((contract) => (
                    <tr key={contract.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {doctorDisplayName(
                          contract.doctor,
                          contract.doctor_id.slice(0, 8).toUpperCase(),
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {t(`healthcare.doctorFees.type.${contract.contract_type}`)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {contract.consultation_share_percent.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(contract.fixed_consultation_fee, currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {contract.lab_procedure_share_percent.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {contract.pharmacy_share_percent.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            contract.is_active
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-gray-200 bg-gray-50 text-gray-500'
                          }`}
                        >
                          {contract.is_active
                            ? t('healthcare.doctorFees.contract.statusActive')
                            : t('healthcare.doctorFees.contract.statusInactive')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setContractEditor({ open: true, contract })}
                          disabled={!canWrite}
                        >
                          {t('healthcare.doctorFees.contract.edit')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <DoctorContractModal
        open={contractEditor.open}
        onClose={() => setContractEditor({ open: false, contract: null })}
        businessId={businessId}
        contract={contractEditor.contract}
        doctors={doctors}
        accounts={accounts}
        canWrite={canWrite}
        onSaved={() => {
          invalidate();
          setContractEditor({ open: false, contract: null });
        }}
      />

      <DoctorPayoutVoucherModal
        open={voucherOpen}
        onClose={() => setVoucherOpen(false)}
        earnings={voucherReady ? selectedEarnings : []}
        currency={currency}
      />
    </div>
  );
}
