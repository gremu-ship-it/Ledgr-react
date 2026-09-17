/**
 * Persistent banner shown while the visitor is inside the demo account.
 *
 * Its job is honesty and escape hatches, in that order:
 *   1. make it unmistakable that this is sample data, not their books
 *      (`demo@ledgr.test`, "Lilongwe Trading Ltd");
 *   2. say where the data lives and when it resets (their browser, 24h);
 *   3. offer the three things a demo visitor legitimately wants — reset the
 *      sample data, create a real account, or leave the demo.
 *
 * Mounted in `AppLayout` above the offline banner so it is present on every
 * screen of the app, including mobile.
 */
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FlaskConical, LogOut, RotateCcw, X } from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { exitDemoMode } from '@/lib/demo/session';
import { demoMsUntilReset } from '@/lib/demo/persistence';
import { DEMO_BUSINESS_NAME } from '@/lib/demoData';
import { DEMO_BUSINESS_ID, DEMO_EMAIL } from '@/lib/demo/constants';
import { pushSuccess } from '@/lib/notifications';
import { createLogger } from '@/lib/logger';

const log = createLogger('DemoBanner');

function formatTimeLeft(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function DemoBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => formatTimeLeft(demoMsUntilReset()));

  const handleReset = useCallback(() => {
    setResetting(true);
    // The reseed lives in the lazily loaded demo engine chunk — it is already
    // in memory by the time the banner is on screen, so this resolves
    // immediately; importing it dynamically just keeps the banner itself out
    // of the app shell's dependency graph.
    import('@/lib/demo/store')
      .then(({ resetDemoData }) => {
        resetDemoData();
        // Drop every cached query so the UI re-reads the pristine seed instead
        // of showing the numbers the visitor had just edited.
        queryClient.clear();
        void queryClient.invalidateQueries();
        setTimeLeft(formatTimeLeft(demoMsUntilReset()));
        // Scope the notification to the demo business so it appears in the bell
        // like any other tenant-scoped alert.
        pushSuccess(t('demo.resetDoneTitle'), t('demo.resetDoneBody'), undefined, DEMO_BUSINESS_ID);
      })
      .catch((err) => {
        log.error('Demo reset failed', err as Error);
      })
      .finally(() => {
        setResetting(false);
      });
  }, [t]);

  const handleExit = useCallback(() => {
    exitDemoMode();
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900 sm:px-4"
    >
      <span className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{t('demo.bannerLabel')}</span>
        <span className="sm:hidden">{t('demo.bannerShort')}</span>
        <span className="hidden font-normal text-amber-800 md:inline">
          {DEMO_BUSINESS_NAME} · {DEMO_EMAIL}
        </span>
      </span>

      <span className="hidden text-xs text-amber-800 lg:inline">
        {t('demo.bannerNote', { timeLeft })}
      </span>

      <span className="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${resetting ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('demo.resetAction')}
        </button>

        <Link
          to="/register"
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('demo.signUpAction')}
        </Link>

        <button
          type="button"
          onClick={handleExit}
          title={t('demo.exitAction')}
          aria-label={t('demo.exitAction')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{t('demo.exitAction')}</span>
          <X className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
