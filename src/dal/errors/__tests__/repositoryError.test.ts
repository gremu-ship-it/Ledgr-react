import { describe, it, expect } from 'vitest';
import {
  toRepositoryError,
  ValidationError,
  InsufficientStockError,
  INSUFFICIENT_STOCK_MESSAGE,
  UnauthorizedError,
  DatabaseError,
} from '../RepositoryError';

describe('toRepositoryError', () => {
  it('shows a concise stock message for the inventory non-negative constraint', () => {
    const rawError = {
      code: '23514',
      message:
        'new row for relation "inventory_balances" violates check constraint "chk_inventory_balances_on_hand_nonneg"',
      details: 'Failing row contains (…, -90.0000, 0.0000, …)',
    };
    const err = toRepositoryError('stock_movements', rawError);

    expect(err).toBeInstanceOf(InsufficientStockError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe(INSUFFICIENT_STOCK_MESSAGE);
    expect(err.message).not.toContain('chk_inventory_balances_on_hand_nonneg');
    expect(err.message).not.toContain('Failing row contains');
    // Keep the database payload available for diagnostics without showing it
    // to the user.
    expect(err.cause).toBe(rawError);
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
