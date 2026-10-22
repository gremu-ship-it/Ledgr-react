import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import type { ConstructionFailure } from '@/lib/construction/constructionCommandFeedback';

/**
 * Small presentation atoms shared by the Construction workspace sections.
 * Deliberately not a design system: they exist so every section reports loading,
 * empty, refusal and success states in the same way, including the exact server
 * wording for a refusal.
 */

export const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 disabled:text-gray-500';

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  /** ReactNode since P2-3: the project header renders the client as a link. */
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description ? <p className="mt-0.5 max-w-3xl text-xs text-gray-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function StatusPill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-gray-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ?? t('construction.procurement.shared.loading')}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {detail ? <p className="mx-auto mt-1 max-w-2xl text-xs text-gray-500">{detail}</p> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/**
 * Renders a refusal exactly as the database described it, and adds the
 * documented explanation and next step when the token is known. The raw server
 * message is never replaced — it is the authoritative statement.
 */
export function FailureBanner({ failure }: { failure: ConstructionFailure }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
      {failure.explanation ? (
        <p className="font-medium">{failure.explanation.summary}</p>
      ) : failure.isAuthorityDenial ? (
        // A 42501 is not a rule about the document — it is about who is asking and
        // in which business or branch. Saying so is more useful than "refused",
        // and the server's own wording is still printed below, unaltered.
        <p className="font-medium">{t('construction.procurement.shared.noAuthoritySummary')}</p>
      ) : (
        <p className="font-medium">{t('construction.procurement.shared.refusedSummary')}</p>
      )}
      {failure.explanation ? (
        <p className="mt-1 text-xs text-red-800">{failure.explanation.action}</p>
      ) : failure.isAuthorityDenial ? (
        <p className="mt-1 text-xs text-red-800">
          {t('construction.procurement.shared.noAuthorityAction')}
        </p>
      ) : null}
      <p className="mt-1 break-words font-mono text-[11px] leading-4 text-red-700">{failure.message}</p>
      {failure.token || failure.sqlState ? (
        <p className="mt-1 text-[11px] text-red-600">
          {failure.token ? t('construction.procurement.shared.refusalToken', { token: failure.token }) : null}
          {failure.token && failure.sqlState ? ' · ' : null}
          {failure.sqlState ? t('construction.procurement.shared.sqlState', { sqlState: failure.sqlState }) : null}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  // The hint is deliberately OUTSIDE the <label>: a hint inside the label element
  // becomes part of the control's accessible name ("Construction siteThe site
  // fixes the branch…"), which is both wrong for screen readers and impossible to
  // target by label text.
  return (
    <div className="block text-sm">
      <label className="block">
        <span className="mb-1 block font-medium text-gray-700">
          {label}
          {required ? <span className="ml-0.5 text-red-600">*</span> : null}
        </span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'attention' | 'good';
}) {
  const toneClass =
    tone === 'attention' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-gray-500">{detail}</p> : null}
    </div>
  );
}

/** A disabled control with its reason attached, so nothing is silently inert. */
export function GatedButton({
  allowed,
  reason,
  children,
  onClick,
  type = 'button',
  disabled,
  className,
  title,
}: {
  allowed: boolean;
  reason: string;
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span className="inline-flex flex-col">
      <button
        type={type}
        onClick={onClick}
        disabled={!allowed || disabled}
        title={allowed ? title : reason}
        aria-disabled={!allowed || disabled}
        className={
          className ??
          'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
        }
      >
        {children}
      </button>
      {!allowed ? <span className="mt-1 max-w-xs text-[11px] text-gray-500">{reason}</span> : null}
    </span>
  );
}
