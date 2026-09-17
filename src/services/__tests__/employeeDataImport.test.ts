import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IMPORT_TEMPLATES,
  validateRows,
  importEmployees,
  type ParsedRow,
  type ImportPreview,
} from '../dataImportService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  const from = vi.fn();
  return {
    supabase: {
      from,
    },
  };
});

describe('Bulk Employee Import with branch_code and cost_centre_code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes branch_code and cost_centre_code in IMPORT_TEMPLATES.employees headers', () => {
    const template = IMPORT_TEMPLATES.employees;
    expect(template.headers).toContain('branch_code');
    expect(template.headers).toContain('cost_centre_code');
    expect(template.headers).toContain('first_name');
    expect(template.headers).toContain('last_name');
  });

  it('validates employee rows successfully when required fields are present', () => {
    const preview: ImportPreview = {
      totalRows: 1,
      validRows: 0,
      invalidRows: 0,
      headers: ['first_name', 'last_name', 'branch_code', 'cost_centre_code', 'gross_salary'],
      rows: [
        {
          rowNumber: 2,
          data: {
            first_name: 'John',
            last_name: 'Banda',
            branch_code: 'HQ',
            cost_centre_code: 'FIN-01',
            gross_salary: '500000',
          },
          errors: [],
          warnings: [],
          isValid: true,
        },
      ],
    };

    const validated = validateRows(preview, 'employees');
    expect(validated.validRows).toBe(1);
    expect(validated.invalidRows).toBe(0);
    expect(validated.rows[0].errors).toHaveLength(0);
  });

  it('flags errors when first_name or last_name is missing, or salary is negative', () => {
    const preview: ImportPreview = {
      totalRows: 2,
      validRows: 0,
      invalidRows: 0,
      headers: ['first_name', 'last_name', 'gross_salary'],
      rows: [
        {
          rowNumber: 2,
          data: { first_name: '', last_name: 'Phiri', gross_salary: '1000' },
          errors: [],
          warnings: [],
          isValid: true,
        },
        {
          rowNumber: 3,
          data: { first_name: 'Alice', last_name: 'Moyo', gross_salary: '-500' },
          errors: [],
          warnings: [],
          isValid: true,
        },
      ],
    };

    const validated = validateRows(preview, 'employees');
    expect(validated.invalidRows).toBe(2);
    expect(validated.rows[0].errors.some((e) => e.includes('first_name'))).toBe(true);
    expect(validated.rows[1].errors.some((e) => e.includes('Salary must not be negative'))).toBe(true);
  });

  it('resolves branch_id and department_id by code and inserts employees', async () => {
    const mockBranches = [
      { id: 'b-hq', code: 'HQ', name: 'Headquarters' },
      { id: 'b-blz', code: 'BLZ', name: 'Blantyre' },
    ];
    const mockDepartments = [
      { id: 'd-fin', code: 'FIN', cost_centre: 'FIN-01', name: 'Finance', branch_id: 'b-hq' },
      { id: 'd-sls', code: 'SLS', cost_centre: 'SLS-02', name: 'Sales', branch_id: 'b-blz' },
    ];

    const insertedRows: Record<string, unknown>[] = [];

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'branches') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: mockBranches, error: null }),
            }),
          }),
        } as never;
      }
      if (table === 'departments') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: mockDepartments, error: null }),
            }),
          }),
        } as never;
      }
      if (table === 'employees') {
        return {
          insert: (records: unknown[]) => {
            insertedRows.push(...(records as Record<string, unknown>[]));
            return {
              select: async () => ({ data: [{ id: 'emp-1' }, { id: 'emp-2' }], error: null }),
            };
          },
        } as never;
      }
      return {} as never;
    });

    const parsedRows: ParsedRow[] = [
      {
        rowNumber: 2,
        data: {
          first_name: 'John',
          last_name: 'Banda',
          employee_number: 'EMP-001',
          branch_code: 'HQ',
          cost_centre_code: 'FIN-01',
          gross_salary: '750000',
          payment_method: 'bank_transfer',
          bank_name: 'NBS',
          bank_account_number: '123456',
        },
        errors: [],
        warnings: [],
        isValid: true,
      },
      {
        rowNumber: 3,
        data: {
          first_name: 'Mary',
          last_name: 'Tembo',
          employee_number: 'EMP-002',
          branch_code: 'BLZ',
          cost_centre_code: 'SLS-02',
          gross_salary: '450000',
          payment_method: 'airtel_money',
          mobile_money_number: '0999123456',
        },
        errors: [],
        warnings: [],
        isValid: true,
      },
    ];

    const result = await importEmployees('biz-1', parsedRows);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
    expect(insertedRows).toHaveLength(2);

    expect(insertedRows[0].branch_id).toBe('b-hq');
    expect(insertedRows[0].department_id).toBe('d-fin');
    expect(insertedRows[0].gross_salary).toBe(750000);

    expect(insertedRows[1].branch_id).toBe('b-blz');
    expect(insertedRows[1].department_id).toBe('d-sls');
    expect(insertedRows[1].payment_method).toBe('airtel_money');
  });

  it('returns failure when branch_code or cost_centre_code is specified but not found', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'branches') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: [{ id: 'b-hq', code: 'HQ', name: 'Headquarters' }], error: null }),
            }),
          }),
        } as never;
      }
      if (table === 'departments') {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: [], error: null }),
            }),
          }),
        } as never;
      }
      return {} as never;
    });

    const parsedRows: ParsedRow[] = [
      {
        rowNumber: 2,
        data: {
          first_name: 'Unknown',
          last_name: 'BranchUser',
          branch_code: 'NON_EXISTENT_BRANCH',
          gross_salary: '100000',
        },
        errors: [],
        warnings: [],
        isValid: true,
      },
    ];

    const result = await importEmployees('biz-1', parsedRows);
    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].message).toContain('Branch code or name "NON_EXISTENT_BRANCH" not found');
  });
});
