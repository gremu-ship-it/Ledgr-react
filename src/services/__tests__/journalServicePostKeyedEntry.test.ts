// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const journal = vi.hoisted(() => ({
  findByPostingKey: vi.fn(),
  createBalancedEntry: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({ repos: { journal } }));
vi.mock('@/services/webhook/WebhookService', () => ({ webhookService: { emit: vi.fn() } }));

import { postKeyedEntry } from '@/services/journalService';

const dto = {
  business_id: 'biz-1',
  entry_date: '2026-12-25',
  description: 'Issue shares',
  source_type: 'share_issue',
  posting_key: 'shares:issue:1',
} as never;

const lines = [
  { account_id: 'acc-cash', is_debit: true, amount: 100, amount_base: 100, description: 'Cash' },
  { account_id: 'acc-equity', is_debit: false, amount: 100, amount_base: 100, description: 'Share capital' },
] as never;

const draftRow = { id: 'je-1', status: 'draft', posting_key: 'shares:issue:1' } as never;
const postedRow = { id: 'je-1', status: 'posted', posting_key: 'shares:issue:1' } as never;

describe('postKeyedEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.findByPostingKey.mockResolvedValue(null);
    journal.createBalancedEntry.mockResolvedValue({ entry: draftRow, lines: [] });
    journal.post.mockResolvedValue(postedRow);
  });

  it('returns the posted row, not the draft the insert left behind', async () => {
    // createBalancedEntry writes a draft by design (the command owns the
    // status), so the inserted row alone would still read `status: 'draft'`.
    const entry = await postKeyedEntry(dto, lines);

    expect(journal.createBalancedEntry).toHaveBeenCalledWith(dto, lines);
    expect(journal.post).toHaveBeenCalledWith('je-1', null);
    expect(entry).toBe(postedRow);
    expect((entry as unknown as { status: string }).status).toBe('posted');
  });

  it('resumes a keyed retry by posting the draft that the first attempt left open', async () => {
    journal.findByPostingKey.mockResolvedValue(draftRow);
    journal.post.mockResolvedValue(postedRow);

    const entry = await postKeyedEntry(dto, lines);

    expect(journal.createBalancedEntry).not.toHaveBeenCalled();
    expect(journal.post).toHaveBeenCalledWith('je-1', null);
    expect((entry as unknown as { status: string }).status).toBe('posted');
  });
});
