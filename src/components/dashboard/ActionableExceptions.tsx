import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, CircleCheck, Factory, HardHat, ReceiptText, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useOutstandingInvoices } from '@/hooks/useDashboardData';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { getManufacturingDashboard } from '@/dal/repositories/ManufacturingDashboardRepository';
import { getDefaultManufacturingDashboardRange } from '@/pages/manufacturing/manufacturingDashboardRange';

const LOW_YIELD_THRESHOLD = 85;
const MAX_EXCEPTIONS_PER_GROUP = 5;

interface ExceptionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
}

function dateOnlyEpoch(date: string): number {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function invoiceBalanceBase(invoice: {
  amount_due: number | null;
  functional_amount: number | null;
  total_amount: number;
  amount_paid: number;
  exchange_rate: number;
}): number {
  return Math.max(0, invoice.amount_due !== null
    ? Number(invoice.amount_due) * Number(invoice.exchange_rate || 1)
    : Number(invoice.functional_amount ?? invoice.total_amount) - Number(invoice.amount_paid) * Number(invoice.exchange_rate || 1));
}

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)}`;
  }
}

function ExceptionCard({ item }: { item: ExceptionItem }) {
  return (
    <Link
      to={item.href}
      className="group flex min-h-20 items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 transition hover:border-amber-400 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-snug text-gray-900">{item.title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-gray-600">{item.detail}</span>
      </span>
      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
    </Link>
  );
}

function ExceptionGroup({
  title,
  icon: Icon,
  items,
  loading,
  failed,
}: {
  title: string;
  icon: LucideIcon;
  items: ExceptionItem[];
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation();
  if (!loading && !failed && items.length === 0) return null;
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
        <Icon className="h-4 w-4 text-amber-700" aria-hidden="true" />
        {title}
      </h3>
      {loading ? <p className="text-sm text-gray-500">{t('dashboard.actionableExceptions.loading')}</p> : null}
      {failed ? <p role="status" className="text-sm text-gray-600">{t('dashboard.actionableExceptions.loadError')}</p> : null}
      {items.length > 0 ? (
        <ul className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
          {items.slice(0, MAX_EXCEPTIONS_PER_GROUP).map((item) => <li key={item.id}><ExceptionCard item={item} /></li>)}
        </ul>
      ) : null}
    </section>
  );
}

export function ActionableExceptions({
  construction,
  manufacturing,
  inventoryEnabled,
}: {
  construction: boolean;
  manufacturing: boolean;
  inventoryEnabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id;
  const currency = business?.base_currency ?? 'MWK';
  const locale = i18n.language || 'en';
  const invoicesQuery = useOutstandingInvoices(businessId);

  const inventoryQuery = useQuery({
    queryKey: ['dashboard', 'actionable-exceptions', 'inventory', businessId],
    queryFn: () => repos.inventory.findDashboardStockBalances(businessId!),
    enabled: Boolean(businessId) && inventoryEnabled,
    staleTime: 5 * 60 * 1000,
  });
  const constructionHoldsQuery = useQuery({
    queryKey: ['dashboard', 'actionable-exceptions', 'construction-holds', businessId],
    queryFn: () => repos.construction.findOpenItems(businessId!),
    enabled: Boolean(businessId) && construction,
    staleTime: 5 * 60 * 1000,
  });
  const submittedChangeOrdersQuery = useQuery({
    queryKey: ['dashboard', 'actionable-exceptions', 'submitted-change-orders', businessId],
    queryFn: () => repos.changeOrder.listSubmittedForApproval(businessId!),
    enabled: Boolean(businessId) && construction,
    staleTime: 5 * 60 * 1000,
  });
  const overBudgetQuery = useQuery({
    queryKey: ['construction', 'dashboard-cost-breakdown', businessId],
    queryFn: () => repos.projects.getCostBreakdownByProject(businessId!),
    enabled: Boolean(businessId) && construction,
    staleTime: 5 * 60 * 1000,
  });
  const manufacturingRange = getDefaultManufacturingDashboardRange();
  const manufacturingDashboardQuery = useQuery({
    queryKey: ['manufacturing', 'dashboard', businessId, manufacturingRange],
    queryFn: () => getManufacturingDashboard(businessId!, manufacturingRange),
    enabled: Boolean(businessId) && manufacturing,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const workOrderStockoutsQuery = useQuery({
    queryKey: ['manufacturing', 'work-order-stockouts', businessId],
    queryFn: () => repos.manufacturing.listWorkOrderStockouts(businessId!),
    enabled: Boolean(businessId) && manufacturing,
    staleTime: 5 * 60 * 1000,
  });

  const overdueInvoices = useMemo(() => {
    const today = dateOnlyEpoch(localDateString());
    return (invoicesQuery.data?.rows ?? []).flatMap((invoice) => {
      if (!invoice.due_date || invoiceBalanceBase(invoice) <= 0) return [];
      const days = Math.floor((today - dateOnlyEpoch(invoice.due_date)) / 86_400_000);
      return days > 30
        ? [{
            id: invoice.id,
            title: t('dashboard.actionableExceptions.overdueInvoice', {
              invoice: invoice.invoice_number,
              days,
            }),
            detail: t('dashboard.actionableExceptions.openInvoiceList'),
            href: '/invoices?status=overdue',
          }]
        : [];
    });
  }, [invoicesQuery.data?.rows, t]);

  const lowStockItems = useMemo(() => !inventoryEnabled ? [] : (inventoryQuery.data ?? []).flatMap((balance) => {
    const reorderLevel = balance.products?.reorder_level;
    const available = Number(balance.quantity_available ?? (balance.quantity_on_hand - balance.quantity_reserved));
    return reorderLevel != null && available <= Number(reorderLevel)
      ? [{
          id: balance.id,
          title: t('dashboard.actionableExceptions.lowStock', {
            product: balance.products?.name ?? balance.products?.sku ?? '—',
          }),
          detail: t('dashboard.actionableExceptions.openWarehouse'),
          href: '/warehouse',
        }]
      : [];
  }), [inventoryEnabled, inventoryQuery.data, t]);

  const constructionHoldItems = useMemo(() => {
    const holds = constructionHoldsQuery.data?.open_holds ?? [];
    if (!holds.length) return [];
    return [{
      id: 'construction-open-holds',
      title: t('dashboard.actionableExceptions.openProcurementHolds', { count: holds.length }),
      detail: t('dashboard.actionableExceptions.openConstruction'),
      href: '/construction',
    }];
  }, [constructionHoldsQuery.data, t]);

  const changeOrderItems = useMemo(() => (submittedChangeOrdersQuery.data ?? []).map((changeOrder) => ({
    id: changeOrder.id,
    title: t('dashboard.actionableExceptions.submittedChangeOrder', {
      number: changeOrder.co_number,
      title: changeOrder.title,
    }),
    detail: t('dashboard.actionableExceptions.openChangeOrder'),
    href: `/construction/change-orders/${changeOrder.id}`,
  })), [submittedChangeOrdersQuery.data, t]);

  const overBudgetItems = useMemo(() => (overBudgetQuery.data ?? [])
    .filter((project) => Number(project.budget) > 0 && Number(project.net_cost) > Number(project.budget))
    .map((project) => ({
      id: project.project_id,
      title: t('dashboard.actionableExceptions.overBudgetProject', {
        project: project.project_name,
        amount: formatMoney(Number(project.net_cost) - Number(project.budget), currency, locale),
      }),
      detail: t('dashboard.actionableExceptions.openProject'),
      href: `/construction/projects/${project.project_id}`,
    })), [overBudgetQuery.data, currency, locale, t]);

  const stockoutItems = useMemo(() => (workOrderStockoutsQuery.data ?? []).map((workOrder) => ({
    id: workOrder.work_order_id,
    title: t('dashboard.actionableExceptions.workOrderStockout', {
      workOrder: workOrder.work_order_number,
      product: workOrder.product_name,
      count: workOrder.shortage_components,
    }),
    detail: t('dashboard.actionableExceptions.openWorkOrder'),
    href: `/manufacturing/production/${workOrder.work_order_id}`,
  })), [workOrderStockoutsQuery.data, t]);

  const lowYieldItems = useMemo(() => (manufacturingDashboardQuery.data?.yieldByProduct ?? [])
    .filter((product) => Number(product.yield_pct) < LOW_YIELD_THRESHOLD)
    .map((product) => ({
      id: product.product_id,
      title: t('dashboard.actionableExceptions.workOrderYield', {
        product: product.product_name,
        yield: Number(product.yield_pct).toFixed(1),
        threshold: LOW_YIELD_THRESHOLD,
      }),
      detail: t('dashboard.actionableExceptions.openProduction'),
      href: '/manufacturing/production',
    })), [manufacturingDashboardQuery.data, t]);

  const generalItems = [...overdueInvoices, ...lowStockItems];
  const constructionItems = [...constructionHoldItems, ...changeOrderItems, ...overBudgetItems];
  const manufacturingItems = [...stockoutItems, ...lowYieldItems];
  const loading = invoicesQuery.isLoading || (inventoryEnabled && inventoryQuery.isLoading)
    || (construction && (constructionHoldsQuery.isLoading || submittedChangeOrdersQuery.isLoading || overBudgetQuery.isLoading))
    || (manufacturing && (manufacturingDashboardQuery.isLoading || workOrderStockoutsQuery.isLoading));
  const failed = invoicesQuery.isError || (inventoryEnabled && inventoryQuery.isError)
    || (construction && (constructionHoldsQuery.isError || submittedChangeOrdersQuery.isError || overBudgetQuery.isError))
    || (manufacturing && (manufacturingDashboardQuery.isError || workOrderStockoutsQuery.isError));

  if (!businessId) return null;

  if (!loading && !failed && generalItems.length === 0 && constructionItems.length === 0 && manufacturingItems.length === 0) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-5" aria-label={t('dashboard.actionableExceptions.title')}>
        <h2 className="flex items-center gap-2 text-base font-bold text-emerald-900">
          <CircleCheck className="h-5 w-5" aria-hidden="true" />
          {t('dashboard.actionableExceptions.title')}
        </h2>
        <p className="mt-1 text-sm text-emerald-800">{t('dashboard.actionableExceptions.allClear')}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label={t('dashboard.actionableExceptions.title')} data-testid="actionable-exceptions">
      <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
        <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
        {t('dashboard.actionableExceptions.title')}
      </h2>
      <ExceptionGroup
        title={t('dashboard.actionableExceptions.general')}
        icon={ReceiptText}
        items={generalItems}
        loading={invoicesQuery.isLoading || (inventoryEnabled && inventoryQuery.isLoading)}
        failed={invoicesQuery.isError || (inventoryEnabled && inventoryQuery.isError)}
      />
      {construction ? <ExceptionGroup
        title={t('dashboard.actionableExceptions.construction')}
        icon={HardHat}
        items={constructionItems}
        loading={constructionHoldsQuery.isLoading || submittedChangeOrdersQuery.isLoading || overBudgetQuery.isLoading}
        failed={constructionHoldsQuery.isError || submittedChangeOrdersQuery.isError || overBudgetQuery.isError}
      /> : null}
      {manufacturing ? <ExceptionGroup
        title={t('dashboard.actionableExceptions.manufacturing')}
        icon={Factory}
        items={manufacturingItems}
        loading={manufacturingDashboardQuery.isLoading || workOrderStockoutsQuery.isLoading}
        failed={manufacturingDashboardQuery.isError || workOrderStockoutsQuery.isError}
      /> : null}
    </section>
  );
}
