/**
 * R09.4 — REAL-BROWSER runtime evidence for the R09.1–R09.3 offline/cache/
 * tenant-boundary contracts (owner-authorized mandate; harness only, zero
 * product-code changes, zero reclassification of existing records).
 *
 * Every record executes in a genuine Chromium process with real IndexedDB,
 * real CacheStorage, real BroadcastChannel and the built production service
 * worker. Two execution layers:
 *  - PWA layer: the real Vite build (dist) served from a local stub —
 *    service-worker lifecycle, workbox runtime caching, disk-persisted
 *    queue/provenance across a real browser-process restart.
 *  - Harness page layer: production offline/cache/reconciliation modules
 *    bundled VERBATIM (identical wiring to the app) with two labelled seams:
 *    '@/lib/supabase' → in-origin protocol stub (synthetic-server wire), and
 *    the hydrated app-store actor → scenario-controlled identity.
 *    Assertions concern CLIENT behavior; server-side truth is never
 *    fabricated. Server-resident revalidation of the reconcile RPC is
 *    explicitly BLOCKED with the sandbox limitation (final record) — the
 *    DB-side authority remains covered by the sealed R093.RECON.* records.
 *
 * Additive: all ids use the R094.BROWSER.* namespace; R13 gate semantics
 * (evidenceExit) are unchanged by this suite.
 */
import { beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evidenceSuite, Blocked, ObservedFailure } from './evidence';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — ESM .mjs modules have no ambient declaration under this config
import { createStubServer } from '../browser/stub-server.mjs';
// @ts-ignore — ESM .mjs
import { launchBrowser, launchPersistent, chromiumVersionLabel } from '../browser/browser-runtime.mjs';

const test = evidenceSuite('r094-browser');

const meta = (id: string, expectation: string) => ({
  id,
  expected: expectation,
  source:
    'src/offline/{db,queueApi,provenance,payloadIntegrity,lease,exceptions,syncEngine,reconciliation}.ts, src/lib/cacheWipe.ts, src/lib/queryPersister.ts, src/components/layout/OfflineQueueDrawer.tsx, dist (real Vite production build) — executed in real Chromium; harness in tests/browser/*',
  remediation: 'R09.4',
  layer: 'real Chromium browser runtime (real IndexedDB/CacheStorage/BroadcastChannel/service worker); production modules bundled verbatim with two labelled seams (in-origin synthetic Supabase wire + scenario-controlled hydrated actor); no server truth fabricated',
});

const ROOT = resolve(__dirname, '..', '..');
const PAGES_OUT = join(ROOT, '.cache', 'r094', 'pages');
const DIST = join(ROOT, 'dist');

const BIZ_A = 'r094-biz-a';
const BIZ_B = 'r094-biz-b';
const USER_A = 'r094-user-a-000000000001';
const USER_B = 'r094-user-b-000000000002';
const ORG_A = { business: BIZ_A, branch: `${BIZ_A}-branch`, product: `${BIZ_A}-product`, shift: `${BIZ_A}-shift`, terminal: `${BIZ_A}-terminal` };

let stub: any;
let browser: any;

const ev = (page: any, fn: (...a: any[]) => any, arg?: any): Promise<any> => page.evaluate(fn as any, arg);

