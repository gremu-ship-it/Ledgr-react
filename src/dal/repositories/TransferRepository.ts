import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export type TransferStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  | 'received';

export interface TransferWithLines {
  transfer: Row<'stock_transfers'>;
  lines: Row<'stock_transfer_lines'>[];
}

export class TransferRepository extends BaseRepository<'stock_transfers'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'stock_transfers');
  }

  async findByBusiness(
    businessId: string,
    status?: TransferStatus,
  ): Promise<Row<'stock_transfers'>[]> {
    let query = this.client
      .from('stock_transfers')
      .select('*')
      .eq('business_id', businessId);

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw toRepositoryError('stock_transfers', error);
    return data ?? [];
  }

  async findByLocation(locationId: string): Promise<Row<'stock_transfers'>[]> {
    const { data, error } = await this.client
      .from('stock_transfers')
      .select('*')
      .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
      .order('created_at', { ascending: false });
    if (error) throw toRepositoryError('stock_transfers', error);
    return data ?? [];
  }

  async findWithLines(transferId: string): Promise<TransferWithLines> {
    const transfer = await this.findById(transferId);

    const { data: lines, error } = await this.client
      .from('stock_transfer_lines')
      .select('*')
      .eq('transfer_id', transferId)
      .eq('business_id', transfer.business_id)
      .order('created_at', { ascending: true });

    if (error) throw toRepositoryError('stock_transfer_lines', error);
    return { transfer, lines: lines ?? [] };
  }

  async createWithLines(
    transfer: Omit<Row<'stock_transfers'>, 'id' | 'created_at' | 'updated_at'>,
    lines: Omit<Row<'stock_transfer_lines'>, 'id' | 'created_at' | 'transfer_id'>[],
  ): Promise<TransferWithLines> {
    const created = await this.create(transfer as never);

    const lineRows = lines.map((l) => ({ ...l, transfer_id: created.id }));

    const { data: createdLines, error } = await this.client
      .from('stock_transfer_lines')
      .insert(lineRows as never)
      .select('*');

    if (error) {
      await this.client.from('stock_transfers').delete().eq('id', created.id);
      throw toRepositoryError('stock_transfer_lines', error);
    }

    return { transfer: created, lines: createdLines ?? [] };
  }

  async updateStatus(
    transferId: string,
    status: TransferStatus,
    extra?: Partial<Row<'stock_transfers'>>,
  ): Promise<Row<'stock_transfers'>> {
    return this.update(transferId, {
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    } as never);
  }

  async dispatch(
    transferId: string,
    dispatchedBy: string,
    lineQuantities: { lineId: string; quantityDispatched: number }[],
  ): Promise<Row<'stock_transfers'>> {
    const { data, error } = await (this.client as unknown as {
      rpc: (
        fn: 'dispatch_stock_transfer_atomically',
        args: { p_transfer_id: string; p_dispatched_by: string; p_lines: { line_id: string; quantity_dispatched: number }[] },
      ) => Promise<{ data: Row<'stock_transfers'> | null; error: { code?: string; message?: string } | null }>;
    }).rpc('dispatch_stock_transfer_atomically', {
      p_transfer_id: transferId,
      p_dispatched_by: dispatchedBy,
      p_lines: lineQuantities.map(({ lineId, quantityDispatched }) => ({
        line_id: lineId,
        quantity_dispatched: Number(quantityDispatched),
      })),
    });
    if (error) throw toRepositoryError('stock_transfers', error);
    if (!data) throw toRepositoryError('stock_transfers', { message: 'inventory-transfer-empty-result' });
    return data;
  }

  async confirmReceipt(
    transferId: string,
    receivedBy: string,
    lineQuantities: { lineId: string; quantityReceived: number }[],
  ): Promise<Row<'stock_transfers'>> {
    const { data, error } = await (this.client as unknown as {
      rpc: (
        fn: 'confirm_stock_transfer_receipt_atomically',
        args: { p_transfer_id: string; p_received_by: string; p_lines: { line_id: string; quantity_received: number }[] },
      ) => Promise<{ data: Row<'stock_transfers'> | null; error: { code?: string; message?: string } | null }>;
    }).rpc('confirm_stock_transfer_receipt_atomically', {
      p_transfer_id: transferId,
      p_received_by: receivedBy,
      p_lines: lineQuantities.map(({ lineId, quantityReceived }) => ({
        line_id: lineId,
        quantity_received: Number(quantityReceived),
      })),
    });
    if (error) throw toRepositoryError('stock_transfers', error);
    if (!data) throw toRepositoryError('stock_transfers', { message: 'inventory-transfer-empty-result' });
    return data;
  }

  async generateTransferNumber(businessId: string): Promise<string> {
    const { count } = await this.client
      .from('stock_transfers')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .then((r) => ({ count: r.count ?? 0 }));

    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const next = String(count + 1).padStart(4, '0');
    return `TRF-${next}-${rand}`;
  }
}