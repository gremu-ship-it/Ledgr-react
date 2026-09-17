// @vitest-environment jsdom
/**
 * Demo session lifecycle: entering, using, resetting and leaving the demo.
 *
 * Runs in jsdom because the flag and the dataset live in localStorage, and
 * because it exercises the client facade in `src/lib/supabase.ts` — the piece
 * that decides whether the app talks to Supabase or to the seeded tables.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { enterDemoMode, exitDemoMode, isDemoUserEmail } from '@/lib/demo/session';
import { isDemoMode, setDemoMode } from '@/lib/demo/mode';
import {
  DEMO_BUSINESS_ID,
  DEMO_EMAIL,
  DEMO_RESET_AFTER_MS,
  DEMO_STATE_VERSION,
  DEMO_USER_ID,
  demoStateStorageKey,
} from '@/lib/demo/constants';
import { clearDemoData, getDemoState, resetDemoData } from '@/lib/demo/store';
import { DemoQueryBuilder } from '@/lib/demo/queryBuilder';
import type { DemoRow } from '@/lib/demo/dataset';

const firstBusiness = async (): Promise<DemoRow | null> => {
  const { data, error } = await supabase.from('businesses').select('*').eq('id', DEMO_BUSINESS_ID).maybeSingle();
  expect(error).toBeNull();
  return data as DemoRow | null;
};

beforeEach(async () => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
});

describe('demo mode flag', () => {
  it('is off by default, so a normal visitor never touches demo code paths', () => {
    expect(isDemoMode()).toBe(false);
  });

  it('persists across a page reload (same origin)', () => {
    setDemoMode(true);
    expect(window.localStorage.getItem('ledgr-demo-mode')).toBe('1');
    setDemoMode(false);
    expect(window.localStorage.getItem('ledgr-demo-mode')).toBeNull();
  });

  it('recognises the demo email for guardrails', () => {
    expect(isDemoUserEmail(DEMO_EMAIL)).toBe(true);
    expect(isDemoUserEmail('Demo@Ledgr.TEST')).toBe(true);
    expect(isDemoUserEmail('owner@realbusiness.mw')).toBe(false);
    expect(isDemoUserEmail(null)).toBe(false);
  });
});

describe('entering the demo', () => {
  it('signs the visitor in as demo@ledgr.test with no credentials', async () => {
    await enterDemoMode();

    expect(isDemoMode()).toBe(true);
    const { currentUser, businesses, currentBusiness, isAuthLoading, isBusinessesLoading } =
      useAppStore.getState();

    expect(currentUser?.id).toBe(DEMO_USER_ID);
    expect(currentUser?.email).toBe(DEMO_EMAIL);
    expect(isAuthLoading).toBe(false);
    expect(isBusinessesLoading).toBe(false);

    expect(businesses).toHaveLength(1);
    expect(businesses[0].role).toBe('owner');
    expect(currentBusiness?.business?.id).toBe(DEMO_BUSINESS_ID);
    expect(currentBusiness?.business?.name).toBeTruthy();
    expect(currentBusiness?.business?.base_currency).toBe('MWK');
  });

  it('serves the seeded books through the ordinary supabase client', async () => {
    await enterDemoMode();

    const business = await firstBusiness();
    expect(business?.name).toBeTruthy();
    expect(business?.plan_tier).toBe('pro');

    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('invoice_number, total_amount, contact:contacts(name)')
      .eq('business_id', DEMO_BUSINESS_ID)
      .order('issue_date', { ascending: false });

    expect(error).toBeNull();
    expect((invoices as DemoRow[]).length).toBeGreaterThan(10);
    expect((invoices as DemoRow[])[0].contact).toBeTruthy();
  });

  it('exposes a demo session to auth callers', async () => {
    await enterDemoMode();
    const { data } = await supabase.auth.getSession();
    expect(data.session?.user.email).toBe(DEMO_EMAIL);
    expect(data.session?.user.id).toBe(DEMO_USER_ID);
  });

  it('is idempotent — re-entering keeps one business and one user', async () => {
    await enterDemoMode();
    await enterDemoMode();
    const { businesses, currentUser } = useAppStore.getState();
    expect(businesses).toHaveLength(1);
    expect(currentUser?.email).toBe(DEMO_EMAIL);
  });
});

describe('using the demo', () => {
  it('records writes locally so a visitor can create documents', async () => {
    await enterDemoMode();

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({ business_id: DEMO_BUSINESS_ID, name: 'Demo Walk-in Customer', contact_type: 'customer', wht_exempt: false })
      .select('*')
      .single();

    expect(error).toBeNull();
    expect((created as DemoRow).name).toBe('Demo Walk-in Customer');

    const { data: found } = await supabase
      .from('contacts')
      .select('name')
      .eq('id', String((created as DemoRow).id))
      .maybeSingle();
    expect((found as DemoRow | null)?.name).toBe('Demo Walk-in Customer');
  });

  it('reserves document numbers through the RPC the repositories call', async () => {
    await enterDemoMode();

    const first = await supabase.rpc('reserve_next_document_number', {
      p_business_id: DEMO_BUSINESS_ID,
      p_kind: 'invoice',
    });
    const second = await supabase.rpc('reserve_next_document_number', {
      p_business_id: DEMO_BUSINESS_ID,
      p_kind: 'invoice',
    });

    expect(first.error).toBeNull();
    expect(String(first.data)).toMatch(/^INV-\d{4}$/);
    expect(Number(String(second.data).slice(4))).toBe(Number(String(first.data).slice(4)) + 1);
  });

  it('resets to pristine books, discarding what the visitor created', async () => {
    await enterDemoMode();

    await supabase
      .from('contacts')
      .insert({ business_id: DEMO_BUSINESS_ID, name: 'Temporary Contact', contact_type: 'customer', wht_exempt: false });

    const beforeReset = await supabase.from('contacts').select('id').eq('business_id', DEMO_BUSINESS_ID);
    const beforeCount = (beforeReset.data as DemoRow[]).length;

    resetDemoData();

    const afterReset = await supabase.from('contacts').select('id').eq('business_id', DEMO_BUSINESS_ID);
    expect((afterReset.data as DemoRow[]).length).toBe(beforeCount - 1);

    const { data: temporary } = await supabase
      .from('contacts')
      .select('id')
      .ilike('name', '%Temporary Contact%');
    expect(temporary).toEqual([]);
  });

  it('auto-reseeds once the snapshot is older than the reset window', async () => {
    await enterDemoMode();
    const stale = {
      version: DEMO_STATE_VERSION,
      seededAt: Date.now() - DEMO_RESET_AFTER_MS - 60_000,
      tables: { businesses: [], contacts: [] },
    };
    window.localStorage.setItem(demoStateStorageKey(), JSON.stringify(stale));
    clearDemoData(); // drop the in-memory copy so the store re-reads storage

    const state = getDemoState();
    expect(Date.now() - state.seededAt).toBeLessThan(60_000);
    expect((state.tables.businesses ?? []).length).toBe(1);
  });

  it('reseeds when the persisted snapshot was written by an older schema', async () => {
    await enterDemoMode();
    window.localStorage.setItem(
      demoStateStorageKey(),
      JSON.stringify({ version: DEMO_STATE_VERSION - 1, seededAt: Date.now(), tables: {} }),
    );
    clearDemoData();

    const state = getDemoState();
    expect(state.version).toBe(DEMO_STATE_VERSION);
    expect((state.tables.invoices ?? []).length).toBeGreaterThan(0);
  });
});

describe('leaving the demo', () => {
  it('clears the flag, the session and the cached queries', async () => {
    await enterDemoMode();
    expect(useAppStore.getState().currentUser?.email).toBe(DEMO_EMAIL);

    exitDemoMode();

    expect(isDemoMode()).toBe(false);
    const { currentUser, businesses, currentBusiness } = useAppStore.getState();
    expect(currentUser).toBeNull();
    expect(businesses).toEqual([]);
    expect(currentBusiness).toBeNull();
  });

  it('stops routing the client facade to the demo tables once the flag is off', async () => {
    await enterDemoMode();
    expect(supabase.from('businesses')).toBeInstanceOf(DemoQueryBuilder);

    exitDemoMode();
    // Back to the real Supabase client — the swap is per-call, so nothing
    // keeps a stale reference to the demo tables.
    expect(supabase.from('businesses')).not.toBeInstanceOf(DemoQueryBuilder);
  });

  it('signing out through the client leaves demo mode', async () => {
    await enterDemoMode();
    await supabase.auth.signOut();
    // signOut() exits demo mode through a dynamic import; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDemoMode()).toBe(false);
    expect(useAppStore.getState().currentUser).toBeNull();
  });

  it('keeps the demo snapshot for a return visit but never leaks it into a real session', async () => {
    await enterDemoMode();
    await supabase
      .from('contacts')
      .insert({ business_id: DEMO_BUSINESS_ID, name: 'Kept For Later', contact_type: 'customer', wht_exempt: false });

    exitDemoMode();
    expect(window.localStorage.getItem(demoStateStorageKey())).toBeTruthy();

    // Back in the demo, the visitor's work is still there…
    await enterDemoMode();
    const { data } = await supabase.from('contacts').select('name').ilike('name', '%Kept For Later%');
    expect((data as DemoRow[]).length).toBe(1);

    // …and leaving again removes the identity, so a real sign-in starts clean.
    exitDemoMode();
    expect(useAppStore.getState().currentUser).toBeNull();
    expect(isDemoMode()).toBe(false);
  });
});