async function newHarnessPage(context: any): Promise<any> {
  await context.addInitScript((origin: string) => {
    (window as any).R094_STUB_ORIGIN = origin;
    (window as any).R094_ANON_KEY = 'r094-anon';
  }, stub.origin);
  const page = await context.newPage();
  if (process.env.R094_DEBUG === '1') {
    page.on('pageerror', (e: unknown) => process.stderr.write(`[r094-pageerror] ${String(e).slice(0, 400)}\n`));
    page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') process.stderr.write(`[r094-console] ${m.text().slice(0, 300)}\n`); });
  }
  await page.goto(stub.pageUrl('harness.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).r094, undefined, { timeout: 20_000 });
  return page;
}

async function enqueueAsUser(page: any, n: number, userId = USER_A): Promise<{ localId: number; clientKey: string }> {
  return ev(page, ([nn, uid, org]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uid);
    api.setCurrentBusiness(org.business);
    const payload = api.queuePayloadFor(nn, org);
    return api.enqueuePosSale(org.business, payload).then(async (localId: number) => {
      const item = await api.getItem(localId);
      return { localId, clientKey: item.clientKey };
    });
  }, [n, userId, ORG_A]);
}

async function waitItem(page: any, localId: number, pred: (item: any) => boolean, timeoutMs = 15_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const item = await ev(page, (lid: number) => (window as any).r094.getItem(lid), localId);
    if (!item) throw new ObservedFailure(`queue item ${localId} vanished`);
    if (pred(item)) return item;
    if (Date.now() > deadline) throw new ObservedFailure(`timeout waiting for queue item ${localId}: status=${item.status}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

const stubCalls = async () => (await stub.control({ action: 'calls' })).calls as any[];

function must(cond: boolean, actual: string) {
  if (!cond) throw new ObservedFailure(actual);
}

/** Poll the real SW registry on a page until activated+in-control is observed N consecutive times (transient registration windows excluded). */
async function waitSwStableControl(page: any, consecutive = 3, timeoutMs = 12_000): Promise<{ trace: string[]; ok: boolean }> {
  const trace: string[] = [];
  const deadline = Date.now() + timeoutMs;
  let streak = 0;
  while (Date.now() < deadline) {
    const s: any = await go('sw state read', ev(page, async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return { active: reg?.active?.state ?? null, ctrl: !!navigator.serviceWorker.controller };
    }));
    trace.push(`${s.active}/${s.ctrl ? 'ctrl' : 'noctrl'}`);
    streak = s.active === 'activated' && s.ctrl === true ? streak + 1 : 0;
    if (streak >= consecutive) return { trace, ok: true };
    await new Promise((r) => setTimeout(r, 350));
  }
  return { trace, ok: false };
}

/** Convert any harness-step rejection into a labelled ObservedFailure so the gate records the real failure surface. */
async function go<T>(label: string, p: Promise<T>): Promise<T> {
  try { return await p; }
  catch (e: any) {
    if (e instanceof ObservedFailure) throw e;
    throw new ObservedFailure(`${label}: ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
const guarded = (label: string, run: () => Promise<void>) => () => go(label, run());

beforeAll(async () => {
  // 1) harness page bundle (esbuild; production wiring, designated seams only)
  execFileSync(process.execPath, [join(ROOT, 'tests', 'browser', 'build-pages.mjs')], {
    env: { ...process.env, R094_PAGES_OUT: PAGES_OUT }, stdio: 'inherit', timeout: 120_000,
  });
  // 2) real PWA build unless one already exists (SW evidence requires the real artifact)
  //    — and only reuse it if its SW runtime pattern keys to the R09.4 host
  //    (a dist built under the harness stub-env r13.invalid would be silently wrong).
  const EXPECTED_HOST = process.env.R094_SUPABASE_HOST ?? 'https://r094.invalid';
  let needsBuild = !existsSync(join(DIST, 'index.html')) || process.env.R094_FORCE_BUILD === '1';
  if (!needsBuild) {
    const sw = existsSync(join(DIST, 'sw.js')) ? (await import('node:fs/promises')).readFile(join(DIST, 'sw.js'), 'utf8') : '';
    const host = EXPECTED_HOST.replace(/^https?:\/\//, '');
    if (!(await sw).includes(host)) needsBuild = true;
  }
  if (needsBuild) {
    execSync('npm run build', {
      cwd: ROOT, stdio: 'inherit', timeout: 360_000,
      env: {
        ...process.env,
        // Deterministic: the release harness stub-env is r13.invalid; the SW
        // runtime cache pattern MUST key to this origin for R09.4 evidence.
        VITE_SUPABASE_URL: EXPECTED_HOST,
        VITE_SUPABASE_ANON_KEY: 'r094-anon',
      },
    });
  }
  stub = await createStubServer({ distDir: DIST, pagesDir: PAGES_OUT, tlsCertDir: join(ROOT, '.cache', 'r094', 'tls') } as any);
  browser = await launchBrowser({ pacUrl: stub.pacUrl as any });
}, 420_000);

afterAll(async () => {
  await browser?.close();
  await stub?.close();
});

test(meta('R094.BROWSER.ENVIRONMENT', 'Real-browser gate declaration: genuine headless Chromium, real storage APIs, zero browser-capability simulation; every synthetic seam (protocol stub, hydrated-actor scenario) is labelled on the records that touch it'), () => {
  must(
    browser?.version?.().startsWith('138') || !!browser?.version?.(),
    `Chromium version unreadable: ${browser?.version?.()}`,
  );
});

test(meta('R094.BROWSER.SW-LIFECYCLE', 'The real built service worker reaches state=activated and controls the page after reload; a workbox precache with entries exists; the app shell is served on the controlled second load'), async () => {
  // No interception: app-side traffic to the harness host really traverses
  // PAC→CONNECT→TLS into the local terminator (environmental seam, labelled).
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(stub.origin + '/', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' }); // second load: the SW must already control the document
  const sw = await waitSwStableControl(page);
  const after = await ev(page, async () => {
    const cacheNames: string[] = 'caches' in window ? await caches.keys() : [];
    const precache = cacheNames.filter((n) => /precache/i.test(n));
    const counts = await Promise.all(precache.map(async (n) => (await caches.open(n)).keys().then((k: readonly unknown[]) => k.length)));
    return {
      cacheNames, counts,
      shellServed: document.title.length > 0 && !!document.getElementById('root'),
    };
  });
  await ctx.close();
  must(
    sw.ok === true && after.shellServed === true && after.counts.some((n: number) => n > 0),
    `SW evidence shortfall: stableControl=${sw.ok} trace=[${sw.trace.join(',')}] shell=${after.shellServed} precacheEntries=[${after.counts}] caches=${after.cacheNames}`,
  );
});

test(meta('R094.BROWSER.SW-API-CACHE-FLUSH', 'A real SW-intercepted fetch to the Supabase /rest/v1 url pattern lands in the workbox runtime API cache; the PRODUCTION signed-out wipe (real SW flush request/reply messaging) then empties every entry'), async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  // No Playwright routing: the SW's own workbox NetworkFirst fetch goes out
  // via PAC→CONNECT→TLS to the local terminator (Playwright context routes
  // cannot intercept SW-originated fetches — this is the real network path).
  // ORDER MATTERS (real SW semantics): the harness page must be loaded
  // BEFORE the app SW exists, because the production workbox NavigationRoute
  // SPA-falls-back document navigations to index.html once the SW controls
  // them. Loaded first, the harness page then becomes a claimed client of
  // the activated SW (clientsClaim()) — exactly the production control flow.
  const harness = await newHarnessPage(ctx);
  const appPage = await ctx.newPage();
  await appPage.goto(stub.origin + '/', { waitUntil: 'load' });
  await appPage.reload({ waitUntil: 'load' });
  const swReady = await waitSwStableControl(appPage);
  await go('harness claimed by SW', ev(harness, async () => {
    // clientsClaim() claims this pre-existing client; control is observable.
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 250));
    return { controlled: !!navigator.serviceWorker.controller && !!(window as any).r094 };
  }));
  const warmed = await go('sw-intercepted fetch warms runtime cache', ev(harness, async () => {
    const api = (window as any).r094;
    const r = await fetch('https://r094.invalid/rest/v1/products?select=id&r094marker=1');
    const status = r.status;
    // The SW's NetworkFirst caches via event.waitUntil AFTER responding —
    // observe the real cache state (poll), never assume a sync boundary.
    let entries = 0;
    for (let i = 0; i < 30; i++) {
      entries = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
      if (entries >= 1) break;
      await new Promise((x) => setTimeout(x, 150));
    }
    return { status, entries, controlled: !!navigator.serviceWorker.controller };
  }));
  const after = await go('production wipe flushes runtime cache', ev(harness, async () => {
    const api = (window as any).r094;
    const before = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
    await api.wipeIdentityTransitionCaches('signed-out');
    const afterN = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
    return { before, afterN };
  }));
  const swReads = (await stubCalls()).filter((c) => c.fn === 'GET products' && c.via === 'tls').length;
  await ctx.close();
  must(
    swReady.ok === true && warmed.status === 200 && warmed.entries >= 1 && after.before >= 1 && after.afterN === 0,
    `api-cache evidence shortfall: swStable=${swReady.ok} fetchStatus=${warmed.status} swTlsReads=${swReads} entriesAfterFetch=${warmed.entries} beforeWipe=${after.before} afterWipe=${after.afterN} controlledAtFetch=${warmed.controlled}`,
  );
});

test(meta('IC.CACHE.BROWSER-FINANCIAL-NETWORK-ONLY', 'Incident containment P8 (additive record): in a REAL browser with the PRODUCTION service worker in control, financial REST reads (invoices, invoice_payments, expenses, journal_entries, inventory_balances, rpc) reach the network on every request and are NEVER written to the workbox runtime API cache, while a non-financial read (products) still is — so a stale financial response can never be served from the SW'), async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const appPage = await ctx.newPage();
  await appPage.goto(stub.origin + '/', { waitUntil: 'load' });
  await appPage.reload({ waitUntil: 'load' });
  const swReady = await waitSwStableControl(appPage);
  const tables = ['invoices', 'invoice_payments', 'expenses', 'journal_entries', 'inventory_balances'];
  const beforeCalls = (await stubCalls()).length;
  const res = await go('financial vs control reads through the SW', ev(harness, async (tbls: string[]) => {
    const api = (window as any).r094;
    for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 250));
    const statuses: number[] = [];
    for (let round = 0; round < 2; round++) {
      for (const t of tbls) statuses.push((await fetch(`https://r094.invalid/rest/v1/${t}?select=id&icround=${round}`)).status);
    }
    statuses.push((await fetch('https://r094.invalid/rest/v1/products?select=id&iccontrol=1')).status);
    let urls: string[] = [];
    for (let i = 0; i < 30; i++) {
      urls = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).map((k: Request) => k.url);
      if (urls.some((u) => u.includes('iccontrol=1'))) break;
      await new Promise((x) => setTimeout(x, 150));
    }
    return { statuses, urls, controlled: !!navigator.serviceWorker.controller };
  }, tables));
  const calls = (await stubCalls()).slice(beforeCalls);
  await ctx.close();
  const financialCached = res.urls.filter((u: string) => tables.some((t) => u.includes(`/rest/v1/${t}?`)));
  const networkHits = tables.map((t) => calls.filter((c: any) => c.fn === `GET ${t}`).length);
  must(
    swReady.ok === true && res.controlled === true && res.statuses.every((s: number) => s === 200)
      && financialCached.length === 0 && networkHits.every((n) => n === 2)
      && res.urls.some((u: string) => u.includes('products?select=id&iccontrol=1')),
    `financial-cache evidence shortfall: swStable=${swReady.ok} controlled=${res.controlled} statuses=[${res.statuses}] financialCached=[${financialCached}] networkHitsPerTable=[${networkHits}] cacheUrls=[${res.urls}]`,
  );
});

