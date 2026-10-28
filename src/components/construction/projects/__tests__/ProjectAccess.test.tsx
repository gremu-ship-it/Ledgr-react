// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'node:fs';
import '@/i18n';
const state = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/hooks/useCapability', () => ({
  useCapability: () => state.allowed,
}));
import { CapabilityGate } from '@/components/billing/CapabilityGate';
afterEach(cleanup);
describe('project route capability boundary', () => {
  it('keeps both list and detail under the existing construction wildcard gate', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(
      /path="\/construction\/\*"[\s\S]*?<CapabilityGate capability="construction">[\s\S]*?<ConstructionWorkspacePage/,
    );
  });
  it.each(['/construction/projects', '/construction/projects/p1'])(
    'blocks direct %s access for a non-construction business',
    (path) => {
      state.allowed = false;
      render(
        <MemoryRouter initialEntries={[path]}>
          <CapabilityGate capability="construction">
            <p>Protected projects</p>
          </CapabilityGate>
        </MemoryRouter>,
      );
      expect(screen.queryByText('Protected projects')).toBeNull();
      expect(
        screen.getByRole('link', { name: 'Contact support' }),
      ).toBeTruthy();
    },
  );
  it('allows the project surface with the effective Enterprise construction capability', () => {
    state.allowed = true;
    render(
      <MemoryRouter>
        <CapabilityGate capability="construction">
          <p>Protected projects</p>
        </CapabilityGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('Protected projects')).toBeTruthy();
  });
});
