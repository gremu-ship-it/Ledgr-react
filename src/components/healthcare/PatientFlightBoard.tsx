import { useTranslation } from 'react-i18next';
import {
  Check,
  ClipboardList,
  FlaskConical,
  Pill,
  Receipt,
  Stethoscope,
} from 'lucide-react';
import type { VisitStage } from '@/services/healthcareService';

type FlightStep = {
  key: 'triage' | 'doctor' | 'diagnostics' | 'pharmacy' | 'billing';
  icon: typeof ClipboardList;
  tone: string;
};

const STEPS: readonly FlightStep[] = [
  { key: 'triage', icon: ClipboardList, tone: 'bg-sky-600' },
  { key: 'doctor', icon: Stethoscope, tone: 'bg-violet-600' },
  { key: 'diagnostics', icon: FlaskConical, tone: 'bg-cyan-600' },
  { key: 'pharmacy', icon: Pill, tone: 'bg-emerald-600' },
  { key: 'billing', icon: Receipt, tone: 'bg-rose-600' },
];

function currentStepIndex(stage: VisitStage | string | null | undefined): number {
  switch (stage) {
    case 'triaged':
    case 'with_doctor':
      return 1;
    case 'in_lab':
    case 'in_radiology':
    case 'in_diagnostics':
    case 'results_review':
      return 2;
    case 'at_pharmacy':
      return 3;
    case 'in_billing':
      return 4;
    case 'admitted':
    case 'completed':
      return STEPS.length;
    default:
      return 0;
  }
}

/**
 * Patient flight board: Triage → Doctor → Labs/Scans → Rx → Bill.
 * Completed steps are ticked, the current step is highlighted and a diagnostic
 * loop-back shows the "results ready" marker on the board.
 */
export function PatientFlightBoard({
  stage,
  resultsReadyForReview = false,
  className = '',
}: {
  stage: VisitStage | string | null | undefined;
  resultsReadyForReview?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = currentStepIndex(stage);
  const cancelled = stage === 'cancelled';
  const done = stage === 'completed' || stage === 'admitted';

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white px-3 py-3 ${className}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {t('healthcare.flow.title')}
        </p>
        {resultsReadyForReview && (
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-800">
            {t('healthcare.review.ready')}
          </span>
        )}
      </div>

      <ol className="flex items-center gap-0 overflow-x-auto pb-1" aria-label={t('healthcare.flow.title')}>
        {STEPS.map((step, index) => {
          const stepDone = done || index < current || (index === current && cancelled);
          const active = !done && !cancelled && index === current;
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    stepDone
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : active
                        ? `border-transparent text-white shadow-sm ${step.tone}`
                        : 'border-gray-200 bg-gray-50 text-gray-400'
                  }`}
                  aria-current={active ? 'step' : undefined}
                >
                  {stepDone ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Icon className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span
                  className={`max-w-[72px] truncate text-[10px] font-semibold sm:max-w-none ${
                    active ? 'text-gray-900' : stepDone ? 'text-emerald-700' : 'text-gray-400'
                  }`}
                >
                  {t(`healthcare.flow.${step.key}`)}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <span
                  className={`mx-1 mb-4 h-0.5 min-w-[12px] flex-1 rounded ${
                    index < current ? 'bg-emerald-500' : 'bg-gray-200'
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
