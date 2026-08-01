import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ChevronsLeft, ChevronsRight, X, Lock } from 'lucide-react';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { isItemLocked, visibleSectionsFor } from './navConfig';
import { usePartner } from '@/partner/PartnerContext';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { useUsage } from '@/hooks/useUsage';
import { pushUpgradeRequired } from '@/lib/notifications';

export function Sidebar() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const density = useAppStore((s) => s.density);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const role = useAppStore((s) => s.currentBusiness?.role);
  const { logoUrl, businessName } = useBrandTheme();
  const { planTier } = useUsage();
  const { isFeatureEnabled } = usePartner();
  const visibleSections = visibleSectionsFor(isFeatureEnabled, role);

  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!sidebarOpen) return;
    setIsResizing(true);
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [sidebarOpen, sidebarWidth]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!isResizing) return;
    const diff = e.clientX - startX.current;
    setSidebarWidth(startWidth.current + diff);
  }, [isResizing, setSidebarWidth]);

  const onPointerUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onPointerMove, onPointerUp]);

  const widthStyle = sidebarOpen ? { width: `${sidebarWidth}px` } : undefined;

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        style={widthStyle}
        className={clsx(
          'fixed inset-y-0 start-0 z-30 flex flex-col border-e border-gray-200 bg-white transition-[width,transform] duration-200 ease-out',
          'lg:translate-x-0',
          !sidebarOpen && '-translate-x-full lg:translate-x-0',
          !sidebarOpen && 'lg:w-[72px]',
          sidebarOpen && 'translate-x-0',
          isResizing && 'transition-none',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-4 shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={businessName} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
              {(businessName || 'L').charAt(0).toUpperCase()}
            </div>
          )}
          {sidebarOpen && <span className="truncate text-[15px] font-semibold text-gray-900">{businessName}</span>}
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
              className="ms-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 lg:hidden touch-manipulation"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <nav
          aria-label={t('common.primaryNavigation')}
          className={clsx(
            'flex-1 overflow-y-auto px-3 py-4 scrollbar-thin',
            density === 'compact' ? 'space-y-3' : ''
          )}
        >
          {visibleSections.map((section) => {
            const isSupport = section.labelKey.includes('support');
            return (
              <div key={section.labelKey} className={clsx('mb-6', isSupport && 'mt-8 pt-6 border-t border-gray-100')}>
                {sidebarOpen && (
                  <p className="mb-2 px-3 text-[11px] font-semibold text-gray-400 category-label">
                    {t(section.labelKey)}
                  </p>
                )}
                <ul className={clsx('space-y-1', density === 'compact' && 'space-y-0.5')}>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const locked = isItemLocked(item, planTier, section.minPlan);
                    const handleClick = (e: React.MouseEvent) => {
                      if (locked) {
                        e.preventDefault();
                        pushUpgradeRequired(t(item.labelKey), 'Growth', businessId);
                        if (window.innerWidth < 1024) setSidebarOpen(false);
                        return;
                      }
                      if (window.innerWidth < 1024) setSidebarOpen(false);
                    };
                    return (
                      <li key={item.path} className="group relative">
                        <NavLink
                          to={item.path}
                          onClick={handleClick}
                          className={({ isActive }) =>
                            clsx(
                              'relative flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors touch-manipulation',
                              density === 'compact' ? 'py-1.5' : 'py-2.5',
                              isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                              !sidebarOpen && 'justify-center',
                              locked && 'opacity-60',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                              {sidebarOpen ? (
                                <span className="flex flex-1 items-center justify-between gap-2 truncate">
                                  <span className="truncate">{t(item.labelKey)}</span>
                                  {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-label="Upgrade required" />}
                                </span>
                              ) : null}
                              {!sidebarOpen && locked && (
                                <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-gray-400" aria-hidden="true" />
                              )}
                              {isActive && <span className="sr-only"> (current page)</span>}
                            </>
                          )}
                        </NavLink>
                        {!sidebarOpen && (
                          <div className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">
                            {t(item.labelKey)}
                            {locked ? ' (upgrade)' : ''}
                            <div className="absolute right-full top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rotate-45 bg-gray-900" />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-3 shrink-0">
          <button
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? t('common.collapse') : 'Expand sidebar'}
            className={clsx(
              'hidden lg:flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 touch-manipulation',
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

        {/* Resize handle — desktop only, when open */}
        {sidebarOpen && (
          <div
            onPointerDown={onPointerDown}
            className="absolute bottom-0 right-0 top-0 hidden w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-brand-100 lg:block"
            aria-hidden="true"
            title="Drag to resize sidebar"
          >
            <div className="absolute right-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-gray-200" />
          </div>
        )}
      </aside>

      {/* Spacer for global styles when resizing? */}
      {isResizing && <div className="fixed inset-0 z-[100] cursor-col-resize" aria-hidden="true" />}
    </>
  );
}