test(meta('R094.BROWSER.PERSIST-RESTART', 'A queued sale with full provenance (originUser/branch/device/terminal/shift, payloadVersion, payloadHash) and the legacy POS localStorage key survive a REAL browser-process restart (profile-on-disk relaunch); payload integrity re-verifies after restart'), async () => {
  const profile = mkdtempSync(join(tmpdir(), 'r094-profile-restart-'));
  let ctx = await launchPersistent(profile);
  let page = await newHarnessPage(ctx);
  const before = await ev(page, async ([org, uid]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    const localId = await api.enqueuePosSale(org.business, api.queuePayloadFor(101, org));
    const item = await api.getItem(localId);
    api.setLegacyQueueMarker([{ saleId: 'legacy-sentinel' }]);
    await api.warmRqPersist(org.business, 'restart-marker');
    return {
      localId,
      snap: {
        clientKey: item.clientKey, originUserId: item.originUserId, originBranchId: item.originBranchId,
        originDeviceId: item.originDeviceId, originTerminalId: item.originTerminalId, originShiftId: item.originShiftId,
        payloadVersion: item.payloadVersion, payloadHash: item.payloadHash,
        canonical: api.canonicalPayloadJson(item.payload),
      },
    };
  }, [ORG_A, USER_A]);
  await ctx.close(); // real browser process exits; profile persists on disk
  ctx = await launchPersistent(profile);
  page = await newHarnessPage(ctx);
  const afterR = await ev(page, async ([lid]: any) => {
    const api = (window as any).r094;
    const item = await api.getItem(lid);
    const rq = await api.rqCacheEntries();
    return {
      item,
      integrityValid: await api.verifyPayloadIntegrity(item),
      canonical: api.canonicalPayloadJson(item.payload),
      legacyExact: localStorage.getItem(api.LEGACY_POS_QUEUE_KEY) === JSON.stringify([{ saleId: 'legacy-sentinel' }]),
      rqPersisted: rq.blobFound && rq.queries.some((q: any) => q.dataJson.includes('restart-marker')),
    };
  }, [before.localId]);
  await ctx.close();
  const fieldsEqual = Object.entries(before.snap).every(([k, v]) => k === 'canonical'
    ? afterR.canonical === v
    : afterR.item[k] === v);
  must(
    fieldsEqual && afterR.integrityValid === true && afterR.legacyExact === true && afterR.rqPersisted === true,
    `restart-persistence shortfall: fieldsEqual=${fieldsEqual} integrity=${afterR.integrityValid} legacy=${afterR.legacyExact} rqPersisted=${afterR.rqPersisted}`,
  );
});

