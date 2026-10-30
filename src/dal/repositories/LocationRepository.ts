import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { NotFoundError, toRepositoryError } from '../errors/RepositoryError';
import type { LocationType } from '@/hooks/useLocationTypes';

/**
 * Inventory locations (stores/sites) — the master-data CRUD layer behind the
 * Settings → Locations tab (P2-1).
 *
 * Authority model: this repository writes inventory_locations DIRECTLY under
 * the existing role-aware RLS tier (20260728000008): members read,
 * `can_write_business_data` inserts/updates, `can_admin_business_data`
 * deletes. No new RLS policy and no new RPC is involved. Rows are never
 * deleted here — deactivation sets `is_active = false`.
 *
 * The generated Database types predate location_type/project_id (they were
 * added by 20261028000000 and 20261103000000), so the row shape is extended
 * locally and the manufacturing/construction safety-check tables — which the
 * generated types do not know at all — are queried through a loose cast, the
 * same idiom ProjectRepository uses for construction_projects.
 */

/** inventory_locations row including the columns the generated types lack. */
export interface InventoryLocation extends Row<'inventory_locations'> {
  /** Store role; see LOCATION_TYPES in useLocationTypes. */
  location_type: LocationType | string;
  /** Linked construction project (project sites), null when unlinked. */
  project_id: string | null;
}

/** A location with its paired branch's name embedded (list view). */
export interface LocationWithBranch extends InventoryLocation {
  branches: { name: string } | null;
}

export interface CreateLocationInput {
  business_id: string;
  name: string;
  code?: string | null;
  branch_id?: string | null;
  location_type?: LocationType | string;
  /** When true the single-default invariant moves the flag to this row. */
  is_default?: boolean;
}

export interface UpdateLocationInput {
  name?: string;
  code?: string | null;
  branch_id?: string | null;
  location_type?: LocationType | string;
  is_default?: boolean;
}

/** Why a location cannot be deactivated. Codes are translated by the UI. */
export type DeactivateBlockCode =
  | 'stock_on_hand'
  | 'open_work_orders'
  | 'active_procurement_site'
  | 'last_default';

export interface DeactivateBlockReason {
  code: DeactivateBlockCode;
  /** Total units on hand (stock_on_hand) or open work-order count. */
  count?: number;
}

export interface DeactivateCheckResult {
  ok: boolean;
  reasons: DeactivateBlockReason[];
}

export interface DeactivateResult extends DeactivateCheckResult {
  deactivated: boolean;
}

/**
 * Terminal work-order statuses: a work order in any other status can still
 * move stock through its source/destination locations. `closed` is terminal
 * too — manufacturing_wo_close only accepts completed orders — so counting it
 * as "open" would block deactivation forever with no way to resolve it.
 */
const OPEN_WORK_ORDER_STATUSES_EXCLUDED = '(completed,cancelled,closed)';

