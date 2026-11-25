import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OfflineBanner } from '@/offline/OfflineBanner';
import { OfflineSyncProvider } from '@/offline/OfflineSyncProvider';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { usePartnerTheme } from '@/partner/usePartnerTheme';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocation } from 'react-router';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';
import { useOrientationLock } from '@/hooks/useOrientationLock';
import { useRenewalReminder } from '@/hooks/useRenewalReminder';
import { InactivityWarningModal } from '@/components/auth/InactivityWarningModal';
import { LedgrAiChatDrawer } from '@/components/ai/LedgrAiChatDrawer';
import { useUsage } from '@/hooks/useUsage';
import { CommandPalette } from './CommandPalette';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { useDemoMode } from '@/hooks/useDemoMode';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PartnerClientContextBanner } from '@/partner/PartnerClientContextBanner';
import { usePartnerClientContext } from '@/partner/usePartnerClientContext';
import { clearPartnerClientContext } from '@/partner/partnerClientContext';

export function AppLayout() {
  const { t } = useTranslation();
  const { planTier } = useUsage();
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [showAiUpgrade, setShowAiUpgrade] = useState(false);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const isMobile = useIsMobile();
  const location = useLocation();
  const isDemo = useDemoMode();
  const { session: partnerClientSession, isRestoring: isRestoringPartnerContext, exitContext } = usePartnerClientContext();

  useBrandTheme();
  usePartnerTheme();
  const { showWarning, secondsRemaining, extendSession } = useInactivityTimeout();
  useRenewalReminder();
  useOrientationLock();

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  const showMobileHeader = isMobile && !isDashboard;

  return (
    <OfflineSyncProvider>
      <div className="min-h-screen bg-gray-50">
        <a href="#main-content" className="skip-link">
          {t('common.skipToMain')}
        </a>

        <div id="ledgr-live-region" aria-live="polite" aria-atomic="true" className="sr-only" />

        <div className="sticky top-0 z-40">
          {partnerClientSession && <PartnerClientContextBanner session={partnerClientSession} onExit={exitContext} />}
          {/* Demo visitors always see which account they are in and how to
              leave — the sample books must never be mistaken for real data. */}
          {isDemo && <DemoBanner />}
          <OfflineBanner />
        </div>

        <Sidebar />

        <div
          className={clsx('flex min-h-screen flex-col transition-all duration-200')}
          style={
            !isMobile
              ? {
                  paddingInlineStart: sidebarOpen ? `${sidebarWidth}px` : '72px',
                }
              : undefined
          }
        >
          {(!isMobile || showMobileHeader) && <Header />}

          <main
            id="main-content"
            tabIndex={-1}
            aria-label="Main content"
            className={clsx(
              'flex-1 p-4 sm:p-6 outline-none',
              isMobile ? 'pb-[calc(7rem+env(safe-area-inset-bottom))]' : 'pb-6',
              isMobile && isDashboard && 'pt-6'
            )}
          >
            <ErrorBoundary name="PageContent">
              {isRestoringPartnerContext ? <LoadingSpinner label={t('partner.restoringClientContext')} className="py-16" /> : <Outlet />}
            </ErrorBoundary>
          </main>
        </div>

        <BottomNav />

        {/* Global conversational assistant launcher. Enterprise only. */}
        <button
          type="button"
          data-testid="ai-assistant-launcher"
          onClick={() => {
            if (planTier === 'enterprise') setIsAiDrawerOpen(true);
            else setShowAiUpgrade(true);
          }}
          aria-label={t('ai.chat.openAssistant')}
          title={t('ai.chat.openAssistant')}
          className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition-transform hover:scale-105 hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-300 sm:bottom-6 sm:right-6"
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </button>
        <ErrorBoundary name="LedgrAiChatDrawer" fallback={() => null}>
          <LedgrAiChatDrawer isOpen={isAiDrawerOpen} onClose={() => setIsAiDrawerOpen(false)} />
        </ErrorBoundary>

        {showAiUpgrade && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4">
            <div role="dialog" aria-modal="true" aria-label={t('ai.chat.enterpriseRequiredTitle')} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-lg font-bold text-slate-900">{t('ai.chat.enterpriseRequiredTitle')}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t('ai.chat.enterpriseRequiredDesc')}</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAiUpgrade(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  {t('common.close')}
                </button>
                <Link
                  to="/settings?tab=billing"
                  onClick={() => setShowAiUpgrade(false)}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700"
                >
                  {t('ai.chat.upgradeAction')}
                </Link>
              </div>
            </div>
          </div>
        )}

        <CommandPalette />

        {showWarning && (
          <InactivityWarningModal
            secondsRemaining={secondsRemaining}
            onExtend={extendSession}
            onLogoutNow={() => {
              clearPartnerClientContext();
              window.location.href = '/login';
            }}
          />
        )}
      </div>
    </OfflineSyncProvider>
  );
}
