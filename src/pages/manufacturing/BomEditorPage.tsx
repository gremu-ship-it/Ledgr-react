import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers3, LoaderCircle, PackagePlus, Plus, Save, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';
import { repos } from '@/lib/repositories';
import type { BomComponentDraft, BomComponentTree, BomVersionTree } from '@/dal/repositories/BomRepository';
import type { Row } from '@/dal/types/database';

interface BomListItem extends Row<'boms'> {
  versions: Row<'bom_versions'>[];
}

interface BomCandidate {
  bom: Row<'boms'>;
  versions: Row<'bom_versions'>[];
}

interface EditorComponent extends BomComponentDraft {
  localId: string;
  productName?: string;
  subassemblyName?: string;
  subassembly?: BomVersionTree | null;
  product?: BomComponentTree['product'];
}

type AddMode = 'product' | 'subassembly';

let nextLocalId = 1;
const localId = () => `bom-component-${nextLocalId++}`;
const EMPTY_PRODUCTS: Row<'products'>[] = [];

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

function editorComponentFromTree(component: BomComponentTree): EditorComponent {
  return {
    localId: localId(),
    component_product_id: component.component_product_id,
    component_bom_version_id: component.component_bom_version_id,
    quantity: component.quantity,
    unit_of_measure: component.unit_of_measure,
    scrap_percentage: component.scrap_percentage,
    sort_order: component.sort_order,
    notes: component.notes,
    product: component.product,
    productName: component.product?.name,
    subassembly: component.subassembly,
    subassemblyName: component.subassembly?.bom.name,
  };
}

function displayComponentFromTree(component: BomComponentTree): EditorComponent {
  return {
    ...editorComponentFromTree(component),
    subassembly: component.subassembly,
  };
}

