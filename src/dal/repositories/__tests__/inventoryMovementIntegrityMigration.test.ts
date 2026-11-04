import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261130000000_inventory_movement_integrity.sql'),
  'utf8',
);

describe('inventory movement integrity migration', () => {
  it('guards future source/product/location duplicates without rewriting existing movement rows', () => {
    expect(migration).toMatch(/new\.movement_type::text in \('sale', 'purchase'\)/i);
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_identity, 0\)\)/i);
    expect(migration).toMatch(/sm\.source_type\s*=\s*new\.source_type[\s\S]*sm\.source_id\s*=\s*new\.source_id[\s\S]*sm\.product_id\s*=\s*new\.product_id[\s\S]*sm\.location_id\s*=\s*new\.location_id/i);
    expect(migration).toMatch(/if exists \([\s\S]*\) then\s+return null;/i);
    expect(migration).not.toMatch(/update\s+public\.stock_movements|delete\s+from\s+public\.stock_movements/i);
  });

  it('creates both transfer directions with a shared transfer_id in one dispatch RPC', () => {
    const dispatch = migration.split('create or replace function public.dispatch_stock_transfer_atomically')[1]
      ?.split('create or replace function public.confirm_stock_transfer_receipt_atomically')[0] ?? '';
    expect(dispatch).toMatch(/for update/i);
    expect(dispatch).toMatch(/'transfer_out'[\s\S]*transfer_id[\s\S]*'transfer_in'[\s\S]*transfer_id/i);
    expect(dispatch).toMatch(/quantity_dispatched\s*=\s*v_quantity/i);
    expect(dispatch).not.toMatch(/quantity_received\s*=\s*v_quantity/i);
    expect(dispatch).toMatch(/status\s*=\s*'dispatched'/i);
  });

  it('keeps receipt confirmation from inserting a second pair and rejects quantity mismatches', () => {
    const receipt = migration.split('create or replace function public.confirm_stock_transfer_receipt_atomically')[1] ?? '';
    expect(receipt).toMatch(/inventory-transfer-quantity-mismatch/);
    expect(receipt).not.toMatch(/insert\s+into\s+public\.stock_movements/i);
    expect(receipt).toMatch(/status\s*=\s*'received'/i);
  });

  it('requires notes or a reference for adjustment movements and leaves the balance writer untouched', () => {
    expect(migration).toMatch(/new\.movement_type::text in \('adjustment_in', 'adjustment_out'\)[\s\S]*new\.reference[\s\S]*new\.notes[\s\S]*inventory-adjustment-reason-required/);
    expect(migration).not.toMatch(/create or replace function public\._ledgr_apply_stock_movement_delta/i);
  });
});
