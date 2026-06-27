import { Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { OfflineBanner } from '@/offline/OfflineBanner';

export function AppLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Offline / sync status banner — sticky so it stays visible on scroll */}
      <div className="sticky top-0 z-40">
        <OfflineBanner />
      </div>

      <Sidebar />

      <div
        className={clsx(
          'flex min-h-screen flex-col transition-all duration-200',
          sidebarOpen ? 'lg:pl-64' : 'lg:pl-[72px]',
        )}
      >
        <Header />

        <main className="flex-1 p-4 sm:p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}