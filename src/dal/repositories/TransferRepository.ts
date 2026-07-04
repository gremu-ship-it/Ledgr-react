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
    for (const { lineId, quantityDispatched } of lineQuantities) {
      const { error } = await this.client
        .from('stock_transfer_lines')
        .update({ quantity_dispatched: quantityDispatched } as never)
        .eq('id', lineId)
        .eq('transfer_id', transferId);
      if (error) throw toRepositoryError('stock_transfer_lines', error);
    }

    const { lines, transfer } = await this.findWithLines(transferId);

    const movements = lines
      .filter((l) => (l.quantity_dispatched ?? 0) > 0)
      .map((l) => ({
        business_id: transfer.business_id,
        product_id: l.product_id,
        location_id: transfer.from_location_id,
        movement_type: 'transfer_out' as const,
        movement_date: new Date().toISOString().slice(0, 10),
        // Negative: stock is LEAVING the source location. The
        // update_inventory_balance() trigger just adds this quantity to
        // the balance, so the sign here is what makes it a decrease.
        quantity: -Number(l.quantity_dispatched),
        unit_cost: Number(l.unit_cost),
        // total_cost is a Postgres GENERATED ALWAYS column — do not set explicitly.
        source_type: 'stock_transfer',
        source_id: transferId,
        reference: transfer.transfer_number,
        created_by: dispatchedBy,
      }));

    if (movements.length > 0) {
      const { error: movErr } = await this.client
        .from('stock_movements')
        .insert(movements as never);
      if (movErr) throw toRepositoryError('stock_movements', movErr);
    }

    return this.updateStatus(transferId, 'dispatched', {
      dispatched_at: new Date().toISOString(),
    });
  }

  async confirmReceipt(
    transferId: string,
    receivedBy: string,
    lineQuantities: { lineId: string; quantityReceived: number }[],
  ): Promise<Row<'stock_transfers'>> {
    for (const { lineId, quantityReceived } of lineQuantities) {
      const { error } = await this.client
        .from('stock_transfer_lines')
        .update({ quantity_received: quantityReceived } as never)
        .eq('id', lineId)
        .eq('transfer_id', transferId);
      if (error) throw toRepositoryError('stock_transfer_lines', error);
    }

    const { lines, transfer } = await this.findWithLines(transferId);

    const movements = lines
      .filter((l) => (l.quantity_received ?? 0) > 0)
      .map((l) => ({
        business_id: transfer.business_id,
        product_id: l.product_id,
        location_id: transfer.to_location_id,
        movement_type: 'transfer_in' as const,
        movement_date: new Date().toISOString().slice(0, 10),
        quantity: Number(l.quantity_received),
        unit_cost: Number(l.unit_cost),
        // total_cost is a Postgres GENERATED ALWAYS column — do not set explicitly.
        source_type: 'stock_transfer',
        source_id: transferId,
        reference: transfer.transfer_number,
        created_by: receivedBy,
      }));

    if (movements.length > 0) {
      const { error: movErr } = await this.client
        .from('stock_movements')
        .insert(movements as never);
      if (movErr) throw toRepositoryError('stock_movements', movErr);
    }

    return this.updateStatus(transferId, 'received', {
      received_at: new Date().toISOString(),
      received_by: receivedBy,
    });
  }

  async generateTransferNumber(businessId: string): Promise<string> {
    const { count } = await this.client
      .from('stock_transfers')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .then((r) => ({ count: r.count ?? 0 }));

    const next = String(count + 1).padStart(4, '0');
    return `TRF-${next}`;
  }
}