// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import type { PosCartItem } from '@/types/pos';
import { PosCart } from '../PosCart';

afterEach(cleanup);

const item: PosCartItem = {
  product_id: 'p1',
  name: 'Maize flour 2kg',
  quantity: 2,
  unit_price: 4500,
  line_total: 9000,
};

function renderCart() {
  const onUpdateQuantity = vi.fn();
  render(
    <PosCart
      items={[item]}
      selectedCustomer={null}
      customers={[]}
      onUpdateQuantity={onUpdateQuantity}
      onRemoveItem={vi.fn()}
      onClearCart={vi.fn()}
      onHoldOrder={vi.fn()}
      onSelectCustomer={vi.fn()}
    />,
  );
  return onUpdateQuantity;
}

describe('POS cart direct quantity input', () => {
  it('renders a numeric quantity field between the minus and plus controls', () => {
    renderCart();
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    expect(input.type).toBe('number');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('step')).toBe('1');
    expect(input.value).toBe('2');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeTruthy();
  });

  it('selects the existing quantity on focus and commits typed quantities', () => {
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    const onUpdateQuantity = renderCart();
    const input = screen.getByRole('spinbutton');

    fireEvent.focus(input);
    expect(select).toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '12' } });
    expect(onUpdateQuantity).toHaveBeenCalledWith('p1', 12);

    fireEvent.change(input, { target: { value: '0' } });
    expect(onUpdateQuantity).toHaveBeenCalledWith('p1', 1);

    fireEvent.blur(input, { target: { value: '7' } });
    expect(onUpdateQuantity).toHaveBeenCalledWith('p1', 7);
    select.mockRestore();
  });

  it('removes a line when minus is pressed at a quantity of one', () => {
    const onRemoveItem = vi.fn();
    const onUpdateQuantity = vi.fn();
    render(
      <PosCart
        items={[{ ...item, quantity: 1 }]}
        selectedCustomer={null}
        customers={[]}
        onUpdateQuantity={onUpdateQuantity}
        onRemoveItem={onRemoveItem}
        onClearCart={vi.fn()}
        onHoldOrder={vi.fn()}
        onSelectCustomer={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onRemoveItem).toHaveBeenCalledWith('p1');
    expect(onUpdateQuantity).not.toHaveBeenCalled();
  });

  it('keeps single-step adjustment on the surrounding buttons', () => {
    const onUpdateQuantity = renderCart();

    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onUpdateQuantity).toHaveBeenCalledWith('p1', 1);

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onUpdateQuantity).toHaveBeenCalledWith('p1', 3);
  });
});
