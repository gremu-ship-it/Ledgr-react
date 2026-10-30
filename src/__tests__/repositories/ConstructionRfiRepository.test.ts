import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConstructionRfiRepository } from '../../dal/repositories/ConstructionRfiRepository';
import type { Database } from '../../dal/types/database';

const rfi = {
  id: 'rfi-1',
  business_id: 'business-1',
  project_id: 'project-1',
  site_id: 'site-1',
  rfi_number: 'RFI-001',
  title: 'Confirm concrete finish',
  question: 'Please confirm the specified finish.',
  response: null,
  evidence: 'Drawing A-12, revision 3',
  proposed_solution: null,
  boq_item_id: null,
  subcontract_id: null,
  drawing_reference: 'A-12 Rev 3',
  status: 'draft',
  priority: 'normal',
  due_date: null,
  answered_at: null,
  answered_by: null,
  closed_at: null,
  created_by: 'user-1',
  updated_by: 'user-1',
  created_at: '2026-11-28T08:00:00Z',
  updated_at: '2026-11-28T08:00:00Z',
} satisfies Database['public']['Tables']['construction_rfis']['Row'];

describe('ConstructionRfiRepository', () => {
  let mockClient: {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  };
  let repository: ConstructionRfiRepository;
  let readChain: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    readChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };
    mockClient = {
      from: vi.fn().mockReturnValue(readChain),
      rpc: vi.fn(),
    };
    repository = new ConstructionRfiRepository(
      mockClient as unknown as SupabaseClient<Database>,
    );
  });

  it('lists RFIs for a business in reverse-created order', async () => {
    readChain.order.mockResolvedValue({ data: [rfi], error: null });

    await expect(repository.listByBusiness('business-1')).resolves.toEqual([rfi]);
    expect(mockClient.from).toHaveBeenCalledWith('construction_rfis');
    expect(readChain.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(readChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('lists RFIs for a project in reverse-created order', async () => {
    readChain.order.mockResolvedValue({ data: [rfi], error: null });

    await expect(repository.listByProject('project-1')).resolves.toEqual([rfi]);
    expect(mockClient.from).toHaveBeenCalledWith('construction_rfis');
    expect(readChain.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(readChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('reads an RFI by id and reports an inaccessible or missing row', async () => {
    readChain.maybeSingle.mockResolvedValueOnce({ data: rfi, error: null });
    await expect(repository.getById('rfi-1')).resolves.toEqual(rfi);

    readChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(repository.getById('missing')).rejects.toThrow(/not found/);
  });

  it('returns overdue open and answered RFIs for a project', async () => {
    const overdueRfi = { ...rfi, status: 'open', due_date: '2026-11-27' };
    readChain.order.mockResolvedValue({ data: [overdueRfi], error: null });

    await expect(repository.getOverdue('project-1', new Date('2026-11-28T12:00:00Z')))
      .resolves.toEqual([overdueRfi]);
    expect(readChain.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(readChain.lt).toHaveBeenCalledWith('due_date', '2026-11-28');
    expect(readChain.in).toHaveBeenCalledWith('status', ['open', 'submitted', 'answered']);
    expect(readChain.order).toHaveBeenCalledWith('due_date', { ascending: true });
  });

  it('creates through the scoped command RPC and stores evidence as text', async () => {
    mockClient.rpc.mockResolvedValue({ data: rfi, error: null });

    await expect(repository.create({
      business_id: 'business-1',
      project_id: 'project-1',
      site_id: 'site-1',
      rfi_number: 'RFI-001',
      title: rfi.title,
      question: rfi.question,
      evidence: 'Drawing A-12, revision 3',
      proposed_solution: 'Use the revised detail.',
      boq_item_id: 'boq-item-1',
      subcontract_id: 'subcontract-1',
      drawing_reference: 'A-12 Rev 3',
    })).resolves.toEqual(rfi);

    expect(mockClient.rpc).toHaveBeenCalledWith('create_construction_rfi', expect.objectContaining({
      p_business_id: 'business-1',
      p_project_id: 'project-1',
      p_site_id: 'site-1',
      p_evidence: 'Drawing A-12, revision 3',
      p_proposed_solution: 'Use the revised detail.',
      p_boq_item_id: 'boq-item-1',
      p_subcontract_id: 'subcontract-1',
      p_drawing_reference: 'A-12 Rev 3',
      p_priority: 'normal',
    }));
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('updates through the command RPC and does not write directly to the table', async () => {
    mockClient.rpc.mockResolvedValue({ data: { ...rfi, title: 'Updated title' }, error: null });

    await repository.update('rfi-1', { title: 'Updated title', due_date: null });

    expect(mockClient.rpc).toHaveBeenCalledWith('update_construction_rfi', {
      p_rfi_id: 'rfi-1',
      p_payload: { title: 'Updated title', due_date: null },
    });
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('uses guarded transition and draft-delete RPCs', async () => {
    mockClient.rpc
      .mockResolvedValueOnce({ data: { ...rfi, status: 'answered', response: 'Approved.' }, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await repository.transitionStatus('rfi-1', 'answered', 'Approved.');
    await expect(repository.deleteDraft('rfi-1')).resolves.toBe(true);

    expect(mockClient.rpc).toHaveBeenNthCalledWith(1, 'transition_construction_rfi', {
      p_rfi_id: 'rfi-1',
      p_new_status: 'answered',
      p_response: 'Approved.',
    });
    expect(mockClient.rpc).toHaveBeenNthCalledWith(2, 'delete_construction_rfi', {
      p_rfi_id: 'rfi-1',
    });
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});