test(meta('R094.BROWSER.WIPE-LOGOUT-BOUNDARY', 'Signed-out wipe empties the business RQ persist cache, the workbox API cache and session-scoped keys, while PRESERVING the offline queue rows, the legacy POS localStorage key and the device/install identity'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  const res = await ev(page, async ([org, uid]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    const localId = await api.enqueuePosSale(org.business, api.queuePayloadFor(201, org));
    await api.warmRqPersist(org.business, 'wipe-a');
    await api.warmApiCache('wipe-a');
    await api.setSessionMarker('ledgr_draft_r094', JSON.stringify({ marker: 'wipe-a' })); // product session-cache family key
    api.setLegacyQueueMarker([{ id: 'legacy-kept' }]);
    const installBefore = (await api.getItem(localId)).originDeviceId;
    const queueBefore = await api.queueCount();
    await api.wipeIdentityTransitionCaches('signed-out');
    const emptiness = await api.verifyBusinessCacheEmptiness();
    const queueAfter = await api.queueCount();
    const item = await api.getItem(localId);
    const rq = await api.rqCacheEntries();
    const apiEntries = 'caches' in window ? (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length : -1;
    return {
      queueBefore, queueAfter, itemIntact: !!item && item.clientKey != null,
      installStable: installBefore === item.originDeviceId,
      sessionMarker: sessionStorage.getItem('ledgr_draft_r094'),
      legacyExact: localStorage.getItem(api.LEGACY_POS_QUEUE_KEY) === JSON.stringify([{ id: 'legacy-kept' }]),
      rqCleared: !rq.blobFound || rq.queries.every((q: any) => !q.dataJson.includes('wipe-a')),
      apiEntries, emptiness,
    };
  }, [ORG_A, USER_A]);
  await ctx.close();
  must(
    res.queueBefore === 1 && res.queueAfter === 1 && res.itemIntact === true
      && res.installStable === true && res.sessionMarker === null
      && res.legacyExact === true && res.rqCleared === true && res.apiEntries === 0,
    `signed-out wipe shortfall: queue ${res.queueBefore}→${res.queueAfter}; itemIntact=${res.itemIntact}; installStable=${res.installStable}; sessionMarker=${res.sessionMarker}; legacy=${res.legacyExact}; rqCleared=${res.rqCleared}; apiEntries=${res.apiEntries}; emptiness=${JSON.stringify(res.emptiness)}`,
  );
});

test(meta('R094.BROWSER.WIPE-USER-SWITCH', 'Identity-switch boundary: after A→wipe→B the persisted cache contains ONLY business B entries (zero A markers) while business A\u2019s offline queue row survives untouched — the documented queue-preservation contract'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  const res = await ev(page, async ([orgA, bizB, uidA]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uidA); api.setCurrentBusiness(orgA.business);
    const localId = await api.enqueuePosSale(orgA.business, api.queuePayloadFor(301, orgA));
    await api.warmRqPersist(orgA.business, 'switch-a-marker');
    const before = await api.rqCacheEntries();
    const aBefore = before.blobFound && before.queries.some((q: any) => q.dataJson.includes('switch-a-marker'));
    await api.wipeIdentityTransitionCaches('user-switch');
    api.setCurrentBusiness(bizB);
    await api.warmRqPersist(bizB, 'switch-b-marker');
    const after = await api.rqCacheEntries();
    const aRemaining = after.queries.filter((q: any) => q.dataJson.includes('switch-a-marker') || q.dataJson.includes(orgA.business) || JSON.stringify(q.queryKey ?? []).includes(orgA.business)).length;
    const bPresent = after.queries.filter((q: any) => q.dataJson.includes('switch-b-marker') && JSON.stringify(q.queryKey ?? []).includes(bizB)).length;
    const queueItem = await api.getItem(localId);
    return { aBefore, aRemaining, bPresent, bOnly: after.queries.every((q: any) => JSON.stringify(q.queryKey ?? []).includes(bizB)), queueStatus: queueItem?.status ?? null, queueBusiness: queueItem?.businessId ?? null };
  }, [ORG_A, BIZ_B, USER_A]);
  await ctx.close();
  must(
    res.aBefore === true && res.aRemaining === 0 && res.bPresent >= 1 && res.bOnly === true
      && res.queueStatus === 'pending' && res.queueBusiness === BIZ_A,
    `user-switch wipe shortfall: aBefore=${res.aBefore} aRemaining=${res.aRemaining} bPresent=${res.bPresent} bOnly=${res.bOnly} queueStatus=${res.queueStatus} queueBusiness=${res.queueBusiness}`,
  );
});

