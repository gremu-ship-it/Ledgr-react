import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, HeartPulse, Loader2 } from 'lucide-react';
import type { BillingType, PatientVisit, VisitStage } from '@/services/healthcareService';
import { hasVitals, vitalSummary } from '@/lib/healthcare/format';

const STAGE_STYLES: Record<VisitStage, string> = {
  registered: 'bg-slate-100 text-slate-700 border-slate-200',
  triaged: 'bg-sky-50 text-sky-700 border-sky-200',
  with_doctor: 'bg-violet-50 text-violet-700 border-violet-200',
  in_lab: 'bg-amber-50 text-amber-800 border-amber-200',
  in_radiology: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  in_diagnostics: 'bg-teal-50 text-teal-800 border-teal-200',
  results_review: 'bg-orange-50 text-orange-800 border-orange-200',
  at_pharmacy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_billing: 'bg-rose-50 text-rose-700 border-rose-200',
  admitted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

export function StageBadge({ stage }: { stage: VisitStage }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_STYLES[stage]}`}>
      {t(`healthcare.queueStage.${stage}`)}
    </span>
  );
}

export function VitalSignsBadge({ visit }: { visit: PatientVisit }) {
  const { t } = useTranslation();
  const summary = vitalSummary(visit);
  const recorded = hasVitals(visit) && summary !== '';
  return (
    <span
      className={
        recorded
          ? 'inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800'
          : 'inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500'
      }
    >
      <HeartPulse className="h-3 w-3" aria-hidden />
      {recorded ? summary : t('healthcare.workspace.noVitals')}
    </span>
  );
}

const BILLING_STYLES: Record<BillingType, string> = {
  cash: 'border-gray-200 bg-gray-50 text-gray-700',
  insurance: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  corporate: 'border-teal-200 bg-teal-50 text-teal-700',
};

const BILLING_LABEL_KEYS: Record<BillingType, string> = {
  cash: 'healthcare.patients.billingCash',
  insurance: 'healthcare.patients.billingInsurance',
  corporate: 'healthcare.patients.billingCorporate',
};

export function BillingTypeBadge({ billingType }: { billingType: BillingType | string }) {
  const { t } = useTranslation();
  const type: BillingType =
    billingType === 'insurance' || billingType === 'corporate' ? billingType : 'cash';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${BILLING_STYLES[type]}`}>
      {t(BILLING_LABEL_KEYS[type])}
    </span>
  );
}

export function AllergyPills({
  allergies,
  max = 2,
}: {
  allergies: readonly string[] | null | undefined;
  max?: number;
}) {
  const { t } = useTranslation();
  const list = allergies ?? [];
  if (list.length === 0) {
    return <span className="text-xs text-gray-400">{t('healthcare.patients.noAllergies')}</span>;
  }
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((allergy) => (
        <span
          key={allergy}
          className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200"
        >
          {allergy}
        </span>
      ))}
      {hidden > 0 && (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
          {t('healthcare.patients.moreAllergies', { count: hidden })}
        </span>
      )}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`} htmlFor={htmlFor}>
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function LoadingNotice({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-6 text-sm text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
