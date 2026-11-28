import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  Package,
  PackagePlus,
  Pencil,
  Pill,
  Plus,
  Power,
  Search,
  Stethoscope,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { ReceiveMedicationBatchModal } from '@/components/healthcare/ReceiveMedicationBatchModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { formatCurrency } from '@/lib/formatters';
import { listMedicationBatches } from '@/services/pharmacyService';
import {
  CATALOGUE_KINDS,
  createHealthcareCatalogueItem,
  deactivateHealthcareCatalogueItem,
  listHealthcareCatalogue,
  summariseStockForItem,
  updateHealthcareCatalogueItem,
  type CatalogueItemInput,
  type CatalogueItemKind,
  type HealthcareCatalogueItem,
} from '@/services/healthcareCatalogueService';

type KindFilter = CatalogueItemKind | 'all';

const KIND_ICONS = {
  drug: Pill,
  supply: Boxes,
  service: Stethoscope,
  product: Package,
} as const;

const KIND_STYLES: Record<CatalogueItemKind, string> = {
  drug: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  supply: 'border-sky-200 bg-sky-50 text-sky-700',
  service: 'border-violet-200 bg-violet-50 text-violet-700',
  product: 'border-amber-200 bg-amber-50 text-amber-800',
};

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

function formatDateKey(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toLocaleDateString();
}

