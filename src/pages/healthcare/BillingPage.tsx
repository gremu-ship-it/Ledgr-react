import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  CreditCard,
  FileCheck2,
  FileText,
  Printer,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  BillingTypeBadge,
  ErrorNotice,
  LoadingNotice,
  StageBadge,
} from '@/components/healthcare/healthcareUi';
import { SplitBillingCard } from '@/components/healthcare/SplitBillingCard';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  createInvoiceForVisit,
  getPatientVisitBill,
  listOpenVisits,
  type BillItem,
  type BillingCategory,
  type CreatedInvoice,
} from '@/services/healthcareService';
import {
  applyCopayCap,
  calculateSplitBill,
  createClaimForVisit,
  getClaimForVisit,
  getInsuranceProviders,
} from '@/services/insuranceService';
import type {
  ClaimServiceCategory,
  InsuranceClaim,
  SplitBillBreakdown,
} from '@/types/healthcare';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';

const CATEGORY_LABEL_KEYS: Record<BillingCategory, string> = {
  consultation: 'healthcare.billing.categoryConsultation',
  laboratory: 'healthcare.billing.categoryLaboratory',
  pharmacy: 'healthcare.billing.categoryPharmacy',
  procedure: 'healthcare.billing.categoryProcedure',
};

const CATEGORY_STYLES: Record<BillingCategory, string> = {
  consultation: 'bg-brand-50 text-brand-700 border-brand-200',
  laboratory: 'bg-amber-50 text-amber-800 border-amber-200',
  pharmacy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  procedure: 'bg-violet-50 text-violet-700 border-violet-200',
};

