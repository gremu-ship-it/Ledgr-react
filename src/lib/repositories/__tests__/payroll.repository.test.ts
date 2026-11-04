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

  it('searches the employee directory through the injected query builder', async () => {
    const query = {
      select: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      or: vi.fn(function (this: unknown) { return this; }),
      order: vi.fn(function (this: unknown) { return this; }),
      range: vi.fn().mockResolvedValue({ data: [{ id: 'employee-1' }], error: null, count: 1 }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    const result = await repository.getEmployees('business-1', { search: 'Janet Doe,%', status: 'active', page: 2, pageSize: 25 });

    expect(client.from).toHaveBeenCalledWith('employees');
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.or).toHaveBeenCalledWith('first_name.ilike.%Janet Doe%,last_name.ilike.%Janet Doe%,employee_number.ilike.%Janet Doe%,and(first_name.ilike.%Janet%,last_name.ilike.%Doe%),and(first_name.ilike.%Doe%,last_name.ilike.%Janet%)');
    expect(query.range).toHaveBeenCalledWith(25, 49);
    expect(result).toMatchObject({ count: 1, page: 2, pageSize: 25, rows: [{ id: 'employee-1' }] });
  });

  it('adds employee pay-component overrides through the injected client', async () => {
    const query = {
      insert: vi.fn(function (this: unknown) { return this; }),
      select: vi.fn(function (this: unknown) { return this; }),
      single: vi.fn().mockResolvedValue({ data: { id: 'override-1' }, error: null }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.addPayComponentOverride('business-1', 'employee-1', 'component-1', {
      override_amount: 45000,
      effective_from: '2026-11-01',
    })).resolves.toEqual({ id: 'override-1' });
    expect(query.insert).toHaveBeenCalledWith({
      business_id: 'business-1',
      employee_id: 'employee-1',
      pay_component_id: 'component-1',
      override_amount: 45000,
      override_rate: null,
      effective_from: '2026-11-01',
      effective_to: null,
    });
  });

  it('rejects invalid pay-component overrides before writing', async () => {
    const from = vi.fn();
    const repository = new PayrollRepository({ from } as unknown as SupabaseClient<Database>);

    await expect(repository.addPayComponentOverride('business-1', 'employee-1', 'component-1', {
      override_amount: -1,
      effective_from: '2026-11-01',
    })).rejects.toThrow(/valid override/);
    expect(from).not.toHaveBeenCalled();
  });

  it('versions compensation edits on their effective date without sending UI-only fields to employees', async () => {
    const employeeQuery = {
      update: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      select: vi.fn(function (this: unknown) { return this; }),
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: { id: 'employee-1', hire_date: '2024-01-01', gross_salary: 300000, currency: 'MWK', employment_type: 'permanent', pay_frequency: 'monthly' }, error: null })
        .mockResolvedValueOnce({ data: { id: 'employee-1', hire_date: '2024-01-01', gross_salary: 350000, currency: 'MWK', employment_type: 'permanent', pay_frequency: 'monthly' }, error: null }),
    };
    const contractQuery = {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      is: vi.fn(function (this: unknown) { return this; }),
      lt: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = { from: vi.fn((table: string) => table === 'employees' ? employeeQuery : contractQuery) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await repository.updateEmployee('business-1', 'employee-1', {
      gross_salary: 350000,
      pay_frequency: 'monthly',
      employment_type: 'permanent',
      contract_effective_from: '2026-11-04',
    });

    expect(employeeQuery.update).toHaveBeenCalledWith(expect.not.objectContaining({ contract_effective_from: expect.anything() }));
    expect(contractQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'business-1', employee_id: 'employee-1', effective_from: '2026-11-04', gross_salary: 350000,
    }), { onConflict: 'business_id,employee_id,effective_from' });
    expect(contractQuery.update).toHaveBeenCalledWith({ effective_to: '2026-11-03' });
    expect(contractQuery.lt).toHaveBeenCalledWith('effective_from', '2026-11-04');
  });
});
