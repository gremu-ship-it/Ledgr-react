// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const state = vi.hoisted(() => ({ allowed: true, calledWith: [] as unknown[][] }));
vi.mock('@/hooks/useCapability', () => ({
  useCapability: (...args: unknown[]) => {
    state.calledWith.push(args);
    return state.allowed;
  },
}));

import { CapabilityGate } from '../CapabilityGate';

afterEach(() => {
  cleanup();
  state.allowed = true;
  state.calledWith = [];
});

describe('organisation capability route gate', () => {
  it('renders the route content when the effective capability is available', () => {
    state.allowed = true;
    render(
      <MemoryRouter>
        <CapabilityGate capability="pos"><div>POS route content</div></CapabilityGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('POS route content')).toBeTruthy();
  });

  it('replaces direct-route content when the organisation capability is off', () => {
    state.allowed = false;
    render(
      <MemoryRouter>
        <CapabilityGate capability="pos"><div>POS route content</div></CapabilityGate>
      </MemoryRouter>,
    );
    expect(screen.queryByText('POS route content')).toBeNull();
    expect(screen.getByText('Point of Sale isn’t enabled for this business')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toBe('/support');
  });

  it('uses the concrete route path when shared capabilities cover multiple role routes', () => {
    render(
      <MemoryRouter>
        <CapabilityGate capability="inventory" rolePath="/warehouse">
          <div>Warehouse route content</div>
        </CapabilityGate>
      </MemoryRouter>,
    );
    expect(state.calledWith.at(-1)).toEqual(['inventory', '/warehouse']);
  });
});
