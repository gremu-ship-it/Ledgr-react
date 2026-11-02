import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { PeriodPicker } from '@/components/reports/PeriodPicker';
import { BranchPerformanceReport } from '@/components/reports/BranchPerformanceReport';
import { periodForPreset } from '@/lib/reports/periods';
import { useAppStore } from '@/store/useAppStore';

export function BranchPerformancePage() {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [period, setPeriod] = useState(() => periodForPreset('thisMonth'));
  const title = t('reports.branchPerformance');

  return (
    <main className="report-container mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="report-header mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.branchPerformanceDescription')}</p>
      </header>

      <section
        aria-label={t('reports.shared.filters')}
        className="report-filters mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <PeriodPicker
          value={period}
          onChange={(from, to) => setPeriod({ from, to })}
        />
      </section>

      {businessId ? (
        <SectionErrorBoundary sectionName={title}>
          <BranchPerformanceReport
            businessId={businessId}
            periodStart={period.from}
            periodEnd={period.to}
            standalone
          />
        </SectionErrorBoundary>
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          {t('reports.shared.noBusinessSelected')}
        </p>
      )}
    </main>
  );
}
