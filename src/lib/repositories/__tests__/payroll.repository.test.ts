import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { PayrollRepository } from '@/lib/repositories/payroll.repository';

const bands = [
  { band_number: 1, lower_bound: 0, upper_bound: 170_000, rate: 0, currency: 'MWK' },
  { band_number: 2, lower_bound: 170_000, upper_bound: null, rate: 0.3, currency: 'MWK' },
];

describe('PayrollRepository', () => {
  it('upserts tax bands using the injected client without deleting omitted stored rows', async () => {
    const query = {
      upsert: vi.fn(function (this: unknown) { return this; }),
      select: vi.fn().mockResolvedValue({ data: bands, error: null }),
      delete: vi.fn(),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.updateTaxBands('business-1', 2026, bands)).resolves.toEqual(bands);
    expect(client.from).toHaveBeenCalledWith('tax_bands');
    expect(query.upsert).toHaveBeenCalledWith(
      bands.map((band) => ({ ...band, business_id: 'business-1', fiscal_year: 2026 })),
      { onConflict: 'business_id,fiscal_year,band_number' },
    );
    expect(query.delete).not.toHaveBeenCalled();
  });

  it('rejects non-contiguous progressive bands before writing', async () => {
    const from = vi.fn();
    const repository = new PayrollRepository({ from } as unknown as SupabaseClient<Database>);

    await expect(repository.updateTaxBands('business-1', 2026, [
      bands[0], { ...bands[1], lower_bound: 200_000 },
    ])).rejects.toThrow(/previous band/);
    expect(from).not.toHaveBeenCalled();
  });
});
