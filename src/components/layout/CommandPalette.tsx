import { useEffect, useMemo, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Search,
  DollarSign,
  Receipt,
  Users,
  BarChart2,
  Settings,
  Plus,
  Sparkles,
  LifeBuoy,
  Building2,
  Package,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';
import { useDefaultRoute } from '../../hooks/useDefaultRoute';
import { isOperatingModelEligible, NAV_SECTIONS } from './navConfig';
import { buildNavigation } from '@/config/navigation';
import { navIcon } from '@/config/navigationIcons';
import { normalizePlanTier } from '@/lib/billing/plans';

interface CommandItem {
  id: string;
  label: string;
  keywords: string;
  path?: string;
  action?: () => void;
  icon: React.ElementType;
  group: string;
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const defaultRoute = useDefaultRoute();
  const businesses = useAppStore((s) => s.businesses);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentBusinessId = currentBusiness?.business.id;
  const operatingModels = currentBusiness?.business?.operating_models ?? null;
  const currentPlan = normalizePlanTier(
    currentBusiness?.business?.plan_tier ?? currentBusiness?.business?.subscription_plan,
  );
  const switchBusiness = useAppStore((s) => s.switchBusiness);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const clinicalNavigation = useMemo(
    () => buildNavigation({ subscriptionPlan: currentPlan, operatingModels }),
    [currentPlan, operatingModels],
  );
  const isClinicalWorkspace = clinicalNavigation.some(
    (section) => section.key === 'clinical_operations',
  );

  const { data: products = [] } = useQuery({
    queryKey: ['command-palette-products', currentBusinessId],
    queryFn: () => repos.inventory.findAllProducts(currentBusinessId!),
    enabled: open && Boolean(currentBusinessId) && !isClinicalWorkspace,
    staleTime: 1000 * 60 * 5,
  });

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    // Vertical isolation: never offer a route that belongs to a different line
    // of business. A retail business must not be able to discover /healthcare
    // (or any other model-gated workspace) through the command palette.
    const clinicalNavItems: CommandItem[] = clinicalNavigation.flatMap((section) =>
      section.items.flatMap((item) => {
        const group = t(section.titleKey);
        if (item.children?.length) {
          return item.children.map((child) => ({
            id: `${section.key}:${item.key}:${child.key}`,
            label: `${t(item.labelKey)} › ${t(child.labelKey)}`,
            keywords: `${t(item.labelKey)} ${t(child.labelKey)} ${item.defaultLabel} ${child.defaultLabel} ${child.path} ${group}`,
            path: child.path,
            icon: navIcon(child.icon ?? item.icon),
            group,
          }));
        }
        if (!item.path) return [];
        return [{
          id: `${section.key}:${item.key}`,
          label: t(item.labelKey),
          keywords: `${t(item.labelKey)} ${item.defaultLabel} ${item.path} ${group}`,
          path: item.path,
          icon: navIcon(item.icon),
          group,
        }];
      }),
    );

    const standardNavItems: CommandItem[] = NAV_SECTIONS.flatMap((section) =>
      section.items
        .filter((item) => isOperatingModelEligible(item, operatingModels))
        .flatMap((item) => {
          if (item.children?.length) {
            return item.children.map((child) => ({
              id: `${section.labelKey}:${item.labelKey}:${child.labelKey}`,
              label: `${t(item.labelKey)} › ${t(child.labelKey)}`,
              keywords: `${t(item.labelKey)} ${t(child.labelKey)} ${item.path ?? ''} ${child.path} ${t(section.labelKey)}`,
              path: child.path,
              icon: child.icon,
              group: t(section.labelKey),
            }));
          }
          if (!item.path) return [];
          return [{
            id: item.path,
            label: t(item.labelKey),
            keywords: `${t(item.labelKey)} ${item.path} ${t(section.labelKey)}`,
            path: item.path,
            icon: item.icon,
            group: t(section.labelKey),
          }];
        }),
    );

    // The standard sidebar still renders the capability-aware legacy config,
    // while `buildNavigation` owns the operational depth. Index those central
    // child destinations too so payroll / banking / tax / ledger / report
    // sub-screens are discoverable in a standard ERP tenant.
    const centralChildItems: CommandItem[] = isClinicalWorkspace
      ? []
      : clinicalNavigation.flatMap((section) =>
          section.items.flatMap((item) =>
            (item.children ?? []).map((child) => ({
              id: `central:${section.key}:${item.key}:${child.key}`,
              label: `${t(item.labelKey)} › ${t(child.labelKey)}`,
              keywords: `${t(item.labelKey)} ${t(child.labelKey)} ${item.defaultLabel} ${child.defaultLabel} ${child.path} ${t(section.titleKey)}`,
              path: child.path,
              icon: navIcon(child.icon ?? item.icon),
              group: t(item.labelKey),
            })),
          ),
        );

    const navItems: CommandItem[] = isClinicalWorkspace
      ? clinicalNavItems
      : [...standardNavItems, ...centralChildItems];

    const quickActions: CommandItem[] = isClinicalWorkspace
      ? [
          { id: 'qa-clinic-hub', label: t('nav.clinicHub'), keywords: 'clinic queue triage hub', path: '/healthcare', icon: navIcon('Activity'), group: t('nav.quickActions') },
          { id: 'qa-patient-directory', label: t('nav.patients'), keywords: 'patient registration directory records', path: '/healthcare/patients', icon: navIcon('Users'), group: t('nav.quickActions') },
          { id: 'qa-patient-billing', label: t('nav.patientBilling'), keywords: 'patient invoice billing payment', path: '/healthcare/billing', icon: navIcon('Receipt'), group: t('nav.quickActions') },
          { id: 'qa-insurance-claims', label: t('nav.insuranceClaims'), keywords: 'insurance hmo claim remittance', path: '/healthcare/insurance', icon: navIcon('ShieldCheck'), group: t('nav.quickActions') },
          { id: 'qa-record-expense', label: t('dashboard.recordExpense'), keywords: 'record clinic expense cost quick', path: '/expenses?action=record', icon: Receipt, group: t('nav.quickActions') },
          { id: 'qa-settings', label: t('nav.settings'), keywords: 'settings configuration billing', path: '/settings', icon: Settings, group: t('nav.quickActions') },
          { id: 'qa-support', label: t('nav.support'), keywords: 'help support contact', path: '/support', icon: LifeBuoy, group: t('nav.quickActions') },
        ]
      : [
          { id: 'qa-new-invoice', label: t('dashboard.newInvoice'), keywords: 'new invoice create billing', path: '/income?action=invoice', icon: Plus, group: 'Quick Actions' },
          { id: 'qa-record-income', label: t('dashboard.recordIncome'), keywords: 'record income sale revenue quick', path: '/income?action=record', icon: DollarSign, group: 'Quick Actions' },
          { id: 'qa-record-expense', label: t('dashboard.recordExpense'), keywords: 'record expense cost quick', path: '/expenses?action=record', icon: Receipt, group: 'Quick Actions' },
          { id: 'qa-new-expense', label: 'New Expense Builder', keywords: 'expense builder detailed', path: '/expenses?action=expense', icon: Receipt, group: 'Quick Actions' },
          { id: 'qa-run-payroll', label: t('payroll.title'), keywords: 'payroll employees', path: '/payroll/employees', icon: Users, group: 'Quick Actions' },
          { id: 'qa-reports', label: 'View Reports', keywords: 'reports analytics trial balance', path: '/reports/trial-balance', icon: BarChart2, group: 'Quick Actions' },
          { id: 'qa-settings', label: 'Settings', keywords: 'settings configuration billing', path: '/settings', icon: Settings, group: 'Quick Actions' },
          { id: 'qa-ai', label: 'Ask Ledgr AI', keywords: 'ai assistant help insights', path: '/ai', icon: Sparkles, group: 'Quick Actions' },
          { id: 'qa-support', label: 'Support', keywords: 'help support contact', path: '/support', icon: LifeBuoy, group: 'Quick Actions' },
        ];

    const businessSwitches: CommandItem[] = businesses.map((m) => ({
      id: `biz-${m.business.id}`,
      label: `Switch to ${m.business.name}`,
      keywords: `switch business ${m.business.name} ${m.role}`,
      icon: Building2,
      group: 'Businesses',
      action: () => {
        switchBusiness(m.business.id);
        navigate(defaultRoute);
      },
    }));

    const productCommands: CommandItem[] = (isClinicalWorkspace ? [] : products as Row<'products'>[]).map((product) => ({
      id: `product-${product.id}`,
      label: product.name,
      keywords: `product ${product.name} ${product.sku ?? ''} ${product.description ?? ''}`,
      path: `/products?search=${encodeURIComponent(product.name)}`,
      icon: Package,
      group: 'Products',
    }));

    return [...productCommands, ...quickActions, ...navItems, ...businessSwitches];
  }, [t, businesses, switchBusiness, navigate, products, defaultRoute, operatingModels, isClinicalWorkspace, clinicalNavigation]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 20);
    const q = query.toLowerCase();
    return commands
      .filter((c) => c.keywords.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      .slice(0, 30);
  }, [commands, query]);

  // Keyboard shortcut and a touch-friendly trigger used by the mobile dashboard.
  useEffect(() => {
    function openFromMobile() {
      setQuery('');
      setSelected(0);
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }

    function onKeyDown(e: KeyboardEvent) {
      const isPaletteShortcut = e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k';
      const mod = e.metaKey || e.ctrlKey;
      if (mod && isPaletteShortcut) {
        e.preventDefault();
        if (open) {
          setOpen(false);
        } else {
          setQuery('');
          setSelected(0);
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 10);
        }
      }
      if (e.key === '/' && !open && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        // Optional: '/' to open as well
        const active = document.activeElement as HTMLElement | null;
        if (!active || active.tagName !== 'INPUT') {
          e.preventDefault();
          setQuery('');
          setSelected(0);
          setOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 10);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ledgr:open-command-palette', openFromMobile);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ledgr:open-command-palette', openFromMobile);
    };
  }, [open]);

  const execute = (item: CommandItem) => {
    setOpen(false);
    navigator.vibrate?.(10);
    if (item.action) item.action();
    else if (item.path) navigate(item.path);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed left-1/2 top-[15%] z-[70] w-[min(90vw,640px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <Search className="h-5 w-5 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[selected]) execute(filtered[selected]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder={
              isClinicalWorkspace
                ? t('nav.commandPlaceholderClinic')
                : t('nav.commandPlaceholder')
            }
            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          <kbd className="hidden sm:inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">ESC</kbd>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-gray-500">
                {t('nav.commandEmpty', { query })}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {isClinicalWorkspace
                  ? t('nav.commandEmptyHintClinic')
                  : t('nav.commandEmptyHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(new Set(filtered.map((f) => f.group))).map((group) => (
                <div key={group}>
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">{group}</p>
                  <div className="space-y-1">
                    {filtered
                      .filter((f) => f.group === group)
                      .map((item) => {
                        const globalIdx = filtered.indexOf(item);
                        const isSel = globalIdx === selected;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={() => execute(item)}
                            onMouseEnter={() => setSelected(globalIdx)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                              isSel ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-100' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isSel ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className="flex-1 truncate font-medium">{item.label}</span>
                            {item.path && <span className="text-[11px] text-gray-400 truncate hidden sm:block">{item.path}</span>}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2 text-[11px] text-gray-500">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5">↑↓</kbd> Navigate
            <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5">⏎</kbd> Select
          </span>
          <span className="hidden sm:inline">Press <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5">⌘P</kbd> to toggle</span>
        </div>
      </div>
    </>
  );
}
