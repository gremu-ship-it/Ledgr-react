import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import {
  createInsuranceProvider,
  updateInsuranceProvider,
} from '@/services/insuranceService';
import type { AccountOption, InsuranceProvider } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

interface CreateInsuranceProviderModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  provider: InsuranceProvider | null;
  accounts: AccountOption[];
  canWrite: boolean;
  onSaved: (provider: InsuranceProvider) => void;
}

export function CreateInsuranceProviderModal(props: CreateInsuranceProviderModalProps) {
  const { open, provider } = props;
  if (!open) return null;
  return <ProviderModalBody key={provider?.id ?? 'new'} {...props} />;
}

function ProviderModalBody({
  onClose,
  businessId,
  provider,
  accounts,
  canWrite,
  onSaved,
}: Omit<CreateInsuranceProviderModalProps, 'open'>) {
  const { t } = useTranslation();
  const [name, setName] = useState(provider?.name ?? '');
  const [payerCode, setPayerCode] = useState(provider?.payer_code ?? '');
  const [contactPerson, setContactPerson] = useState(provider?.contact_person ?? '');
  const [contactEmail, setContactEmail] = useState(provider?.contact_email ?? '');
  const [contactPhone, setContactPhone] = useState(provider?.contact_phone ?? '');
  const [billingAddress, setBillingAddress] = useState(provider?.billing_address ?? '');
  const [copayPercent, setCopayPercent] = useState(
    String(provider?.default_copay_percent ?? 0),
  );
  const [creditDays, setCreditDays] = useState(String(provider?.credit_period_days ?? 30));
  const [receivableAccountId, setReceivableAccountId] = useState(
    provider?.receivable_account_id ?? '',
  );
  const [settlementAccountId, setSettlementAccountId] = useState(
    provider?.settlement_account_id ?? '',
  );
  const [writeOffAccountId, setWriteOffAccountId] = useState(
    provider?.write_off_account_id ?? '',
  );
  const [isActive, setIsActive] = useState(provider?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const assetAccounts = accounts.filter((account) => account.account_type === 'asset');
  const expenseAccounts = accounts.filter((account) => account.account_type === 'expense');

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    if (!name.trim()) {
      setError(t('healthcare.insurance.provider.nameRequired'));
      return;
    }
    const copay = Number(copayPercent);
    if (!Number.isFinite(copay) || copay < 0 || copay > 100) {
      setError(t('healthcare.insurance.provider.copayInvalid'));
      return;
    }
    const days = Number(creditDays);
    if (!Number.isFinite(days) || days < 0) {
      setError(t('healthcare.insurance.provider.creditInvalid'));
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        payer_code: payerCode.trim() || null,
        contact_person: contactPerson.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        billing_address: billingAddress.trim() || null,
        default_copay_percent: copay,
        credit_period_days: Math.trunc(days),
        receivable_account_id: receivableAccountId || null,
        settlement_account_id: settlementAccountId || null,
        write_off_account_id: writeOffAccountId || null,
        is_active: isActive,
      };
      const saved = provider
        ? await updateInsuranceProvider(businessId, provider.id, payload)
        : await createInsuranceProvider(businessId, payload);
      onSaved(saved);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.insurance.provider.saveError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="insurance-provider-title"
      title={
        provider
          ? t('healthcare.insurance.provider.editTitle')
          : t('healthcare.insurance.provider.createTitle')
      }
      subtitle={t('healthcare.insurance.provider.subtitle')}
      closeLabel={t('healthcare.insurance.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.insurance.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.insurance.saving') : t('healthcare.insurance.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('healthcare.insurance.provider.directoryHint')}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.insurance.provider.name')}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.insurance.provider.namePlaceholder')}
              disabled={!canWrite}
              autoFocus
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.payerCode')}>
            <input
              value={payerCode}
              onChange={(event) => setPayerCode(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.contactPerson')}>
            <input
              value={contactPerson}
              onChange={(event) => setContactPerson(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.contactEmail')}>
            <input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.contactPhone')}>
            <input
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.creditDays')}>
            <input
              type="number"
              min={0}
              step={1}
              value={creditDays}
              onChange={(event) => setCreditDays(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.defaultCopay')} className="sm:col-span-2">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={copayPercent}
              onChange={(event) => setCopayPercent(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.insurance.provider.billingAddress')} className="sm:col-span-2">
            <textarea
              rows={2}
              value={billingAddress}
              onChange={(event) => setBillingAddress(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('healthcare.insurance.provider.receivableAccount')}>
            <select
              value={receivableAccountId}
              onChange={(event) => setReceivableAccountId(event.target.value)}
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
          <Field label={t('healthcare.insurance.provider.settlementAccount')}>
            <select
              value={settlementAccountId}
              onChange={(event) => setSettlementAccountId(event.target.value)}
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
          <Field label={t('healthcare.insurance.provider.writeOffAccount')}>
            <select
              value={writeOffAccountId}
              onChange={(event) => setWriteOffAccountId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.insurance.provider.selectAccount')}</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={!canWrite}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          {t('healthcare.insurance.provider.active')}
        </label>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