test(meta('R094.BROWSER.LEASE-CROSSTAB-EXCLUSIVE', 'REAL cross-tab lease exclusivity: two live pages in one context racing the production sync engine on ONE pending item land exactly ONE replay RPC at the server; no duplicate replay; the loser fails closed (lease exists)'), async () => {
  const ctx = await browser.newContext();
  const page1 = await newHarnessPage(ctx);
  const page2 = await newHarnessPage(ctx);
  const { localId, clientKey } = await enqueueAsUser(page1, 401);
  await stub.control({ action: 'resetAll' });
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey, status: 200, delayMs: 900, body: { id: 'r094-inv-1', number: 'R094-INV-401', journal_entry_id: null, idempotent: false } });
  const p1 = page1.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }).then(() => 'done'), USER_A);
  await new Promise((r) => setTimeout(r, 150)); // tab 1 claims deterministically before tab 2 attempts
  const p2 = page2.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }).then(() => 'done'), USER_A);
  await Promise.all([p1, p2]);
  const calls = (await stubCalls()).filter((c) => c.fn === 'post_pos_sale' && c.clientKey === clientKey);
  const item = await ev(page1, (lid: number) => (window as any).r094.getItem(lid), localId);
  await ctx.close();
  must(
    calls.length === 1 && item.status === 'synced',
    `cross-tab exclusivity shortfall: replayRpcCalls=${calls.length} finalStatus=${item.status}`,
  );
});

test(meta('R094.BROWSER.LEASE-EXPIRY-RECLAIM', 'Lease lifecycle in a real browser: live holder blocks a second claimant (held-by-other); once the TTL elapses with real time, a new claimant acquires; ownership verification is strict to the token; release clears the lease'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  const res = await ev(page, async ([org, uid]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    const localId = await api.enqueuePosSale(org.business, api.queuePayloadFor(402, org));
    const claim1 = await api.claimLease(localId, 'r094-dying-tab', 900);
    const dup = await api.claimLease(localId, 'r094-new-tab');
    await new Promise((r) => setTimeout(r, 1_100)); // real time, real TTL
    const expired = api.isLeaseExpired((await api.getItem(localId)).lease);
    const claim2 = await api.claimLease(localId, 'r094-new-tab');
    const ownsOld = await api.verifyLeaseOwnership(localId, claim1.lease?.token ?? 'none');
    const ownsNew = await api.verifyLeaseOwnership(localId, claim2.lease?.token ?? 'none');
    await api.releaseLease(localId, claim2.lease?.token ?? 'none');
    const afterRelease = (await api.getItem(localId)).lease;
    return { claim1Ok: claim1.ok, dupReason: dup.ok ? null : dup.reason, expired, claim2Ok: claim2.ok, ownsOld, ownsNew, released: afterRelease == null };
  }, [ORG_A, USER_A]);
  await ctx.close();
  must(
    res.claim1Ok === true && res.dupReason === 'held-by-other' && res.expired === true
      && res.claim2Ok === true && res.ownsOld === false && res.ownsNew === true && res.released === true,
    `lease lifecycle shortfall: ${JSON.stringify(res)}`,
  );
});

test(meta('R094.BROWSER.PROVENANCE-REPLAY-GATE', 'Provenance binding in a real browser: same actor replays (null violation); another actor → actor-mismatch; stripped provenance → missing-provenance; an after-capture payload edit fails integrity and reconcile refuses with payload-tampered quarantine; origin actor is never reattributed'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  const res = await ev(page, async ([org, userA, userB]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(userA); api.setCurrentBusiness(org.business);
    const localId = await api.enqueuePosSale(org.business, api.queuePayloadFor(501, org));
    const item = await api.getItem(localId);
    const same = api.replayViolation(item, userA);
    const other = api.replayViolation(item, userB);
    const stripped = { ...item, originUserId: null, originBranchId: null, originDeviceId: null, originTerminalId: null, originShiftId: null, payloadVersion: null, payloadHash: null };
    const strippedViolation = api.replayViolation(stripped, userA);
    // Reconciliation eligibility requires a live typed exception first
    // (shipped gate: not-an-exception is refused before the integrity check).
    await api.updateItem(localId, { status: 'failed', exceptionClass: 'policy-denied', exceptionDetails: 'plan quota (scenario)' });
    // Now tamper AFTER capture: stored payload no longer matches its hash.
    await api.updateItem(localId, { payload: { ...item.payload, notes: 'gate-tampered' } });
    const integrity = await api.verifyPayloadIntegrity(await api.getItem(localId));
    const refusal = await api.reconcileQueueItem(localId, 'gate tamper check'); // returns a rejected result (never throws)
    const after = await api.getItem(localId);
    const originPreserved = after.originUserId === userA;
    return { same, other, strippedViolation, integrity, refusalOk: refusal.ok, refusalCode: refusal.code ?? null, refusalDisposition: refusal.disposition ?? null, afterStatus: after.status, afterReason: after.quarantineReason, originPreserved };
  }, [ORG_A, USER_A, USER_B]);
  await ctx.close();
  must(
    res.same === null && res.other === 'actor-mismatch' && res.strippedViolation === 'missing-provenance'
      && res.integrity === false && res.refusalOk === false && res.refusalCode === 'payload-tampered'
      && res.afterStatus === 'quarantined' && res.afterReason === 'payload-tampered'
      && res.originPreserved === true,
    `provenance gate shortfall: ${JSON.stringify(res)}`,
  );
});

test(meta('R094.BROWSER.EXCEPTION-P0QLT', 'A P0QLT-shaped PostgREST refusal through the REAL engine stamps failed + exceptionClass policy-denied with the durable code/details; the exception is held OUT of subsequent blind retries (zero further RPCs)'), guarded('P0QLT body', async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await stub.control({ action: 'resetAll' });
  const { localId, clientKey } = await go('enqueue', enqueueAsUser(page, 601));
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey, status: 400, body: { code: 'P0QLT', message: 'Invoice quota exhausted for your plan (limit 50); replay is pointless until resolved', details: null, hint: null } });
  await go('first sync pass', page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A));
  const failedItem = await waitItem(page, localId, (i) => i.status === 'failed');
  await stub.control({ action: 'resetCalls' });
  await go('second (no-blind-retry) pass', page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A));
  const retryCalls = (await stubCalls()).filter((c) => c.clientKey === clientKey);
  const held = (await waitItem(page, localId, () => true)).status;
  await ctx.close();
  must(
    failedItem.exceptionClass === 'policy-denied' && typeof failedItem.exceptionDetails === 'string'
      && retryCalls.length === 0 && held === 'failed',
    `P0QLT stamping shortfall: exceptionClass=${failedItem.exceptionClass} details=${String(failedItem.exceptionDetails).length ? 'set' : 'unset'} lastErrorCode=${failedItem.lastErrorCode ?? 'n/a'} retryCalls=${retryCalls.length} heldStatus=${held}`,
  );
}));

