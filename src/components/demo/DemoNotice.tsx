/**
 * Replacement panel for flows that make no sense inside the demo.
 *
 * Payments, account deletion, team invites and API keys all act on a real
 * tenant. In demo mode there is no tenant — the books live in the visitor's
 * browser — so instead of letting those flows fail confusingly (or worse,
 * appear to succeed) we show this panel and point at the two useful exits:
 * create a real account, or leave the demo.
 *
 * Usage:
 *   {isDemo ? <DemoNotice featureKey="billing" /> : <BillingTab … />}
 */
import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FlaskConical, LogOut } from 'lucide-react';
import { exitDemoMode } from '@/lib/demo/session';

export type DemoNoticeFeature =
  | 'billing'
  | 'deleteAccount'
  | 'invites'
  | 'apiKeys'
  | 'webhooks'
  | 'password'
  | 'generic';

interface DemoNoticeProps {
  feature?: DemoNoticeFeature;
  /** Override the heading; defaults to the per-feature string. */
  title?: string;
  className?: string;
}

export function DemoNotice({ feature = 'generic', title, className }: DemoNoticeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleExit = useCallback(() => {
    exitDemoMode();
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <div
      className={`rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center ${className ?? ''}`}
    >
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100">
        <FlaskConical className="h-5 w-5 text-amber-700" aria-hidden="true" />
      </span>
      <h2 className="text-base font-bold text-amber-900">{title ?? t(`demo.notice.${feature}.title`)}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-amber-800">
        {t(`demo.notice.${feature}.body`)}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/register"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('demo.signUpAction')}
        </Link>
        <button
          type="button"
          onClick={handleExit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('demo.exitAction')}
        </button>
      </div>
    </div>
  );
}
