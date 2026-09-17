// @vitest-environment jsdom
/**
 * The landing page's link, end to end.
 *
 * `/demo/enter` is the whole promise of the demo: one click from an external
 * site, no credentials, and the visitor is inside the app. This renders the
 * real page (not a stub) and asserts where it lands, that the app store holds
 * a session afterwards, and that the `?to=` deep link cannot be turned into an
 * open redirect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DemoEntryPage } from '@/pages/DemoEntryPage';
import { useAppStore } from '@/store/useAppStore';
import { exitDemoMode } from '@/lib/demo/session';
import { isDemoMode } from '@/lib/demo/mode';
import { clearDemoData } from '@/lib/demo/store';
import { DEMO_BUSINESS_ID, DEMO_EMAIL, DEMO_USER_ID } from '@/lib/demo/constants';

function renderEntry(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/demo/enter" element={<DemoEntryPage />} />
        <Route path="/dashboard" element={<div>dashboard-rendered</div>} />
        <Route path="/invoices" element={<div>invoices-rendered</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// `globals: false` in vitest.config.ts, so React Testing Library's automatic
// teardown never registers. Without this, trees from earlier tests stay mounted
// and `findByText` matches several copies of the same stub route.
afterEach(cleanup);

beforeEach(() => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
  useAppStore.getState().reset();
});

describe('/demo/enter', () => {
  it('signs the visitor in and lands on the dashboard', async () => {
    renderEntry('/demo/enter');

    // The spinner shows while the engine chunk loads and the books are seeded.
    expect(await screen.findByText(/dashboard-rendered/i, {}, { timeout: 5000 })).toBeTruthy();

    expect(isDemoMode()).toBe(true);
    const { currentUser, businesses, currentBusiness, isAuthLoading } = useAppStore.getState();
    expect(currentUser?.email).toBe(DEMO_EMAIL);
    expect(currentUser?.id).toBe(DEMO_USER_ID);
    expect(businesses).toHaveLength(1);
    expect(currentBusiness?.business?.id).toBe(DEMO_BUSINESS_ID);
    // ProtectedRoute lets the app through only once both flags are false.
    expect(isAuthLoading).toBe(false);
    expect(useAppStore.getState().isBusinessesLoading).toBe(false);
  });

  it('honours a ?to= deep link from a campaign URL', async () => {
    renderEntry('/demo/enter?to=%2Finvoices&ref=instagram-bio');
    expect(await screen.findByText(/invoices-rendered/i, {}, { timeout: 5000 })).toBeTruthy();
    expect(isDemoMode()).toBe(true);
  });

  it('refuses to redirect off-site through ?to=', async () => {
    renderEntry('/demo/enter?to=https%3A%2F%2Fevil.example%2Fphish');
    // Falls back to the dashboard rather than following the external URL.
    expect(await screen.findByText(/dashboard-rendered/i, {}, { timeout: 5000 })).toBeTruthy();
  });

  it('refuses a protocol-relative ?to= target', async () => {
    renderEntry('/demo/enter?to=%2F%2Fevil.example%2Fphish');
    expect(await screen.findByText(/dashboard-rendered/i, {}, { timeout: 5000 })).toBeTruthy();
  });
});
