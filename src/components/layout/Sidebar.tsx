import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ChevronsLeft, ChevronsRight, X, Lock } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { isItemLocked, visibleSectionsFor } from './navConfig';
import { usePartner } from '@/partner/PartnerContext';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { useUsage } from '@/hooks/useUsage';
import { pushUpgradeRequired } from '@/lib/notifications';

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const role = useAppStore((s) => s.currentBusiness?.role);
  const { logoUrl, businessName } = useBrandTheme();
  const { planTier } = useUsage();
  const { isFeatureEnabled } = usePartner();
  // Plan gating is per-item (Accounting + Organisation stay visible on Free);
  // partner feature flags remove modules from the nav entirely, and role permissions hide unauthorized items.
  const visibleSections = visibleSectionsFor(isFeatureEnabled, role);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 start-0 z-30 flex flex-col border-e border-gray-200 bg-white transition-all duration-200',
          // Desktop: always visible, collapses to icon rail
          'lg:translate-x-0',
          sidebarOpen ? 'w-64' : 'lg:w-[72px]',
          // Mobile: full width drawer, hidden when closed
          !sidebarOpen && '-translate-x-full lg:translate-x-0',
          sidebarOpen && 'translate-x-0 w-64',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-4">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={businessName}
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
              {(businessName || 'L').charAt(0).toUpperCase()}
            </div>
          )}
          {sidebarOpen && (
            <span className="truncate text-lg font-semibold text-gray-900">{businessName}</span>
          )}
          {/* Mobile close button */}
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="ms-auto rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <nav
          aria-label={t('common.primaryNavigation')}
          className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4"
        >
          {visibleSections.map((section) => (
            <div key={section.labelKey} className="mb-6">
              {sidebarOpen && (
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t(section.labelKey)}
                </p>
              )}
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const locked = isItemLocked(item, planTier, section.minPlan);

                  const handleClick = (e: React.MouseEvent) => {
                    if (locked) {
                      e.preventDefault();
                      const feature = t(item.labelKey);
                      pushUpgradeRequired(feature, 'Growth', businessId);
                      // Close mobile sidebar anyway
                      if (window.innerWidth < 1024) setSidebarOpen(false);
                      return;
                    }
                    // Close sidebar on mobile after navigation
                    if (window.innerWidth < 1024) setSidebarOpen(false);
                  };

                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        title={
                          !sidebarOpen
                            ? `${t(item.labelKey)}${locked ? ' (upgrade required)' : ''}`
                            : undefined
                        }
                        onClick={handleClick}
                        className={({ isActive }) =>
                          clsx(
                            'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-brand-50 text-brand-700'
                              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                            !sidebarOpen && 'justify-center',
                            locked && 'opacity-70 cursor-not-allowed'
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                            {sidebarOpen && (
                              <span className="flex flex-1 items-center justify-between gap-2 truncate">
                                <span className="truncate">{t(item.labelKey)}</span>
                                {locked && (
                                  <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-label="Upgrade required" />
                                )}
                              </span>
                            )}
                            {!sidebarOpen && locked && (
                              <Lock className="absolute right-1.5 top-1.5 h-2.5 w-2.5 text-gray-400" aria-hidden="true" />
                            )}
                            {isActive && <span className="sr-only"> (current page)</span>}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-3">
          <button
            onClick={toggleSidebar}
            className={clsx(
              'hidden lg:flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900',
              !sidebarOpen && 'justify-center',
            )}
          >
            {sidebarOpen ? (
              <>
                <ChevronsLeft className="h-[18px] w-[18px]" />
                <span>{t('common.collapse')}</span>
              </>
            ) : (
              <ChevronsRight className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