/** Itemized patient bill and the bridge into Ledgr Invoicing. */
export function BillingPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const visitId = searchParams.get('visitId');

  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [contactId, setContactId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<CreatedInvoice | null>(null);
  const [createdClaim, setCreatedClaim] = useState<InsuranceClaim | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Insurance split-billing state. `null` means "use the payer default", so a
  // business that has not customised the co-pay still gets the provider rate.
  const [providerId, setProviderId] = useState('');
  const [copayPercent, setCopayPercent] = useState<string | null>(null);
  const [copayCap, setCopayCap] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [memberId, setMemberId] = useState('');
  const [preAuthCode, setPreAuthCode] = useState('');

  const visitsQuery = useQuery({
    queryKey: ['healthcare', 'openVisits', businessId],
    queryFn: () => listOpenVisits(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const visits = useMemo(() => visitsQuery.data ?? [], [visitsQuery.data]);
  const selectedVisit = useMemo(
    () => visits.find((visit) => visit.id === visitId) ?? null,
    [visits, visitId],
  );

  const billQuery = useQuery({
    queryKey: ['healthcare', 'bill', visitId],
    queryFn: () => getPatientVisitBill(visitId as string),
    enabled: Boolean(visitId),
    staleTime: 5_000,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', businessId, 'customer'],
    queryFn: () => repos.contact.findByBusiness(businessId as string, 'customer'),
    enabled: Boolean(businessId) && canWrite,
    staleTime: 60_000,
  });

  const providersQuery = useQuery({
    queryKey: ['healthcare', 'insurance', 'providers', businessId],
    queryFn: () => getInsuranceProviders(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });

  const visitClaimQuery = useQuery({
    queryKey: ['healthcare', 'insurance', 'visit', businessId, visitId],
    queryFn: () => getClaimForVisit(businessId as string, visitId as string),
    enabled: Boolean(businessId) && Boolean(visitId),
    staleTime: 5_000,
  });

  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const existingClaim = visitClaimQuery.data ?? null;
  const bill = billQuery.data ?? null;
  const isInsuranceBill = bill?.billingType === 'insurance';

  const matchedProvider = useMemo(() => {
    const name = (bill?.insuranceProvider ?? '').trim().toLowerCase();
    if (!name) return null;
    return providers.find((provider) => provider.name.trim().toLowerCase() === name) ?? null;
  }, [bill?.insuranceProvider, providers]);

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === providerId) ??
      matchedProvider ??
      null,
    [matchedProvider, providerId, providers],
  );

  const effectiveCopayPercent = useMemo(() => {
    if (copayPercent !== null && copayPercent.trim() !== '') {
      const parsed = Number(copayPercent);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return selectedProvider?.default_copay_percent ?? 0;
  }, [copayPercent, selectedProvider?.default_copay_percent]);

  const capValue = useMemo(() => {
    const parsed = Number(copayCap);
    return copayCap.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [copayCap]);

  const splitBreakdown: SplitBillBreakdown | null = useMemo(() => {
    if (!bill || bill.items.length === 0) return null;
    const calculatorItems = bill.items.map((item) => ({
      category: (item.category === 'laboratory'
        ? 'laboratory'
        : item.category === 'pharmacy'
        ? 'medication'
        : item.category) as ClaimServiceCategory,
      description: item.description,
      amount: item.total,
    }));
    return applyCopayCap(calculateSplitBill(calculatorItems, effectiveCopayPercent), capValue);
  }, [bill, capValue, effectiveCopayPercent]);

  const insurerInvoiceLines: BillItem[] = useMemo(() => {
    if (!splitBreakdown) return [];
    const categoryForInvoice = (category: ClaimServiceCategory): BillingCategory => {
      if (category === 'medication') return 'pharmacy';
      if (category === 'laboratory') return 'laboratory';
      if (category === 'consultation') return 'consultation';
      return 'procedure';
    };
    return splitBreakdown.items
      .filter((item) => item.insurerShare > 0)
      .map((item) => ({
        description: item.description,
        category: categoryForInvoice(item.category),
        quantity: 1,
        unitPrice: item.insurerShare,
        total: item.insurerShare,
      }));
  }, [splitBreakdown]);

  const insuranceReady = Boolean(
    businessId &&
      canWrite &&
      selectedProvider &&
      selectedProvider.is_active &&
      splitBreakdown &&
      splitBreakdown.insurerClaim > 0 &&
      insurerInvoiceLines.length > 0 &&
      !existingClaim &&
      !selectedVisit?.invoice_id,
  );

  const createInvoice = async () => {
    if (!businessId || !visitId) return;
    setCreateError(null);
    if (!contactId) {
      setCreateError(t('healthcare.billing.invoiceCustomerRequired'));
      return;
    }
    setIsCreating(true);
    try {
      const invoice = await createInvoiceForVisit({
        businessId,
        visitId,
        contactId,
        currency,
      });
      setCreatedInvoice(invoice);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill', visitId] }),
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] }),
      ]);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t('healthcare.billing.invoiceError'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const submitClaimOnly = async () => {
    if (
      !businessId ||
      !visitId ||
      !bill ||
      !selectedProvider ||
      !splitBreakdown ||
      !createdInvoice
    ) {
      return;
    }
    setCreateError(null);
    if (existingClaim) {
      setCreateError(t('healthcare.insurance.billing.alreadyClaimed'));
      return;
    }
    setIsCreating(true);
    try {
      const claim = await createClaimForVisit(businessId, {
        visitId,
        patientId: bill.patientId ?? selectedVisit?.patient_id ?? '',
        providerId: selectedProvider.id,
        invoiceId: createdInvoice.invoiceId,
        policyNumber: policyNumber.trim() || bill.insurancePolicyNumber || undefined,
        memberId: memberId.trim() || bill.insuranceMemberId || undefined,
        preAuthCode: preAuthCode.trim() || undefined,
        splitBreakdown,
      });
      setCreatedClaim(claim);
      await queryClient.invalidateQueries({ queryKey: ['healthcare', 'insurance'] });
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t('healthcare.insurance.billing.error'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const submitInsuranceBilling = async () => {
    if (
      !businessId ||
      !visitId ||
      !bill ||
      !selectedProvider ||
      !splitBreakdown ||
      insurerInvoiceLines.length === 0
    ) {
      return;
    }
    setCreateError(null);
    if (!contactId) {
      setCreateError(t('healthcare.insurance.billing.contactRequired'));
      return;
    }
    if (existingClaim) {
      setCreateError(t('healthcare.insurance.billing.alreadyClaimed'));
      return;
    }
    if (selectedVisit?.invoice_id) {
      setCreateError(t('healthcare.insurance.billing.alreadyInvoiced'));
      return;
    }

    setIsCreating(true);
    try {
      const invoice = await createInvoiceForVisit({
        businessId,
        visitId,
        contactId,
        currency,
        dueInDays: selectedProvider.credit_period_days,
        invoiceLines: insurerInvoiceLines,
      });
      setCreatedInvoice(invoice);

      const claim = await createClaimForVisit(businessId, {
        visitId,
        patientId: bill.patientId ?? selectedVisit?.patient_id ?? '',
        providerId: selectedProvider.id,
        invoiceId: invoice.invoiceId,
        policyNumber: policyNumber.trim() || bill.insurancePolicyNumber || undefined,
        memberId: memberId.trim() || bill.insuranceMemberId || undefined,
        preAuthCode: preAuthCode.trim() || undefined,
        splitBreakdown,
      });
      setCreatedClaim(claim);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill', visitId] }),
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['healthcare', 'insurance'] }),
      ]);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : t('healthcare.insurance.billing.error'),
      );
    } finally {
      setIsCreating(false);
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Receipt className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.billing.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.billing.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {visitId && (
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.billing.print')}
            </Button>
          )}
          <Link
            to="/invoices"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.billing.openInvoices')}
          </Link>
        </div>
      </header>

      <label className="mb-4 block max-w-xl">
        <span className="text-xs font-semibold text-gray-600">{t('healthcare.billing.selectVisit')}</span>
        <select
          value={visitId ?? ''}
          onChange={(event) => {
            setCreatedInvoice(null);
            setCreatedClaim(null);
            setCreateError(null);
            setProviderId('');
            setCopayPercent(null);
            setCopayCap('');
            setPolicyNumber('');
            setMemberId('');
            setPreAuthCode('');
            if (event.target.value) {
              setSearchParams({ visitId: event.target.value });
            } else {
              setSearchParams({});
            }
          }}
          className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        >
          <option value="">{t('healthcare.billing.selectVisitPlaceholder')}</option>
          {visits.map((visit) => (
            <option key={visit.id} value={visit.id}>
              {patientDisplayName(visit.patient)} · {visit.patient?.mrn ?? ''} · {visit.visit_number}
            </option>
          ))}
        </select>
      </label>

      {visitsQuery.isLoading && <LoadingNotice label={t('healthcare.billing.loading')} />}
      {visitsQuery.isError && (
        <ErrorNotice
          message={
            visitsQuery.error instanceof Error
              ? visitsQuery.error.message
              : t('healthcare.billing.loadError')
          }
        />
      )}

      {!visitId && visitsQuery.isSuccess && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <Receipt className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <p className="mt-2 text-sm font-medium text-gray-700">{t('healthcare.billing.noVisitSelected')}</p>
          <p className="mt-1 text-xs text-gray-500">{t('healthcare.billing.selectVisitHint')}</p>
        </div>
      )}

      {visitId && billQuery.isLoading && <LoadingNotice label={t('healthcare.billing.loading')} />}
      {visitId && billQuery.isError && (
        <ErrorNotice
          message={
            billQuery.error instanceof Error
              ? billQuery.error.message
              : t('healthcare.billing.loadError')
          }
        />
      )}

      {billQuery.data && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {billQuery.data.patientName || t('healthcare.workspace.unknownPatient')}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-gray-500">
                  {billQuery.data.mrn} {selectedVisit ? `· ${selectedVisit.visit_number}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <BillingTypeBadge billingType={billQuery.data.billingType} />
                  {selectedVisit && <StageBadge stage={selectedVisit.stage} />}
                  {billQuery.data.billingType !== 'cash' && billQuery.data.insuranceProvider && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      {billQuery.data.insuranceProvider}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{t('healthcare.billing.billDate')}</p>
                <p className="font-medium text-gray-700">
                  {formatDateValue(new Date().toISOString())}
                </p>
              </div>
            </div>

            {selectedVisit?.invoice_id && (
              <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                <BadgeCheck className="h-4 w-4" aria-hidden />
                {t('healthcare.billing.linkedInvoice')}
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <caption className="sr-only">{t('healthcare.billing.itemsTitle')}</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                    <th scope="col" className="px-2 py-2">{t('healthcare.billing.description')}</th>
                    <th scope="col" className="px-2 py-2">{t('healthcare.billing.category')}</th>
                    <th scope="col" className="px-2 py-2 text-right">{t('healthcare.billing.quantity')}</th>
                    <th scope="col" className="px-2 py-2 text-right">{t('healthcare.billing.unitPrice')}</th>
                    <th scope="col" className="px-2 py-2 text-right">{t('healthcare.billing.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {billQuery.data.items.map((item, index) => (
                    <tr key={`${item.category}-${index}-${item.description}`}>
                      <td className="px-2 py-2 text-gray-800">{item.description}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_STYLES[item.category]}`}>
                          {t(CATEGORY_LABEL_KEYS[item.category])}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-gray-700">{item.quantity}</td>
                      <td className="px-2 py-2 text-right text-gray-700">
                        {formatCurrency(item.unitPrice, currency)}
                      </td>
                      <td className="px-2 py-2 text-right font-medium text-gray-900">
                        {formatCurrency(item.total, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <dl className="w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <dt>{t('healthcare.billing.subtotal')}</dt>
                  <dd>{formatCurrency(billQuery.data.subtotal, currency)}</dd>
                </div>
                <div className="flex justify-between text-gray-600">
                  <dt>{t('healthcare.billing.tax')}</dt>
                  <dd>{formatCurrency(billQuery.data.tax, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1.5 text-base font-semibold text-gray-900">
                  <dt>{t('healthcare.billing.grandTotal')}</dt>
                  <dd>{formatCurrency(billQuery.data.total, currency)}</dd>
                </div>
              </dl>
            </div>
            <p className="mt-2 text-right text-[11px] text-gray-400">{t('healthcare.billing.taxExemptNote')}</p>
          </section>

          {isInsuranceBill && splitBreakdown ? (
            <>
              <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" aria-hidden />
                      {t('healthcare.insurance.billing.title')}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {t('healthcare.insurance.billing.subtitle')}
                    </p>
                  </div>
                  <Link
                    to="/healthcare/insurance"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                    {t('healthcare.insurance.billing.openStation')}
                  </Link>
                </div>

                {providers.length === 0 && providersQuery.isSuccess ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {t('healthcare.insurance.billing.noProviders')}
                  </p>
                ) : null}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600">
                      {t('healthcare.insurance.payer')}
                    </span>
                    <select
                      value={selectedProvider?.id ?? ''}
                      onChange={(event) => {
                        setProviderId(event.target.value);
                        setCopayPercent(null);
                        setCreatedClaim(null);
                        setCreateError(null);
                      }}
                      disabled={!canWrite || Boolean(createdInvoice) || providers.length === 0}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
                    >
                      <option value="">{t('healthcare.insurance.billing.selectProvider')}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id} disabled={!provider.is_active}>
                          {provider.name}
                          {provider.is_active ? '' : ` · ${t('healthcare.insurance.provider.inactive')}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600">
                      {t('healthcare.insurance.billing.policyNumber')}
                    </span>
                    <input
                      value={policyNumber}
                      onChange={(event) => setPolicyNumber(event.target.value)}
                      placeholder={bill.insurancePolicyNumber ?? ''}
                      disabled={!canWrite}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600">
                      {t('healthcare.insurance.billing.memberId')}
                    </span>
                    <input
                      value={memberId}
                      onChange={(event) => setMemberId(event.target.value)}
                      placeholder={bill.insuranceMemberId ?? ''}
                      disabled={!canWrite}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600">
                      {t('healthcare.insurance.billing.preAuthCode')}
                    </span>
                    <input
                      value={preAuthCode}
                      onChange={(event) => setPreAuthCode(event.target.value)}
                      disabled={!canWrite}
                      className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </label>
                </div>

                {existingClaim ? (
                  <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <BadgeCheck className="h-4 w-4" aria-hidden />
                    {t('healthcare.insurance.billing.existingClaim', {
                      number: existingClaim.claim_number,
                    })}
                  </p>
                ) : null}
              </section>

              <SplitBillingCard
                breakdown={splitBreakdown}
                currency={currency}
                copayPercent={effectiveCopayPercent}
                onCopayPercentChange={(value) => setCopayPercent(String(value))}
                copayCap={copayCap}
                onCopayCapChange={setCopayCap}
                providerName={selectedProvider?.name ?? bill.insuranceProvider}
                disabled={!canWrite || Boolean(createdInvoice)}
              />
            </>
          ) : null}

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CreditCard className="h-4 w-4 text-brand-600" aria-hidden />
              {isInsuranceBill
                ? t('healthcare.insurance.billing.postTitle')
                : t('healthcare.billing.invoiceTitle')}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {isInsuranceBill
                ? t('healthcare.insurance.billing.postHint')
                : t('healthcare.billing.invoiceHint')}
            </p>

            {createdInvoice ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <p className="flex items-center gap-1.5 font-semibold">
                  <BadgeCheck className="h-4 w-4" aria-hidden />
                  {t('healthcare.billing.invoiceCreated', {
                    number: createdInvoice.invoiceNumber,
                  })}
                </p>
                <p className="mt-1 text-xs">
                  {t('healthcare.billing.invoiceCreatedBody', {
                    amount: formatCurrency(createdInvoice.total, currency),
                  })}
                </p>
                {createdClaim ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
                    <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                    {t('healthcare.insurance.billing.claimSubmitted', {
                      number: createdClaim.claim_number,
                    })}
                  </p>
                ) : null}
                {isInsuranceBill && !createdClaim ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>{t('healthcare.insurance.billing.claimRetryHint')}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void submitClaimOnly()}
                      isLoading={isCreating}
                      disabled={!canWrite || Boolean(existingClaim)}
                    >
                      <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                      {t('healthcare.insurance.billing.retryClaim')}
                    </Button>
                  </div>
                ) : null}
                <Link to="/invoices" className="mt-2 inline-flex text-xs font-semibold text-emerald-800 underline">
                  {t('healthcare.billing.openInvoices')}
                </Link>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-[260px] flex-1">
                  <span className="text-xs font-semibold text-gray-600">
                    {isInsuranceBill
                      ? t('healthcare.insurance.billing.contact')
                      : t('healthcare.billing.invoiceCustomer')}
                  </span>
                  <select
                    value={contactId}
                    onChange={(event) => setContactId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    disabled={!canWrite || contactsQuery.isLoading}
                  >
                    <option value="">{t('healthcare.billing.selectCustomer')}</option>
                    {(contactsQuery.data ?? []).map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-gray-400">
                    {isInsuranceBill
                      ? t('healthcare.insurance.billing.contactHint')
                      : t('healthcare.billing.invoiceCustomerHint')}
                  </span>
                </label>
                {isInsuranceBill ? (
                  <Button
                    type="button"
                    onClick={() => void submitInsuranceBilling()}
                    isLoading={isCreating}
                    disabled={
                      !insuranceReady ||
                      !contactId ||
                      Boolean(existingClaim) ||
                      Boolean(selectedVisit?.invoice_id)
                    }
                  >
                    <FileCheck2 className="h-4 w-4" aria-hidden />
                    {isCreating
                      ? t('healthcare.insurance.billing.posting')
                      : t('healthcare.insurance.billing.postButton')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void createInvoice()}
                    isLoading={isCreating}
                    disabled={!canWrite || Boolean(selectedVisit?.invoice_id) || !contactId}
                  >
                    <Receipt className="h-4 w-4" aria-hidden />
                    {isCreating ? t('healthcare.billing.creatingInvoice') : t('healthcare.billing.createInvoice')}
                  </Button>
                )}
              </div>
            )}

            {createError && <div className="mt-3"><ErrorNotice message={createError} /></div>}
            {!canWrite && (
              <p className="mt-2 text-[11px] text-gray-400">{t('healthcare.billing.readOnly')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
