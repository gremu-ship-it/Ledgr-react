import { Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { OfflineBanner } from '@/offline/OfflineBanner';
import { useBrandTheme } from '@/hooks/useBrandTheme';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useLocation } from 'react-router-dom';

export function AppLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const isMobile = useIsMobile();
  const location = useLocation();

  // Apply brand colors globally based on current business settings
  useBrandTheme();

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  const showMobileHeader = isMobile && !isDashboard;

  return (
    <div className="min-h-screen bg-bg text-ink">
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
          sidebarOpen ? 'lg:pl-64' : 'lg:pl-[72px]',
        )}
      >
        {(!isMobile || showMobileHeader) && <Header />}

        <main className={clsx(
          'flex-1 p-4 sm:p-6 pb-32 lg:pb-6',
          isMobile && isDashboard && 'pt-6'
        )}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <BottomNav />
    </div>
  );
}