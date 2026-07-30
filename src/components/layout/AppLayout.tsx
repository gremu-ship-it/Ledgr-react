import { Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
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

  // Apply brand colors globally based on current business settings
  useBrandTheme();

  // Partner (white-label) branding — the business-level brand theme applied
  // above still takes precedence once a business is selected.
  usePartnerTheme();

  // Inactivity timeout (customizable)
  const { showWarning, secondsRemaining, extendSession } = useInactivityTimeout();

  // In-app bell notification when the paid plan is about to expire
  // (7/3/1 days out) — companion to the daily email reminder.
  useRenewalReminder();

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  const showMobileHeader = isMobile && !isDashboard;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Skip-to-main-content link (WCAG 2.4.1) — first focusable element */}
      <a href="#main-content" className="skip-link">
        {t('common.skipToMain')}
      </a>

      {/* Live region for screen-reader announcements of dynamic content
          (e.g. "Saved", "Failed to load", "3 new notifications") */}
      <div
        id="ledgr-live-region"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Offline banner */}
      <div className="sticky top-0 z-40">
        <OfflineBanner />
      </div>

      {/* Sidebar — hidden on mobile, visible on desktop */}
      <Sidebar />

      <div
        className={clsx(
          'flex min-h-screen flex-col transition-all duration-200',
          // Desktop: offset by sidebar width
          sidebarOpen ? 'lg:ps-64' : 'lg:ps-[72px]',
        )}
      >
        {(!isMobile || showMobileHeader) && <Header />}

        <main
          id="main-content"
          tabIndex={-1}
          aria-label="Main content"
          className={clsx(
            'flex-1 p-4 sm:p-6 pb-32 lg:pb-6 outline-none',
            isMobile && isDashboard && 'pt-6'
          )}
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

        {/* Bottom nav — mobile only */}
      <BottomNav />

      {/* Always-available support assistant */}
      <SupportWidget />

      {/* Inactivity warning modal */}
      {showWarning && (
        <InactivityWarningModal
          secondsRemaining={secondsRemaining}
          onExtend={extendSession}
          onLogoutNow={() => {
            // The hook handles logout, this just closes the modal
            window.location.href = '/login';
          }}
        />
      )}
    </div>
  );
}