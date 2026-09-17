import { describe, it, expect } from 'vitest';
import { csvCell } from '@/services/dataBackupService';

describe('Payroll Cost Center Aggregation and Filtering', () => {
  const mockLines = [
    {
      id: 'l-1',
      employee_id: 'emp-1',
      gross_pay: 1000000,
      paye_deduction: 200000,
      pension_employee: 50000,
      other_deductions: 10000,
      net_pay: 740000,
    },
    {
      id: 'l-2',
      employee_id: 'emp-2',
      gross_pay: 500000,
      paye_deduction: 75000,
      pension_employee: 25000,
      other_deductions: 0,
      net_pay: 400000,
    },
    {
      id: 'l-3',
      employee_id: 'emp-3',
      gross_pay: 300000,
      paye_deduction: 30000,
      pension_employee: 15000,
      other_deductions: 5000,
      net_pay: 250000,
    },
  ];

  interface MockEmployee {
    id: string;
    first_name: string;
    last_name: string;
    branch_id?: string | null;
    branch?: { id: string; name: string; code?: string | null } | null;
    department_id?: string | null;
    department?: { id: string; name: string; cost_centre?: string | null } | null;
  }

  const mockEmployeeMap = new Map<string, MockEmployee>([
    [
      'emp-1',
      {
        id: 'emp-1',
        first_name: 'John',
        last_name: 'Doe',
        branch_id: 'b-hq',
        branch: { id: 'b-hq', name: 'HQ', code: 'HQ' },
        department_id: 'd-fin',
        department: { id: 'd-fin', name: 'Finance', cost_centre: 'FIN-01' },
      },
    ],
    [
      'emp-2',
      {
        id: 'emp-2',
        first_name: 'Jane',
        last_name: 'Smith',
        branch_id: 'b-hq',
        branch: { id: 'b-hq', name: 'HQ', code: 'HQ' },
        department_id: 'd-ops',
        department: { id: 'd-ops', name: 'Operations', cost_centre: 'OPS-01' },
      },
    ],
    [
      'emp-3',
      {
        id: 'emp-3',
        first_name: 'Bob',
        last_name: 'Banda',
        branch_id: 'b-blz',
        branch: { id: 'b-blz', name: 'Blantyre', code: 'BLZ' },
        department_id: 'd-sls',
        department: { id: 'd-sls', name: 'Sales', cost_centre: 'SLS-02' },
      },
    ],
  ]);

  it('filters lines correctly by branch_id', () => {
    const filterBranch = 'b-hq';
    const filtered = mockLines.filter((l) => {
      const emp = mockEmployeeMap.get(l.employee_id);
      return emp?.branch_id === filterBranch;
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((l) => l.employee_id)).toEqual(['emp-1', 'emp-2']);
    const totalGross = filtered.reduce((s, l) => s + l.gross_pay, 0);
    expect(totalGross).toBe(1500000);
  });

  it('filters lines correctly by department_id', () => {
    const filterDept = 'd-fin';
    const filtered = mockLines.filter((l) => {
      const emp = mockEmployeeMap.get(l.employee_id);
      return emp?.department_id === filterDept;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].employee_id).toBe('emp-1');
    expect(filtered[0].net_pay).toBe(740000);
  });

  it('correctly aggregates payroll figures by cost center / branch', () => {
    const branchRollup = mockLines.reduce((acc, line) => {
      const emp = mockEmployeeMap.get(line.employee_id);
      const bKey = emp?.branch_id ?? 'unassigned';
      if (!acc[bKey]) {
        acc[bKey] = { headcount: 0, gross: 0, paye: 0, pension: 0, net: 0 };
      }
      acc[bKey].headcount += 1;
      acc[bKey].gross += line.gross_pay;
      acc[bKey].paye += line.paye_deduction;
      acc[bKey].pension += line.pension_employee;
      acc[bKey].net += line.net_pay;
      return acc;
    }, {} as Record<string, { headcount: number; gross: number; paye: number; pension: number; net: number }>);

    // HQ branch
    expect(branchRollup['b-hq']).toBeDefined();
    expect(branchRollup['b-hq'].headcount).toBe(2);
    expect(branchRollup['b-hq'].gross).toBe(1500000);
    expect(branchRollup['b-hq'].paye).toBe(275000);
    expect(branchRollup['b-hq'].pension).toBe(75000);
    expect(branchRollup['b-hq'].net).toBe(1140000);

    // BLZ branch
    expect(branchRollup['b-blz']).toBeDefined();
    expect(branchRollup['b-blz'].headcount).toBe(1);
    expect(branchRollup['b-blz'].gross).toBe(300000);
    expect(branchRollup['b-blz'].net).toBe(250000);
  });

  it('ensures csvCell sanitizes cost center names and formula injection inputs', () => {
    // Malicious cost centre code attempt
    const maliciousCode = '=SUM(A1:A10)';
    const sanitizedCode = csvCell(maliciousCode);
    const inner = sanitizedCode.startsWith('"') && sanitizedCode.endsWith('"')
      ? sanitizedCode.slice(1, -1).replace(/""/g, '"')
      : sanitizedCode;
    expect(inner.startsWith("'=")).toBe(true);

    const normalCode = 'FIN-01';
    expect(csvCell(normalCode)).toBe('FIN-01');

    const nameWithComma = 'Finance, Administration & Legal';
    expect(csvCell(nameWithComma)).toBe('"Finance, Administration & Legal"');
  });
});
