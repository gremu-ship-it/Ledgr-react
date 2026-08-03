/**
 * inventoryRollup.ts — pure aggregation for the Inventory overview page.
 *
 * Rolls per-location `inventory_balances` rows up to per-product totals with a
 * quantity-weighted average cost, and derives low-stock state against the
 * product's reorder level. No React or Supabase imports so the arithmetic is
 * unit-testable in isolation.
 */
import type { BalanceWithProduct } from '@/dal/repositories/InventoryRepository';

export interface LocationSlice {
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  averageCost: number;
}

export interface ProductRollup {
  productId: string;
  name: string;
  sku: string | null;
  reorderLevel: number | null;
  onHand: number;
  reserved: number;
  available: number;
  /** Quantity-weighted average cost across locations (null-safe). */
  weightedCost: number;
  value: number;
  locations: LocationSlice[];
}

export function rollupByProduct(balances: BalanceWithProduct[]): ProductRollup[] {
  const byProduct = new Map<string, ProductRollup>();

  for (const b of balances) {
    const onHand = Number(b.quantity_on_hand ?? 0);
    const reserved = Number(b.quantity_reserved ?? 0);
    const available = Number(b.quantity_available ?? onHand - reserved);
    const cost = Number(b.average_cost ?? 0);

    let p = byProduct.get(b.productid);
    if (!p) {
      p = {
        productId: b.productid,
        name: b.products?.name ?? 'Unknown product',
        sku: b.products?.sku ?? null,
        reorderLevel: b.products?.reorder_level ?? null,
        onHand: 0, reserved: 0, available: 0,
        weightedCost: 0, value: 0,
        locations: [],
      };
      byProduct.set(b.productid, p);
    }

    p.onHand += onHand;
    p.reserved += reserved;
    p.available += available;
    p.value += onHand * cost;
    p.locations.push({
      locationId: b.locationid,
      locationName: b.inventory_locations?.name ?? 'Unknown location',
      onHand, reserved, available, averageCost: cost,
    });
  }

  for (const p of byProduct.values()) {
    const totalUnits = p.locations.reduce((s, l) => s + l.onHand, 0);
    p.weightedCost = totalUnits > 0
      ? p.locations.reduce((s, l) => s + l.averageCost * l.onHand, 0) / totalUnits
      : (p.locations[0]?.averageCost ?? 0);
    p.locations.sort((a, b) => a.locationName.localeCompare(b.locationName));
  }

  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function isLowStock(p: Pick<ProductRollup, 'available' | 'reorderLevel'>): boolean {
  return p.reorderLevel != null && p.reorderLevel > 0 && p.available <= p.reorderLevel;
}
