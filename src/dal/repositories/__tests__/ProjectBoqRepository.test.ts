/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRepository } from '../ProjectRepository';

const mock = vi.hoisted(() => ({
  from: vi.fn(),
  responses: {} as Record<string, { data: unknown; error: unknown }>,
  queues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  inserts: [] as Array<{ table: string; value: unknown }>,
}));

vi.mock('@/lib/supabase', () => ({ supabase: { from: mock.from } }));

// The repository is exercised against the same fluent surface used by its
// Supabase client; the fixtures deliberately include three nested section levels.
function builderFor(table: string): any {
  const builder: Record<string, (...args: any[]) => any> = {};
  const consume = () => mock.queues[table]?.shift() ?? mock.responses[table] ?? { data: null, error: null };
  for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = vi.fn(() => builder);
  builder.insert = vi.fn((value: unknown) => { mock.inserts.push({ table, value }); return builder; });
  builder.update = vi.fn((value: unknown) => { mock.inserts.push({ table, value }); return builder; });
  builder.delete = vi.fn(() => { mock.inserts.push({ table, value: 'DELETE' }); return builder; });
  builder.single = vi.fn(async () => consume());
  builder.maybeSingle = vi.fn(async () => consume());
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(consume()).then(resolve, reject);
  return builder;
}

const version = {
  id: 'version-1', business_id: 'business-1', project_id: 'project-1', version_number: 1,
  version_label: 'Tender', status: 'active', total_value: 18.5, currency: 'MWK', notes: null,
  created_at: '2026-10-01T00:00:00Z', created_by: 'user-1',
};
const sectionRows = [
  { id: 's1', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: null, code: '1', title: 'Substructure', description: null, sort_order: 0, level: 0 },
  { id: 's2', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: 's1', code: '1.1', title: 'Concrete', description: null, sort_order: 0, level: 1 },
  { id: 's3', boq_version_id: 'version-1', business_id: 'business-1', parent_section_id: 's2', code: '1.1.1', title: 'Foundations', description: null, sort_order: 0, level: 2 },
];
const itemRows = [
  { id: 'i1', boq_version_id: 'version-1', section_id: 's3', business_id: 'business-1', item_number: '1.1.1.1', description: 'Excavate footing', unit_of_measure: 'm³', quantity: 2, rate: 5.25, amount: 10.5, product_id: null, cost_code: null, is_provisional: false, notes: null, sort_order: 0 },
  { id: 'i2', boq_version_id: 'version-1', section_id: 's2', business_id: 'business-1', item_number: '1.1.2', description: 'Provisional allowance', unit_of_measure: 'lot', quantity: 1, rate: 8, amount: 8, product_id: null, cost_code: null, is_provisional: true, notes: null, sort_order: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.responses = {};
  mock.queues = {};
  mock.inserts = [];
  mock.from.mockImplementation((table: string) => builderFor(table));
});

describe('ProjectRepository hierarchical BOQ operations', () => {
  it('retrieves a three-level tree and rolls item totals up through parent sections', async () => {
    mock.responses.boq_versions = { data: version, error: null };
    mock.responses.boq_sections = { data: sectionRows, error: null };
    mock.responses.boq_items = { data: itemRows, error: null };

    const result = await new ProjectRepository().getBoqVersion('business-1', 'version-1');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].children[0].children[0].title).toBe('Foundations');
    expect(result.sections[0].children[0].children[0].items[0].amount).toBe(10.5);
    expect(result.sections[0].children[0].sectionTotal).toBe(18.5);
    expect(result.sections[0].sectionTotal).toBe(18.5);
  });

  it('updates and deletes only draft version metadata through scoped repository methods', async () => {
    mock.responses.boq_versions = { data: { id: 'version-1' }, error: null };
    const repository = new ProjectRepository();
    await repository.updateBoqVersion('business-1', 'version-1', {
      version_label: 'Revised tender', notes: 'Reviewed', currency: 'MWK',
    });
    await repository.deleteBoqVersion('business-1', 'version-1');
    expect(mock.inserts.filter((entry) => entry.table === 'boq_versions').map((entry) => entry.value)).toEqual([
      { version_label: 'Revised tender', notes: 'Reviewed', currency: 'MWK' }, 'DELETE',
    ]);
  });

  it('clones an active tree into the next draft version with remapped parent and item foreign keys', async () => {
    const activeRow = { ...version, status: 'active' };
    mock.queues.boq_versions = [
      { data: { version_number: 1 }, error: null },
      { data: { id: 'version-2' }, error: null },
      { data: [activeRow], error: null },
      { data: activeRow, error: null },
    ];
    mock.queues.boq_sections = [
      { data: sectionRows, error: null },
      { data: { id: 'clone-s1' }, error: null },
      { data: { id: 'clone-s2' }, error: null },
      { data: { id: 'clone-s3' }, error: null },
    ];
    mock.queues.boq_items = [
      { data: itemRows, error: null },
      { data: null, error: null },
    ];

    const id = await new ProjectRepository().createBoqVersion('business-1', {
      project_id: 'project-1', version_label: 'Revision', currency: 'MWK', clone_from_active: true,
    });

    expect(id).toBe('version-2');
    const clonedSections = mock.inserts.filter((entry) => entry.table === 'boq_sections').map((entry) => entry.value);
    expect(clonedSections).toEqual([
      expect.objectContaining({ boq_version_id: 'version-2', parent_section_id: null, code: '1' }),
      expect.objectContaining({ boq_version_id: 'version-2', parent_section_id: 'clone-s1', code: '1.1' }),
      expect.objectContaining({ boq_version_id: 'version-2', parent_section_id: 'clone-s2', code: '1.1.1' }),
    ]);
    const clonedItems = mock.inserts.find((entry) => entry.table === 'boq_items')?.value as Array<Record<string, unknown>>;
    expect(clonedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ boq_version_id: 'version-2', section_id: 'clone-s3', item_number: '1.1.1.1' }),
      expect.objectContaining({ boq_version_id: 'version-2', section_id: 'clone-s2', item_number: '1.1.2' }),
    ]));
  });

  it('reorders item ids within one section and rejects an incomplete ordering', async () => {
    mock.responses.boq_items = { data: [{ id: 'item-a' }, { id: 'item-b' }], error: null };
    const repository = new ProjectRepository();
    await repository.reorderItems('business-1', 'version-1', 'section-1', ['item-b', 'item-a']);
    expect(mock.inserts.filter((entry) => entry.table === 'boq_items').map((entry) => entry.value)).toEqual([
      { sort_order: 0 }, { sort_order: 1 },
    ]);
    await expect(repository.reorderItems('business-1', 'version-1', 'section-1', ['item-b']))
      .rejects.toThrow('construction.boq.errors.reorderMismatch');
  });

  it('bulk imports multiple items into an explicit project-version section scope', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    mock.responses.boq_items = { data: rows, error: null };
    const repository = new ProjectRepository();
    const imported = await repository.bulkImportItems('business-1', 'version-1', 'section-1', [
      { item_number: '1.1', description: 'Concrete', quantity: 2, rate: 50 },
      { item_number: '1.2', description: 'Steel', quantity: 3, rate: 10 },
    ]);

    expect(imported).toBe(2);
    expect(mock.inserts).toEqual([{
      table: 'boq_items',
      value: [
        expect.objectContaining({ business_id: 'business-1', boq_version_id: 'version-1', section_id: 'section-1', item_number: '1.1' }),
        expect.objectContaining({ business_id: 'business-1', boq_version_id: 'version-1', section_id: 'section-1', item_number: '1.2' }),
      ],
    }]);
  });
});
