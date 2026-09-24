import { describe, it, expect } from 'vitest';
import {
  toRepositoryError,
  ValidationError,
  UnauthorizedError,
  DatabaseError,
} from '../RepositoryError';

describe('toRepositoryError', () => {
  it('keeps the constraint name AND the failing row for a check violation', () => {
    // The 2026-09-24 "Reconcile stock levels" incident surfaced as
    // "Failing row contains (…)" with no constraint name, because only the
    // PostgREST `details` field was shown. Both parts must survive.
    const err = toRepositoryError('stock_movements', {
      code: '23514',
      message:
        'new row for relation "inventory_balances" violates check constraint "chk_inventory_balances_on_hand_nonneg"',
      details: 'Failing row contains (…, -3.0000, 0.0000, …)',
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('chk_inventory_balances_on_hand_nonneg');
    expect(err.message).toContain('Failing row contains');
  });

  it('falls back to the message when a constraint violation has no details', () => {
    const err = toRepositoryError('stock_movements', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "x_uidx"',
    });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('duplicate key value');
  });

  it('maps privilege errors to UnauthorizedError', () => {
    const err = toRepositoryError('stock_movements', { code: '42501', message: 'permission denied' });
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it('maps unknown codes to DatabaseError', () => {
    const err = toRepositoryError('stock_movements', { code: 'XX000', message: 'boom' });
    expect(err).toBeInstanceOf(DatabaseError);
  });
});
