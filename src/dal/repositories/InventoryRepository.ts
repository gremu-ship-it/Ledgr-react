import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { UnsupportedOperationError, toRepositoryError } from '../errors/RepositoryError';

export class InventoryRepository extends BaseRepository<'inventory_balances'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'inventory_balances');
  }

  /**
   * FIX: inventory_balances has no deleted_at column.
   * FIX: stock_movements is append-only — update/softDelete must never be called.
   * BaseRepository guards softDelete at runtime, but explicit overrides here
   * provide domain-specific error messages.
   */
  override async softDelete(_id: string): Promise<Row<'inventory_balances'>> {
    throw new UnsupportedOperationError('inventory_balances', 'softDelete');
  }

  async findLocations(businessId: string): Promise<Row<'inventory_locations'>[]> {
    const { data, error } = await this.client
      .from('inventory_locations').select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('inventory_locations', error);
    return data ?? [];
  }

  async findBalance(
    businessId: string,
    productId: string,
    locationId: string,
  ): Promise<Row<'inventory_balances'> | null> {
    const { data, error } = await this.client
      .from('inventory_balances').select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? null;
  }

  async findBalancesByProduct(businessId: string, productId: string): Promise<Row<'inventory_balances'>[]> {
    const { data, error } = await this.client
      .from('inventory_balances').select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId);
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? [];
  }

  async findBalancesByLocation(businessId: string, locationId: string): Promise<Row<'inventory_balances'>[]> {
    const { data, error } = await this.client
      .from('inventory_balances').select('*')
      .eq('business_id', businessId)
      .eq('location_id', locationId);
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? [];
  }

  /**
   * Insert a stock movement. The DB trigger updates inventory_balances automatically.
   * This method does NOT call update() on stock_movements (append-only).
   * Re-fetches the balance after insert to return the trigger-updated row.
   */
  async recordMovement(
    movement: InsertDto<'stock_movements'>,
  ): Promise<{ movement: Row<'stock_movements'>; balance: Row<'inventory_balances'> }> {
    const { data: createdMovement, error: movementError } = await this.client
      .from('stock_movements').insert(movement as never).select('*').single();
    if (movementError) throw toRepositoryError('stock_movements', movementError);

    const balance = await this.findBalance(
      movement.business_id,
      movement.product_id,
      movement.location_id,
    );
    if (!balance) {
      throw toRepositoryError('inventory_balances', {
        message: `inventory_balances not found after insert for product ${movement.product_id}`,
        code: 'LEDGR001',
      });
    }
    return { movement: createdMovement, balance };
  }

  async findMovementHistory(
    businessId: string,
    productId: string,
    limit = 50,
  ): Promise<Row<'stock_movements'>[]> {
    const { data, error } = await this.client
      .from('stock_movements').select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .order('movement_date', { ascending: false })
      .limit(limit);
    if (error) throw toRepositoryError('stock_movements', error);
    return data ?? [];
  }

  async findReorderAlerts(businessId: string): Promise<Row<'v_reorder_alerts'>[]> {
    const { data, error } = await this.client
      .from('v_reorder_alerts').select('*').eq('business_id', businessId);
    if (error) throw toRepositoryError('v_reorder_alerts', error);
    return data ?? [];
  }
}