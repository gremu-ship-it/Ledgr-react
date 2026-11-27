import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { createWardAndBeds } from '@/services/inpatientService';
import {
  GENDER_RESTRICTIONS,
  GENDER_RESTRICTION_LABEL_KEYS,
  WARD_TYPES,
  WARD_TYPE_LABEL_KEYS,
} from '@/lib/healthcare/inpatient';
import { formatCurrency } from '@/lib/formatters';
import type { GenderRestriction, HospitalWard, WardType } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

export interface CreateWardAndBedModalProps {
  open: boolean;
  businessId: string | null;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onCreated: (ward: HospitalWard) => void;
}

export function CreateWardAndBedModal(props: CreateWardAndBedModalProps) {
  if (!props.open) return null;
  return <CreateWardAndBedModalBody {...props} />;
}

function CreateWardAndBedModalBody({
  businessId,
  currency,
  canWrite,
  onClose,
  onCreated,
}: CreateWardAndBedModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [wardType, setWardType] = useState<WardType>('general');
  const [floorNumber, setFloorNumber] = useState('');
  const [genderRestriction, setGenderRestriction] = useState<GenderRestriction>('mixed');
  const [bedCount, setBedCount] = useState('4');
  const [bedPrefix, setBedPrefix] = useState('Bed');
  const [dailyRate, setDailyRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    if (!name.trim()) {
      setError(t('healthcare.wards.configure.nameRequired'));
      return;
    }
    const count = Number(bedCount);
    if (!Number.isFinite(count) || count < 1 || count > 100) {
      setError(t('healthcare.wards.configure.bedCountInvalid'));
      return;
    }
    const rate = Number(dailyRate);
    if (!Number.isFinite(rate) || rate < 0) {
      setError(t('healthcare.wards.configure.rateInvalid'));
      return;
    }

    setIsSaving(true);
    try {
      const ward = await createWardAndBeds(businessId, {
        name: name.trim(),
        wardType,
        floorNumber: floorNumber.trim() || null,
        genderRestriction,
        bedCount: Math.trunc(count),
        dailyRate: rate,
        bedPrefix: bedPrefix.trim() || 'Bed',
      });
      onCreated(ward);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.wards.configure.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const preview = Number(dailyRate);

  return (
    <HealthcareModal
      open
      titleId="create-ward-title"
      title={t('healthcare.wards.configure.title')}
      subtitle={t('healthcare.wards.configure.subtitle')}
      closeLabel={t('healthcare.inpatient.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.inpatient.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.inpatient.saving') : t('healthcare.wards.configure.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('healthcare.wards.configure.hint')}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.wards.configure.name')}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.wards.configure.namePlaceholder')}
              disabled={!canWrite}
              autoFocus
            />
          </Field>
          <Field label={t('healthcare.wards.configure.type')}>
            <select
              value={wardType}
              onChange={(event) => setWardType(event.target.value as WardType)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              {WARD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(WARD_TYPE_LABEL_KEYS[value])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.wards.configure.floor')}>
            <input
              value={floorNumber}
              onChange={(event) => setFloorNumber(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.wards.configure.floorPlaceholder')}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.wards.configure.gender')}>
            <select
              value={genderRestriction}
              onChange={(event) => setGenderRestriction(event.target.value as GenderRestriction)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              {GENDER_RESTRICTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(GENDER_RESTRICTION_LABEL_KEYS[value])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.wards.configure.bedCount')}>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={bedCount}
              onChange={(event) => setBedCount(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field
            label={t('healthcare.wards.configure.bedPrefix')}
            hint={t('healthcare.wards.configure.bedPrefixHint')}
          >
            <input
              value={bedPrefix}
              onChange={(event) => setBedPrefix(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Bed"
              disabled={!canWrite}
            />
          </Field>
          <Field
            label={t('healthcare.wards.configure.dailyRate')}
            className="sm:col-span-2"
            hint={t('healthcare.wards.configure.dailyRateHint')}
          >
            <input
              type="number"
              min={0}
              step="0.01"
              value={dailyRate}
              onChange={(event) => setDailyRate(event.target.value)}
              className={INPUT_CLASS}
              placeholder="0.00"
              disabled={!canWrite}
            />
          </Field>
        </div>

        {Number.isFinite(preview) && preview > 0 ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {t('healthcare.wards.configure.preview', {
              rate: formatCurrency(preview, currency),
              nights: t('healthcare.inpatient.nights', { count: 3 }),
              total: formatCurrency(preview * 3, currency),
            })}
          </p>
        ) : null}

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
