import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { PayrollRepository } from '@/lib/repositories/payroll.repository';

describe('PayrollRepository leave request methods', () => {
  it('loads tenant-scoped leave requests with employee/type details and pagination', async () => {
    const query = {
      select: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      order: vi.fn(function (this: unknown) { return this; }),
      range: vi.fn().mockResolvedValue({ data: [{ id: 'request-1', status: 'pending' }], error: null, count: 21 }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.getLeaveRequests('business-1', { status: 'pending', page: 2, pageSize: 20 }))
      .resolves.toMatchObject({ count: 21, page: 2, pageSize: 20, rows: [{ id: 'request-1' }] });
    expect(client.from).toHaveBeenCalledWith('leave_requests');
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('employee:employees!leave_requests_employee_business_fk'),
      { count: 'exact' },
    );
    expect(query.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(query.range).toHaveBeenCalledWith(20, 39);
  });

  it('submits a validated request through the RPC with snake-case arguments', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { requestId: 'request-1', status: 'pending' }, error: null });
    const repository = new PayrollRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.submitLeaveRequest('business-1', {
      employeeId: 'employee-1', leaveTypeId: 'leave-type-1',
      startDate: '2026-11-02', endDate: '2026-11-06', totalDays: 5, reason: 'Family event',
    })).resolves.toEqual({ requestId: 'request-1', status: 'pending' });
    expect(rpc).toHaveBeenCalledWith('submit_leave_request', {
      p_business_id: 'business-1', p_employee_id: 'employee-1', p_leave_type_id: 'leave-type-1',
      p_start_date: '2026-11-02', p_end_date: '2026-11-06', p_total_days: 5, p_reason: 'Family event',
    });
  });

  it('rejects an invalid date range without calling the RPC', async () => {
    const rpc = vi.fn();
    const repository = new PayrollRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.submitLeaveRequest('business-1', {
      employeeId: 'employee-1', leaveTypeId: 'leave-type-1',
      startDate: '2026-11-07', endDate: '2026-11-06', totalDays: 1,
    })).rejects.toThrow(/valid date range/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('approves or rejects through the atomic decision RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { requestId: 'request-1', status: 'approved' }, error: null });
    const repository = new PayrollRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.approveLeaveRequest('request-1', true)).resolves.toEqual({ requestId: 'request-1', status: 'approved' });
    expect(rpc).toHaveBeenCalledWith('approve_leave_request', { p_request_id: 'request-1', p_approved: true });
  });

  it('calls monthly accrual and pay-run reversal RPCs using the injected client', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { employeesProcessed: 2 }, error: null })
      .mockResolvedValueOnce({ data: { status: 'reversed', reversalJournalEntryId: 'reversal-1' }, error: null });
    const repository = new PayrollRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.accrueLeave('business-1', 2026, 11)).resolves.toEqual({ employeesProcessed: 2 });
    await expect(repository.reversePayRun('run-1')).resolves.toEqual({ status: 'reversed', reversalJournalEntryId: 'reversal-1' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'accrue_leave', { p_business_id: 'business-1', p_year: 2026, p_month: 11 });
    expect(rpc).toHaveBeenNthCalledWith(2, 'reverse_pay_run', { p_pay_run_id: 'run-1' });
  });
});
