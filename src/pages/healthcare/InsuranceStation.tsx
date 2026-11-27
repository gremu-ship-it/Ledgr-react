import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  Download,
  FileCheck2,
  Plus,
  Receipt,
  RotateCw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  ErrorNotice,
  LoadingNotice,
} from '@/components/healthcare/healthcareUi';
import { ClaimStatusBadge } from '@/components/healthcare/ClaimStatusBadge';
import { CreateInsuranceProviderModal } from '@/components/healthcare/CreateInsuranceProviderModal';
import { SettleClaimModal } from '@/components/healthcare/SettleClaimModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import {
  exportClaimsToCsv,
  filterClaimsByStatus,
  getInsuranceProviders,
  listInsuranceClaims,
  setInsuranceProviderActive,
  summarizeClaims,
} from '@/services/insuranceService';
import type {
  AccountOption,
  ClaimStatus,
  InsuranceClaim,
  InsuranceProvider,
} from '@/types/healthcare';

type InsuranceTab = 'claims' | 'providers' | 'remittance';

const STATUS_FILTERS: Array<ClaimStatus | 'all'> = [
  'all',
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'disputed',
  'settled',
];

/** Claims desk: worklist, payer directory and remittance reconciliation. */
export function InsuranceStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [tab, setTab] = useState<InsuranceTab>('claims');
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [providerEditor, setProviderEditor] = useState<{
    open: boolean;
    provider: InsuranceProvider | null;
  }>({ open: false, provider: null });
  const [settleTarget, setSettleTarget] = useState<InsuranceClaim | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const claimsQuery = useQuery({
    queryKey: ['healthcare', 'insurance', 'claims', businessId],
    queryFn: () => listInsuranceClaims(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const providersQuery = useQuery({
    queryKey: ['healthcare', 'insurance', 'providers', businessId],
    queryFn: () => getInsuranceProviders(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'posting', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });

  const claims = useMemo(() => claimsQuery.data ?? [], [claimsQuery.data]);
  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
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

  const filteredClaims = useMemo(() => {
    const byStatus = filterClaimsByStatus(claims, statusFilter);
    const term = search.trim().toLowerCase();
    if (!term) return byStatus;
    return byStatus.filter((claim) => {
      const patient = patientDisplayName(claim.patient).toLowerCase();
      return (
        claim.claim_number.toLowerCase().includes(term) ||
        patient.includes(term) ||
        (claim.patient?.mrn ?? '').toLowerCase().includes(term) ||
        (claim.provider?.name ?? '').toLowerCase().includes(term) ||
        (claim.remittance_reference ?? '').toLowerCase().includes(term)
      );
    });
  }, [claims, search, statusFilter]);

  const summary = useMemo(() => summarizeClaims(claims), [claims]);
  const settledClaims = useMemo(
    () => claims.filter((claim) => claim.status === 'settled'),
    [claims],
  );
  const selectedClaim = useMemo(
    () => claims.find((claim) => claim.id === selectedClaimId) ?? null,
    [claims, selectedClaimId],
  );
  const settleableClaim = useMemo(
    () =>
      selectedClaim && selectedClaim.status !== 'settled'
        ? selectedClaim
        : claims.find((claim) => claim.status !== 'settled') ?? null,
    [claims, selectedClaim],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'insurance'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill'] });
  };

  const toggleProvider = async (provider: InsuranceProvider) => {
    if (!businessId) return;
    setActionError(null);
    try {
      await setInsuranceProviderActive(businessId, provider.id, !provider.is_active);
      await queryClient.invalidateQueries({ queryKey: ['healthcare', 'insurance'] });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('healthcare.insurance.provider.toggleError'),
      );
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.insurance.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.insurance.title')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.insurance.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setProviderEditor({ open: true, provider: null })}
            disabled={!canWrite}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.insurance.addProvider')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportClaimsToCsv(filteredClaims)}
            disabled={filteredClaims.length === 0}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('healthcare.insurance.exportCsv')}
          </Button>
          <Button
            onClick={() => setSettleTarget(settleableClaim)}
            disabled={!canWrite || !settleableClaim}
          >
            <FileCheck2 className="h-4 w-4" aria-hidden />
            {t('healthcare.insurance.settleClaim')}
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.insurance.metrics.open')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.openClaims}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.insurance.metrics.outstanding')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatCurrency(summary.outstanding, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.insurance.settled')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">
            {formatCurrency(summary.settled, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.insurance.disallowance')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">
            {formatCurrency(summary.disallowed, currency)}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200">
        {(['claims', 'providers', 'remittance'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            aria-pressed={tab === option}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition ${
              tab === option
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {option === 'claims' ? <Receipt className="h-4 w-4" aria-hidden /> : null}
            {option === 'providers' ? <Building2 className="h-4 w-4" aria-hidden /> : null}
            {option === 'remittance' ? <WalletCards className="h-4 w-4" aria-hidden /> : null}
            {t(`healthcare.insurance.tabs.${option}`)}
          </button>
        ))}
      </div>

      {actionError ? <div className="mb-3"><ErrorNotice message={actionError} /></div> : null}
      {claimsQuery.isLoading ? <LoadingNotice label={t('healthcare.insurance.loading')} /> : null}
      {claimsQuery.isError ? (
        <ErrorNotice
          message={
            claimsQuery.error instanceof Error
              ? claimsQuery.error.message
              : t('healthcare.insurance.loadError')
          }
        />
      ) : null}

      {tab === 'claims' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">{t('healthcare.insurance.search')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('healthcare.insurance.searchPlaceholder')}
                className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label>
              <span className="sr-only">{t('healthcare.insurance.filterStatus')}</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ClaimStatus | 'all')
                }
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all'
                      ? t('healthcare.insurance.allStatuses')
                      : t(`healthcare.insurance.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" size="sm" onClick={() => void claimsQuery.refetch()}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.insurance.refresh')}
            </Button>
          </div>

          {filteredClaims.length === 0 && claimsQuery.isSuccess ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.insurance.emptyClaims')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.insurance.emptyClaimsHint')}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <caption className="sr-only">{t('healthcare.insurance.claimsTab')}</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                    <th scope="col" className="px-3 py-2">{t('healthcare.insurance.claimNumber')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.insurance.patient')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.insurance.payer')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.totalBill')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.patientPortion')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.insurerPortion')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.settled')}</th>
                    <th scope="col" className="px-3 py-2">{t('healthcare.insurance.statusLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredClaims.map((claim) => (
                    <tr
                      key={claim.id}
                      onClick={() => setSelectedClaimId(claim.id)}
                      className={`cursor-pointer transition hover:bg-indigo-50/40 ${
                        selectedClaimId === claim.id ? 'bg-indigo-50/70' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{claim.claim_number}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">
                          {patientDisplayName(claim.patient) || t('healthcare.insurance.unknownPatient')}
                        </p>
                        <p className="font-mono text-[11px] text-gray-500">{claim.patient?.mrn ?? '—'}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{claim.provider?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(claim.total_bill_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-sky-800">
                        {formatCurrency(claim.patient_copay_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-800">
                        {formatCurrency(claim.insurer_claim_amount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrency(claim.settled_amount ?? 0, currency)}
                      </td>
                      <td className="px-3 py-2"><ClaimStatusBadge status={claim.status} /></td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canWrite || claim.status === 'settled'}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedClaimId(claim.id);
                            setSettleTarget(claim);
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {t('healthcare.insurance.settle.action')}
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

      {tab === 'providers' ? (
        <section className="space-y-3">
          {providersQuery.isLoading ? (
            <LoadingNotice label={t('healthcare.insurance.providersLoading')} />
          ) : null}
          {providers.length === 0 && providersQuery.isSuccess ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <Building2 className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.insurance.provider.empty')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.insurance.provider.emptyHint')}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {providers.map((provider) => (
                <article
                  key={provider.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{provider.name}</h3>
                      <p className="font-mono text-[11px] text-gray-500">
                        {provider.payer_code || t('healthcare.insurance.provider.noCode')}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        provider.is_active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-gray-50 text-gray-500'
                      }`}
                    >
                      {provider.is_active
                        ? t('healthcare.insurance.provider.active')
                        : t('healthcare.insurance.provider.inactive')}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-gray-400">{t('healthcare.insurance.defaultCopay')}</dt>
                      <dd className="font-semibold text-gray-800">
                        {provider.default_copay_percent.toFixed(2)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-400">{t('healthcare.insurance.provider.creditDays')}</dt>
                      <dd className="font-semibold text-gray-800">{provider.credit_period_days}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-gray-400">{t('healthcare.insurance.provider.contact')}</dt>
                      <dd className="text-gray-700">
                        {[provider.contact_person, provider.contact_phone, provider.contact_email]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setProviderEditor({ open: true, provider })}
                      disabled={!canWrite}
                    >
                      {t('healthcare.insurance.provider.edit')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void toggleProvider(provider)}
                      disabled={!canWrite}
                    >
                      {provider.is_active
                        ? t('healthcare.insurance.provider.deactivate')
                        : t('healthcare.insurance.provider.activate')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === 'remittance' ? (
        <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <caption className="sr-only">{t('healthcare.insurance.tabs.remittance')}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th scope="col" className="px-3 py-2">{t('healthcare.insurance.claimNumber')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.insurance.payer')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.insurance.settle.remittanceReference')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.insurance.settle.date')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.insurerPortion')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.settled')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('healthcare.insurance.disallowance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {settledClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-500">
                    {t('healthcare.insurance.remittanceEmpty')}
                  </td>
                </tr>
              ) : (
                settledClaims.map((claim) => (
                  <tr key={claim.id}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{claim.claim_number}</td>
                    <td className="px-3 py-2 text-gray-700">{claim.provider?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{claim.remittance_reference ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatDateValue(claim.settlement_date)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatCurrency(claim.insurer_claim_amount, currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-emerald-800">
                      {formatCurrency(claim.settled_amount ?? 0, currency)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-800">
                      {formatCurrency(claim.disallowance_amount ?? 0, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      <CreateInsuranceProviderModal
        open={providerEditor.open}
        onClose={() => setProviderEditor({ open: false, provider: null })}
        businessId={businessId}
        provider={providerEditor.provider}
        accounts={accounts}
        canWrite={canWrite}
        onSaved={() => {
          invalidate();
          void queryClient.invalidateQueries({
            queryKey: ['healthcare', 'insurance', 'providers'],
          });
        }}
      />

      <SettleClaimModal
        open={Boolean(settleTarget)}
        onClose={() => setSettleTarget(null)}
        businessId={businessId}
        claim={settleTarget}
        currency={currency}
        accounts={accounts}
        canWrite={canWrite}
        onSettled={() => {
          setSettleTarget(null);
          invalidate();
        }}
      />
    </div>
  );
}
