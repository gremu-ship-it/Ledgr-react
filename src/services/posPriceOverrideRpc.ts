/**
 * Till price / discount overrides (owner decision 2026-09-26, migration
 * 20261013000000_owner_decisions_price_override_branch_stock.sql).
 *
 * Only a supervisor (owner, admin, manager, sales_manager, branch_manager) may
 * sell away from the catalogue price or above the cashier discount cap. The
 * server enforces this inside `post_pos_sale`; this module only carries the
 * request and the supervisor's authorisation. A token is single-use, expires,
 * and is bound to the product + price (price) or to a maximum % (discount).
 * The client can never authorise anything by itself.
 */
import { supabase } from '@/lib/supabase';

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};
const rpcClient = supabase as unknown as RpcClient;

export interface PosPriceOverrideRequest {
  id: string;
  token: string;
  kind: 'price' | 'discount';
  expiresAt: string;
}

export async function requestPosPriceOverride(
  businessId: string,
  request:
    | { kind: 'price'; productId: string; unitPrice: number; reason?: string }
    | { kind: 'discount'; maxDiscountPercent: number; reason?: string },
): Promise<PosPriceOverrideRequest> {
  const { data, error } = await rpcClient.rpc('request_pos_price_override', {
    p_business_id: businessId,
    p_kind: request.kind,
    p_product_id: request.kind === 'price' ? request.productId : null,
    p_unit_price: request.kind === 'price' ? request.unitPrice : null,
    p_max_discount_percent: request.kind === 'discount' ? request.maxDiscountPercent : null,
    p_reason: request.reason ?? null,
    p_ttl_minutes: 15,
  });
  if (error) throw new Error(error.message || 'Could not request a supervisor override.');
  const row = data as { id?: string; token?: string; kind?: 'price' | 'discount'; expires_at?: string } | null;
  if (!row?.token || !row.id) throw new Error('The server did not return an override token.');
  return { id: row.id, token: row.token, kind: row.kind ?? request.kind, expiresAt: row.expires_at ?? '' };
}

/** Called from a SUPERVISOR's own session. The server rejects non-supervisors, the requester, and over-limit discounts. */
export async function authorizePosPriceOverride(token: string): Promise<void> {
  const { error } = await rpcClient.rpc('authorize_pos_price_override', { p_token: token });
  if (error) throw new Error(error.message || 'Could not authorise the override.');
}

/** True for the roles the server treats as till supervisors (_ledgr_is_pos_supervisor). Display only. */
export const POS_SUPERVISOR_ROLES = ['owner', 'admin', 'manager', 'sales_manager', 'branch_manager'] as const;
export function isPosSupervisorRole(role: string | null | undefined): boolean {
  return !!role && (POS_SUPERVISOR_ROLES as readonly string[]).includes(role);
}
