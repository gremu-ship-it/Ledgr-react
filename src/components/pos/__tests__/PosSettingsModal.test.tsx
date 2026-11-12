// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import type { PosSettings } from '@/types/pos';
import { PosSettingsModal } from '../PosSettingsModal';

afterEach(cleanup);

const settings = {
  business_id: 'biz-1',
  enabled_payment_methods: ['cash'],
  max_cashier_discount_percent: 10,
  cashier_max_discount_percent: 10,
  max_manager_discount_percent: 25,
  manager_max_discount_percent: 25,
} as PosSettings;

describe('POS discount threshold settings', () => {
  it('sends the configured values through the canonical database fields', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <PosSettingsModal
        open
        onClose={() => {}}
        settings={settings}
        onSaveSettings={onSaveSettings}
        isOwnerOrManager
        canConfigureDiscountThresholds
      />,
    );

    const thresholdInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(thresholdInputs[0], { target: { value: '18' } });
    fireEvent.change(thresholdInputs[1], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save POS Settings' }));

    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    expect(onSaveSettings.mock.calls[0][0]).toMatchObject({
      max_cashier_discount_percent: 18,
      cashier_max_discount_percent: 18,
      max_manager_discount_percent: 40,
      manager_max_discount_percent: 40,
    });
  });

  it('does not submit threshold fields when the plan gate is not available', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <PosSettingsModal
        open
        onClose={() => {}}
        settings={settings}
        onSaveSettings={onSaveSettings}
        isOwnerOrManager
        canConfigureDiscountThresholds={false}
      />,
    );

    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save POS Settings' }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    expect(onSaveSettings.mock.calls[0][0]).not.toHaveProperty('cashier_max_discount_percent');
    expect(onSaveSettings.mock.calls[0][0]).not.toHaveProperty('manager_max_discount_percent');
  });
});
