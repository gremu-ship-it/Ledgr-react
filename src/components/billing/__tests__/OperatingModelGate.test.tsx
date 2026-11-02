// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const state = vi.hoisted(() => ({ operatingModels: null as string[] | null }));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (value: { currentBusiness: unknown }) => unknown) =>
    selector({
      currentBusiness: state.operatingModels
        ? { business: { operating_models: state.operatingModels } }
        : null,
    }),
}));

import { OperatingModelGate } from '../OperatingModelGate';

function CurrentPath() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderPosRoute() {
  return render(
    <MemoryRouter initialEntries={['/pos']}>
      <Routes>
        <Route path="/pos" element={
          <OperatingModelGate requiredOperatingModels={['RETAIL']}>
            <p>POS surface</p>
          </OperatingModelGate>
        } />
        <Route path="/dashboard" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  state.operatingModels = null;
});

describe('OperatingModelGate', () => {
  it('renders the route only when RETAIL is selected', () => {
    state.operatingModels = ['RETAIL'];
    renderPosRoute();
    expect(screen.getByText('POS surface')).toBeTruthy();
  });

  it.each([null, [], ['CONSTRUCTION'], ['SERVICE_SALES']])(
    'redirects profiles without RETAIL to the dashboard (%s)',
    (operatingModels) => {
      state.operatingModels = operatingModels;
      renderPosRoute();
      expect(screen.queryByText('POS surface')).toBeNull();
      expect(screen.getByTestId('current-path').textContent).toBe('/dashboard');
    },
  );
});
