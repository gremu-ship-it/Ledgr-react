// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManufacturingDashboardRedirect } from '@/routes/ManufacturingDashboardRedirect';

const app = readFileSync('src/App.tsx', 'utf8');
const redirectSource = readFileSync('src/routes/ManufacturingDashboardRedirect.tsx', 'utf8');

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

describe('Manufacturing dashboard canonical route', () => {
  it('serves the dashboard at /manufacturing behind Enterprise and capability gates', () => {
    const start = app.indexOf('path="/manufacturing"');
    expect(start).toBeGreaterThanOrEqual(0);
    const route = app.slice(start, app.indexOf('/>', start));

    expect(route).toContain('PlanGate minPlan="enterprise"');
    expect(route).toContain('<CapabilityGate capability="manufacturing">');
    expect(route).toContain('<ManufacturingDashboardPage');
  });

  it('redirects the legacy URL to the canonical route', async () => {
    const aliasStart = app.indexOf('path="/manufacturing/dashboard"');
    expect(aliasStart).toBeGreaterThanOrEqual(0);
    const aliasRoute = app.slice(aliasStart, app.indexOf('/>', aliasStart));
    expect(aliasRoute).toContain('<ManufacturingDashboardRedirect');
    expect(redirectSource).toContain('<Navigate to="/manufacturing" replace />');

    render(
      <MemoryRouter initialEntries={['/manufacturing/dashboard']}>
        <Routes>
          <Route path="/manufacturing/dashboard" element={<ManufacturingDashboardRedirect />} />
          <Route path="/manufacturing" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/manufacturing');
    });
  });
});
