import { Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  X,
  Lock,
  Building2,
  DollarSign,
} from 'lucide-react';
import { useRef, useState, useCallback, useEffect, useMemo, useId } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import {
  isItemLocked,
  navLabelResolver,
  planRequiredForItem,
  visibleSectionsFor,
  type NavItemConfig,
  type NavSectionConfig,
} from './navConfig';
import {
  buildNavigation,
  isNavigationPathActive,
  resolveNavigationTarget,
} from '@/config/navigation';
import type { PlanTier } from '@/lib/billing/plans';
import { navIcon } from '@/config/navigationIcons';
import { useDefaultRoute } from '@/hooks/useDefaultRoute';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import { usePartner } from '@/partner/PartnerContext';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { useUsage } from '@/hooks/useUsage';
import { useOrganisationCapabilityVisibility } from '@/hooks/useCapability';
import { pushUpgradeRequired } from '@/lib/notifications';

interface SidebarNavEntryProps {
  item: NavItemConfig;
  sectionMinPlan?: PlanTier;
  sidebarOpen: boolean;
  density: string;
  isClinicalWorkspace: boolean;
  planTier: PlanTier;
  businessId?: string;
  labelKeyFor: (key: string) => string;
  setSidebarOpen: (open: boolean) => void;
}

function SidebarNavEntry({
  item,
  sectionMinPlan,
  sidebarOpen,
  density,
  isClinicalWorkspace,
  planTier,
  businessId,
  labelKeyFor,
  setSidebarOpen,
}: SidebarNavEntryProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Icon = item.icon;
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const locked = item.locked ?? isItemLocked(item, planTier, sectionMinPlan);

  const closeOnMobile = () => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const showUpgrade = () => {
    pushUpgradeRequired(
      t(labelKeyFor(item.labelKey)),
      planRequiredForItem(item, sectionMinPlan)?.name ?? t('navigation.accessibility.higherPlan'),
      businessId,
    );
    closeOnMobile();
  };

  const childIsActive = hasChildren && children.some((child) =>
    isNavigationPathActive(child.path, location.pathname, location.search),
  );
  const leafIsActive = item.path
    ? isNavigationPathActive(item.path, location.pathname, location.search)
    : false;
  const isItemActive = leafIsActive || childIsActive;
  // A child route always wins over a manually collapsed parent: landing on a
  // deep link or a `?tab=` destination re-expands its accordion.
  const isExpanded = hasChildren && (childIsActive || expanded);

  const handleParentClick = (event: React.MouseEvent) => {
    event.preventDefault();
    if (locked) {
      showUpgrade();
      return;
    }
    if (!sidebarOpen) {
      setSidebarOpen(true);
      setExpanded(true);
      return;
    }
    setExpanded((value) => !value);
  };

  return (
    <li className="group relative">
      {hasChildren ? (
        <>
          <button
            type="button"
            onClick={handleParentClick}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            aria-current={childIsActive ? 'true' : undefined}
            data-active={isItemActive ? 'true' : undefined}
            className={clsx(
              'relative flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors touch-manipulation',
              density === 'compact' ? 'py-1.5' : 'py-2.5',
              isItemActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              !sidebarOpen && 'justify-center',
              locked && 'opacity-60',
            )}
          >
            {childIsActive && (
              <span
                className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-500"
                aria-hidden="true"
              />
            )}
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {sidebarOpen ? (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{t(labelKeyFor(item.labelKey))}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {locked && (
                    <Lock
                      className="h-3.5 w-3.5 text-gray-400"
                      aria-label={t('navigation.accessibility.upgradeRequired')}
                    />
                  )}
                  <ChevronDown
                    className={clsx(
                      'h-4 w-4 text-gray-400 transition-transform duration-200',
                      !isExpanded && '-rotate-90',
                    )}
                    aria-hidden="true"
                  />
                </span>
              </span>
            ) : null}
            {!sidebarOpen && locked && (
              <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-gray-400" aria-hidden="true" />
            )}
          </button>

          {sidebarOpen && isExpanded && (
            <ul
              id={panelId}
              className="ms-5 mt-1 space-y-0.5 border-s border-gray-200 ps-2"
            >
              {children.map((child) => {
                const ChildIcon = child.icon;
                const childActive = isNavigationPathActive(
                  child.path,
                  location.pathname,
                  location.search,
                );
                return (
                  <li key={`${child.labelKey}:${child.path}`}>
                    <Link
                      to={child.path}
                      onClick={(event) => {
                        if (locked) {
                          event.preventDefault();
                          showUpgrade();
                          return;
                        }
                        closeOnMobile();
                      }}
                      aria-current={childActive ? 'page' : undefined}
                      className={clsx(
                        'relative flex items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors touch-manipulation',
                        density === 'compact' ? 'py-1.5' : 'py-2',
                        childActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
                        locked && 'opacity-60',
                      )}
                    >
                      <ChildIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{t(labelKeyFor(child.labelKey))}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!sidebarOpen && (
            <div className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">
              {t(labelKeyFor(item.labelKey))}
              {locked ? ` ${t('navigation.accessibility.upgradeSuffix')}` : ''}
              <div className="absolute right-full top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rotate-45 bg-gray-900" />
            </div>
          )}
        </>
      ) : (
        <>
          <NavLink
            to={item.path ?? '#'}
            end={isClinicalWorkspace && item.path === '/healthcare'}
            onClick={(event) => {
              if (locked) {
                event.preventDefault();
                showUpgrade();
                return;
              }
              closeOnMobile();
            }}
            aria-current={leafIsActive ? 'page' : undefined}
            className={clsx(
              'relative flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors touch-manipulation',
              density === 'compact' ? 'py-1.5' : 'py-2.5',
              leafIsActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              !sidebarOpen && 'justify-center',
              locked && 'opacity-60',
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {sidebarOpen ? (
              <span className="flex flex-1 items-center justify-between gap-2 truncate">
                <span className="truncate">{t(labelKeyFor(item.labelKey))}</span>
                {locked && (
                  <Lock
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                    aria-label={t('navigation.accessibility.upgradeRequired')}
                  />
                )}
              </span>
            ) : null}
            {!sidebarOpen && locked && (
              <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-gray-400" aria-hidden="true" />
            )}
            {leafIsActive && <span className="sr-only"> {t('navigation.accessibility.currentPage')}</span>}
          </NavLink>
          {!sidebarOpen && (
            <div className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">
              {t(labelKeyFor(item.labelKey))}
              {locked ? ` ${t('navigation.accessibility.upgradeSuffix')}` : ''}
              <div className="absolute right-full top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rotate-45 bg-gray-900" />
            </div>
          )}
        </>
      )}
    </li>
  );
}

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
  const operatingModels = useAppStore((s) => s.currentBusiness?.business?.operating_models ?? null);
  const { logoUrl, businessName } = useBrandTheme();
  const { planTier } = useUsage();
  const { isFeatureEnabled } = usePartner();
  const isOrgCapabilityEnabled = useOrganisationCapabilityVisibility();
  const isPlatformAdmin = useIsPlatformAdmin();
  const landingPath = useDefaultRoute();

  // Pure/hybrid healthcare tenants read the central five-group clinical
  // builder. Every other tenant keeps the richer capability/partner-aware
  // NAV_SECTIONS configuration, so construction, manufacturing and retail
  // navigation is untouched.
  const clinicalNavigation = useMemo(
    () => buildNavigation({ subscriptionPlan: planTier, operatingModels }),
    [operatingModels, planTier],
  );
  const isClinicalWorkspace = clinicalNavigation.some(
    (section) => section.key === 'clinical_operations',
  );
  const clinicalSections = useMemo<NavSectionConfig[]>(() => {
    if (!isClinicalWorkspace) return [];
    const canReach = (path: string) =>
      !role || isPathAllowedForRole(role, resolveNavigationTarget(path));
    return clinicalNavigation
      .map((section) => ({
        labelKey: section.titleKey,
        items: section.items
          .map((item) => {
            const children = (item.children ?? [])
              .filter((child) => canReach(child.path))
              .map((child) => ({
                labelKey: child.labelKey,
                path: child.path,
                icon: navIcon(child.icon ?? item.icon),
              }));
            return {
              labelKey: item.labelKey,
              ...(item.path ? { path: item.path } : {}),
              icon: navIcon(item.icon),
              locked: false,
              ...(children.length > 0 ? { children } : {}),
            };
          })
          .filter((item) => Boolean(item.path) || Boolean(item.children?.length))
          .filter((item) => !item.path || canReach(item.path)),
      }))
      .filter((section) => section.items.length > 0);
  }, [clinicalNavigation, isClinicalWorkspace, role]);

  // `visibleSectionsFor` already applies business labels; the resolver keeps
  // the collapsed-rail tooltip and upgrade prompt aligned with the link text.
  const visibleSections = isClinicalWorkspace
    ? clinicalSections
    : visibleSectionsFor(isFeatureEnabled, role, isOrgCapabilityEnabled, planTier, operatingModels);
  const labelKeyFor = navLabelResolver(isOrgCapabilityEnabled, operatingModels);

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
          <Link
            to={landingPath}
            className="flex min-w-0 items-center gap-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
            aria-label={businessName || 'Home'}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={businessName} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
                {(businessName || 'L').charAt(0).toUpperCase()}
              </div>
            )}
            {sidebarOpen && <span className="truncate text-[15px] font-semibold text-gray-900">{businessName}</span>}
          </Link>
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label={t('common.close')}
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
            const isSupport = section.labelKey.toLowerCase().includes('support');
            return (
              <div key={section.labelKey} className={clsx('mb-6', isSupport && 'mt-8 pt-6 border-t border-gray-100')}>
                {sidebarOpen && (
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {t(section.labelKey)}
                  </p>
                )}
                <ul className={clsx('space-y-1', density === 'compact' && 'space-y-0.5')}>
                  {section.items.map((item) => (
                    <SidebarNavEntry
                      key={`${item.labelKey}:${item.path ?? 'group'}`}
                      item={item}
                      sectionMinPlan={section.minPlan}
                      sidebarOpen={sidebarOpen}
                      density={density}
                      isClinicalWorkspace={isClinicalWorkspace}
                      planTier={planTier}
                      businessId={businessId}
                      labelKeyFor={labelKeyFor}
                      setSidebarOpen={setSidebarOpen}
                    />
                  ))}
                </ul>
              </div>
            );
          })}

          {isPlatformAdmin && (
            <div className="mb-6 mt-8 border-t border-gray-100 pt-6">
              {sidebarOpen && (
                <p className="mb-2 px-3 text-[11px] font-semibold text-gray-400 category-label">
                  {t('navigation.sections.admin')}
                </p>
              )}
              <ul className="space-y-1">
                <li>
                  <NavLink
                    to="/admin/businesses"
                    className={({ isActive }) =>
                      clsx(
                        'relative flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors touch-manipulation',
                        density === 'compact' ? 'py-1.5' : 'py-2.5',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                        !sidebarOpen && 'justify-center',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Building2 className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        {sidebarOpen ? (
                          <span className="truncate">{t('navigation.items.businesses')}</span>
                        ) : null}
                        {isActive && <span className="sr-only"> {t('navigation.accessibility.currentPage')}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/admin/billing"
                    className={({ isActive }) =>
                      clsx(
                        'relative flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors touch-manipulation',
                        density === 'compact' ? 'py-1.5' : 'py-2.5',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                        !sidebarOpen && 'justify-center',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <DollarSign className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        {sidebarOpen ? (
                          <span className="truncate">{t('navigation.items.adminBilling')}</span>
                        ) : null}
                        {isActive && <span className="sr-only"> {t('navigation.accessibility.currentPage')}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              </ul>
            </div>
          )}
        </nav>

        <div className="border-t border-gray-200 p-3 shrink-0">
          <button
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? t('common.collapse') : t('common.expandSidebar')}
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
            title={t('navigation.accessibility.dragToResize')}
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
