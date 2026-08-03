/**
 * IAS 21 realised FX gain/loss — sign conventions.
 *
 * These lock the semantics used by journalService when a payment settles a
 * foreign-currency invoice or expense at a rate different from the booking
 * rate. Getting the sign wrong posts gains as losses (and vice versa) with no
 * error — the balance still balances.
 *
 * Example rates: MWK functional, USD original, ~1,700 MWK/USD.
 */
import { describe, it, expect } from 'vitest';
import { calculateRealisedFx } from '@/services/realisedFx';

describe('calculateRealisedFx — receivable (invoice/AR)', () => {
  it('books a GAIN when the foreign currency strengthens before settlement', () => {
    // USD 100 billed at 1,700 MWK, customer pays when USD = 1,750 MWK
    expect(calculateRealisedFx(100, 1700, 1750, 'receivable')).toBe(5_000);
  });

  it('books a LOSS when the foreign currency weakens before settlement', () => {
    expect(calculateRealisedFx(100, 1700, 1650, 'receivable')).toBe(-5_000);
  });

  it('returns zero when rates are unchanged', () => {
    expect(calculateRealisedFx(250.75, 1720, 1720, 'receivable')).toBe(0);
  });
});

describe('calculateRealisedFx — payable (expense/AP)', () => {
  it('books a LOSS when the foreign currency strengthens (debt costs more MWK)', () => {
    expect(calculateRealisedFx(100, 1700, 1750, 'payable')).toBe(-5_000);
  });

  it('books a GAIN when the foreign currency weakens (debt costs less MWK)', () => {
    expect(calculateRealisedFx(100, 1700, 1650, 'payable')).toBe(5_000);
  });

  it('is the exact mirror of the receivable case', () => {
    for (const [amount, booked, settled] of [
      [100, 1700, 1750], [55.5, 1650, 1700], [1_000, 1720, 1700],
    ] as const) {
      expect(calculateRealisedFx(amount, booked, settled, 'payable'))
        .toBe(-calculateRealisedFx(amount, booked, settled, 'receivable'));
    }
  });
});

describe('calculateRealisedFx — partial settlements', () => {
  it('scales with the settled portion, not the invoice total', () => {
    // Settling half of a USD 200 invoice booked at 1,700, settled at 1,720
    expect(calculateRealisedFx(100, 1700, 1720, 'receivable')).toBe(2_000);
  });

  it('handles a zero settled amount', () => {
    expect(calculateRealisedFx(0, 1700, 9999, 'receivable')).toBe(0);
  });
});