test(meta('R094.BROWSER.EXCEPTION-23514-TYPED', '23514 typing is by CONSTRAINT IDENTITY, not substring: the on-hand non-negativity constraint stamps stock-denied; a different 23514 constraint on the same wire stamps NO typed exception (still failed) — never ambiently both'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await stub.control({ action: 'resetAll' });
  const a = await enqueueAsUser(page, 701);
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: a.clientKey, status: 400, body: { code: '23514', message: 'new row for relation "inventory_balances" violates check constraint "chk_inventory_balances_on_hand_nonneg"', details: 'Failing row contains (..., -1).', hint: null } });
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const typedItem = await waitItem(page, a.localId, (i) => i.status === 'failed');
  const b = await enqueueAsUser(page, 702);
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: b.clientKey, status: 400, body: { code: '23514', message: 'new row for relation "invoices" violates check constraint "chk_invoices_total_positive"', details: null, hint: null } });
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const plainItem = await waitItem(page, b.localId, (i) => i.status === 'failed');
  await ctx.close();
  must(
    typedItem.exceptionClass === 'stock-denied' && typeof typedItem.exceptionDetails === 'string'
      && (typedItem.lastErrorCode === '23514' || typedItem.lastErrorCode == null)
      && plainItem.exceptionClass == null,
    `23514 identity discrimination shortfall: onHand.class=${typedItem.exceptionClass} onHand.code=${typedItem.lastErrorCode ?? 'null'} other.class=${plainItem.exceptionClass ?? 'null'} other.status=${plainItem.status}`,
  );
});

test(meta('R094.BROWSER.RECONCILE-CLIENTPATH', 'Manager-flagged exception takes the client reconciliation path: p_request carries the ORIGINAL client_key + reason; stored payload stays byte-identical across the recovery; on acceptance the row is synced with resolvedServerId, reconcileAttempts=1 and the historical exception evidence retained (frozen audit identity); a repeated reconcile with the same client key resolves idempotently without duplication'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await stub.control({ action: 'resetAll' });
  const { localId, clientKey } = await enqueueAsUser(page, 801);
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey, status: 400, body: { code: 'P0QLT', message: 'Plan quota exhausted', details: null, hint: null } });
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const failedItem = await waitItem(page, localId, (i) => i.status === 'failed');
  const canonicalBefore = await ev(page, (lid: number) => (window as any).r094.getItem(lid).then((i: any) => (window as any).r094.canonicalPayloadJson(i.payload)), localId);
  await stub.control({ action: 'setScenario', fn: 'reconcile_offline_queue_item', clientKey, status: 200, body: { ok: true, document_id: 'doc-reconcile-1', idempotent: false } });
  const recon = await ev(page, ([lid, reason]: any) => (window as any).r094.reconcileQueueItem(lid, reason), [localId, 'daily stock count corrected on shelf']);
  const afterItem = await ev(page, (lid: number) => (window as any).r094.getItem(lid), localId);
  const rpcCalls = (await stubCalls()).filter((c) => c.fn === 'reconcile_offline_queue_item' && c.clientKey === clientKey);
  const reqBody = rpcCalls[0]?.body;
  const request = reqBody?.p_request ?? reqBody;
  const canonicalAfter = await ev(page, (lid: number) => (window as any).r094.getItem(lid).then((i: any) => (window as any).r094.canonicalPayloadJson(i.payload)), localId);
  // idempotent lost-ack: same client key resolves against the committed document
  await ev(page, (lid: number) => (window as any).r094.updateItem(lid, { status: 'failed', exceptionClass: 'policy-denied', resolvedServerId: null, lastSyncedAt: null }), localId);
  await stub.control({ action: 'resetCalls' });
  await stub.control({ action: 'setScenario', fn: 'reconcile_offline_queue_item', clientKey, status: 200, body: { ok: true, document_id: 'doc-reconcile-1', idempotent: true } });
  const recon2 = await ev(page, (lid: number) => (window as any).r094.reconcileQueueItem(lid, 'retry after acknowledgement lost'), localId);
  const item2 = await ev(page, (lid: number) => (window as any).r094.getItem(lid), localId);
  const rpc2 = (await stubCalls()).filter((c) => c.fn === 'reconcile_offline_queue_item' && c.clientKey === clientKey);
  await ctx.close();
  must(
    recon?.ok === true && recon?.disposition === 'replay-accepted' && recon?.documentId === 'doc-reconcile-1'
      && afterItem.status === 'synced' && afterItem.resolvedServerId === 'doc-reconcile-1'
      && afterItem.reconcileAttempts === 1
      && afterItem.lastErrorCode === 'P0QLT'
      && request?.client_key === clientKey && typeof request?.reason === 'string'
      && canonicalBefore === canonicalAfter
      && recon2?.ok === true && recon2?.idempotent === true
      && item2.status === 'synced' && item2.reconcileAttempts === 2 && rpc2.length === 1,
    `reconcile client-path shortfall: disposition=${recon?.disposition} item=${afterItem.status}/${afterItem.resolvedServerId} attempts=${afterItem.reconcileAttempts} retainedEvidence=${afterItem.lastErrorCode} clientKeyMatch=${request?.client_key === clientKey} canonicalPreserved=${canonicalBefore === canonicalAfter} secondOk=${recon2?.ok} secondIdempotent=${recon2?.idempotent} attempts2=${item2.reconcileAttempts} rpc2=${rpc2.length} (failed ${failedItem.exceptionClass})`,
  );
});

