import { useEffect, useMemo, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
import { NAV_SECTIONS } from './navConfig';

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
  const businesses = useAppStore((s) => s.businesses);
  const currentBusinessId = useAppStore((s) => s.currentBusiness?.business.id);
  const switchBusiness = useAppStore((s) => s.switchBusiness);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: products = [] } = useQuery({
    queryKey: ['command-palette-products', currentBusinessId],
    queryFn: () => repos.inventory.findAllProducts(currentBusinessId!),
    enabled: open && Boolean(currentBusinessId),
    staleTime: 1000 * 60 * 5,
  });

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    const navItems: CommandItem[] = NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({
        id: item.path,
        label: t(item.labelKey),
        keywords: `${t(item.labelKey)} ${item.path} ${t(section.labelKey)}`,
        path: item.path,
        icon: item.icon,
        group: t(section.labelKey),
      }))
    );

    const quickActions: CommandItem[] = [
      { id: 'qa-new-invoice', label: t('dashboard.newInvoice'), keywords: 'new invoice create billing', path: '/income?action=invoice', icon: Plus, group: 'Quick Actions' },
      { id: 'qa-record-income', label: t('dashboard.recordIncome'), keywords: 'record income sale revenue quick', path: '/income?action=record', icon: DollarSign, group: 'Quick Actions' },
      { id: 'qa-record-expense', label: t('dashboard.recordExpense'), keywords: 'record expense cost quick', path: '/expenses?action=record', icon: Receipt, group: 'Quick Actions' },
      { id: 'qa-new-expense', label: 'New Expense Builder', keywords: 'expense builder detailed', path: '/expenses?action=expense', icon: Receipt, group: 'Quick Actions' },
      { id: 'qa-run-payroll', label: t('dashboard.runPayroll'), keywords: 'payroll run employees', path: '/payroll?action=run', icon: Users, group: 'Quick Actions' },
      { id: 'qa-reports', label: 'View Reports', keywords: 'reports analytics trial balance', path: '/reports', icon: BarChart2, group: 'Quick Actions' },
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
        navigate('/dashboard');
      },
    }));

    const productCommands: CommandItem[] = (products as Row<'products'>[]).map((product) => ({
      id: `product-${product.id}`,
      label: product.name,
      keywords: `product ${product.name} ${product.sku ?? ''} ${product.description ?? ''}`,
      path: `/products?search=${encodeURIComponent(product.name)}`,
      icon: Package,
      group: 'Products',
    }));

    return [...productCommands, ...quickActions, ...navItems, ...businessSwitches];
  }, [t, businesses, switchBusiness, navigate, products]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 20);
    const q = query.toLowerCase();
    return commands
      .filter((c) => c.keywords.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      .slice(0, 30);
  }, [commands, query]);

  // Keyboard shortcut
  useEffect(() => {
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
    return () => window.removeEventListener('keydown', onKeyDown);
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
            placeholder="Search products, pages, actions, or businesses… (⌘P)"
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
              <p className="text-sm font-medium text-gray-500">No results for “{query}”</p>
              <p className="mt-1 text-xs text-gray-400">Try a product name, SKU, Income, Invoice, or Payroll.</p>
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
