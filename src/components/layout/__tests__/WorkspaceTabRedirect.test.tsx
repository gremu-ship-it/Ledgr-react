// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { WorkspaceTabRedirect } from '../WorkspaceTabRedirect';

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/payroll"
          element={<WorkspaceTabRedirect basePath="/payroll" fallback="/payroll/employees" />}
        />
        <Route
          path="/banking"
          element={<WorkspaceTabRedirect basePath="/banking" fallback="/bank-reconciliation/accounts" />}
        />
        <Route path="/payroll/leave" element={<LocationProbe />} />
        <Route path="/payroll/pay-runs" element={<LocationProbe />} />
        <Route path="/cash-deposits" element={<LocationProbe />} />
        <Route path="/bank-reconciliation/accounts" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('WorkspaceTabRedirect', () => {
  it('resolves the leave tab to the canonical Leave screen', () => {
    renderAt('/payroll?tab=leave');
    expect(screen.getByTestId('location').textContent).toBe('/payroll/leave');
  });

  it('resolves the pay-runs tab to the canonical Pay Runs screen', () => {
    renderAt('/payroll?tab=payruns');
    expect(screen.getByTestId('location').textContent).toBe('/payroll/pay-runs');
  });

  it('resolves a banking tab and keeps the plain alias fallback', () => {
    renderAt('/banking?tab=deposits');
    expect(screen.getByTestId('location').textContent).toBe('/cash-deposits');
  });

  it('falls back to the first screen when no recognised tab is present', () => {
    renderAt('/banking');
    expect(screen.getByTestId('location').textContent).toBe('/bank-reconciliation/accounts');
  });
});
