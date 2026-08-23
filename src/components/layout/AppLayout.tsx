import { Outlet } from 'react-router';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
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
import { SupportWidget } from '@/components/support/SupportWidget';
import { AssistantWidget } from '@/components/ai/AssistantWidget';
import { CommandPalette } from './CommandPalette';

export function AppLayout() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const isMobile = useIsMobile();
  const location = useLocation();

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
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>

        <BottomNav />
        <SupportWidget />
        <ErrorBoundary name="AssistantWidget" fallback={() => null}>
          <AssistantWidget />
        </ErrorBoundary>
        <CommandPalette />

        {showWarning && (
          <InactivityWarningModal
            secondsRemaining={secondsRemaining}
            onExtend={extendSession}
            onLogoutNow={() => {
              window.location.href = '/login';
            }}
          />
        )}
      </div>
    </OfflineSyncProvider>
  );
}
