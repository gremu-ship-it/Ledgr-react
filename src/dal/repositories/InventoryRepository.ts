import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { UnsupportedOperationError, toRepositoryError } from '../errors/RepositoryError';

export interface BalanceWithProduct {
  id: string;
  businessid: string;
  productid: string;
  locationid: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number | null;
  average_cost: number;
  last_movement_at: string | null;
  updated_at: string;
  products: {
    name: string;
    sku: string | null;
    reorder_level: number | null;
  } | null;
  inventory_locations: {
    name: string;
  } | null;
}

export class InventoryRepository extends BaseRepository<'inventory_balances'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'inventory_balances');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- inventory balances are never soft-deleted
  override async softDelete(_id: string): Promise<Row<'inventory_balances'>> {
    throw new UnsupportedOperationError('inventory_balances', 'softDelete');
  }

  async findLocations(businessId: string): Promise<Row<'inventory_locations'>[]> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*')
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
      .from('inventory_balances')
      .select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? null;
  }

  async findBalancesByProduct(
    businessId: string,
    productId: string,
  ): Promise<Row<'inventory_balances'>[]> {
    const { data, error } = await this.client
      .from('inventory_balances')
      .select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId);
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? [];
  }

  async findBalancesByLocation(
    businessId: string,
    locationId: string,
  ): Promise<Row<'inventory_balances'>[]> {
    const { data, error } = await this.client
      .from('inventory_balances')
      .select('*')
      .eq('business_id', businessId)
      .eq('location_id', locationId);
    if (error) throw toRepositoryError('inventory_balances', error);
    return data ?? [];
  }

  /**
   * Fetch all inventory balances for a business with product and location
   * names joined. Optionally filter by a single location.
   * Used by WarehousePage stock table.
   */
  async findAllWithDetails(
    businessId: string,
    locationId?: string,
  ): Promise<BalanceWithProduct[]> {
    let query = this.client
      .from('inventory_balances')
      .select(`
        *,
        products ( name, sku, reorder_level ),
        inventory_locations ( name )
      `)
      .eq('business_id', businessId);

    if (locationId) query = query.eq('location_id', locationId);

    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) throw toRepositoryError('inventory_balances', error);
    return (data ?? []) as unknown as BalanceWithProduct[];
  }

  /**
   * Find the active inventory location marked as default (the warehouse).
   */
  async findDefaultLocation(
    businessId: string,
  ): Promise<Row<'inventory_locations'> | null> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw toRepositoryError('inventory_locations', error);
    return data ?? null;
  }

  /**
   * Insert a stock movement. The DB trigger updates inventory_balances automatically.
   */
  async recordMovement(
    movement: InsertDto<'stock_movements'>,
    clientKey?: string,
  ): Promise<{ movement: Row<'stock_movements'>; balance: Row<'inventory_balances'> }> {
    // Idempotency for offline sync retries: a retried movement must not double
    // the stock quantity (the insert fires a balance-updating trigger).
    if (clientKey) {
      const existing = await this.findMovementByClientKey(movement.business_id!, clientKey);
      if (existing) {
        const balance = await this.findBalance(
          movement.business_id!,
          movement.product_id!,
          movement.location_id!,
        );
        if (!balance) {
          throw toRepositoryError('inventory_balances', {
            message: `inventory_balances not found for product ${movement.product_id}`,
            code: 'LEDGR001',
          });
        }
        return { movement: existing, balance };
      }
    }

    const movementRow: InsertDto<'stock_movements'> = clientKey
      ? ({ ...movement, client_key: clientKey } as InsertDto<'stock_movements'>)
      : movement;

    const { data: createdMovement, error: movementError } = await this.client
      .from('stock_movements')
      .insert(movementRow as never)
      .select('*')
      .single();
    if (movementError) throw toRepositoryError('stock_movements', movementError);

    const balance = await this.findBalance(
      movement.business_id!,
      movement.product_id!,
      movement.location_id!,
    );
    if (!balance) {
      throw toRepositoryError('inventory_balances', {
        message: `inventory_balances not found after insert for product ${movement.product_id}`,
        code: 'LEDGR001',
      });
    }
    return { movement: createdMovement, balance };
  }

  /** Idempotency lookup: find a stock movement previously recorded under a client_key. */
  private async findMovementByClientKey(
    businessId: string,
    clientKey: string,
  ): Promise<Row<'stock_movements'> | null> {
    const { data, error } = await this.client
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_key added by migration 20260813000003, not yet in generated types
      .eq('client_key' as any, clientKey)
      .maybeSingle();
    if (error) throw toRepositoryError('stock_movements', error);
    return (data as Row<'stock_movements'> | null) ?? null;
  }

  /**
   * Bulk-insert multiple stock movements in one round-trip.
   * Used by WarehousePage "Receive Stock" for multi-line receipts.
   */
  async recordMovements(
    movements: InsertDto<'stock_movements'>[],
  ): Promise<Row<'stock_movements'>[]> {
    if (movements.length === 0) return [];
    const { data, error } = await this.client
      .from('stock_movements')
      .insert(movements as never)
      .select('*');
    if (error) throw toRepositoryError('stock_movements', error);
    return data ?? [];
  }

  async findMovementHistory(
    businessId: string,
    productId: string,
    limit = 50,
  ): Promise<Row<'stock_movements'>[]> {
    const { data, error } = await this.client
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .order('movement_date', { ascending: false })
      .limit(limit);
    if (error) throw toRepositoryError('stock_movements', error);
    return data ?? [];
  }

  async findReorderAlerts(businessId: string): Promise<Row<'v_reorder_alerts'>[]> {
    const { data, error } = await this.client
      .from('v_reorder_alerts')
      .select('*')
      .eq('business_id', businessId);
    if (error) throw toRepositoryError('v_reorder_alerts', error);
    return data ?? [];
  }

  /**
   * Fetch all active, inventory-tracked products for a business.
   * Used by WarehousePage and TransfersPage product pickers.
   */
  async findTrackableProducts(businessId: string): Promise<Row<'products'>[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('track_inventory', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('products', error);
    return data ?? [];
  }

  /**
   * Fetch all active products (including non-tracked) for a business.
   * Used by TransfersPage when transferring any product.
   */
  async findAllProducts(businessId: string): Promise<Row<'products'>[]> {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('products', error);
    return data ?? [];
  }

  /**
   * Reconciles stock levels against sales & purchase records: backfills any
   * `stock_movements` row missing for a tracked-product invoice or expense
   * line, then recomputes `inventory_balances` from the full movement
   * history. For businesses where inventory tracking was switched on after
   * income/expense transactions already existed, this is what closes the
   * gap between quantity on hand and what those transactions imply it
   * should be.
   *
   * `backfill_and_recalculate_inventory` is not in the generated Supabase
   * types (see phase-9-type-regeneration.md for the regeneration)
   * behind migrations) — cast the client narrowly to this RPC's exact
   * signature rather than casting to `any`, following the pattern used for
   * `record_business_terms_acceptance` in CreateBusinessPage.
   */
  async backfillFromSalesAndPurchases(businessId: string): Promise<{
    salesBackfilled: number;
    purchasesBackfilled: number;
    balancesUpdated: number;
  }> {
    const { data, error } = await (
      this.client as unknown as {
        rpc: (
          fn: 'backfill_and_recalculate_inventory',
          args: { p_business_id: string },
        ) => Promise<{
          data: {
            out_business_id: string;
            sales_backfilled: number;
            purchases_backfilled: number;
            balances_updated: number;
          }[] | null;
          error: { code?: string; message?: string } | null;
        }>;
      }
    ).rpc('backfill_and_recalculate_inventory', { p_business_id: businessId });

    if (error) throw toRepositoryError('stock_movements', error);

    const row = data?.[0];
    return {
      salesBackfilled: Number(row?.sales_backfilled ?? 0),
      purchasesBackfilled: Number(row?.purchases_backfilled ?? 0),
      balancesUpdated: Number(row?.balances_updated ?? 0),
    };
  }
}