/** Drug, supply, service and product catalogue for the healthcare workspace. */
export function CataloguePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HealthcareCatalogueItem | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<{ name: string; productId: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const catalogueQuery = useQuery({
    queryKey: ['healthcare', 'catalogue', businessId, includeInactive],
    queryFn: () =>
      listHealthcareCatalogue(businessId as string, {
        kind: 'all',
        includeInactive,
      }),
    enabled: Boolean(businessId),
    staleTime: 15_000,
  });

  const batchesQuery = useQuery({
    queryKey: ['healthcare', 'catalogue', 'stock', businessId],
    queryFn: () => listMedicationBatches(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 15_000,
  });

  const items = useMemo(() => catalogueQuery.data ?? [], [catalogueQuery.data]);
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);

  const stockByItem = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summariseStockForItem>>();
    for (const item of items) {
      map.set(item.id, summariseStockForItem(item, batches));
    }
    return map;
  }, [batches, items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        (item.sku ?? '').toLowerCase().includes(term) ||
        (item.strength ?? '').toLowerCase().includes(term) ||
        (item.description ?? '').toLowerCase().includes(term)
      );
    });
  }, [items, kindFilter, search]);

  const counts = useMemo(() => {
    const active = items.filter((item) => item.is_active);
    return {
      total: active.length,
      drugs: active.filter((item) => item.kind === 'drug').length,
      services: active.filter((item) => item.kind === 'service').length,
      outOfStock: active.filter(
        (item) =>
          item.kind === 'drug' &&
          (stockByItem.get(item.id)?.onHand ?? 0) <= 0,
      ).length,
    };
  }, [items, stockByItem]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'catalogue'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'pharmacy'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const deactivate = async (item: HealthcareCatalogueItem) => {
    if (!businessId) return;
    setActionError(null);
    try {
      await deactivateHealthcareCatalogueItem(businessId, item.id);
      invalidate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('healthcare.catalogue.deactivateError'),
      );
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Package className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.catalogue.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.catalogue.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/healthcare/pharmacy"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('healthcare.catalogue.backToPharmacy')}
          </Link>
          <Button
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
            disabled={!canWrite}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.catalogue.addItem')}
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['total', counts.total, Package],
          ['drugs', counts.drugs, Pill],
          ['services', counts.services, Stethoscope],
          ['outOfStock', counts.outOfStock, Boxes],
        ].map(([key, value, Icon]) => {
          const MetricIcon = Icon as typeof Package;
          return (
            <div
              key={String(key)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {t(`healthcare.catalogue.metrics.${String(key)}`)}
                </p>
                <MetricIcon className="h-4 w-4 text-gray-300" aria-hidden />
              </div>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{String(value)}</p>
            </div>
          );
        })}
      </div>

      <section className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...CATALOGUE_KINDS] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              aria-pressed={kindFilter === kind}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                kindFilter === kind
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {kind === 'all'
                ? t('healthcare.catalogue.filters.all')
                : t(`healthcare.catalogue.kinds.${kind}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('healthcare.catalogue.searchPlaceholder')}
              aria-label={t('healthcare.catalogue.searchPlaceholder')}
              className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            {t('healthcare.catalogue.showInactive')}
          </label>
        </div>
      </section>

      {actionError ? <div className="mb-3"><ErrorNotice message={actionError} /></div> : null}
      {catalogueQuery.isError ? (
        <ErrorNotice
          message={
            catalogueQuery.error instanceof Error
              ? catalogueQuery.error.message
              : t('healthcare.catalogue.loadError')
          }
        />
      ) : null}

      {catalogueQuery.isLoading ? (
        <LoadingNotice label={t('healthcare.catalogue.loading')} />
      ) : null}

      {!catalogueQuery.isLoading && filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <Package className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <p className="mt-2 text-sm font-medium text-gray-700">
            {t('healthcare.catalogue.emptyTitle')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            {t('healthcare.catalogue.emptyHint')}
          </p>
          {canWrite ? (
            <Button
              className="mt-4"
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('healthcare.catalogue.addItem')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('healthcare.catalogue.columns.item')}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('healthcare.catalogue.columns.kind')}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t('healthcare.catalogue.columns.price')}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t('healthcare.catalogue.columns.stock')}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('healthcare.catalogue.columns.status')}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t('healthcare.catalogue.columns.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => {
                const Icon = KIND_ICONS[item.kind];
                const stock = stockByItem.get(item.id);
                return (
                  <tr key={item.id} className={item.is_active ? 'hover:bg-gray-50' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-[11px] text-gray-500">
                            {[item.strength, item.dosage_form, item.sku]
                              .filter(Boolean)
                              .join(' · ') || item.unit_of_measure}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLES[item.kind]}`}
                      >
                        {t(`healthcare.catalogue.kinds.${item.kind}`)}
                      </span>
                      {item.is_dispensable ? (
                        <p className="mt-1 text-[10px] font-medium text-emerald-700">
                          {t('healthcare.catalogue.dispensable')}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900">
                        {formatCurrency(item.sale_price, currency)}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {t('healthcare.catalogue.perUnit', { unit: item.unit_of_measure })}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.track_inventory ? (
                        <>
                          <p
                            className={`font-medium ${
                              (stock?.onHand ?? 0) > 0 ? 'text-gray-900' : 'text-red-600'
                            }`}
                          >
                            {stock?.onHand ?? 0}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {stock?.nearestExpiry
                              ? t('healthcare.catalogue.expires', {
                                  date: formatDateKey(stock.nearestExpiry),
                                })
                              : t('healthcare.catalogue.noStock')}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {t('healthcare.catalogue.notTracked')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {item.is_active
                          ? t('healthcare.catalogue.active')
                          : t('healthcare.catalogue.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {item.kind === 'drug' && item.is_active ? (
                          <button
                            type="button"
                            onClick={() => setReceiveTarget({ name: item.name, productId: item.id })}
                            disabled={!canWrite}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <PackagePlus className="h-3 w-3" aria-hidden />
                            {t('healthcare.catalogue.receiveStock')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setEditTarget(item);
                            setFormOpen(true);
                          }}
                          disabled={!canWrite}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                          {t('healthcare.catalogue.edit')}
                        </button>
                        {item.is_active ? (
                          <button
                            type="button"
                            onClick={() => void deactivate(item)}
                            disabled={!canWrite}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            <Power className="h-3 w-3" aria-hidden />
                            {t('healthcare.catalogue.deactivate')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <CatalogueItemModal
        open={formOpen}
        item={editTarget}
        businessId={businessId}
        currency={currency}
        canWrite={canWrite}
        onClose={() => {
          setFormOpen(false);
          setEditTarget(null);
        }}
        onSaved={() => {
          invalidate();
          setFormOpen(false);
          setEditTarget(null);
        }}
      />

      <ReceiveMedicationBatchModal
        open={Boolean(receiveTarget)}
        businessId={businessId}
        canWrite={canWrite}
        defaultMedicationName={receiveTarget?.name ?? ''}
        defaultProductId={receiveTarget?.productId ?? null}
        onClose={() => setReceiveTarget(null)}
        onCreated={() => {
          invalidate();
          setReceiveTarget(null);
        }}
      />
    </div>
  );
}

function CatalogueItemModal({
  open,
  item,
  businessId,
  currency,
  canWrite,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: HealthcareCatalogueItem | null;
  businessId: string;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!open) return null;
  return (
    <CatalogueItemForm
      key={item?.id ?? 'new'}
      item={item}
      businessId={businessId}
      currency={currency}
      canWrite={canWrite}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function CatalogueItemForm({
  item,
  businessId,
  currency,
  canWrite,
  onClose,
  onSaved,
}: {
  item: HealthcareCatalogueItem | null;
  businessId: string;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<CatalogueItemKind>(item?.kind ?? 'drug');
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [strength, setStrength] = useState(item?.strength ?? '');
  const [dosageForm, setDosageForm] = useState(item?.dosage_form ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [unit, setUnit] = useState(item?.unit_of_measure ?? 'each');
  const [salePrice, setSalePrice] = useState(item ? String(item.sale_price) : '');
  const [purchasePrice, setPurchasePrice] = useState(item ? String(item.purchase_price) : '');
  const [trackInventory, setTrackInventory] = useState(
    item ? item.track_inventory : kind !== 'service',
  );
  const [reorderLevel, setReorderLevel] = useState(
    item?.reorder_level == null ? '' : String(item.reorder_level),
  );
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const changeKind = (next: CatalogueItemKind) => {
    setKind(next);
    setTrackInventory(next !== 'service');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const input: CatalogueItemInput = {
        businessId,
        name,
        kind,
        sku,
        strength,
        dosageForm,
        description,
        unitOfMeasure: unit,
        salePrice: Number(salePrice || 0),
        purchasePrice: Number(purchasePrice || 0),
        trackInventory,
        reorderLevel: reorderLevel === '' ? null : Number(reorderLevel),
        isActive,
        currency,
      };
      if (item) {
        await updateHealthcareCatalogueItem(businessId, item.id, input);
      } else {
        await createHealthcareCatalogueItem(input);
      }
      onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.catalogue.saveError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="catalogue-item-title"
      title={
        item ? t('healthcare.catalogue.editTitle') : t('healthcare.catalogue.createTitle')
      }
      subtitle={t('healthcare.catalogue.formSubtitle')}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.cancel')}
          </Button>
          <Button type="submit" form="catalogue-item-form" isLoading={isSaving} disabled={!canWrite}>
            {item ? t('healthcare.common.save') : t('healthcare.catalogue.create')}
          </Button>
        </>
      }
    >
      <form id="catalogue-item-form" onSubmit={submit} className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        {!canWrite ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('healthcare.catalogue.readOnly')}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.catalogue.form.kind')} className="sm:col-span-2">
            <select
              value={kind}
              onChange={(event) => changeKind(event.target.value as CatalogueItemKind)}
              className={INPUT_CLASS}
            >
              {CATALOGUE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {t(`healthcare.catalogue.kinds.${option}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t('healthcare.catalogue.form.name')}
            hint={t('healthcare.catalogue.form.nameHint')}
            className="sm:col-span-2"
          >
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('healthcare.catalogue.form.namePlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>

          {kind === 'drug' ? (
            <>
              <Field label={t('healthcare.catalogue.form.strength')}>
                <input
                  type="text"
                  value={strength}
                  onChange={(event) => setStrength(event.target.value)}
                  placeholder="500 mg"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label={t('healthcare.catalogue.form.dosageForm')}>
                <input
                  type="text"
                  value={dosageForm}
                  onChange={(event) => setDosageForm(event.target.value)}
                  placeholder={t('healthcare.catalogue.form.dosagePlaceholder')}
                  className={INPUT_CLASS}
                />
              </Field>
            </>
          ) : null}

          <Field label={t('healthcare.catalogue.form.sku')}>
            <input
              type="text"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder={t('healthcare.catalogue.form.skuPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.catalogue.form.unit')}>
            <input
              type="text"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder={t('healthcare.catalogue.form.unitPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label={t('healthcare.catalogue.form.salePrice', { currency })}>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.catalogue.form.purchasePrice', { currency })}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={purchasePrice}
              onChange={(event) => setPurchasePrice(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          {kind !== 'service' ? (
            <>
              <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={trackInventory}
                  onChange={(event) => setTrackInventory(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                {t('healthcare.catalogue.form.trackInventory')}
              </label>
              <Field label={t('healthcare.catalogue.form.reorderLevel')}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={reorderLevel}
                  onChange={(event) => setReorderLevel(event.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
            </>
          ) : null}

          <Field label={t('healthcare.catalogue.form.description')} className="sm:col-span-2">
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            {t('healthcare.catalogue.form.active')}
          </label>
        </div>

        {kind === 'drug' ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {t('healthcare.catalogue.form.drugHint')}
          </p>
        ) : null}
      </form>
    </HealthcareModal>
  );
}
