import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import type {
  BoqItem,
  BoqSectionWithItems,
  CreateBoqItemInput,
  Project,
} from '@/dal/repositories/ProjectRepository';
import { ErrorBanner } from '../constructionUi';

type ProductOption = { id: string; name: string; sku: string | null };
type SectionDraft = { code: string; title: string; description: string };
type ItemDraft = {
  item_number: string;
  description: string;
  unit_of_measure: string;
  quantity: number;
  rate: number;
  product_id: string;
  cost_code: string;
  is_provisional: boolean;
  notes: string;
};

const uomOptions = [
  ['m', 'uomM'], ['m²', 'uomM2'], ['m³', 'uomM3'], ['kg', 'uomKg'],
  ['ea', 'uomEa'], ['lot', 'uomLot'], ['hr', 'uomHr'], ['day', 'uomDay'],
] as const;
const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const flattenSections = (sections: BoqSectionWithItems[]): BoqSectionWithItems[] =>
  sections.flatMap((section) => [section, ...flattenSections(section.children)]);
const flattenItems = (sections: BoqSectionWithItems[]): BoqItem[] =>
  sections.flatMap((section) => [...section.items, ...flattenItems(section.children)]);

export function ProjectBoqVersionEditor({
  project,
  canManage,
  currency,
  onNotice,
}: {
  project: Project;
  canManage: boolean;
  currency: string;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const versionsKey = ['construction', 'boq-versions', project.id] as const;
  const versionsQuery = useQuery({
    queryKey: versionsKey,
    queryFn: () => repos.projects.listBoqVersions(project.business_id, project.id),
  });
  const versions = versionsQuery.data ?? [];
  const lockSummaryQuery = useQuery({
    queryKey: ['construction', 'boq-summary', project.id],
    queryFn: () => repos.projects.getBoqSummary(project.id),
  });
  const [selectedId, setSelectedId] = useState('');
  const selectedVersionId = versions.some((version) => version.id === selectedId)
    ? selectedId
    : versions[0]?.id ?? '';
  const [itemDialog, setItemDialog] = useState<{ section: BoqSectionWithItems; item: ReturnType<typeof flattenItems>[number] | null } | null>(null);
  const versionKey = ['construction', 'boq-version', project.id, selectedVersionId] as const;
  const versionQuery = useQuery({
    queryKey: versionKey,
    queryFn: () => repos.projects.getBoqVersion(project.business_id, selectedVersionId),
    enabled: !!selectedVersionId,
  });
  const productsQuery = useQuery({
    queryKey: ['construction', 'boq-products', project.business_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,sku')
        .eq('business_id', project.business_id).order('name');
      if (error) throw error;
      return (data ?? []) as ProductOption[];
    },
    enabled: canManage && Boolean(itemDialog),
  });
  const version = versionQuery.data;
  const tree = version?.sections ?? [];
  const allItems = flattenItems(tree);
  const totalValue = allItems.reduce((sum, item) => sum + Number(item.amount), 0);
  const provisionalTotal = allItems.reduce((sum, item) => sum + (item.is_provisional ? Number(item.amount) : 0), 0);
  const subtotal = totalValue - provisionalTotal;
  const locked = Boolean(project.boq_locked_at || lockSummaryQuery.data?.is_locked);
  const canEdit = canManage && !locked && version?.status === 'draft';
  const displayCurrency = version?.currency || currency;
  const money = (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: displayCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    } catch {
      return `${displayCurrency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  };
  const errorText = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return message.startsWith('construction.boq.errors.') ? t(message) : t('construction.boq.errors.operationFailed');
  };
  const invalidateVersion = () => {
    void cache.invalidateQueries({ queryKey: versionsKey });
    void cache.invalidateQueries({ queryKey: versionKey });
    void cache.invalidateQueries({ queryKey: ['construction', 'boq', project.id] });
    void cache.invalidateQueries({ queryKey: ['construction', 'boq-summary', project.id] });
  };

  const [showVersionDialog, setShowVersionDialog] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const [cloneActive, setCloneActive] = useState(true);
  const [sectionDialog, setSectionDialog] = useState<{ section: BoqSectionWithItems | null; parent: BoqSectionWithItems | null } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const saveFailure = (error: unknown) => { setErrorMessage(errorText(error)); };
  const newVersion = useMutation({
    mutationFn: () => repos.projects.createBoqVersion(project.business_id, {
      project_id: project.id,
      version_label: versionLabel || null,
      currency: currency || 'MWK',
      clone_from_active: cloneActive,
    }),
    onSuccess: (id) => {
      setShowVersionDialog(false);
      setVersionLabel('');
      setSelectedId(id);
      setErrorMessage('');
      invalidateVersion();
      onNotice(t('construction.boq.versionCreated'));
    },
    onError: saveFailure,
  });
  const activate = useMutation({
    mutationFn: () => repos.projects.activateBoqVersion(project.business_id, selectedVersionId),
    onSuccess: () => {
      setErrorMessage('');
      invalidateVersion();
      onNotice(t('construction.boq.versionActivated'));
    },
    onError: saveFailure,
  });
  const saveSection = useMutation({
    mutationFn: async ({ section, parent, draft }: { section: BoqSectionWithItems | null; parent: BoqSectionWithItems | null; draft: SectionDraft }) => {
      if (!version) throw new Error('construction.boq.errors.versionNotFound');
      if (section) return repos.projects.updateSection(project.business_id, section.id, draft);
      return repos.projects.createSection(project.business_id, {
        boq_version_id: version.id,
        parent_section_id: parent?.id ?? null,
        ...draft,
        sort_order: parent ? parent.children.length : tree.length,
      });
    },
    onSuccess: () => { setSectionDialog(null); setErrorMessage(''); invalidateVersion(); },
    onError: saveFailure,
  });
  const removeSection = useMutation({
    mutationFn: (sectionId: string) => repos.projects.deleteSection(project.business_id, sectionId),
    onSuccess: () => { setErrorMessage(''); invalidateVersion(); },
    onError: saveFailure,
  });
  const saveItem = useMutation({
    mutationFn: async ({ section, item, draft }: { section: BoqSectionWithItems; item: ReturnType<typeof flattenItems>[number] | null; draft: ItemDraft }) => {
      const data: CreateBoqItemInput = {
        item_number: draft.item_number,
        description: draft.description,
        unit_of_measure: draft.unit_of_measure,
        quantity: draft.quantity,
        rate: draft.rate,
        product_id: draft.product_id || null,
        cost_code: draft.cost_code || null,
        is_provisional: draft.is_provisional,
        notes: draft.notes || null,
        sort_order: item?.sort_order ?? section.items.length,
      };
      if (item) return repos.projects.updateItem(project.business_id, item.id, data);
      if (!version) throw new Error('construction.boq.errors.versionNotFound');
      return repos.projects.createItem(project.business_id, version.id, section.id, data);
    },
    onSuccess: () => { setItemDialog(null); setErrorMessage(''); invalidateVersion(); },
    onError: saveFailure,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => repos.projects.deleteItem(project.business_id, itemId),
    onSuccess: () => { setErrorMessage(''); invalidateVersion(); },
    onError: saveFailure,
  });
  const reorderSection = async (section: BoqSectionWithItems, delta: number) => {
    if (!version) return;
    const siblings = section.parent_section_id
      ? flattenSections(tree).find((entry) => entry.id === section.parent_section_id)?.children ?? []
      : tree;
    const index = siblings.findIndex((entry) => entry.id === section.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const rootCopy = structuredClone(tree) as BoqSectionWithItems[];
    const setSiblings = (sections: BoqSectionWithItems[]): boolean => {
      if (!section.parent_section_id) {
        sections.splice(0, sections.length, ...reordered);
        return true;
      }
      for (const entry of sections) {
        if (entry.id === section.parent_section_id) {
          entry.children = reordered;
          return true;
        }
        if (setSiblings(entry.children)) return true;
      }
      return false;
    };
    setSiblings(rootCopy);
    await repos.projects.reorderSections(project.business_id, version.id, flattenSections(rootCopy).map((entry) => entry.id));
    invalidateVersion();
  };

  const reorderItem = async (section: BoqSectionWithItems, item: BoqItem, delta: number) => {
    if (!version) return;
    const ordered = [...section.items].sort((a, b) => a.sort_order - b.sort_order || a.item_number.localeCompare(b.item_number));
    const index = ordered.findIndex((entry) => entry.id === item.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await repos.projects.reorderItems(project.business_id, version.id, section.id, ordered.map((entry) => entry.id));
    invalidateVersion();
  };

  if (versionsQuery.isLoading) return <p>{t('construction.boq.loading')}</p>;
  if (versionsQuery.isError) return <ErrorBanner message={errorText(versionsQuery.error)} />;
  if (versionQuery.isError) return <ErrorBanner message={errorText(versionQuery.error)} />;

  const openNewVersion = () => {
    setCloneActive(versions.some((entry) => entry.status === 'active'));
    setShowVersionDialog(true);
  };
  const nextSectionCode = (parent: BoqSectionWithItems | null) => {
    const siblings = parent ? parent.children : tree;
    const prefix = parent ? `${parent.code}.` : '';
    const numbers = siblings.map((entry) => Number(entry.code.slice(prefix.length))).filter(Number.isInteger);
    return `${prefix}${(Math.max(0, ...numbers) + 1).toString()}`;
  };
  const nextItemNumber = (section: BoqSectionWithItems) => {
    const prefix = `${section.code}.`;
    const numbers = allItems.filter((item) => item.item_number.startsWith(prefix))
      .map((item) => Number(item.item_number.slice(prefix.length))).filter(Number.isInteger);
    return `${prefix}${Math.max(0, ...numbers) + 1}`;
  };

  return <div className="space-y-4" data-testid="construction-boq-editor">
    {locked && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">{t('construction.boq.lockBanner')}</div>}
    {errorMessage && <ErrorBanner message={errorMessage} />}
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[minmax(220px,1fr)_auto_auto] sm:items-end">
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="boq-version-select">{t('construction.boq.version')}</label>
        <select id="boq-version-select" aria-label={t('construction.boq.version')} className="w-full rounded-lg border px-3 py-2 text-sm"
          value={selectedVersionId} onChange={(event) => { setSelectedId(event.target.value); setErrorMessage(''); }} disabled={!versions.length}>
          {versions.length === 0 && <option value="">{t('construction.boq.noVersions')}</option>}
          {versions.map((entry) => <option key={entry.id} value={entry.id}>
            {t('construction.boq.versionOption', { version: entry.version_number, label: entry.version_label || t('construction.boq.untitledVersion'), status: t(`construction.boq.status.${entry.status}`) })}
          </option>)}
        </select>
      </div>
      <div className="text-sm"><span className="block text-xs font-semibold text-gray-600">{t('construction.boq.currency')}</span><strong>{displayCurrency}</strong></div>
      {canManage && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={locked || newVersion.isPending} onClick={openNewVersion} className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50">{t('construction.boq.newVersion')}</button>
        {version?.status === 'draft' && <button type="button" disabled={locked || activate.isPending} onClick={() => {
          if (window.confirm(t('construction.boq.confirmActivate'))) activate.mutate();
        }} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('construction.boq.activate')}</button>}
      </div>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="boq-summary">
      <Summary label={t('construction.boq.totalValue')} value={money(version?.total_value ?? 0)} />
      <Summary label={t('construction.boq.subtotal')} value={money(subtotal)} />
      <Summary label={t('construction.boq.provisionalTotal')} value={money(provisionalTotal)} />
      <Summary label={t('construction.boq.contractVariance')} value={money(Number(project.contract_sum) - totalValue)} />
      <Summary label={t('construction.boq.budgetVariance')} value={money(Number(project.budget) - totalValue)} />
    </div>

    {!version ? <div className="rounded-xl border border-dashed bg-white p-8 text-center">
      <p className="text-sm text-gray-600">{t('construction.boq.emptyState')}</p>
      {canManage && !locked && <button type="button" className="mt-3 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white" onClick={openNewVersion}>{t('construction.boq.newVersion')}</button>}
    </div> : versionQuery.isLoading ? <p>{t('construction.boq.loading')}</p> : <section className="overflow-x-auto rounded-xl border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><h2 className="font-semibold">{t('construction.boq.title')}</h2><span className="text-xs text-gray-500">{version.version_label || t('construction.boq.untitledVersion')} · {t(`construction.boq.status.${version.status}`)}</span></div>
        {canEdit && <button type="button" onClick={() => setSectionDialog({ section: null, parent: null })} className="rounded-lg border px-3 py-2 text-sm font-medium">{t('construction.boq.addSection')}</button>}
      </div>
      {tree.length === 0 ? <div className="p-8 text-center text-sm text-gray-600">{t('construction.boq.emptyVersion')}</div> : <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>
          <th className="px-3 py-3">{t('construction.boq.itemNumber')}</th><th className="px-3 py-3">{t('construction.boq.description')}</th>
          <th className="px-3 py-3">{t('construction.boq.unitOfMeasure')}</th><th className="px-3 py-3 text-right">{t('construction.boq.quantity')}</th>
          <th className="px-3 py-3 text-right">{t('construction.boq.rate')}</th><th className="px-3 py-3 text-right">{t('construction.boq.amount')}</th>
          {canEdit && <th className="px-3 py-3">{t('construction.boq.actions')}</th>}
        </tr></thead>
        <tbody>{tree.map((section) => <BoqSectionRows key={section.id} section={section} canEdit={canEdit} money={money} t={t}
          onAddSection={(parent) => setSectionDialog({ section: null, parent })}
          onEditSection={(entry) => setSectionDialog({ section: entry, parent: entry.parent_section_id ? flattenSections(tree).find((s) => s.id === entry.parent_section_id) ?? null : null })}
          onDeleteSection={(entry) => { if (window.confirm(t('construction.boq.confirmDeleteSection'))) removeSection.mutate(entry.id); }}
          onAddItem={(parent) => setItemDialog({ section: parent, item: null })}
          onEditItem={(parent, item, quantity, rate) => setItemDialog({ section: parent, item: { ...item, quantity, rate, amount: rounded(quantity * rate) } })}
          onDeleteItem={(item) => { if (window.confirm(t('construction.boq.confirmDeleteItem'))) removeItem.mutate(item.id); }}
          onSaveInline={(item, quantity, rate) => repos.projects.updateItem(project.business_id, item.id, { quantity, rate })
            .then(() => { invalidateVersion(); setErrorMessage(''); }).catch(saveFailure)}
          onMove={(entry, delta) => { void reorderSection(entry, delta).catch(saveFailure); }}
          onMoveItem={(section, item, delta) => { void reorderItem(section, item, delta).catch(saveFailure); }} />)}</tbody>
        <tfoot><tr className="border-t bg-gray-50 font-semibold"><td colSpan={5} className="px-3 py-3 text-right">{t('construction.boq.grandTotal')}</td><td className="px-3 py-3 text-right">{money(totalValue)}</td>{canEdit && <td />}</tr></tfoot>
      </table>}
    </section>}

    {showVersionDialog && <VersionDialog label={versionLabel} setLabel={setVersionLabel} cloneActive={cloneActive} setCloneActive={setCloneActive}
      busy={newVersion.isPending} canClone={versions.some((entry) => entry.status === 'active')} t={t}
      onCancel={() => setShowVersionDialog(false)} onSubmit={(event) => { event.preventDefault(); newVersion.mutate(); }} />}
    {sectionDialog && <SectionDialog key={`${sectionDialog.section?.id ?? 'new'}:${sectionDialog.parent?.id ?? 'root'}`}
      initial={sectionDialog.section} suggestedCode={sectionDialog.section?.code ?? nextSectionCode(sectionDialog.parent)} t={t}
      busy={saveSection.isPending} onCancel={() => setSectionDialog(null)}
      onSubmit={(draft) => saveSection.mutate({ ...sectionDialog, draft })} />}
    {itemDialog && <ItemDialog key={`${itemDialog.item?.id ?? 'new'}:${itemDialog.section.id}`}
      item={itemDialog.item} suggestedNumber={itemDialog.item?.item_number ?? nextItemNumber(itemDialog.section)} products={productsQuery.data ?? []}
      t={t} busy={saveItem.isPending} onCancel={() => setItemDialog(null)}
      onSubmit={(draft) => saveItem.mutate({ ...itemDialog, draft })} />}
  </div>;
}

function BoqSectionRows({
  section, canEdit, money, t, onAddSection, onEditSection, onDeleteSection, onAddItem, onEditItem, onDeleteItem, onSaveInline, onMove, onMoveItem,
}: {
  section: BoqSectionWithItems;
  canEdit: boolean;
  money: (amount: number) => string;
  t: TFunction;
  onAddSection: (section: BoqSectionWithItems) => void;
  onEditSection: (section: BoqSectionWithItems) => void;
  onDeleteSection: (section: BoqSectionWithItems) => void;
  onAddItem: (section: BoqSectionWithItems) => void;
  onEditItem: (section: BoqSectionWithItems, item: ReturnType<typeof flattenItems>[number], quantity: number, rate: number) => void;
  onDeleteItem: (item: ReturnType<typeof flattenItems>[number]) => void;
  onSaveInline: (item: ReturnType<typeof flattenItems>[number], quantity: number, rate: number) => void;
  onMove: (section: BoqSectionWithItems, delta: number) => void;
  onMoveItem: (section: BoqSectionWithItems, item: BoqItem, delta: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return <>
    <tr className="border-t bg-slate-50 font-semibold">
      <td className="px-3 py-2" style={{ paddingLeft: `${12 + section.level * 20}px` }}>
        <button type="button" aria-label={expanded ? t('construction.boq.collapseSection', { title: section.title }) : t('construction.boq.expandSection', { title: section.title })}
          aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mr-2 text-gray-600">{expanded ? '▼' : '▶'}</button>{section.code}
      </td>
      <td className="px-3 py-2" colSpan={4}>{section.title}</td><td className="px-3 py-2 text-right">{money(section.sectionTotal)}</td>
      {canEdit && <td className="px-3 py-2"><div className="flex flex-wrap gap-2 text-xs">
        <button type="button" aria-label={t('construction.boq.moveSectionUp', { title: section.title })} onClick={() => onMove(section, -1)} className="rounded border px-1.5">↑</button>
        <button type="button" aria-label={t('construction.boq.moveSectionDown', { title: section.title })} onClick={() => onMove(section, 1)} className="rounded border px-1.5">↓</button>
        <button type="button" onClick={() => onAddSection(section)} className="text-brand-700">{t('construction.boq.addChildSection')}</button>
        <button type="button" onClick={() => onAddItem(section)} className="text-brand-700">{t('construction.boq.addItem')}</button>
        <button type="button" onClick={() => onEditSection(section)} className="text-gray-700">{t('common.edit')}</button>
        <button type="button" onClick={() => onDeleteSection(section)} className="text-red-700">{t('common.delete')}</button>
      </div></td>}
    </tr>
    {expanded && <>
      {section.items.map((item, index) => <BoqItemRow key={`${item.id}:${item.quantity}:${item.rate}`} item={item} canEdit={canEdit} money={money} t={t}
        canMoveUp={index > 0} canMoveDown={index < section.items.length - 1}
        onMoveUp={() => onMoveItem(section, item, -1)} onMoveDown={() => onMoveItem(section, item, 1)}
        onEdit={(quantity, rate) => onEditItem(section, item, quantity, rate)} onDelete={() => onDeleteItem(item)} onCommit={(quantity, rate) => onSaveInline(item, quantity, rate)} />)}
      {section.children.map((child) => <BoqSectionRows key={child.id} section={child} canEdit={canEdit} money={money} t={t}
        onAddSection={onAddSection} onEditSection={onEditSection} onDeleteSection={onDeleteSection}
        onAddItem={onAddItem} onEditItem={onEditItem} onDeleteItem={onDeleteItem} onSaveInline={onSaveInline} onMove={onMove} onMoveItem={onMoveItem} />)}
    </>}
  </>;
}

function BoqItemRow({ item, canEdit, money, t, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onEdit, onDelete, onCommit }: {
  item: ReturnType<typeof flattenItems>[number];
  canEdit: boolean;
  money: (amount: number) => string;
  t: TFunction;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: (quantity: number, rate: number) => void;
  onDelete: () => void;
  onCommit: (quantity: number, rate: number) => void;
}) {
  const [quantity, setQuantity] = useState(Number(item.quantity));
  const [rate, setRate] = useState(Number(item.rate));
  const [committed, setCommitted] = useState({ quantity: Number(item.quantity), rate: Number(item.rate) });
  const commit = () => {
    if (!Number.isFinite(quantity) || !Number.isFinite(rate) || quantity < 0 || rate < 0) return;
    if (quantity !== committed.quantity || rate !== committed.rate) {
      setCommitted({ quantity, rate });
      onCommit(quantity, rate);
    }
  };
  return <tr className="border-t" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(); }}>
    <td className="px-3 py-2 pl-8 text-xs font-mono">{item.item_number}</td>
    <td className="px-3 py-2">{item.description}{item.is_provisional && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900">{t('construction.boq.provisionalSum')}</span>}</td>
    <td className="px-3 py-2">{item.unit_of_measure}</td>
    <td className="px-3 py-2 text-right"><input aria-label={t('construction.boq.inlineQuantity', { item: item.item_number })} type="number" min="0" step="0.0001" disabled={!canEdit} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="w-24 rounded border px-2 py-1 text-right disabled:border-transparent disabled:bg-transparent" /></td>
    <td className="px-3 py-2 text-right"><input aria-label={t('construction.boq.inlineRate', { item: item.item_number })} type="number" min="0" step="0.0001" disabled={!canEdit} value={rate} onChange={(event) => setRate(Number(event.target.value))} className="w-28 rounded border px-2 py-1 text-right disabled:border-transparent disabled:bg-transparent" /></td>
    <td className="px-3 py-2 text-right">{money(rounded(quantity * rate))}</td>
    {canEdit && <td className="px-3 py-2"><div className="flex gap-2 text-xs">
      <button type="button" aria-label={t('construction.boq.moveItemUp', { item: item.item_number })} disabled={!canMoveUp} onClick={onMoveUp} className="rounded border px-1 disabled:opacity-40">↑</button>
      <button type="button" aria-label={t('construction.boq.moveItemDown', { item: item.item_number })} disabled={!canMoveDown} onClick={onMoveDown} className="rounded border px-1 disabled:opacity-40">↓</button>
      <button type="button" onClick={() => onEdit(quantity, rate)} className="text-brand-700">{t('common.edit')}</button><button type="button" onClick={onDelete} className="text-red-700">{t('common.delete')}</button>
    </div></td>}
  </tr>;
}

function VersionDialog({ label, setLabel, cloneActive, setCloneActive, busy, canClone, t, onCancel, onSubmit }: {
  label: string; setLabel: (value: string) => void; cloneActive: boolean; setCloneActive: (value: boolean) => void;
  busy: boolean; canClone: boolean; t: TFunction; onCancel: () => void; onSubmit: (event: FormEvent) => void;
}) {
  return <Dialog title={t('construction.boq.newVersion')} t={t} onClose={onCancel}><form onSubmit={onSubmit} className="space-y-4">
    <Field label={t('construction.boq.versionLabel')}><input maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cloneActive && canClone} disabled={!canClone} onChange={(event) => setCloneActive(event.target.checked)} />{t('construction.boq.cloneVersion')}</label>
    <DialogActions busy={busy} t={t} onCancel={onCancel} submitLabel={t('construction.boq.newVersion')} />
  </form></Dialog>;
}

function SectionDialog({ initial, suggestedCode, t, busy, onCancel, onSubmit }: {
  initial: BoqSectionWithItems | null; suggestedCode: string; t: TFunction; busy: boolean;
  onCancel: () => void; onSubmit: (draft: SectionDraft) => void;
}) {
  const [draft, setDraft] = useState<SectionDraft>({ code: initial?.code ?? suggestedCode, title: initial?.title ?? '', description: initial?.description ?? '' });
  return <Dialog title={t(initial ? 'construction.boq.editSection' : 'construction.boq.addSection')} t={t} onClose={onCancel}>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }} className="space-y-3">
      <Field label={t('construction.boq.sectionCode')}><input required value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.trim() })} className={inputClass} /></Field>
      <Field label={t('construction.boq.sectionTitle')}><input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClass} /></Field>
      <Field label={t('construction.boq.sectionDescription')}><textarea rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} /></Field>
      <DialogActions busy={busy} t={t} onCancel={onCancel} submitLabel={t('common.save')} />
    </form>
  </Dialog>;
}

function ItemDialog({ item, suggestedNumber, products, t, busy, onCancel, onSubmit }: {
  item: ReturnType<typeof flattenItems>[number] | null; suggestedNumber: string; products: ProductOption[];
  t: TFunction; busy: boolean; onCancel: () => void; onSubmit: (draft: ItemDraft) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>({
    item_number: item?.item_number ?? suggestedNumber,
    description: item?.description ?? '',
    unit_of_measure: item?.unit_of_measure ?? 'm²',
    quantity: Number(item?.quantity ?? 0),
    rate: Number(item?.rate ?? 0),
    product_id: item?.product_id ?? '',
    cost_code: item?.cost_code ?? '',
    is_provisional: item?.is_provisional ?? false,
    notes: item?.notes ?? '',
  });
  const amount = rounded(draft.quantity * draft.rate);
  return <Dialog title={t(item ? 'construction.boq.editItem' : 'construction.boq.addItem')} t={t} onClose={onCancel}>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }} className="space-y-3">
      <Field label={t('construction.boq.itemNumber')}><input value={draft.item_number} readOnly className={`${inputClass} bg-gray-50`} /></Field>
      <Field label={t('construction.boq.description')}><input required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('construction.boq.unitOfMeasure')}><select value={draft.unit_of_measure} onChange={(event) => setDraft({ ...draft, unit_of_measure: event.target.value })} className={inputClass}>{uomOptions.map(([value, key]) => <option key={value} value={value}>{t(`construction.boq.${key}`)}</option>)}</select></Field>
        <Field label={t('construction.boq.product')}><select value={draft.product_id} onChange={(event) => setDraft({ ...draft, product_id: event.target.value })} className={inputClass}><option value="">{t('construction.boq.noProduct')}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select></Field>
        <Field label={t('construction.boq.quantity')}><input type="number" required min="0" step="0.0001" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })} className={inputClass} /></Field>
        <Field label={t('construction.boq.rate')}><input type="number" required min="0" step="0.0001" value={draft.rate} onChange={(event) => setDraft({ ...draft, rate: Number(event.target.value) })} className={inputClass} /></Field>
      </div>
      <Field label={t('construction.boq.amount')}><input readOnly value={amount.toFixed(2)} className={`${inputClass} bg-gray-50`} /></Field>
      <Field label={t('construction.boq.costCode')}><input value={draft.cost_code} onChange={(event) => setDraft({ ...draft, cost_code: event.target.value })} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.is_provisional} onChange={(event) => setDraft({ ...draft, is_provisional: event.target.checked })} />{t('construction.boq.provisionalSum')}</label>
      <Field label={t('construction.boq.notes')}><textarea rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className={inputClass} /></Field>
      <DialogActions busy={busy} t={t} onCancel={onCancel} submitLabel={t('common.save')} />
    </form>
  </Dialog>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-white p-3"><span className="block text-xs text-gray-500">{label}</span><strong className="mt-1 block text-sm text-gray-900">{value}</strong></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>{children}</label>; }
function Dialog({ title, onClose, children, t }: { title: string; onClose: () => void; children: ReactNode; t: TFunction }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button type="button" aria-label={t('construction.boq.closeDialog')} onClick={onClose} className="rounded border px-2 py-1 text-sm">×</button></div>{children}</div></div>; }
function DialogActions({ busy, t, onCancel, submitLabel }: { busy: boolean; t: TFunction; onCancel: () => void; submitLabel: string }) { return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm">{t('common.cancel')}</button><button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitLabel}</button></div>; }
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm';
export default ProjectBoqVersionEditor;
