// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PosZReportModal } from '../PosZReportModal';
import type { PosShift } from '@/types/pos';

const shift = {
  id: 'shift-1',
  business_id: 'biz-001',
  branch_id: 'branch-001',
  cashier_id: 'user-1',
  cashier_name: 'R13 cashier',
  opening_cash: 50000,
  opening_float: 50000,
  expected_cash: 58000,
  expectedCash: 58000,
  actual_cash: 58000,
  cash_variance: 0,
  total_sales_amount: 15000,
  cash_sales_amount: 15000,
  other_sales_amount: 0,
  refunds_amount: 7000,
  cash_in_amount: 0,
  cash_out_amount: 0,
  status: 'closed',
  opened_at: '2026-09-19T08:00:00Z',
  closed_at: '2026-09-19T17:00:00Z',
  start_time: '2026-09-19T08:00:00Z',
} as unknown as PosShift;

describe('PosZReportModal (R08.5 honest states)', () => {
  it('shows the immutable server-minted Z report number when provided', () => {
    const { container } = render(<PosZReportModal open onClose={() => {}} shift={shift} serverReportNumber="Z-2026-42" />);
    const hits = Array.from(container.querySelectorAll('p')).filter((el) => el.textContent?.includes('Report #:'));
    expect(hits.some((el) => el.textContent?.includes('Z-2026-42'))).toBe(true);
  });

  it('never simulates an email dispatch: no send action and an explicit not-implemented notice', () => {
    const { container } = render(<PosZReportModal open onClose={() => {}} shift={shift} serverReportNumber="Z-2026-42" />);

    // The honest state is rendered…
    const notices = container.querySelectorAll('[data-testid="zreport-email-unavailable"]');
    expect(notices.length).toBeGreaterThan(0);
    const notice = notices[0];
    expect(notice.textContent).toMatch(/email dispatch is not available/i);
    expect(notice.textContent).toMatch(/Nothing was sent/i);
    expect(notice.textContent).toMatch(/R14/);

    // …and there is no path that could claim a fake "sent" state.
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((label) => /email report/i.test(label))).toBe(false);
    expect(container.textContent ?? '').not.toMatch(/successfully emailed/i);
    expect(container.querySelector('input[placeholder*="recipient@"]')).toBeNull();
    expect(screen.queryByText(/successfully emailed/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/recipient@/i)).toBeNull();
  });

  it('falls back to the client-side frame only when no server number was minted yet (rendering fallback, documented)', () => {
    const { container } = render(<PosZReportModal open onClose={() => {}} shift={shift} />);
    const hits = Array.from(container.querySelectorAll('p')).filter((el) => el.textContent?.includes('Report #:'));
    expect(hits.some((el) => /Report #: Z-\d{4}-/.test(el.textContent ?? ''))).toBe(true);
  });
});
