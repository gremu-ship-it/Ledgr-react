import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import type { BoqItem, BoqSectionWithItems } from '@/dal/repositories/ProjectRepository';
import type { ConstructionPurchaseOrder, ConstructionPurchaseOrderLine } from '@/dal/repositories/ConstructionProcurementRepository';
import {
  EmptyState,
  ErrorBanner,
  Field,
  FIELD_CLASS,
  InfoNote,
  LoadingBlock,
  SectionCard,
} from '@/components/construction/constructionUi';

interface LineRow {
  order: ConstructionPurchaseOrder;
  line: ConstructionPurchaseOrderLine;
}

export function ProjectProcurementBoqLinks({
  businessId,
  projectId,
  capabilities,
}: {
  businessId: string;
  projectId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['construction', 'project-po-boq-links', businessId, projectId],
    queryFn: async () => {
      const [orders, versions, links, products] = await Promise.all([
        repos.construction.findPurchaseOrders(businessId, projectId),
        repos.projects.listBoqVersions(businessId, projectId),
        repos.construction.findProjectPurchaseOrderBoqLinks(businessId, projectId),
        repos.inventory.findAllProducts(businessId),
      ]);
      const [lineGroups, boqTrees] = await Promise.all([
        Promise.all(orders.map(async (order) => ({ order, lines: await repos.construction.findPurchaseOrderLines(order.id) }))),
        Promise.all(versions.map((version) => repos.projects.getBoqVersion(businessId, version.id))),
      ]);
      return {
        orders,
        links,
        products,
        lineGroups,
        boqTrees,
        activeTree: boqTrees.find((version) => version.status === 'active') ?? null,
      };
    },
  });

  const items = useMemo(() => {
    const flattened: BoqItem[] = [];
    const visit = (sections: BoqSectionWithItems[]) => {
      for (const section of sections) {
        flattened.push(...section.items);
        visit(section.children);
      }
    };
    if (query.data?.activeTree) visit(query.data.activeTree.sections);
    return flattened;
  }, [query.data?.activeTree]);

  const linkMutation = useMutation({
    mutationFn: (input: { lineId: string; itemId: string | null }) =>
      repos.construction.setProjectPurchaseOrderBoqLink({
        businessId,
        projectId,
        purchaseOrderLineId: input.lineId,
        boqItemId: input.itemId,
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['construction', 'project-po-boq-links', businessId, projectId] });
    },
  });

  if (query.isLoading) return <LoadingBlock label={t('construction.procurement.projectBoqLinks.loading')} />;
  if (query.isError) {
    return <ErrorBanner message={t('construction.procurement.projectBoqLinks.loadError', {
      detail: query.error instanceof Error ? query.error.message : t('construction.procurement.shared.unknownError'),
    })} />;
  }

  const { links, products, lineGroups, boqTrees, activeTree } = query.data!;
  const lineRows: LineRow[] = lineGroups.flatMap(({ order, lines }) => lines.map((line) => ({ order, line })));
  const linkedItems = new Map(links.map((link) => [link.purchase_order_line_id, link.boq_item_id]));
  const allBoqItems = boqTrees.flatMap((version) => {
    const flattened: BoqItem[] = [];
    const visit = (sections: BoqSectionWithItems[]) => {
      for (const section of sections) {
        flattened.push(...section.items);
        visit(section.children);
      }
    };
    visit(version.sections);
    return flattened;
  });
  const itemsById = new Map(allBoqItems.map((item) => [item.id, item]));
  const activeItemIds = new Set(items.map((item) => item.id));
  const productNames = new Map(products.map((product) => [product.id, product.name]));
  const canManage = capabilities.includes('procurement.po.manage');

  return (
    <SectionCard
      title={t('construction.procurement.projectBoqLinks.title')}
      description={t('construction.procurement.projectBoqLinks.description')}
    >
      <InfoNote>
        <p>{t('construction.procurement.projectBoqLinks.info')}</p>
      </InfoNote>
      {linkMutation.isError ? (
        <div className="mb-4">
          <ErrorBanner message={t('construction.procurement.projectBoqLinks.saveError', {
            detail: linkMutation.error instanceof Error ? linkMutation.error.message : t('construction.procurement.shared.unknownError'),
          })} />
        </div>
      ) : null}
      {!activeTree ? (
        <EmptyState
          title={t('construction.procurement.projectBoqLinks.noActiveTitle')}
          detail={t('construction.procurement.projectBoqLinks.noActiveDetail')}
        />
      ) : lineRows.length === 0 ? (
        <EmptyState
          title={t('construction.procurement.projectBoqLinks.noLinesTitle')}
          detail={t('construction.procurement.projectBoqLinks.noLinesDetail')}
        />
      ) : (
        <div className="space-y-3">
          {lineRows.map(({ order, line }) => {
            const selectedItemId = linkedItems.get(line.id) ?? '';
            const currentItem = itemsById.get(selectedItemId);
            return (
              <div key={line.id} className="grid gap-3 rounded-lg border border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)] md:items-center">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{order.po_number} · {t('construction.procurement.projectBoqLinks.lineLabel', { number: line.line_number })}</p>
                  <p className="truncate text-sm text-gray-600">
                    {productNames.get(line.product_id) ?? line.line_note ?? t('construction.procurement.projectBoqLinks.unnamedProduct')}
                    <span className="ml-2 text-xs text-gray-500">{line.quantity_ordered} {line.uom}</span>
                  </p>
                  {currentItem ? <p className="mt-1 text-xs text-brand-700">{t('construction.procurement.projectBoqLinks.linkedTo', { item: currentItem.item_number })}</p> : null}
                </div>
                <Field label={t('construction.procurement.projectBoqLinks.selectLabel', { number: line.line_number })}>
                  <select
                    aria-label={t('construction.procurement.projectBoqLinks.selectLabel', { number: line.line_number })}
                    className={FIELD_CLASS}
                    value={selectedItemId}
                    disabled={!canManage || order.status !== 'draft' || linkMutation.isPending}
                    onChange={(event) => linkMutation.mutate({ lineId: line.id, itemId: event.target.value || null })}
                  >
                    <option value="">{t('construction.procurement.projectBoqLinks.noLinkOption')}</option>
                    {currentItem && !activeItemIds.has(currentItem.id) ? (
                      <option value={currentItem.id} disabled>
                        {t('construction.procurement.projectBoqLinks.archivedLinkOption', { item: currentItem.item_number })}
                      </option>
                    ) : null}
                    {items.map((item) => {
                      const productMismatch = Boolean(line.product_id && item.product_id && line.product_id !== item.product_id);
                      return (
                        <option key={item.id} value={item.id} disabled={productMismatch}>
                          {item.item_number} · {item.description} ({item.quantity} {item.unit_of_measure})
                        </option>
                      );
                    })}
                  </select>
                </Field>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