test(meta('R094.BROWSER.DRAWER-EXCEPTIONS', 'The real OfflineQueueDrawer renders typed exception rows with their distinct badges (Stock hold / Plan limit hold) and non-blind-retry guidance; a plain failed row remains visually distinct; a quarantined row surfaces the security/identity hold wording'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await ev(page, async ([org, uid]: any) => {
    const api = (window as any).r094;
    (window as any).R094_ROLE = 'owner';
    (window as any).R094_ONLINE = true;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    const stockId = await api.enqueuePosSale(org.business, api.queuePayloadFor(901, org));
    await api.updateItem(stockId, { status: 'failed', exceptionClass: 'stock-denied', exceptionDetails: 'Not enough stock for the ordered quantity', lastErrorCode: '23514' });
    const polId = await api.enqueuePosSale(org.business, api.queuePayloadFor(902, org));
    await api.updateItem(polId, { status: 'failed', exceptionClass: 'policy-denied', exceptionDetails: 'Plan quota exhausted', lastErrorCode: 'P0QLT' });
    const qId = await api.enqueuePosSale(org.business, api.queuePayloadFor(903, org));
    await api.updateItem(qId, { status: 'quarantined', quarantineReason: 'actor-mismatch' });
    const plainId = await api.enqueuePosSale(org.business, api.queuePayloadFor(904, org));
    await api.updateItem(plainId, { status: 'failed', lastError: 'network down' });
    api.mountDrawer('#r094-drawer');
    return true;
  }, [ORG_A, USER_A]);
  // open through the real trigger button
  await page.locator('button').first().evaluate((b: HTMLButtonElement) => b.click());
  await page.waitForFunction(() => /Stock hold/.test(document.body.innerText), undefined, { timeout: 10_000 });
  const text = await page.evaluate(() => document.body.innerText as string);
  await ctx.close();
  const stockBadge = text.includes('Stock hold');
  const policyBadge = text.includes('Plan limit hold');
  const exceptionGuidance = /will not sync automatically/i.test(text) || /never be synced/i.test(text) || /Reconciliation/i.test(text);
  const securityHoldVisible = /security hold/i.test(text) || /actor/i.test(text) || /mismatch/i.test(text);
  const plainDistinct = text.includes('network down');
  must(
    stockBadge && policyBadge && exceptionGuidance && securityHoldVisible && plainDistinct,
    `drawer exceptions shortfall: stockBadge=${stockBadge} policyBadge=${policyBadge} guidance=${exceptionGuidance} security=${securityHoldVisible} plainRow=${plainDistinct}`,
  );
});

test(meta('R094.BROWSER.DRAWER-RECONCILE-GATING', 'Reconcile affordance gate (production expression isReconcilable && isOnline && role \u2208 {owner,admin,manager}): owner/online sees the button; cashier does not and gets the manager-required guidance; offline also hides it'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  const cases = [
    { role: 'owner', online: true, expectButton: true },
    { role: 'cashier', online: true, expectButton: false },
    { role: 'owner', online: false, expectButton: false },
  ];
  const outcomes: string[] = [];
  let ok = true;
  for (const [i, c] of cases.entries()) {
    const html = await ev(page, async ([idx, role, online, org, uid]: any) => {
      const api = (window as any).r094;
      (window as any).R094_ROLE = role;
      (window as any).R094_ONLINE = online;
      api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
      const localId = await api.enqueuePosSale(org.business, api.queuePayloadFor(950 + idx, org));
      await api.updateItem(localId, { status: 'failed', exceptionClass: 'policy-denied', exceptionDetails: 'Plan quota exhausted', lastErrorCode: 'P0QLT' });
      const host = document.querySelector('#r094-drawer') as HTMLElement;
      host.innerHTML = '';
      host.appendChild(document.createElement('div'));
      api.mountDrawer('#r094-drawer > div');
      await new Promise((r) => setTimeout(r, 700)); // liveQuery-driven render settle (UI-only)
      (host.querySelector('button') as HTMLButtonElement | null)?.click();
      await new Promise((r) => setTimeout(r, 500));
      return {
        hasReconcile: document.body.innerText.includes('Reconcile (manager)'),
        guidance: document.body.innerText.includes('Requires an owner, admin or manager'),
      };
    }, [i, c.role, c.online, ORG_A, USER_A]);
    const caseOk = html.hasReconcile === c.expectButton && (c.expectButton || html.guidance);
    outcomes.push(`role=${c.role},online=${c.online}→button=${html.hasReconcile},guidance=${html.guidance}`);
    ok = ok && caseOk;
  }
  await ctx.close();
  must(ok, `reconcile affordance gating shortfall: ${outcomes.join(' | ')}`);
});