function ComponentRows({
  components,
  businessId,
  editable,
  onQuantityChange,
  onRemove,
  t,
}: {
  components: EditorComponent[];
  businessId: string;
  editable: boolean;
  onQuantityChange?: (id: string, quantity: string) => void;
  onRemove?: (id: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (!components.length) {
    return <p className="px-4 py-5 text-sm text-gray-500">{t('manufacturing.bom.noComponents')}</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {components.map((component) => (
        <ComponentRow
          key={component.localId}
          component={component}
          businessId={businessId}
          editable={editable}
          onQuantityChange={onQuantityChange}
          onRemove={onRemove}
          t={t}
          depth={0}
        />
      ))}
    </div>
  );
}

function ComponentRow({
  component,
  businessId,
  editable,
  onQuantityChange,
  onRemove,
  t,
  depth,
}: {
  component: EditorComponent;
  businessId: string;
  editable: boolean;
  onQuantityChange?: (id: string, quantity: string) => void;
  onRemove?: (id: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSubassembly = Boolean(component.component_bom_version_id);
  const nestedTree = useQuery({
    queryKey: ['manufacturing', 'bom-version-tree', businessId, component.component_bom_version_id],
    queryFn: () => repos.bom.getVersionTree(businessId, component.component_bom_version_id!),
    enabled: expanded && hasSubassembly && !component.subassembly,
  });
  const subassembly = component.subassembly ?? nestedTree.data ?? null;
  const childRows = subassembly?.components.map(displayComponentFromTree) ?? [];
  const title = hasSubassembly
    ? component.subassemblyName ?? subassembly?.bom.name ?? t('manufacturing.bom.subAssembly')
    : component.productName ?? component.product?.name ?? t('manufacturing.bom.rawMaterial');
  const rowLabel = hasSubassembly ? t('manufacturing.bom.subAssembly') : t('manufacturing.bom.rawMaterial');

  return (
    <div className="bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ paddingInlineStart: `${16 + depth * 18}px` }}>
        {hasSubassembly ? (
          <button
            type="button"
            aria-label={t(expanded ? 'manufacturing.bom.collapseSubassembly' : 'manufacturing.bom.expandSubassembly')}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-400">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-[140px] flex-1">
          <p className="font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{rowLabel}{component.product?.sku ? ` · ${component.product.sku}` : ''}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          <span>{t('manufacturing.bom.quantityPerUnit')}</span>
          <input
            aria-label={`${t('manufacturing.bom.quantityPerUnit')}: ${title}`}
            type="number"
            min="0.000001"
            step="any"
            value={component.quantity}
            disabled={!editable}
            onChange={(event) => onQuantityChange?.(component.localId, event.target.value)}
            className="w-24 rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-600"
          />
        </label>
        <span className="min-w-12 text-sm text-gray-500">{component.unit_of_measure}</span>
        {editable && onRemove && (
          <button
            type="button"
            aria-label={t('manufacturing.bom.removeComponent')}
            onClick={() => onRemove(component.localId)}
            className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && hasSubassembly && (
        <div className="border-s-2 border-brand-100 bg-gray-50/70" style={{ marginInlineStart: `${24 + depth * 18}px` }}>
          {nestedTree.isLoading ? (
            <p className="px-4 py-3 text-sm text-gray-500">{t('common.loading')}</p>
          ) : nestedTree.error ? (
            <p className="px-4 py-3 text-sm text-red-600">{t('manufacturing.bom.errors.loadFailed')}</p>
          ) : !childRows.length ? (
            <p className="px-4 py-3 text-sm text-gray-500">{t('manufacturing.bom.noComponents')}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {childRows.map((child) => (
                <ComponentRow
                  key={child.localId}
                  component={child}
                  businessId={businessId}
                  editable={false}
                  t={t}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddComponentDialog({
  mode,
  products,
  candidates,
  currentBomId,
  onClose,
  onAdd,
}: {
  mode: AddMode;
  products: Row<'products'>[];
  candidates: BomCandidate[];
  currentBomId: string | null;
  onClose: () => void;
  onAdd: (component: EditorComponent) => void;
}) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState('');
  const [bomId, setBomId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('ea');
  const [scrap, setScrap] = useState('0');
  const [error, setError] = useState('');
  const selectableBoms = candidates.filter((candidate) => candidate.bom.id !== currentBomId);
  const selectedCandidate = selectableBoms.find((candidate) => candidate.bom.id === bomId);
  const preferredVersion = selectedCandidate?.versions.find((version) => version.status === 'active') ?? selectedCandidate?.versions[0];
  const effectiveVersionId = versionId || preferredVersion?.id || '';

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedScrap = Number(scrap);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError(t('manufacturing.bom.errors.positiveQuantity'));
      return;
    }
    if (!Number.isFinite(parsedScrap) || parsedScrap < 0 || parsedScrap >= 100) {
      setError(t('manufacturing.bom.errors.invalidScrap'));
      return;
    }
    if (mode === 'product') {
      const product = products.find((item) => item.id === productId);
      if (!product) {
        setError(t('manufacturing.bom.errors.requiredComponent'));
        return;
      }
      onAdd({
        localId: localId(), component_product_id: product.id, component_bom_version_id: null,
        quantity: parsedQuantity, unit_of_measure: unit || product.unit_of_measure || 'ea',
        scrap_percentage: Number.isFinite(parsedScrap) ? parsedScrap : 0,
        sort_order: 0, notes: null, product, productName: product.name,
      });
      return;
    }
    if (!selectedCandidate) {
      setError(t('manufacturing.bom.errors.requiredComponent'));
      return;
    }
    if (!effectiveVersionId) {
      setError(t('manufacturing.bom.errors.requiredVersion'));
      return;
    }
    onAdd({
      localId: localId(), component_product_id: null, component_bom_version_id: effectiveVersionId,
      quantity: parsedQuantity, unit_of_measure: unit || selectedCandidate.bom.unit_of_measure || 'ea',
      scrap_percentage: Number.isFinite(parsedScrap) ? parsedScrap : 0,
      sort_order: 0, notes: null,
      subassemblyName: selectedCandidate.bom.name,
      subassembly: null,
    });
  }

  const label = mode === 'product' ? t('manufacturing.bom.addComponent') : t('manufacturing.bom.addSubassembly');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl sm:p-6" aria-label={label}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('manufacturing.bom.quantityPerUnit')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {mode === 'product' ? (
          <label className="mb-4 block text-sm font-medium text-gray-700">
            {t('manufacturing.bom.selectProduct')}
            <select value={productId} onChange={(event) => { const id = event.target.value; setProductId(id); setUnit(products.find((product) => product.id === id)?.unit_of_measure || 'ea'); }} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-normal">
              <option value="">{t('manufacturing.bom.selectProduct')}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="mb-4 block text-sm font-medium text-gray-700">
              {t('manufacturing.bom.selectSubassembly')}
              <select value={bomId} onChange={(event) => { setBomId(event.target.value); setVersionId(''); }} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-normal">
                <option value="">{t('manufacturing.bom.selectSubassembly')}</option>
                {selectableBoms.map(({ bom }) => <option key={bom.id} value={bom.id}>{bom.code} — {bom.name}</option>)}
              </select>
            </label>
            <label className="mb-4 block text-sm font-medium text-gray-700">
              {t('manufacturing.bom.selectSubassemblyVersion')}
              <select value={effectiveVersionId} onChange={(event) => setVersionId(event.target.value)} disabled={!selectedCandidate} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-normal disabled:bg-gray-50">
                <option value="">{t('manufacturing.bom.selectVersion')}</option>
                {selectedCandidate?.versions.map((version) => <option key={version.id} value={version.id}>{t('manufacturing.bom.versionNumber', { number: version.version_number })}{version.version_label ? ` · ${version.version_label}` : ''} · {t(`manufacturing.bom.${version.status}`)}</option>)}
              </select>
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-gray-700">
            {t('manufacturing.bom.quantityPerUnit')}
            <input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            {t('manufacturing.bom.unit')}
            <input value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium text-gray-700">
          {t('manufacturing.bom.scrapPercentage')}
          <input type="number" min="0" max="99.999" step="any" value={scrap} onChange={(event) => setScrap(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">{t('common.cancel')}</button>
          <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">{t('manufacturing.bom.addToBom')}</button>
        </div>
      </form>
    </div>
  );
}

export function BomEditorPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const { canWrite } = usePermissions();
  const [selectedBomId, setSelectedBomId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [header, setHeader] = useState({ code: '', name: '', productId: '', versionLabel: '1' });
  const [draftComponents, setDraftComponents] = useState<EditorComponent[]>([]);
  const [editing, setEditing] = useState(false);
  const editorEnabled = canWrite && editing;
  const [isNewBom, setIsNewBom] = useState(false);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const loadedVersionId = useRef('');

  const bomsQuery = useQuery({
    queryKey: ['manufacturing', 'boms', businessId],
    queryFn: async (): Promise<BomListItem[]> => {
      const boms = await repos.bom.listBoms(businessId);
      return Promise.all(boms.map(async (bom) => ({ ...bom, versions: await repos.bom.listVersions(businessId, bom.id) })));
    },
    enabled: Boolean(businessId),
  });
  const productsQuery = useQuery({
    queryKey: ['manufacturing', 'products', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId),
    enabled: Boolean(businessId),
  });
  const candidatesQuery = useQuery({
    queryKey: ['manufacturing', 'subassembly-candidates', businessId],
    queryFn: async (): Promise<BomCandidate[]> => {
      const boms = await repos.bom.listBoms(businessId);
      return Promise.all(boms.map(async (bom) => ({ bom, versions: await repos.bom.listVersions(businessId, bom.id) })));
    },
    enabled: Boolean(businessId),
  });
  const selectedTreeQuery = useQuery({
    queryKey: ['manufacturing', 'bom-version-tree', businessId, selectedVersionId],
    queryFn: () => repos.bom.getVersionTree(businessId, selectedVersionId),
    enabled: Boolean(businessId && selectedVersionId),
  });

  const boms = bomsQuery.data ?? [];
  const products = productsQuery.data ?? EMPTY_PRODUCTS;
  const candidates = candidatesQuery.data ?? [];
  const selectedBom = boms.find((bom) => bom.id === selectedBomId) ?? null;
  const selectedTree = selectedTreeQuery.data;
  const activeVersionId = selectedBom?.versions.find((version) => version.status === 'active')?.id ?? '';
  const activeTreeQuery = useQuery({
    queryKey: ['manufacturing', 'bom-version-tree', businessId, activeVersionId],
    queryFn: () => repos.bom.getVersionTree(businessId, activeVersionId),
    enabled: Boolean(businessId && activeVersionId && selectedBomId),
  });
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const currentVersion = selectedTree;

  useEffect(() => {
    if (!selectedTree || loadedVersionId.current === selectedVersionId) return;
    loadedVersionId.current = selectedVersionId;
    setSelectedBomId(selectedTree.bom_id);
    setHeader({
      code: selectedTree.bom.code,
      name: selectedTree.bom.name,
      productId: selectedTree.bom.product_id,
      versionLabel: selectedTree.version_label ?? String(selectedTree.version_number),
    });
    setDraftComponents(selectedTree.components.map(editorComponentFromTree));
    setEditing(false);
    setIsNewBom(false);
    setError('');
  }, [selectedTree, selectedVersionId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!businessId) throw new Error('Missing business');
      if (!header.code.trim()) throw new Error('requiredCode');
      if (!header.name.trim()) throw new Error('requiredName');
      if (!header.productId) throw new Error('requiredProduct');
      const components: BomComponentDraft[] = draftComponents.map((component, index) => {
        const quantity = Number(component.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('positiveQuantity');
        return {
          component_product_id: component.component_product_id,
          component_bom_version_id: component.component_bom_version_id,
          quantity,
          unit_of_measure: component.unit_of_measure || 'ea',
          scrap_percentage: Number(component.scrap_percentage) || 0,
          sort_order: index,
          notes: component.notes,
        };
      });
      return repos.bom.saveVersion({
        businessId,
        bomId: selectedBomId,
        code: header.code.trim(),
        name: header.name.trim(),
        productId: header.productId,
        versionLabel: header.versionLabel.trim() || null,
        components,
      });
    },
    onSuccess: async (versionId) => {
      setSuccess(t('manufacturing.bom.saved'));
      setError('');
      setEditing(false);
      setIsNewBom(false);
      setSelectedVersionId(versionId);
      loadedVersionId.current = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['manufacturing', 'subassembly-candidates', businessId] }),
      ]);
    },
    onError: (cause) => {
      const reason = messageOf(cause);
      const validationKey = ['requiredCode', 'requiredName', 'requiredProduct', 'positiveQuantity'].find((key) => reason === key);
      if (validationKey) {
        setError(t(`manufacturing.bom.errors.${validationKey}`));
      } else if (/BOM cycle detected/i.test(reason)) {
        const candidate = draftComponents.find((component) => component.component_bom_version_id);
        const candidateName = candidate?.subassemblyName
          ?? candidates.find((option) => option.versions.some((version) => version.id === candidate?.component_bom_version_id))?.bom.name
          ?? t('manufacturing.bom.errors.unknownSubassembly');
        setError(t('manufacturing.bom.errors.cycleError', { bomName: candidateName }));
      } else {
        setError(t('manufacturing.bom.errors.saveFailed'));
      }
      setSuccess('');
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => {
      if (!businessId || !selectedVersionId) throw new Error('Missing BOM version');
      return repos.bom.activateVersion(businessId, selectedVersionId);
    },
    onSuccess: async () => {
      setError('');
      setSuccess(t('manufacturing.bom.activated'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['manufacturing', 'boms', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['manufacturing', 'subassembly-candidates', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['manufacturing', 'bom-version-tree', businessId] }),
      ]);
      loadedVersionId.current = '';
      await selectedTreeQuery.refetch();
    },
    onError: () => {
      setError(t('manufacturing.bom.errors.activateFailed'));
      setSuccess('');
    },
  });

  function openBom(bom: BomListItem) {
    loadedVersionId.current = '';
    setError('');
    setSuccess('');
    setIsNewBom(false);
    setSelectedBomId(bom.id);
    const version = bom.versions.find((candidate) => candidate.status === 'active') ?? bom.versions[0];
    setSelectedVersionId(version?.id ?? '');
    if (!version) {
      setHeader({ code: bom.code, name: bom.name, productId: bom.product_id, versionLabel: '1' });
      setDraftComponents([]);
      setEditing(canWrite);
    }
  }

  function startNewBom() {
    loadedVersionId.current = '';
    setSelectedBomId(null);
    setSelectedVersionId('');
    setHeader({ code: '', name: '', productId: '', versionLabel: '1' });
    setDraftComponents([]);
    setIsNewBom(true);
    setEditing(true);
    setError('');
    setSuccess('');
  }

  function startNewVersion() {
    const base = activeTreeQuery.data ?? (!activeVersionId ? selectedTree : currentVersion?.status === 'active' ? currentVersion : null);
    if (!base) return;
    setDraftComponents(base.components.map(editorComponentFromTree));
    setHeader((value) => ({
      ...value,
      versionLabel: String(Math.max(...(selectedBom?.versions.map((version) => version.version_number) ?? [base.version_number])) + 1),
    }));
    setEditing(true);
    setError('');
    setSuccess('');
  }

  function addComponent(component: EditorComponent) {
    setDraftComponents((items) => [...items, { ...component, sort_order: items.length }]);
    setAddMode(null);
    setError('');
  }

  const outputProducts = products.filter((product) => product.product_type !== 'service');
  const selectedProductName = productById.get(header.productId)?.name;
  const currentStatus = currentVersion?.status;
  const canActivate = Boolean(canWrite && currentVersion?.status === 'draft' && !editing);
  const canCloneVersion = Boolean(canWrite && selectedBomId && currentVersion && (!activeVersionId || activeTreeQuery.data || currentVersion.status === 'active'));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
            <Layers3 className="h-4 w-4" aria-hidden="true" />
            {t('navigation.sections.manufacturing')}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('manufacturing.bom.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('manufacturing.bom.subtitle')}</p>
        </div>
        {canWrite && <button type="button" onClick={startNewBom} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          <Plus className="h-4 w-4" aria-hidden="true" />{t('manufacturing.bom.newBom')}
        </button>}
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.7fr)]">
        <aside className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-4">
            <h2 className="font-semibold text-gray-900">{t('manufacturing.bom.title')}</h2>
          </div>
          {bomsQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-gray-500">{t('manufacturing.bom.loading')}</p>
          ) : bomsQuery.error ? (
            <p className="px-4 py-6 text-sm text-red-600">{t('manufacturing.bom.errors.loadFailed')}</p>
          ) : !boms.length ? (
            <div className="p-5">
              <p className="text-sm text-gray-500">{t('manufacturing.bom.noBoms')}</p>
              {canWrite && <button type="button" onClick={startNewBom} className="mt-3 text-sm font-semibold text-brand-700 hover:text-brand-800">{t('manufacturing.bom.createFirst')}</button>}
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto">
              {boms.map((bom) => {
                const activeVersion = bom.versions.find((version) => version.status === 'active');
                const product = productById.get(bom.product_id);
                return (
                  <li key={bom.id}>
                    <button
                      type="button"
                      onClick={() => openBom(bom)}
                      aria-current={selectedBomId === bom.id ? 'page' : undefined}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${selectedBomId === bom.id ? 'bg-brand-50' : ''}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-gray-900">{bom.code} · {bom.name}</span>
                        <span className="shrink-0 text-xs text-gray-500">{activeVersion ? t('manufacturing.bom.versionNumber', { number: activeVersion.version_number }) : t('manufacturing.bom.noVersion')}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-gray-500">{product?.name ?? ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm">
          {!selectedBomId && !isNewBom ? (
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <PackagePlus className="mb-3 h-9 w-9 text-gray-300" aria-hidden="true" />
              <p className="text-sm text-gray-500">{t('manufacturing.bom.noBoms')}</p>
              {canWrite && <button type="button" onClick={startNewBom} className="mt-4 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">{t('manufacturing.bom.createFirst')}</button>}
            </div>
          ) : (
            <>
              <div className="border-b border-gray-100 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('manufacturing.bom.title')}</p>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900">{header.name || t('manufacturing.bom.newBom')}</h2>
                  </div>
                  {selectedBomId && selectedBom && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor="bom-version-select">{t('manufacturing.bom.selectVersion')}</label>
                      <select
                        id="bom-version-select"
                        value={selectedVersionId}
                        onChange={(event) => { loadedVersionId.current = ''; setSelectedVersionId(event.target.value); setError(''); setSuccess(''); }}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">{t('manufacturing.bom.selectVersion')}</option>
                        {selectedBom.versions.map((version) => <option key={version.id} value={version.id}>{t('manufacturing.bom.versionNumber', { number: version.version_number })}{version.version_label ? ` · ${version.version_label}` : ''} · {t(`manufacturing.bom.${version.status}`)}</option>)}
                      </select>
                      {currentStatus && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentStatus === 'active' ? 'bg-green-50 text-green-700' : currentStatus === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{t(`manufacturing.bom.${currentStatus}`)}</span>}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="text-xs font-semibold text-gray-500">
                    {t('manufacturing.bom.code')}
                    <input value={header.code} disabled={!editorEnabled} onChange={(event) => setHeader((value) => ({ ...value, code: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900 disabled:bg-gray-50 disabled:text-gray-600" />
                  </label>
                  <label className="text-xs font-semibold text-gray-500">
                    {t('manufacturing.bom.name')}
                    <input value={header.name} disabled={!editorEnabled} onChange={(event) => setHeader((value) => ({ ...value, name: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900 disabled:bg-gray-50 disabled:text-gray-600" />
                  </label>
                  <label className="text-xs font-semibold text-gray-500">
                    {t('manufacturing.bom.outputProduct')}
                    <select value={header.productId} disabled={!editorEnabled || Boolean(selectedBomId)} onChange={(event) => setHeader((value) => ({ ...value, productId: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-900 disabled:bg-gray-50 disabled:text-gray-600">
                      <option value="">{t('manufacturing.bom.selectOutputProduct')}</option>
                      {outputProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-gray-500">
                    {t('manufacturing.bom.versionLabel')}
                    <input value={header.versionLabel} disabled={!editorEnabled} onChange={(event) => setHeader((value) => ({ ...value, versionLabel: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900 disabled:bg-gray-50 disabled:text-gray-600" />
                  </label>
                </div>
                {selectedProductName && <p className="mt-2 text-xs text-gray-400">{t('manufacturing.bom.listProduct')}: {selectedProductName}</p>}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('manufacturing.bom.component')}</h3>
                    <p className="mt-0.5 text-xs text-gray-500">{t('manufacturing.bom.quantityPerUnit')}</p>
                  </div>
                  {editorEnabled && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setAddMode('product')} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t('manufacturing.bom.addComponent')}
                      </button>
                      <button type="button" onClick={() => setAddMode('subassembly')} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                        <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />{t('manufacturing.bom.addSubassembly')}
                      </button>
                    </div>
                  )}
                </div>
                {selectedTreeQuery.isLoading && !editing ? (
                  <div className="flex items-center gap-2 px-4 py-8 text-sm text-gray-500"><LoaderCircle className="h-4 w-4 animate-spin" />{t('manufacturing.bom.loading')}</div>
                ) : (
                  <ComponentRows
                    components={draftComponents}
                    businessId={businessId}
                    editable={editorEnabled}
                    t={t}
                    onQuantityChange={(id, quantity) => setDraftComponents((items) => items.map((item) => item.localId === id ? { ...item, quantity: Number(quantity) || 0 } : item))}
                    onRemove={(id) => setDraftComponents((items) => items.filter((item) => item.localId !== id))}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 p-4 sm:p-5">
                <div className="flex flex-wrap gap-2">
                  {canWrite && selectedBomId && currentVersion && !editing && (
                    <button type="button" onClick={startNewVersion} disabled={!canCloneVersion} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">{t('manufacturing.bom.newVersion')}</button>
                  )}
                  {canActivate && (
                    <button
                      type="button"
                      onClick={() => { if (window.confirm(t('manufacturing.bom.confirmActivate'))) activateMutation.mutate(); }}
                      disabled={activateMutation.isPending}
                      className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                    >{t('manufacturing.bom.activateVersion')}</button>
                  )}
                </div>
                {editorEnabled && (
                  <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
                    {saveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                    {t('manufacturing.bom.saveVersion')}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {addMode && canWrite && (
        <AddComponentDialog
          mode={addMode}
          products={products}
          candidates={candidates}
          currentBomId={selectedBomId}
          onClose={() => setAddMode(null)}
          onAdd={addComponent}
        />
      )}
    </div>
  );
}
