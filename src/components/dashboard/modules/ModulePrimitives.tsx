import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';

export function ModuleCard({
  title, href, action, icon: Icon, testId, metadata, children,
}: {
  title: string; href: string; action: string; icon: LucideIcon; testId: string; metadata?: string; children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <h3 className="truncate text-sm font-bold text-gray-900">{title}</h3>
        </div>
        <Link to={href} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:text-brand-900 touch-manipulation">{action}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </header>
      {metadata && <p className="mb-3 inline-flex min-h-8 max-w-full items-center rounded-full bg-gray-50 px-3 text-[11px] font-medium text-gray-600">{metadata}</p>}
      {children}
    </section>
  );
}

export function ModuleMetrics({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-2 gap-3">{children}</div>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="min-w-0 rounded-xl bg-gray-50 p-3"><p className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 truncate text-base font-extrabold text-gray-900" title={value}>{value}</p>{detail && <p className="mt-0.5 truncate text-[10px] text-gray-500">{detail}</p>}</div>;
}

export function ModuleLoading() {
  const { t } = useTranslation();
  return <div aria-label={t('dashboard.verticals.loading')} className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl bg-gray-100" />)}</div>;
}

export function ModuleError({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useTranslation();
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><p>{message}</p><button type="button" onClick={retry} className="mt-2 inline-flex min-h-11 items-center rounded px-2 font-semibold underline touch-manipulation">{t('common.retry')}</button></div>;
}

export function ModuleEmpty() {
  const { t } = useTranslation();
  return <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">{t('dashboard.verticals.noActivity')}</p>;
}