export class LocationRepository extends BaseRepository<'inventory_locations'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'inventory_locations');
  }

  /**
   * Tables outside the generated types (manufacturing_work_orders,
   * construction_procurement_sites), queried read-only for deactivation
   * safety checks.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vertical tables absent from database.generated.ts; read-only safety checks
  private get loose(): any {
    return this.client;
  }

  /** Every location of a business, active AND inactive, with branch names. */
  async getAll(businessId: string): Promise<LocationWithBranch[]> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*, branches(name)')
      .eq('business_id', businessId)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('inventory_locations', error);
    return (data ?? []) as unknown as LocationWithBranch[];
  }

  /** One location scoped to its business (tenant guard on the id). */
  async getById(businessId: string, id: string): Promise<InventoryLocation> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw toRepositoryError('inventory_locations', error);
    if (!data) throw new NotFoundError('inventory_locations', id);
    return data as unknown as InventoryLocation;
  }

  /**
   * Create a location. `is_default` is applied through setDefault() after the
   * insert so a failed insert can never leave the business with no default.
   */
  async create(input: CreateLocationInput): Promise<InventoryLocation> {
    const dto: InsertDto<'inventory_locations'> = {
      business_id: input.business_id,
      name: input.name,
      code: input.code ?? null,
      branch_id: input.branch_id ?? null,
      is_default: false,
      is_active: true,
      // location_type is absent from the generated Insert type; the DB column
      // defaults to 'warehouse' when omitted.
      ...(input.location_type ? { location_type: input.location_type } : {}),
    } as never;
    const { data, error } = await this.client
      .from('inventory_locations')
      .insert(dto)
      .select('*')
      .single();
    if (error) throw toRepositoryError('inventory_locations', error);
    const created = data as unknown as InventoryLocation;
    if (input.is_default) {
      await this.setDefault(input.business_id, created.id);
      return { ...created, is_default: true };
    }
    return created;
  }

  /**
   * Update a location.
   *
   * Branch-pairing name sync (audit §1.1.2 drift fix): when the name changes
   * and the location is its branch's MIRROR (branch.name equals the
   * location's current name — the shape BranchRepository.createWithLocation
   * and the provisioning RPCs produce), the branch is renamed to match.
   * Non-mirror pairings (e.g. the three typed stores under "Main Factory")
   * are deliberately left alone: renaming one store must not rename the
   * branch, and renaming the branch must not flatten three distinct stores
   * into one name.
   *
   * Named updateLocation (not update) because BaseRepository.update(id, dto)
   * has a different contract — the same precedent as
   * BranchRepository.updateBranch.
   */
  async updateLocation(
    businessId: string,
    id: string,
    input: UpdateLocationInput,
  ): Promise<InventoryLocation> {
    let mirrorBranchId: string | null = null;
    if (input.name !== undefined) {
      const current = await this.getById(businessId, id);
      if (current.branch_id && current.name !== input.name) {
        const { data: branch } = await this.client
          .from('branches')
          .select('id, name')
          .eq('id', current.branch_id)
          .maybeSingle();
        if (branch && branch.name === current.name) {
          mirrorBranchId = branch.id;
        }
      }
    }

    const { is_default, ...fields } = input;
    if (Object.keys(fields).length > 0) {
      const { error } = await this.client
        .from('inventory_locations')
        .update(fields as UpdateDto<'inventory_locations'>)
        .eq('business_id', businessId)
        .eq('id', id);
      if (error) throw toRepositoryError('inventory_locations', error);
    }

    if (mirrorBranchId && input.name !== undefined) {
      const { error } = await this.client
        .from('branches')
        .update({ name: input.name })
        .eq('id', mirrorBranchId);
      if (error) throw toRepositoryError('branches', error);
    }

    if (is_default === true) {
      await this.setDefault(businessId, id);
    } else if (is_default === false) {
      const { error } = await this.client
        .from('inventory_locations')
        .update({ is_default: false })
        .eq('business_id', businessId)
        .eq('id', id);
      if (error) throw toRepositoryError('inventory_locations', error);
    }

    return this.getById(businessId, id);
  }

  /**
   * Single-default invariant: clear the flag on every other location of the
   * business, then set it on the target. Two sequential business-scoped
   * updates under RLS (accepted by the P2-1 spec; no RPC exists for this and
   * none may be added by this change).
   */
  async setDefault(businessId: string, locationId: string): Promise<void> {
    const { error: clearError } = await this.client
      .from('inventory_locations')
      .update({ is_default: false })
      .eq('business_id', businessId)
      .eq('is_default', true)
      .neq('id', locationId);
    if (clearError) throw toRepositoryError('inventory_locations', clearError);

    const { error: setError } = await this.client
      .from('inventory_locations')
      .update({ is_default: true })
      .eq('business_id', businessId)
      .eq('id', locationId);
    if (setError) throw toRepositoryError('inventory_locations', setError);
  }

  /**
   * The four deactivation safety checks from the P2-1 spec, as structured
   * reason codes the UI translates (the repository never produces English).
   *
   * The work-order and procurement-site checks run for EVERY business, not
   * only vertical-enabled ones: rows outlive operating-model removal (the
   * "removing the model revokes nothing" doctrine), so a business that dropped
   * MANUFACTURING must still be blocked by its open work orders.
   */
  async canDeactivate(
    businessId: string,
    locationId: string,
  ): Promise<DeactivateCheckResult> {
    const location = await this.getById(businessId, locationId);
    const reasons: DeactivateBlockReason[] = [];

    // 1. Stock on hand: any inventory_balances row with quantity_on_hand > 0.
    const { data: balances, error: balancesError } = await this.client
      .from('inventory_balances')
      .select('quantity_on_hand')
      .eq('business_id', businessId)
      .eq('location_id', locationId)
      .gt('quantity_on_hand', 0);
    if (balancesError) throw toRepositoryError('inventory_balances', balancesError);
    if (balances && balances.length > 0) {
      const units = balances.reduce(
        (total, row) => total + Number(row.quantity_on_hand ?? 0),
        0,
      );
      reasons.push({ code: 'stock_on_hand', count: units });
    }

    // 2. Open manufacturing work orders referencing the location as source
    //    or destination.
    const { data: workOrders, error: workOrdersError } = await this.loose
      .from('manufacturing_work_orders')
      .select('id')
      .eq('business_id', businessId)
      .not('status', 'in', OPEN_WORK_ORDER_STATUSES_EXCLUDED)
      .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`);
    if (workOrdersError) throw toRepositoryError('manufacturing_work_orders', workOrdersError);
    if (workOrders && workOrders.length > 0) {
      reasons.push({ code: 'open_work_orders', count: workOrders.length });
    }

    // 3. Active construction procurement sites bound to the location.
    const { data: sites, error: sitesError } = await this.loose
      .from('construction_procurement_sites')
      .select('id')
      .eq('business_id', businessId)
      .eq('location_id', locationId)
      .eq('is_active', true);
    if (sitesError) throw toRepositoryError('construction_procurement_sites', sitesError);
    if (sites && sites.length > 0) {
      reasons.push({ code: 'active_procurement_site', count: sites.length });
    }

    // 4. Last default: the business must keep a default location.
    if (location.is_default) {
      const { data: otherDefaults, error: defaultsError } = await this.client
        .from('inventory_locations')
        .select('id')
        .eq('business_id', businessId)
        .eq('is_default', true)
        .neq('id', locationId)
        .limit(1);
      if (defaultsError) throw toRepositoryError('inventory_locations', defaultsError);
      if (!otherDefaults || otherDefaults.length === 0) {
        reasons.push({ code: 'last_default' });
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  /**
   * Deactivate (never delete). Runs canDeactivate first and refuses when
   * blocked — the repository is the authority, the UI pre-check is only
   * messaging (defense in depth per the P2-1 spec).
   */
  async deactivate(businessId: string, locationId: string): Promise<DeactivateResult> {
    const check = await this.canDeactivate(businessId, locationId);
    if (!check.ok) {
      return { ...check, deactivated: false };
    }
    const { error } = await this.client
      .from('inventory_locations')
      .update({ is_active: false })
      .eq('business_id', businessId)
      .eq('id', locationId);
    if (error) throw toRepositoryError('inventory_locations', error);
    return { ok: true, reasons: [], deactivated: true };
  }

  /** Reactivate. No guards: reactivating a location is always safe. */
  async reactivate(businessId: string, locationId: string): Promise<void> {
    const { error } = await this.client
      .from('inventory_locations')
      .update({ is_active: true })
      .eq('business_id', businessId)
      .eq('id', locationId);
    if (error) throw toRepositoryError('inventory_locations', error);
  }
}
