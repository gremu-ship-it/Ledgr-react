// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { PosPaymentModal } from '../PosPaymentModal';

afterEach(cleanup);

const renderModal = (props: Partial<React.ComponentProps<typeof PosPaymentModal>> = {}) => {
  const onCompleteSale = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <PosPaymentModal
      open
      onClose={() => {}}
      grandTotal={10.01}
      onCompleteSale={onCompleteSale}
      maxTenders={2}
      {...props}
    />,
  );
  return { ...view, onCompleteSale };
};

describe('POS split tender checkout', () => {
  it('requires a cent-exact split and sends the exact tender rows', async () => {
    const { onCompleteSale } = renderModal({ grandTotal: 3.00, netPayable: 3.00 });
    fireEvent.click(screen.getByRole('button', { name: 'Split payment' }));
    fireEvent.change(screen.getByLabelText('Tender 1 amount'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    expect((screen.getByLabelText('Tender 2 amount') as HTMLInputElement).value).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(onCompleteSale).toHaveBeenCalledTimes(1);
    expect(onCompleteSale.mock.calls[0][0].payments).toEqual([
      expect.objectContaining({ payment_method: 'cash', amount: 1 }),
      expect.objectContaining({ payment_method: 'airtel_money', amount: 2 }),
    ]);
  });

  it('disables checkout when split assignments differ from the payable total by one cent', () => {
    renderModal({ grandTotal: 10.01, netPayable: 10.01 });
    fireEvent.click(screen.getByRole('button', { name: 'Split payment' }));
    fireEvent.change(screen.getByLabelText('Tender 1 amount'), { target: { value: '9.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    fireEvent.change(screen.getByLabelText('Tender 2 amount'), { target: { value: '0.01' } });
    expect((screen.getByRole('button', { name: /Complete sale/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('MK 0.01')).toBeTruthy();
  });

  it('enforces the Starter two-tender cap while Growth can add unlimited tender rows', () => {
    const starter = renderModal({ grandTotal: 10, netPayable: 10, maxTenders: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Split payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    expect((screen.getByRole('button', { name: 'Add tender' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Starter supports up to 2 tenders/)).toBeTruthy();
    starter.unmount();

    renderModal({ grandTotal: 10, netPayable: 10, maxTenders: null });
    fireEvent.click(screen.getByRole('button', { name: 'Split payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    expect(screen.getByLabelText('Tender 3 amount')).toBeTruthy();
  });

  it('resets split rows and references when checkout is reopened', () => {
    const view = renderModal({ grandTotal: 15, netPayable: 15 });
    fireEvent.click(screen.getByRole('button', { name: 'Split payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tender' }));
    expect(screen.getByLabelText('Tender 2 amount')).toBeTruthy();
    view.rerender(
      <PosPaymentModal open={false} onClose={() => {}} grandTotal={15} onCompleteSale={view.onCompleteSale} maxTenders={2} />,
    );
    view.rerender(
      <PosPaymentModal open onClose={() => {}} grandTotal={15} onCompleteSale={view.onCompleteSale} maxTenders={2} />,
    );
    expect(screen.queryByLabelText('Tender 2 amount')).toBeNull();
    expect(screen.queryByText('Split payment breakdown')).toBeNull();
  });
});
