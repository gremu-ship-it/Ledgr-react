import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { savePatient, type BillingType, type PatientRecord } from '@/services/healthcareService';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';
const SELECT_CLASS = INPUT_CLASS;

const BLOOD_GROUPS = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

const BILLING_OPTIONS: Array<{ value: BillingType; labelKey: string }> = [
  { value: 'cash', labelKey: 'healthcare.registration.cash' },
  { value: 'insurance', labelKey: 'healthcare.registration.insurance' },
  { value: 'corporate', labelKey: 'healthcare.registration.corporate' },
];

function TagInput({
  id,
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    }
  };

  return (
    <div className="mt-1">
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {addLabel}
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100"
                aria-label={`${removeLabel}: ${value}`}
              >
                {value}
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PatientRegistrationModalProps {
  businessId: string;
  onClose: () => void;
  onSaved: (patient: PatientRecord) => void;
}

/**
 * Patient registration. The MRN is allocated by the service immediately before
 * the insert, so the number shown after saving is the one stored on the row.
 */
export function PatientRegistrationModal({
  businessId,
  onClose,
  onSaved,
}: PatientRegistrationModalProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'' | 'male' | 'female' | 'other'>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [bloodGroup, setBloodGroup] = useState('Unknown');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [chronicConditions, setChronicConditions] = useState<string[]>([]);
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [billingType, setBillingType] = useState<BillingType>('cash');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('');
  const [insuranceMemberId, setInsuranceMemberId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError(t('healthcare.registration.requiredName'));
      return;
    }
    if (billingType !== 'cash' && !insuranceProvider.trim()) {
      setError(t('healthcare.registration.insuranceRequired'));
      return;
    }

    setIsSaving(true);
    try {
      const saved = await savePatient({
        business_id: businessId,
        mrn: '',
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth || null,
        gender: gender || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        national_id: nationalId.trim() || null,
        blood_group: bloodGroup,
        allergies,
        chronic_conditions: chronicConditions,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
        billing_type: billingType,
        insurance_provider: billingType === 'cash' ? null : insuranceProvider.trim() || null,
        insurance_policy_number: billingType === 'cash' ? null : insurancePolicyNumber.trim() || null,
        insurance_member_id: billingType === 'cash' ? null : insuranceMemberId.trim() || null,
        status: 'active',
      });
      onSaved(saved);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('healthcare.registration.saveError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-registration-title"
    >
      <form
        onSubmit={submit}
        className="my-6 w-full max-w-3xl space-y-5 rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="patient-registration-title" className="text-lg font-semibold text-gray-900">
              {t('healthcare.registration.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{t('healthcare.registration.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error && <ErrorNotice message={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('healthcare.registration.firstName')} htmlFor="patient-first-name">
            <input
              id="patient-first-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className={INPUT_CLASS}
              required
            />
          </Field>
          <Field label={t('healthcare.registration.lastName')} htmlFor="patient-last-name">
            <input
              id="patient-last-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className={INPUT_CLASS}
              required
            />
          </Field>
          <Field label={t('healthcare.registration.dateOfBirth')} htmlFor="patient-dob">
            <input
              id="patient-dob"
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.gender')} htmlFor="patient-gender">
            <select
              id="patient-gender"
              value={gender}
              onChange={(event) => setGender(event.target.value as '' | 'male' | 'female' | 'other')}
              className={SELECT_CLASS}
            >
              <option value="">{t('healthcare.registration.genderUnspecified')}</option>
              <option value="male">{t('healthcare.registration.male')}</option>
              <option value="female">{t('healthcare.registration.female')}</option>
              <option value="other">{t('healthcare.registration.other')}</option>
            </select>
          </Field>
          <Field label={t('healthcare.registration.phone')} htmlFor="patient-phone">
            <input
              id="patient-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.email')} htmlFor="patient-email">
            <input
              id="patient-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.address')} htmlFor="patient-address" className="sm:col-span-2">
            <input
              id="patient-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.nationalId')} htmlFor="patient-national-id">
            <input
              id="patient-national-id"
              value={nationalId}
              onChange={(event) => setNationalId(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.bloodGroup')} htmlFor="patient-blood-group">
            <select
              id="patient-blood-group"
              value={bloodGroup}
              onChange={(event) => setBloodGroup(event.target.value)}
              className={SELECT_CLASS}
            >
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group === 'Unknown' ? t('healthcare.patients.unknownBloodGroup') : group}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('healthcare.registration.allergies')}
            htmlFor="patient-allergy"
            hint={t('healthcare.registration.allergiesHint')}
            className="sm:col-span-2"
          >
            <TagInput
              id="patient-allergy"
              values={allergies}
              onChange={setAllergies}
              placeholder={t('healthcare.registration.allergiesPlaceholder')}
              addLabel={t('healthcare.registration.addAllergy')}
              removeLabel={t('healthcare.registration.removeAllergy')}
            />
          </Field>
          <Field
            label={t('healthcare.registration.chronicConditions')}
            htmlFor="patient-chronic"
            hint={t('healthcare.registration.chronicHint')}
            className="sm:col-span-2"
          >
            <TagInput
              id="patient-chronic"
              values={chronicConditions}
              onChange={setChronicConditions}
              placeholder={t('healthcare.registration.chronicPlaceholder')}
              addLabel={t('healthcare.registration.addCondition')}
              removeLabel={t('healthcare.registration.removeCondition')}
            />
          </Field>
          <Field label={t('healthcare.registration.emergencyContactName')} htmlFor="patient-emergency-name">
            <input
              id="patient-emergency-name"
              value={emergencyName}
              onChange={(event) => setEmergencyName(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.registration.emergencyContactPhone')} htmlFor="patient-emergency-phone">
            <input
              id="patient-emergency-phone"
              type="tel"
              value={emergencyPhone}
              onChange={(event) => setEmergencyPhone(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="text-xs font-semibold text-gray-600">
            {t('healthcare.registration.billingType')}
          </legend>
          <div className="mt-2 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            {BILLING_OPTIONS.map((option) => {
              const active = billingType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBillingType(option.value)}
                  className={
                    active
                      ? 'rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-brand-700 shadow-sm'
                      : 'rounded-lg px-4 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800'
                  }
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {billingType !== 'cash' && (
          <div className="grid gap-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 sm:grid-cols-3">
            <Field label={t('healthcare.registration.insuranceProvider')} htmlFor="patient-insurer">
              <input
                id="patient-insurer"
                value={insuranceProvider}
                onChange={(event) => setInsuranceProvider(event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t('healthcare.registration.insurancePolicyNumber')} htmlFor="patient-policy">
              <input
                id="patient-policy"
                value={insurancePolicyNumber}
                onChange={(event) => setInsurancePolicyNumber(event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t('healthcare.registration.insuranceMemberId')} htmlFor="patient-member">
              <input
                id="patient-member"
                value={insuranceMemberId}
                onChange={(event) => setInsuranceMemberId(event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('healthcare.registration.cancel')}
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {isSaving ? t('healthcare.registration.saving') : t('healthcare.registration.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
