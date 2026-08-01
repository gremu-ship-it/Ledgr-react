import { Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { OfflineBanner } from '@/offline/OfflineBanner';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { usePartnerTheme } from '@/partner/usePartnerTheme';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocation } from 'react-router-dom';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';
import { useRenewalReminder } from '@/hooks/useRenewalReminder';
import { InactivityWarningModal } from '@/components/auth/InactivityWarningModal';
import { SupportWidget } from '@/components/support/SupportWidget';

export function AppLayout() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMobile = useIsMobile();
  const location = useLocation();

  useBrandTheme();
  usePartnerTheme();
  const { showWarning, secondsRemaining, extendSession } = useInactivityTimeout();
  useRenewalReminder();

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  const showMobileHeader = isMobile && !isDashboard;

  return (
    <div className="min-h-screen bg-gray-50">
      <a href="#main-content" className="skip-link">
        {t('common.skipToMain')}
      </a>

      <div
        id="ledgr-live-region"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Offline banner — sticky above header */}
      <div className="sticky top-0 z-40">
        <OfflineBanner />
      </div>

      <Sidebar />

      <div
        className={clsx(
          'flex min-h-screen flex-col transition-all duration-200',
          sidebarOpen ? 'lg:ps-64' : 'lg:ps-[72px]',
        )}
      >
        {(!isMobile || showMobileHeader) && <Header />}

        <main
          id="main-content"
          tabIndex={-1}
          aria-label="Main content"
          className={clsx(
            'flex-1 p-4 sm:p-6 outline-none',
            // Desktop: normal padding, Mobile: extra bottom for floating nav + safe-area
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
  );
}
