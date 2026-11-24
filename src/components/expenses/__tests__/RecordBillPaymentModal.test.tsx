// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Row } from '@/dal/types/database';

/**
 * Cover for the missing payment entry point.
 *
 * `recordPayment` (the atomic `record_expense_payment` command) existed and was
 * tested server-side, but NO screen called it — a bill could be created and
 * never settled from inside the app, which is how a MK 4,000,000 payable ended
 * up needing a manual journal. This test drives the modal that closes that
 * loop: it must post the payment through the repository with a per-dialog
 * idempotency key, and it must refuse to record more than the bill owes.
 */

const recordPaymentForBill = vi.fn();
const findBankAccounts = vi.fn(async () => []);

vi.mock('@/lib/repositories', () => ({
  repos: {
    account: { findBankAccounts: () => findBankAccounts() },
    expense: { recordPaymentForBill: (...args: unknown[]) => recordPaymentForBill(...args) },
  },
}));

vi.mock('@/lib/currency', () => ({
  resolveTransactionRate: async () => ({ rate: 1, rateDate: '2026-11-24', isStale: false }),
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      currentUser: { id: 'user-1' },
      currentBusiness: { business: { base_currency: 'MWK' } },
    }),
}));

import { RecordBillPaymentModal } from '../RecordBillPaymentModal';

const bill = {
  id: 'bill-1',
  business_id: 'business-1',
  expense_number: 'EXP-0478',
  status: 'approved',
  currency: 'MWK',
  original_currency: null,
  total_amount: 4_000_000,
  amount_paid: 1_000_000,
} as unknown as Row<'expenses'>;

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RecordBillPaymentModal bill={bill} businessId="business-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('RecordBillPaymentModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    findBankAccounts.mockResolvedValue([]);
    recordPaymentForBill.mockResolvedValue({ payment: {}, expense: bill });
  });

  it('shows the outstanding balance, not the bill total', () => {
    renderModal();
    // 4,000,000 total less 1,000,000 already paid.
    expect(screen.getAllByText(/3,000,000/).length).toBeGreaterThan(0);
  });

  it('defaults the amount to the full outstanding balance', () => {
    renderModal();
    const amount = screen.getByDisplayValue('3000000.00');
    expect(amount).toBeTruthy();
  });

  it('records the payment through the repository with an idempotency key', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(recordPaymentForBill).toHaveBeenCalledTimes(1));
    const [payment, clientKey] = recordPaymentForBill.mock.calls[0];
    expect(payment).toMatchObject({
      business_id: 'business-1',
      expense_id: 'bill-1',
      amount: 3_000_000,
      currency: 'MWK',
      payment_method: 'bank_transfer',
    });
    // A real uuid, not a compound string: client_key is a uuid column.
    expect(clientKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('rejects a payment larger than the outstanding balance without calling the server', async () => {
    renderModal();

    const input = screen.getByDisplayValue('3000000.00');
    fireEvent.change(input, { target: { value: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(screen.getByText(/cannot exceed the outstanding balance/i)).toBeTruthy());
    expect(recordPaymentForBill).not.toHaveBeenCalled();
  });

  it('surfaces a server rejection instead of pretending the payment landed', async () => {
    recordPaymentForBill.mockRejectedValue(new Error('Payment exceeds the outstanding balance'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() =>
      expect(screen.getByText(/Payment exceeds the outstanding balance/)).toBeTruthy(),
    );
  });
});
