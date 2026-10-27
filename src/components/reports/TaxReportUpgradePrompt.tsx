import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function TaxReportUpgradePrompt({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <section className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('reports.shared.upgradePrompt')}</p>
        <Link
          to="/settings?tab=billing"
          className="mt-6 inline-flex items-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {t('reports.shared.viewPlans')}
        </Link>
      </div>
    </section>
  );
}
