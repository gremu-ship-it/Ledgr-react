import { describe, expect, it, vi } from 'vitest';
import type { Row } from '@/dal/types/database';
import { TransferRepository } from '@/dal/repositories/TransferRepository';

const transfer = {
  id: 'transfer-1',
  business_id: 'business-1',
  status: 'dispatched',
  transfer_number: 'TRF-0001',
} as Row<'stock_transfers'>;

const makeRepository = () => {
  const rpc = vi.fn().mockResolvedValue({ data: transfer, error: null });
  const repository = new TransferRepository({ rpc } as never);
  return { repository, rpc };
};

describe('TransferRepository atomic stock transfer commands', () => {
  it('dispatches through one atomic command that creates the paired movements', async () => {
    const { repository, rpc } = makeRepository();
    const result = await repository.dispatch('transfer-1', 'user-1', [
      { lineId: 'line-1', quantityDispatched: 4 },
      { lineId: 'line-2', quantityDispatched: 2 },
    ]);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('dispatch_stock_transfer_atomically', {
      p_transfer_id: 'transfer-1',
      p_dispatched_by: 'user-1',
      p_lines: [
        { line_id: 'line-1', quantity_dispatched: 4 },
        { line_id: 'line-2', quantity_dispatched: 2 },
      ],
    });
    expect(result).toBe(transfer);
  });

  it('confirms receipt atomically without issuing any additional stock movement command', async () => {
    const { repository, rpc } = makeRepository();
    await repository.confirmReceipt('transfer-1', 'user-2', [
      { lineId: 'line-1', quantityReceived: 4 },
    ]);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('confirm_stock_transfer_receipt_atomically', {
      p_transfer_id: 'transfer-1',
      p_received_by: 'user-2',
      p_lines: [{ line_id: 'line-1', quantity_received: 4 }],
    });
  });

  it('surfaces a failed atomic dispatch instead of marking the transfer dispatched', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'stock balance constraint failed' },
    });
    const repository = new TransferRepository({ rpc } as never);

    await expect(repository.dispatch('transfer-1', 'user-1', [
      { lineId: 'line-1', quantityDispatched: 4 },
    ])).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
  });
});
