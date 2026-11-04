// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import type { OperatingModel } from '@/lib/capabilities/profile';
import { useBusinessProfile } from '../useBusinessProfile';
import { useDefaultRoute } from '../useDefaultRoute';
import { SmartRedirect } from '@/App';
import { CommandPalette } from '@/components/layout/CommandPalette';

vi.mock('@/lib/repositories', () => ({
  repos: {
    inventory: {
      findAllProducts: vi.fn().mockResolvedValue([]),
    },
  },
}));

function setActiveBusiness(operatingModels?: OperatingModel[] | null) {
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'Ledgr Test Co',
        base_currency: 'MWK',
        organisation_type: 'FOR_PROFIT',
        operating_models: operatingModels ?? null,
      },
    },
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAppStore.setState({
    currentBusiness: null,
    businesses: [],
  });
});

describe('useBusinessProfile', () => {
  it('returns null profile when no business is selected', () => {
    const { result } = renderHook(() => useBusinessProfile());
    expect(result.current.profile).toBeNull();
  });

  it('returns active business profile with operating_models as string[]', () => {
    setActiveBusiness(['CONSTRUCTION', 'MANUFACTURING']);
    const { result } = renderHook(() => useBusinessProfile());
    expect(result.current.profile?.operating_models).toEqual([
      'CONSTRUCTION',
      'MANUFACTURING',
    ]);
  });

  it('normalises absent operating_models to an empty array', () => {
    setActiveBusiness(null);
    const { result } = renderHook(() => useBusinessProfile());
    expect(result.current.profile?.operating_models).toEqual([]);
  });
});

describe('useDefaultRoute', () => {
  it('routes business with [CONSTRUCTION, MANUFACTURING] to /construction', () => {
    setActiveBusiness(['CONSTRUCTION', 'MANUFACTURING']);
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/construction');
  });

  it('prioritises CONSTRUCTION over MANUFACTURING regardless of array order', () => {
    setActiveBusiness(['MANUFACTURING', 'CONSTRUCTION']);
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/construction');
  });

  it('routes business with [MANUFACTURING] only to /manufacturing', () => {
    setActiveBusiness(['MANUFACTURING']);
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/manufacturing');
  });

  it('routes business with [RETAIL] only to /dashboard', () => {
    setActiveBusiness(['RETAIL']);
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/dashboard');
  });

  it('routes business with empty operating_models [] to /dashboard', () => {
    setActiveBusiness([]);
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/dashboard');
  });

  it('routes to /dashboard when no business profile is loaded', () => {
    const { result } = renderHook(() => useDefaultRoute());
    expect(result.current).toBe('/dashboard');
  });
});

describe('SmartRedirect and direct route navigation', () => {
  function renderRouter(initialEntry: string) {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/construction/*" element={<div>construction-page</div>} />
          <Route path="/manufacturing" element={<div>manufacturing-page</div>} />
          <Route path="/dashboard" element={<div>dashboard-page</div>} />
          <Route path="/" element={<SmartRedirect />} />
          <Route path="*" element={<SmartRedirect />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it.each([
    {
      label: '[CONSTRUCTION, MANUFACTURING]',
      models: ['CONSTRUCTION', 'MANUFACTURING'] as OperatingModel[],
      expectedPath: '/construction',
      expectedMarker: 'construction-page',
    },
    {
      label: '[MANUFACTURING] only',
      models: ['MANUFACTURING'] as OperatingModel[],
      expectedPath: '/manufacturing',
      expectedMarker: 'manufacturing-page',
    },
    {
      label: '[RETAIL] only',
      models: ['RETAIL'] as OperatingModel[],
      expectedPath: '/dashboard',
      expectedMarker: 'dashboard-page',
    },
    {
      label: 'no operating models',
      models: [] as OperatingModel[],
      expectedPath: '/dashboard',
      expectedMarker: 'dashboard-page',
    },
  ])('redirects / and unmatched routes for $label to $expectedPath', ({
    models,
    expectedPath,
    expectedMarker,
  }) => {
    setActiveBusiness(models);

    const { unmount } = renderRouter('/');
    expect(screen.getByTestId('pathname').textContent).toBe(expectedPath);
    expect(screen.getByText(expectedMarker)).toBeTruthy();
    unmount();

    renderRouter('/unknown-legacy-route');
    expect(screen.getByTestId('pathname').textContent).toBe(expectedPath);
    expect(screen.getByText(expectedMarker)).toBeTruthy();
  });

  it('preserves direct navigation to /dashboard, /construction, and /manufacturing regardless of vertical', () => {
    setActiveBusiness(['CONSTRUCTION', 'MANUFACTURING']);

    for (const [directPath, marker] of [
      ['/dashboard', 'dashboard-page'],
      ['/construction', 'construction-page'],
      ['/manufacturing', 'manufacturing-page'],
    ] as const) {
      const { unmount } = renderRouter(directPath);
      expect(screen.getByTestId('pathname').textContent).toBe(directPath);
      expect(screen.getByText(marker)).toBeTruthy();
      unmount();
    }
  });

  it('wires SmartRedirect on index and catch-all routes in App.tsx without altering vertical paths', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSource).toContain('path="/construction/*"');
    expect(appSource).toContain('path="/manufacturing"');
    expect(appSource).toContain('path="/dashboard"');
    expect(appSource).toContain('<SmartRedirect />');
  });
});

describe('CommandPalette vertical-aware business switch navigation', () => {
  it.each([
    {
      models: ['CONSTRUCTION', 'MANUFACTURING'] as OperatingModel[],
      expectedPath: '/construction',
    },
    {
      models: ['MANUFACTURING'] as OperatingModel[],
      expectedPath: '/manufacturing',
    },
    {
      models: ['RETAIL'] as OperatingModel[],
      expectedPath: '/dashboard',
    },
  ])('navigates to $expectedPath when switching business in CommandPalette', ({
    models,
    expectedPath,
  }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const targetMembership = {
      role: 'owner',
      business: {
        id: '20000000-0000-0000-0000-000000000002',
        name: 'Target Vertical Business',
        base_currency: 'MWK',
        organisation_type: 'FOR_PROFIT' as const,
        operating_models: models,
      },
    };

    useAppStore.setState({
      currentBusiness: targetMembership,
      businesses: [targetMembership],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings']}>
          <LocationProbe />
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent(window, new Event('ledgr:open-command-palette'));
    const input = screen.getByPlaceholderText(/Search products, pages, actions, or businesses/i);
    fireEvent.change(input, { target: { value: 'Target Vertical Business' } });
    fireEvent.click(screen.getByText('Switch to Target Vertical Business'));

    expect(screen.getByTestId('pathname').textContent).toBe(expectedPath);
  });
});
