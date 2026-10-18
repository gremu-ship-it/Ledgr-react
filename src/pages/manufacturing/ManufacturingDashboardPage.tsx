import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

/**
 * The Manufacturing workspace — Phase A placeholder.
 *
 * This is a foundation surface only. It exists so the MANUFACTURING operating
 * model has a real, capability-gated destination from the day it ships, without
 * pretending any production UI is ready. Every string is translated, and the
 * route that renders it is wrapped in the same organisation capability gate as
 * the construction workspace, so a business that never selected MANUFACTURING
 * cannot reach it by URL.
 *
 * Deliberately no data access: no repository call, no query, no command. The
 * bills of materials, works orders and WIP posting that will live here arrive
 * with the phase that builds them.
 */
export function ManufacturingDashboardPage() {
  const { t } = useTranslation();
  const businessName = useAppStore((state) => state.currentBusiness?.business?.name ?? '');

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Factory className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('manufacturing.title')}</h1>
            {businessName ? (
              <p className="text-sm text-gray-500">{businessName}</p>
            ) : null}
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-600">{t('manufacturing.comingSoon')}</p>
      </section>
    </div>
  );
}

export default ManufacturingDashboardPage;
