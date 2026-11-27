import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Banknote, CheckCircle2, FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { ClaimStatusBadge } from '@/components/healthcare/ClaimStatusBadge';
import { formatCurrency } from '@/lib/formatters';
import { patientDisplayName } from '@/lib/healthcare/format';
import { settleInsuranceClaim } from '@/services/insuranceService';
import type { AccountOption, InsuranceClaim } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

interface SettleClaimModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  claim: InsuranceClaim | null;
  currency: string;
  accounts: AccountOption[];
  canWrite: boolean;
  onSettled: () => void;
}

export function SettleClaimModal(props: SettleClaimModalProps) {
  const { open, claim } = props;
  if (!open || !claim) return null;
  return <SettleClaimBody key={claim.id} {...props} claim={claim} />;
}

function SettleClaimBody({
  onClose,
  businessId,
  claim,
  currency,
  accounts,
  canWrite,
  onSettled,
}: Omit<SettleClaimModalProps, 'open' | 'claim'> & { claim: InsuranceClaim }) {
  const { t } = useTranslation();
  const insurerClaim = Number(claim.insurer_claim_amount) || 0;
  const [settledAmount, setSettledAmount] = useState(String(insurerClaim));
  const [reference, setReference] = useState(claim.remittance_reference ?? '');
  const [reason, setReason] = useState(claim.rejection_reason ?? '');
  const defaultDeposit =
    claim.provider?.settlement_account_id ??
    accounts.find((account) => account.is_bank_account)?.id ??
    '';
  const defaultWriteOff = claim.provider?.write_off_account_id ?? '';
  const [depositAccountId, setDepositAccountId] = useState(defaultDeposit);
  const [writeOffAccountId, setWriteOffAccountId] = useState(defaultWriteOff);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const settled = Number(settledAmount);
  const settledValid = Number.isFinite(settled) && settled >= 0 && settled <= insurerClaim;
  const disallowance = settledValid ? Math.max(0, insurerClaim - settled) : 0;
  const receivableAccountId = claim.provider?.receivable_account_id ?? '';
  const assetAccounts = accounts.filter((account) => account.account_type === 'asset');
  const receivableAccount = accounts.find((account) => account.id === receivableAccountId) ?? null;
  const expenseAccounts = accounts.filter((account) => account.account_type === 'expense');
  const journalReady = Boolean(receivableAccountId && depositAccountId);
  const writeOffReady = disallowance <= 0 || Boolean(writeOffAccountId);
  const canSubmit = canWrite && settledValid && journalReady && writeOffReady;

  const journalWarning = useMemo(() => {
    if (!receivableAccountId) return t('healthcare.insurance.settle.missingReceivable');
    if (!depositAccountId) return t('healthcare.insurance.settle.missingDeposit');
    if (disallowance > 0 && !writeOffAccountId) {
      return t('healthcare.insurance.settle.missingWriteOff');
    }
    return null;
  }, [receivableAccountId, depositAccountId, disallowance, writeOffAccountId, t]);

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    if (!settledValid) {
      setError(t('healthcare.insurance.settle.invalidAmount'));
      return;
    }
    if (!reference.trim()) {
      setError(t('healthcare.insurance.settle.referenceRequired'));
      return;
    }
    if (disallowance > 0 && !reason.trim()) {
      setError(t('healthcare.insurance.settle.reasonRequired'));
      return;
    }
    if (!journalReady) {
      setError(t('healthcare.insurance.settle.journalRequired'));
      return;
    }
    if (!writeOffReady) {
      setError(t('healthcare.insurance.settle.writeOffRequired'));
      return;
    }

    setIsSaving(true);
    try {
      await settleInsuranceClaim(businessId, claim.id, {
        settledAmount: settled,
        remittanceReference: reference.trim(),
        disallowanceReason: reason.trim() || undefined,
        journal: {
          receivableAccountId,
          depositAccountId,
          writeOffAccountId: writeOffAccountId || null,
        },
      });
      onSettled();
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.insurance.settle.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="settle-claim-title"
      title={t('healthcare.insurance.settle.title')}
      subtitle={t('healthcare.insurance.settle.subtitle')}
      closeLabel={t('healthcare.insurance.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.insurance.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canSubmit}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.insurance.saving') : t('healthcare.insurance.settle.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-xs text-gray-500">{claim.claim_number}</p>
              <p className="text-sm font-semibold text-gray-900">
                {patientDisplayName(claim.patient) || t('healthcare.insurance.unknownPatient')}
              </p>
              <p className="text-xs text-gray-500">
                {claim.provider?.name ?? t('healthcare.insurance.unknownProvider')}
              </p>
            </div>
            <ClaimStatusBadge status={claim.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t('healthcare.insurance.totalBill')}
              </p>
              <p className="font-semibold text-gray-800">
                {formatCurrency(claim.total_bill_amount, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t('healthcare.insurance.patientPortion')}
              </p>
              <p className="font-semibold text-sky-800">
                {formatCurrency(claim.patient_copay_amount, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t('healthcare.insurance.insurerPortion')}
              </p>
              <p className="font-semibold text-emerald-800">
                {formatCurrency(insurerClaim, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t('healthcare.insurance.disallowance')}
              </p>
              <p className="font-semibold text-amber-800">
                {formatCurrency(disallowance, currency)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.insurance.settle.settledAmount')}>
            <input
              type="number"
              min={0}
              max={insurerClaim}
              step="0.01"
              value={settledAmount}
              onChange={(event) => setSettledAmount(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.settle.remittanceReference')}>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.insurance.settle.referencePlaceholder')}
              disabled={!canWrite}
            />
          </Field>
          <Field
            label={t('healthcare.insurance.settle.reason')}
            hint={t('healthcare.insurance.settle.reasonHint')}
            className="sm:col-span-2"
          >
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite || disallowance <= 0}
              placeholder={t('healthcare.insurance.settle.reasonPlaceholder')}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <Banknote className="h-4 w-4 text-brand-600" aria-hidden />
            {t('healthcare.insurance.settle.journalTitle')}
          </h3>
          <p className="mt-1 text-[11px] text-gray-500">
            {t('healthcare.insurance.settle.journalHint')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('healthcare.insurance.provider.receivableAccount')}>
              <select value={receivableAccountId} disabled className={INPUT_CLASS}>
                <option value={receivableAccountId}>
                  {receivableAccount
                    ? `${receivableAccount.code} — ${receivableAccount.name}`
                    : receivableAccountId
                      ? receivableAccountId.slice(0, 8).toUpperCase()
                      : t('healthcare.insurance.provider.selectAccount')}
                </option>
              </select>
            </Field>
            <Field label={t('healthcare.insurance.settle.depositAccount')}>
              <select
                value={depositAccountId}
                onChange={(event) => setDepositAccountId(event.target.value)}
                className={INPUT_CLASS}
                disabled={!canWrite}
              >
                <option value="">{t('healthcare.insurance.provider.selectAccount')}</option>
                {assetAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('healthcare.insurance.settle.writeOffAccount')}>
              <select
                value={writeOffAccountId}
                onChange={(event) => setWriteOffAccountId(event.target.value)}
                className={INPUT_CLASS}
                disabled={!canWrite || disallowance <= 0}
              >
                <option value="">{t('healthcare.insurance.provider.selectAccount')}</option>
                {expenseAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
              <p className="flex items-center gap-1.5 font-semibold text-gray-700">
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                {t('healthcare.insurance.settle.postingSummary')}
              </p>
              <p className="mt-1">
                {t('healthcare.insurance.settle.postingDebit', {
                  amount: formatCurrency(settledValid ? settled : 0, currency),
                })}
              </p>
              <p>
                {t('healthcare.insurance.settle.postingWriteOff', {
                  amount: formatCurrency(disallowance, currency),
                })}
              </p>
              <p>
                {t('healthcare.insurance.settle.postingCredit', {
                  amount: formatCurrency(insurerClaim, currency),
                })}
              </p>
            </div>
          </div>
        </div>

        {journalWarning ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {journalWarning}
          </p>
        ) : null}

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
