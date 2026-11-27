import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { upsertDoctorContract } from '@/services/doctorFeeService';
import type {
  AccountOption,
  ClinicDoctor,
  DoctorContractType,
  DoctorFeeContract,
} from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

const CONTRACT_TYPES: DoctorContractType[] = ['percentage', 'fixed', 'hybrid'];

interface DoctorContractModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  contract: DoctorFeeContract | null;
  doctors: ClinicDoctor[];
  accounts: AccountOption[];
  canWrite: boolean;
  onSaved: (contract: DoctorFeeContract) => void;
}

export function DoctorContractModal(props: DoctorContractModalProps) {
  const { open, contract } = props;
  if (!open) return null;
  return <DoctorContractBody key={contract?.id ?? 'new'} {...props} />;
}

function DoctorContractBody({
  onClose,
  businessId,
  contract,
  doctors,
  accounts,
  canWrite,
  onSaved,
}: Omit<DoctorContractModalProps, 'open'>) {
  const { t } = useTranslation();
  const [doctorId, setDoctorId] = useState(contract?.doctor_id ?? '');
  const [contractType, setContractType] = useState<DoctorContractType>(
    contract?.contract_type ?? 'percentage',
  );
  const [consultationPercent, setConsultationPercent] = useState(
    String(contract?.consultation_share_percent ?? 0),
  );
  const [fixedFee, setFixedFee] = useState(String(contract?.fixed_consultation_fee ?? 0));
  const [labPercent, setLabPercent] = useState(
    String(contract?.lab_procedure_share_percent ?? 0),
  );
  const [pharmacyPercent, setPharmacyPercent] = useState(
    String(contract?.pharmacy_share_percent ?? 0),
  );
  const [expenseAccountId, setExpenseAccountId] = useState(
    contract?.expense_account_id ?? '',
  );
  const [payableAccountId, setPayableAccountId] = useState(
    contract?.payable_account_id ?? '',
  );
  const [isActive, setIsActive] = useState(contract?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const expenseAccounts = accounts.filter((account) => account.account_type === 'expense');
  const payableAccounts = accounts.filter((account) => account.account_type === 'liability');

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    if (!doctorId) {
      setError(t('healthcare.doctorFees.contract.doctorRequired'));
      return;
    }
    const numbers = {
      consultation: Number(consultationPercent),
      fixed: Number(fixedFee),
      lab: Number(labPercent),
      pharmacy: Number(pharmacyPercent),
    };
    if (
      !Number.isFinite(numbers.consultation) ||
      numbers.consultation < 0 ||
      numbers.consultation > 100 ||
      !Number.isFinite(numbers.lab) ||
      numbers.lab < 0 ||
      numbers.lab > 100 ||
      !Number.isFinite(numbers.pharmacy) ||
      numbers.pharmacy < 0 ||
      numbers.pharmacy > 100
    ) {
      setError(t('healthcare.doctorFees.contract.percentInvalid'));
      return;
    }
    if (!Number.isFinite(numbers.fixed) || numbers.fixed < 0) {
      setError(t('healthcare.doctorFees.contract.feeInvalid'));
      return;
    }

    setIsSaving(true);
    try {
      const saved = await upsertDoctorContract(businessId, {
        doctor_id: doctorId,
        contract_type: contractType,
        consultation_share_percent: numbers.consultation,
        fixed_consultation_fee: numbers.fixed,
        lab_procedure_share_percent: numbers.lab,
        pharmacy_share_percent: numbers.pharmacy,
        expense_account_id: expenseAccountId || null,
        payable_account_id: payableAccountId || null,
        is_active: isActive,
      });
      onSaved(saved);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.doctorFees.contract.saveError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="doctor-contract-title"
      title={
        contract
          ? t('healthcare.doctorFees.contract.editTitle')
          : t('healthcare.doctorFees.contract.createTitle')
      }
      subtitle={t('healthcare.doctorFees.contract.subtitle')}
      closeLabel={t('healthcare.doctorFees.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.doctorFees.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.doctorFees.saving') : t('healthcare.doctorFees.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <HandCoins className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('healthcare.doctorFees.contract.hint')}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.doctorFees.doctorName')}>
            <select
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite || Boolean(contract)}
            >
              <option value="">{t('healthcare.doctorFees.contract.selectDoctor')}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.doctorFees.contractType')}>
            <select
              value={contractType}
              onChange={(event) => setContractType(event.target.value as DoctorContractType)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              {CONTRACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`healthcare.doctorFees.type.${type}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('healthcare.doctorFees.contract.consultationShare')}
            hint={t('healthcare.doctorFees.contract.consultationShareHint')}
          >
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={consultationPercent}
              onChange={(event) => setConsultationPercent(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite || contractType === 'fixed'}
            />
          </Field>
          <Field
            label={t('healthcare.doctorFees.fixedFee')}
            hint={t('healthcare.doctorFees.contract.fixedFeeHint')}
          >
            <input
              type="number"
              min={0}
              step="0.01"
              value={fixedFee}
              onChange={(event) => setFixedFee(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite || contractType === 'percentage'}
            />
          </Field>
          <Field label={t('healthcare.doctorFees.contract.labShare')}>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={labPercent}
              onChange={(event) => setLabPercent(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.doctorFees.contract.pharmacyShare')}>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={pharmacyPercent}
              onChange={(event) => setPharmacyPercent(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.doctorFees.contract.expenseAccount')}>
            <select
              value={expenseAccountId}
              onChange={(event) => setExpenseAccountId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.doctorFees.contract.selectAccount')}</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.doctorFees.contract.payableAccount')}>
            <select
              value={payableAccountId}
              onChange={(event) => setPayableAccountId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.doctorFees.contract.selectAccount')}</option>
              {payableAccounts.map((account) => (
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
          {t('healthcare.doctorFees.contract.active')}
        </label>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