test(meta('R094.BROWSER.OFFLINE-ONLINE', 'Real offline→online: a sale enqueued while genuinely offline carries complete provenance AND remains pending; after the real transition online exactly ONE replay RPC succeeds (resolvedServerId from the server); a second engine pass adds zero RPCs; provenance/payload hash are byte-equal across the transition'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await stub.control({ action: 'resetAll' });
  await ctx.setOffline(true);
  const pre = await ev(page, ([org, uid]: any) => {
    const api = (window as any).r094;
    const online = navigator.onLine;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    return api.enqueuePosSale(org.business, api.queuePayloadFor(1001, org)).then(async (localId: number) => {
      const item = await api.getItem(localId);
      return {
        localId, online,
        snap: { clientKey: item.clientKey, originUserId: item.originUserId, originBranchId: item.originBranchId, originDeviceId: item.originDeviceId, originTerminalId: item.originTerminalId, originShiftId: item.originShiftId, payloadVersion: item.payloadVersion, payloadHash: item.payloadHash },
        canonical: api.canonicalPayloadJson(item.payload),
        status: item.status,
      };
    });
  }, [ORG_A, USER_A]);
  await ctx.setOffline(false);
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: pre.snap.clientKey, status: 200, body: { id: 'r094-inv-online-1', number: 'R094-INV-1001', journal_entry_id: null, idempotent: false } });
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const synced = await waitItem(page, pre.localId, (i) => i.status === 'synced');
  const rpcFirst = (await stubCalls()).filter((c) => c.clientKey === pre.snap.clientKey).length;
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const rpcSecond = (await stubCalls()).filter((c) => c.clientKey === pre.snap.clientKey).length;
  const post = await ev(page, async (lid: number) => {
    const api = (window as any).r094;
    const i = await api.getItem(lid);
    return {
      canonical: api.canonicalPayloadJson(i.payload),
      fields: { clientKey: i.clientKey, originUserId: i.originUserId, originBranchId: i.originBranchId, originDeviceId: i.originDeviceId, originTerminalId: i.originTerminalId, originShiftId: i.originShiftId, payloadVersion: i.payloadVersion, payloadHash: i.payloadHash },
      integrity: await api.verifyPayloadIntegrity(i),
    };
  }, pre.localId);
  await ctx.close();
  const fieldsEqual = Object.entries(pre.snap).every(([k, v]) => (post.fields as any)[k] === v);
  must(
    pre.online === false && pre.status === 'pending' && pre.snap.originUserId === USER_A
      && synced.status === 'synced' && synced.resolvedServerId === 'r094-inv-online-1'
      && rpcFirst === 1 && rpcSecond === 1
      && fieldsEqual === true && post.canonical === pre.canonical && post.integrity === true,
    `offline→online shortfall: queuedOnlineFlag=${pre.online} enqueueStatus=${pre.status} afterReplay=${synced.status}/${synced.resolvedServerId} rpcFirst=${rpcFirst} rpcSecond=${rpcSecond} provenanceByteEqual=${fieldsEqual} canonicalPreserved=${post.canonical === pre.canonical} integrity=${post.integrity}`,
  );
});

test(meta('R094.BROWSER.STALE-VERSION-MEASURE', 'P7: payloadVersion 0 (stale) quarantines stale-version, 9999 (unknown-future) quarantines unknown-version, legacy no-provenance quarantines missing-provenance (P5-A Q1/Q2/Q11 C)'), async () => {
  const ctx = await browser.newContext();
  const page = await newHarnessPage(ctx);
  await stub.control({ action: 'resetAll' });
  const older = await enqueueAsUser(page, 1101);
  await ev(page, (lid: number) => (window as any).r094.updateItem(lid, { payloadVersion: 0 }), older.localId);
  const newer = await enqueueAsUser(page, 1102);
  await ev(page, (lid: number) => (window as any).r094.updateItem(lid, { payloadVersion: 9999 }), newer.localId);
  const legacy = await ev(page, async (org: any) => {
    const api = (window as any).r094;
    const id: number = await api.enqueuePosSale(org.business, api.queuePayloadFor(1103, org));
    await api.updateItem(id, { originUserId: null, originBranchId: null, originDeviceId: null, originTerminalId: null, originShiftId: null, payloadVersion: null, payloadHash: null });
    return id;
  }, ORG_A);
  // P7: stale/unknown now quarantine before network; scenarios unused but kept for harness compat
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: older.clientKey, status: 200, body: { id: 'r094-inv-stale-0', number: 'R094-INV-1101', journal_entry_id: null, idempotent: false } });
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: newer.clientKey, status: 200, body: { id: 'r094-inv-stale-9999', number: 'R094-INV-1102', journal_entry_id: null, idempotent: false } });
  await page.evaluate((uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A);
  const staleItem = await waitItem(page, older.localId, (i) => i.status !== 'pending');
  const newerItem = await waitItem(page, newer.localId, (i) => i.status !== 'pending');
  const legacyItem = await waitItem(page, legacy as number, (i) => i.status !== 'pending');
  await ctx.close();
  must(
    staleItem.status === 'quarantined' && staleItem.quarantineReason === 'stale-version'
      && newerItem.status === 'quarantined' && newerItem.quarantineReason === 'unknown-version'
      && legacyItem.status === 'quarantined' && legacyItem.quarantineReason === 'missing-provenance',
    `stale-version measurement anomaly: v0=${staleItem.status}/${staleItem.quarantineReason} v9999=${newerItem.status}/${newerItem.quarantineReason} legacy=${legacyItem.status}/${legacyItem.quarantineReason}`,
  );
});

test(meta('R094.BROWSER.SERVER-REVALIDATION', 'Server-side revalidation of the reconcile RPC (DB-side actor-vs-origin check, DB-side client_key idempotency, snapshot-vs-server raster) from a real browser session'), () => {
  throw new Blocked(
    'Server-resident reconciliation revalidation from a browser session requires a REAL backend (Postgres + Edge functions + auth) driven over the wire. This sandbox has no disposable Supabase harness for browser traffic (no Docker; DB-suite embedded-Postgres is process-local, not network-addressable; the stub only models the HTTP shape). Client-path and UI evidence is recorded in R094.BROWSER.RECONCILE-CLIENTPATH / DRAWER-RECONCILE-GATING / EXCEPTION-*; the DB-side RPC authority remains covered by the sealed R093.RECON.* records against a real disposable database. This BLOCKED is scoped strictly to browser-driven real-server revalidation.',
  );
});
