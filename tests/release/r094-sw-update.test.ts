/**
 * R09.4 Phase A — REAL-BROWSER evidence for the service-worker UPDATE/INSTALL
 * variant (same-origin Version A → Version B transition), per the follow-on
 * owner authorization. Evidence/harness-only; additive records under
 * R094.BROWSER.SW.*; existing R094 records untouched; R13 gate semantics
 * unchanged. Zero simulation: real Chromium, real (two!) production builds,
 * real SW lifecycle events, real CacheStorage/IndexedDB.
 *
 * Version strategy (documented, harness-only): Version A is the currently
 * verified baseline build (copied verbatim); Version B is produced by the
 * SAME build command with ONLY VITE_SUPABASE_ANON_KEY varied (env marker).
 * Rollup content-hashes cascade coherently (supabase chunk → entry module →
 * index.html → sw.js bytes + precache revisions), giving a genuine distinct
 * version with zero product-behavior change. No product code is modified to
 * manufacture the difference.
 *
 * Production lifecycle documented and followed (no code-driven force-
 * activation): the shipped bundle self-registers immediately (registerSW with
 * immediate:true, registerType:'autoUpdate'), the shipped sw.js self-activates
 * (top-level skipWaiting) and claims clients (top-level clientsClaim), and the
 * production registerSW runtime then reloads the open app document once the
 * claimed worker takes control. Activation, claim advance, and the production
 * auto-reload are all asynchronous relative to one another; the claim advance
 * is observable only as a NEW 'controllerchange' event (worker scriptURLs are
 * identical across versions, so a URL comparison cannot detect the flip).
 * The harness follows this lifecycle and never triggers activation itself.
 */
import { beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { evidenceSuite, ObservedFailure } from './evidence';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — ESM .mjs modules have no ambient declarations under this config
import { createStubServer } from '../browser/stub-server.mjs';
// @ts-ignore — ESM .mjs
import { launchBrowser } from '../browser/browser-runtime.mjs';

const test = evidenceSuite('r094-sw-update');

const meta = (id: string, expectation: string) => ({
  id,
  expected: expectation,
  source:
    'two real Vite production builds (Version A = verified baseline copy; Version B = identical build with env-only anon-key marker), served same-origin by tests/browser/stub-server.mjs; production registerServiceWorker.ts + sw.js/sw-events.js unmodified (registerType autoUpdate lifecycle); real Chromium runtime; harness-only fixtures',
  remediation: 'R09.4-PHASE-A',
  layer: 'real Chromium browser runtime; real SW install/update lifecycle on a genuine same-origin version swap; zero simulation of SW semantics; synthetic data only',
});

const ROOT = resolve(__dirname, '..', '..');
const PAGES_OUT = join(ROOT, '.cache', 'r094', 'pages');
const CACHE_DIR = join(ROOT, '.cache', 'r094');
const DIST_BASE = join(ROOT, 'dist');
const DIST_A = join(CACHE_DIR, 'distA');
const DIST_B = join(CACHE_DIR, 'distB');

const BIZ_A = 'r094-biz-a';
const BIZ_B = 'r094-biz-b';
const USER_A = 'r094-user-a-000000000001';
const ORG_A = { business: BIZ_A, branch: `${BIZ_A}-branch`, product: `${BIZ_A}-product`, shift: `${BIZ_A}-shift`, terminal: `${BIZ_A}-terminal` };

let stub: any;
let browser: any;
let digestSwA = '';
let digestSwB = '';
let digestIndexA = '';
let digestIndexB = '';
let entryAssetA = '';
let entryAssetB = '';
/** Captured canonical transition outcome (record 2) for the deterministic-repeat record. */
let canonicalTransition: any = null;

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const entryAssetName = (distDir: string): string => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  if (!m) throw new ObservedFailure(`entry asset not parseable from ${distDir}/index.html`);
  return m[1];
};

const ev = (page: any, fn: (...a: any[]) => any, arg?: any): Promise<any> => page.evaluate(fn as any, arg);

/** Convert any harness-step rejection into a labelled ObservedFailure. */
async function go<T>(label: string, p: Promise<T>): Promise<T> {
  try { return await p; }
  catch (e: any) {
    if (e instanceof ObservedFailure) throw e;
    throw new ObservedFailure(`${label}: ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
function must(cond: boolean, actual: string) {
  if (!cond) throw new ObservedFailure(actual);
}

/** true when a harness evaluation raced the page's (production-triggered) navigation. */
const isContextDestroyed = (e: any) => String(e?.message ?? e).includes('Execution context was destroyed');

async function newHarnessPage(context: any): Promise<any> {
  await context.addInitScript((origin: string) => {
    (window as any).R094_STUB_ORIGIN = origin;
    (window as any).R094_ANON_KEY = 'r094-anon';
  }, stub.origin);
  const page = await context.newPage();
  await page.goto(stub.pageUrl('harness.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).r094, undefined, { timeout: 20_000 });
  return page;
}

/** Load the app page with SW-event capture installed BEFORE the document loads. */
async function newAppPage(context: any): Promise<any> {
  await context.addInitScript(() => {
    (window as any).__r094SwEvents = [];
    for (const name of ['app:update-available', 'app:sw-registered', 'app:offline-ready', 'app:sw-registration-error']) {
      window.addEventListener(name, (e: Event) => {
        (window as any).__r094SwEvents.push({ type: name, at: Date.now(), detail: !!((e as CustomEvent).detail) });
      });
    }
    navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
      (window as any).__r094SwEvents.push({ type: 'controllerchange', at: Date.now() });
    });
  });
  const page = await context.newPage();
  await page.goto(stub.origin + '/', { waitUntil: 'load' });
  return page;
}

/** Attach updatefound/statechange capture to the page's registration. */
async function attachRegistrationCapture(page: any): Promise<void> {
  await ev(page, async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return;
    const push = (type: string) => (window as any).__r094SwEvents?.push({ type, at: Date.now() });
    reg.addEventListener('updatefound', () => {
      push('updatefound');
      const w = reg.installing ?? reg.waiting;
      w?.addEventListener('statechange', () => push(`workerstate:${w.state}`));
    });
  });
}

async function swSnapshot(page: any): Promise<any> {
  return go('sw snapshot', ev(page, async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const reg = await navigator.serviceWorker.getRegistration('/');
    const digestOf = async (url: string) => {
      const r = await fetch(url, { cache: 'no-store' });
      const buf = await r.arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    return {
      registrations: regs.length,
      active: reg?.active?.state ?? null,
      waiting: reg?.waiting?.state ?? null,
      installing: reg?.installing?.state ?? null,
      controller: !!navigator.serviceWorker.controller,
      swDigest: await digestOf('/sw.js'),
      indexDigest: await digestOf('/'),
      events: ((window as any).__r094SwEvents ?? []).map((e: any) => e.type),
      caches: 'caches' in window ? await caches.keys() : [],
      entryAssets: Array.from(document.querySelectorAll('script[src],link[rel="modulepreload"]')).map((el) => (el as any).src ?? (el as any).href),
    };
  }));
}

async function waitActiveDigest(page: any, expected: string, timeoutMs = 25_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    try {
      last = await swSnapshot(page);
    } catch (e: any) {
      // mid-navigation transients: the production auto-reload (or the harness
      // fallback navigation) aborts in-flight fetches ('Failed to fetch') and
      // destroys execution contexts; both are retryable within the bound. A
      // genuinely persistent failure surfaces at the deadline with last-state.
      if (!isContextDestroyed(e) && !String(e?.message ?? e).includes('Failed to fetch')) throw e;
    }
    if (last != null && last.active === 'activated' && last.swDigest === expected && last.registrations === 1) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new ObservedFailure(`SW did not settle on expected digest within ${timeoutMs}ms; last=${JSON.stringify({ active: last?.active, digest: last?.swDigest?.slice(0, 12), registrations: last?.registrations, waiting: last?.waiting, installing: last?.installing })}`);
}

async function precacheEntries(page: any): Promise<string[]> {
  return go('precache entries', ev(page, async () => {
    const names = await caches.keys();
    const precache = names.find((n) => /precache/i.test(n));
    if (!precache) return [];
    const reqs = await (await caches.open(precache)).keys();
    return reqs.map((r) => r.url).sort();
  }));
}

/**
 * Precache-convergence anchor: workbox's activate-phase deletion of obsolete
 * entries runs inside the activate event's extended lifetime, so the worker
 * may already read 'activated' before cleanup completes. Poll the precache
 * entry set until the named obsolete asset is gone (genuine cleanup done).
 */
async function waitPrecacheConverged(page: any, obsoleteAssetName: string, timeoutMs = 90_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let entries: string[] = [];
  while (Date.now() < deadline) {
    try {
      entries = await precacheEntries(page);
    } catch (e: any) {
      if (!isContextDestroyed(e)) throw e; // mid (production) navigation transient: retry
    }
    if (entries.length > 0 && !entries.some((u) => u.includes(obsoleteAssetName))) return entries;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new ObservedFailure(`precache did not converge: obsolete asset ${obsoleteAssetName} still present (entries=${entries.length})`);
}

/** Forensic: the REAL bytes stored under every precache key for a given URL
 * fragment (e.g. 'index.html'), digested, with its revision label. */
async function precacheSlotDigests(page: any, urlFragment: string): Promise<any[]> {
  return go('precache slot digests', ev(page, async (frag: string) => {
    const digestOf = async (txt: string) => {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const names = await caches.keys();
    const precache = names.find((n) => /precache/i.test(n));
    if (!precache) return [];
    const cache = await caches.open(precache);
    const out: any[] = [];
    for (const k of await cache.keys()) {
      if (!k.url.includes(frag)) continue;
      const r = await cache.match(k);
      out.push({
        url: k.url,
        revision: (k.url.match(/__WB_REVISION__=([^&]+)/) ?? [])[1] ?? null,
        digest: r ? await digestOf(await r.clone().text()) : null,
      });
    }
    return out;
  }, urlFragment));
}

const enqueueAsUser = (page: any, n: number, userId = USER_A) =>
  go('enqueue', ev(page, ([nn, uid, org]: any) => {
    const api = (window as any).r094;
    api.setCurrentUser(uid); api.setCurrentBusiness(org.business);
    return api.enqueuePosSale(org.business, api.queuePayloadFor(nn, org)).then(async (localId: number) => {
      const item = await api.getItem(localId);
      return {
        localId, clientKey: item.clientKey,
        snap: { originUserId: item.originUserId, originBranchId: item.originBranchId, originDeviceId: item.originDeviceId, originTerminalId: item.originTerminalId, originShiftId: item.originShiftId, payloadVersion: item.payloadVersion, payloadHash: item.payloadHash },
        canonical: api.canonicalPayloadJson(item.payload),
      };
    });
  }, [n, userId, ORG_A]));

async function rereadQueueState(page: any, localId: number): Promise<any> {
  return go('queue reread', ev(page, async (lid: number) => {
    const api = (window as any).r094;
    const item = await api.getItem(lid);
    const count = await api.queueCount();
    return {
      count,
      snap: item ? { originUserId: item.originUserId, originBranchId: item.originBranchId, originDeviceId: item.originDeviceId, originTerminalId: item.originTerminalId, originShiftId: item.originShiftId, payloadVersion: item.payloadVersion, payloadHash: item.payloadHash } : null,
      canonical: item ? api.canonicalPayloadJson(item.payload) : null,
      integrity: item ? await api.verifyPayloadIntegrity(item) : null,
      status: item?.status ?? null,
      sequence: item?.sequence ?? null,
      clientKey: item?.clientKey ?? null,
    };
  }, localId));
}

/**
 * Full REAL PRODUCTION A→B transition on the given open app page. Serves
 * Version B on the same origin, issues the normative update() check, then
 * follows the production lifecycle without forcing anything:
 *   1. polls the REAL registration state machine (timeline evidence) while
 *      Version B installs and self-activates (shipped skipWaiting);
 *   2. observes the production clientsClaim advance as a NEW controllerchange
 *      event (scriptURLs identical across versions — events are the only
 *      trustworthy observable), measured as claim latency;
 *   3. the production registerSW runtime (registerType autoUpdate) reloads the
 *      open app document once the claimed worker controls it — observed as an
 *      execution-context destruction; awaited when it happens (bounded);
 *   4. returns the settled snapshot pre-navigation, the post-navigation
 *      document snapshot (Version-B authority), the timeline, the claim
 *      latency, and whether the production auto-reload occurred.
 * If the production auto-reload does not occur within the bound, the harness
 * performs a plain navigation reload and records that fact (production-
 * lifecycle limitation evidence, not an activation step).
 * An optional duringProbe runs while Version B installs/activates and the
 * Version-A document is still the loaded one (active-session evidence).
 */
async function performUpdate(page: any, duringProbe?: () => Promise<any>): Promise<any> {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_B }); // same origin now serves Version B
  await attachRegistrationCapture(page);
  const baselineControllerChanges = await go('claim baseline', ev(page, () => ((window as any).__r094SwEvents ?? []).filter((e: any) => e.type === 'controllerchange').length));
  const docStart: string = await go('doc generation', ev(page, () => String(performance.timeOrigin)));
  await go('reg.update()', ev(page, async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    await reg?.update();
    return true;
  }));
  let during: any = null;
  if (duringProbe) {
    during = await duringProbe().catch((e: any) => ({ probeError: String(e?.message ?? e).slice(0, 200) }));
  }
  const timeline: string[] = [];
  let settled: any = null;
  let claimed = false;
  let claimMs = -1;
  let autoReloaded = false;
  const tClaim0 = Date.now();
  const deadline = Date.now() + 25_000;
  for (;;) {
    // State machine evidence (navigation-resilient).
    try {
      const states = await go('sw states', ev(page, async () => {
        const reg = await navigator.serviceWorker.getRegistration('/');
        return [reg?.installing?.state, reg?.waiting?.state, reg?.active?.state].filter(Boolean).join(',');
      }));
      for (const st of states.split(',')) if (st && !timeline.includes(st)) timeline.push(st);
      settled = await swSnapshot(page);
    } catch (e: any) {
      if (!isContextDestroyed(e) && !String(e?.message ?? e).includes('Failed to fetch')) throw e;
      // The production auto-reload fired mid-transition: the Version-A
      // document is gone; activation+claim already happened (the reload is
      // gated on the claimed worker). That IS the production evidence.
      autoReloaded = true;
      claimed = true;
      claimMs = Date.now() - tClaim0;
      break;
    }
    if (settled?.active === 'activated' && settled.swDigest === digestSwB && settled.registrations === 1) {
      // Claim anchor: a NEW controllerchange event is the only trustworthy observable.
      try {
        const count = await go('claim watch', ev(page, () => ((window as any).__r094SwEvents ?? []).filter((e: any) => e.type === 'controllerchange').length));
        // count > baseline: claim advanced in this document.
        // count < baseline: the production auto-reload fired and reset the
        // fresh document's event array — the production reload is gated on
        // the claimed worker, so the reload itself proves the claim advance.
        if (count > baselineControllerChanges) {
          claimed = true;
          claimMs = Date.now() - tClaim0;
          break;
        }
        const start = await go('doc generation watch', ev(page, () => String(performance.timeOrigin)));
        if (start !== docStart) {
          claimed = true;
          claimMs = Date.now() - tClaim0;
          autoReloaded = true;
          break;
        }
        if (count < baselineControllerChanges) {
          claimed = true;
          claimMs = Date.now() - tClaim0;
          autoReloaded = true;
          break;
        }
      } catch (e: any) {
        if (!isContextDestroyed(e)) throw e;
        autoReloaded = true;
        claimed = true;
        claimMs = Date.now() - tClaim0;
        break;
      }
    }
    if (Date.now() > deadline) throw new ObservedFailure(`transition never settled; timeline=${timeline.join('>')} last=${settled?.active}/${settled?.swDigest?.slice(0, 12)} claimed=${claimed}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!claimed && settled?.active === 'activated' && settled.swDigest === digestSwB) {
    throw new ObservedFailure('production claim never advanced for the open client — recorded production active-session claim defect');
  }
  // Follow the production lifecycle to its natural end state: an open document
  // served under Version-B authority. The production runtime auto-reloads the
  // page on claim; await it briefly, else perform a plain navigation (recorded).
  if (!autoReloaded) {
    const watchDeadline = Date.now() + 8_000;
    while (Date.now() < watchDeadline) {
      try {
        const start = await go('auto-reload watch', ev(page, () => String(performance.timeOrigin)));
        if (start !== docStart) { autoReloaded = true; break; }
      } catch (e: any) {
        if (!isContextDestroyed(e)) throw e;
        autoReloaded = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  if (autoReloaded) {
    await go('post-reload settle', page.waitForLoadState('load', { timeout: 30_000 }));
  } else {
    await page.reload({ waitUntil: 'load' });
  }
  const after = await waitActiveDigest(page, digestSwB);
  // Post-navigation forensics on the now-stable page.
  const servedProbe = await go('served probe', ev(page, async () => {
    const digestOf = async (txt: string) => {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const r = await fetch('/', { cache: 'no-store' });
    return { status: r.status, fetchedDigest: await digestOf(await r.text()) };
  }));
  return { settled, timeline, claimed, claimMs, autoReloaded, after, servedProbe, during };
}

beforeAll(async () => {
  execFileSync(process.execPath, [join(ROOT, 'tests', 'browser', 'build-pages.mjs')], {
    env: { ...process.env, R094_PAGES_OUT: PAGES_OUT }, stdio: 'inherit', timeout: 120_000,
  });

  // Version A = the currently verified baseline build, copied verbatim.
  const aMarker = join(DIST_A, '.r094-env.json');
  const aMarkerOk = existsSync(aMarker) && readFileSync(aMarker, 'utf8').includes('r094.invalid');
  if (!aMarkerOk) {
    if (!existsSync(join(DIST_BASE, 'sw.js')) || !readFileSync(join(DIST_BASE, 'sw.js'), 'utf8').includes('r094.invalid')) {
      execSync('npm run build', {
        cwd: ROOT, stdio: 'inherit', timeout: 360_000,
        env: { ...process.env, VITE_SUPABASE_URL: 'https://r094.invalid', VITE_SUPABASE_ANON_KEY: 'r094-anon' },
      });
    }
    rmSync(DIST_A, { recursive: true, force: true });
    mkdirSync(DIST_A, { recursive: true });
    cpSync(DIST_BASE, DIST_A, { recursive: true });
    writeFileSync(aMarker, JSON.stringify({ copiedFrom: 'dist/', env: 'r094.invalid/r094-anon', note: 'byte-verbatim copy of the verified baseline build' }));
  }

  // Version B = identical build command with ONLY the anon-key env marker varied.
  const bMarker = join(DIST_B, '.r094-env.json');
  const bMarkerOk = existsSync(bMarker) && readFileSync(bMarker, 'utf8').includes('r094-anon-key-v2');
  if (!bMarkerOk) {
    rmSync(DIST_B, { recursive: true, force: true });
    execSync('node_modules/.bin/vite build --outDir ' + DIST_B, {
      cwd: ROOT, stdio: 'inherit', timeout: 360_000,
      env: { ...process.env, VITE_SUPABASE_URL: 'https://r094.invalid', VITE_SUPABASE_ANON_KEY: 'r094-anon-key-v2' },
    });
    writeFileSync(bMarker, JSON.stringify({ builtWith: 'same command; env-only marker VITE_SUPABASE_ANON_KEY=r094-anon-key-v2', note: 'harness-only version distinction; zero product-behavior change' }));
  }

  digestSwA = sha256(join(DIST_A, 'sw.js'));
  digestSwB = sha256(join(DIST_B, 'sw.js'));
  digestIndexA = sha256(join(DIST_A, 'index.html'));
  digestIndexB = sha256(join(DIST_B, 'index.html'));
  entryAssetA = entryAssetName(DIST_A);
  entryAssetB = entryAssetName(DIST_B);
  must(digestSwA !== digestSwB && digestIndexA !== digestIndexB, `Version distinction missing: swA==swB or indexA==indexB (env-marker cascade failed)`);
  must(entryAssetA !== entryAssetB, `Entry module name unchanged across versions (${entryAssetA}); cascade verification failed`);

  stub = await createStubServer({ distDir: DIST_A, pagesDir: PAGES_OUT, tlsCertDir: join(CACHE_DIR, 'tls') } as any);
  browser = await launchBrowser({ pacUrl: stub.pacUrl } as any);
}, 420_000);

afterAll(async () => {
  await stub?.control({ action: 'setDistDir', dirAbs: DIST_A }).catch(() => {});
  await browser?.close();
  await stub?.close();
});

test(meta('R094.BROWSER.SW.INSTALL-REGISTER', 'Version A installs genuinely: production register creates exactly one registration scoped /, the worker activates (self skipWaiting + clientsClaim in the shipped sw.js), controls the page, digests match the served Version-A files, precache populates (manifest entries present), and the app-emitted registration event fired'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await newAppPage(ctx);
  const snap = await waitActiveDigest(page, digestSwA);
  const precache = await precacheEntries(page);
  await ctx.close();
  must(
    snap.registrations === 1 && snap.active === 'activated' && snap.controller === true
      && snap.swDigest === digestSwA && snap.indexDigest === digestIndexA
      && precache.length >= 10
      && snap.events.includes('app:sw-registered'),
    `install evidence shortfall: registrations=${snap.registrations} active=${snap.active} controller=${snap.controller} digestMatch=${snap.swDigest === digestSwA} indexMatch=${snap.indexDigest === digestIndexA} precacheEntries=${precache.length} events=${JSON.stringify(snap.events)}`,
  );
});

test(meta('R094.BROWSER.SW.UPDATE-DETECT-TRANSITION', 'Same-origin Version-A→B under the real production lifecycle (registerType autoUpdate: self-activation + clientsClaim + production auto-reload; nothing forced by code): after serving B on the same origin and a normative update() check, the browser detects a byte-different sw.js, installs AND activates Version B; the claim advances the open client (measured); the end-state document is unambiguously Version B (html digest + entry module, incl. SW-handled fetch bytes); the precache holds the correct Version-B bytes under the Version-B revision slot; exactly one registration remains'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  const tx = await performUpdate(page);
  const slots = await precacheSlotDigests(page, 'index.html');
  const bSlotPresent = slots.some((sl: any) => sl.digest === digestIndexB);
  await ctx.close();
  const after = tx.after;
  const sawInstall = tx.timeline.includes('installing') || (tx.settled?.events ?? []).some((e: string) => e === 'updatefound');
  const sawActivate = tx.timeline.includes('activated') && (tx.settled?.active === 'activated' || tx.claimed === true);
  const entryIsB = after.entryAssets.some((u: string) => u.includes(entryAssetB));
  const entryIsA = after.entryAssets.some((u: string) => u.includes(entryAssetA));
  const pass = sawInstall && sawActivate
    && tx.claimed === true && tx.claimMs >= 0
    && tx.servedProbe.status === 200 && tx.servedProbe.fetchedDigest === digestIndexB
    && bSlotPresent === true
    && after.swDigest === digestSwB && after.indexDigest === digestIndexB
    && after.registrations === 1 && after.controller === true
    && entryIsB && !entryIsA;
  // Canonical snapshot for the deterministic-repeat record
  canonicalTransition = {
    finalActiveDigest: after.swDigest, finalIndexDigest: after.indexDigest,
    entryAssetServed: entryAssetB, registrations: after.registrations, controller: after.controller,
    updatefoundSeen: sawInstall, activatedSeen: sawActivate,
  };
  must(
    pass,
    `update-transition shortfall: updatefound=${sawInstall} activatedTimeline=${sawActivate} claimed=${tx.claimed} claimMs=${tx.claimMs} autoReloaded=${tx.autoReloaded} servedProbeStatus=${tx.servedProbe.status} servedIsB=${tx.servedProbe.fetchedDigest === digestIndexB} bSlotPresent=${bSlotPresent} slots=${JSON.stringify(slots)} postNavDigestMatch=${after.swDigest === digestSwB} indexMatch=${after.indexDigest === digestIndexB} registrations=${after.registrations} entryIsB=${entryIsB} entryIsA=${entryIsA} events=${JSON.stringify(tx.settled?.events ?? [])}`,
  );
});

test(meta('R094.BROWSER.SW.ACTIVE-SESSION', 'Active-session behavior WHILE the newer version is detected, installed, and self-activated (nothing forced): the still-loaded Version-A document and its loaded offline-queue module stack stay functional during the transition; the production lifecycle then advances the claim and reloads the open document (measured), yielding Version B on the next document — the exact production active-session lifecycle is the evidence'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx); // claimed later by the SW (production clientsClaim path)
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  const seeded = await enqueueAsUser(harness, 2101);
  const tx = await performUpdate(page, async () =>
    // Active-session probe while B installs/activates and the A document is the loaded one.
    go('active-session probe', ev(page, async () => ({
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
      title: document.title,
      controller: !!navigator.serviceWorker.controller,
    }))));
  // The loaded module stack on the open client stays functional across the claim:
  const extra = await enqueueAsUser(harness, 2102);
  const queueDuring = await rereadQueueState(harness, seeded.localId);
  const extraState = await rereadQueueState(harness, extra.localId);
  await ctx.close();
  const after = tx.after;
  must(
    tx.during != null && tx.during.rootChildren >= 1 && tx.during.controller === true
      && queueDuring.count === 2 && queueDuring.status === 'pending'
      && extraState.status === 'pending'
      && tx.claimed === true && tx.claimMs >= 0
      && after.swDigest === digestSwB && after.indexDigest === digestIndexB && after.registrations === 1,
    `active-session shortfall: during=${JSON.stringify(tx.during)} queueDuring=${queueDuring.status}/${queueDuring.count} extraQueued=${extraState.status} claimed=${tx.claimed} claimMs=${tx.claimMs} autoReloaded=${tx.autoReloaded} afterB=${after.swDigest === digestSwB}/idx${after.indexDigest === digestIndexB} events=${JSON.stringify(tx.settled?.events ?? [])}`,
  );
});

test(meta('R094.BROWSER.SW.CACHE-TRANSITION', 'Cache transition on version change: the workbox precache entry set converges to the Version-B set (obsolete Version-A-only hashed assets are removed by the production activate-phase cleanup), while the identity-scoped runtime caches (ledgr-api-cache) are preserved across the version transition (R09.1: wipe is identity-triggered, not version-triggered)'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  // Identity-scoped runtime cache warmed via the real SW route (SW must cache it).
  const warmed = await go('warm api cache via SW', ev(harness, async () => {
    const api = (window as any).r094;
    const r = await fetch('https://r094.invalid/rest/v1/products?select=id&r094upd=1');
    let entries = 0;
    for (let i = 0; i < 30; i++) {
      entries = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
      if (entries >= 1) break;
      await new Promise((x) => setTimeout(x, 150));
    }
    return { status: r.status, entries };
  }));
  const precacheA = await precacheEntries(page);
  const cachesBefore = await go('caches before', ev(page, () => caches.keys()));
  await performUpdate(page);
  const precacheB = await waitPrecacheConverged(page, entryAssetA); // genuine activate-phase cleanup done
  const cachesAfter = await go('caches after', ev(page, () => caches.keys()));
  const apiEntriesAfter = await go('api entries after', ev(harness, async () => {
    const api = (window as any).r094;
    return (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
  }));
  await ctx.close();
  const addedEntries = precacheB.filter((u) => !precacheA.includes(u));
  must(
    warmed.status === 200 && warmed.entries >= 1
      && precacheA.length >= 10 && precacheB.length >= 10
      && addedEntries.length >= 1
      && precacheB.some((u) => u.includes(entryAssetB))
      && !precacheB.some((u) => u.includes(entryAssetA))
      && cachesAfter.includes('ledgr-api-cache')
      && apiEntriesAfter >= 1,
    `cache-transition shortfall: warm=${warmed.status}/${warmed.entries} precacheA=${precacheA.length} precacheB=${precacheB.length} added=${addedEntries.length} bEntryPresent=${precacheB.some((u) => u.includes(entryAssetB))} aEntryRemoved=${!precacheB.some((u) => u.includes(entryAssetA))} apiCacheSurvived=${cachesAfter.includes('ledgr-api-cache')} apiEntriesAfter=${apiEntriesAfter} cachesBefore=${JSON.stringify(cachesBefore)} cachesAfter=${JSON.stringify(cachesAfter)}`,
  );
});

test(meta('R094.BROWSER.SW.QUEUE-PROVENANCE', 'Offline queue preservation across the version transition: a provenance-complete queue item enqueued under Version A survives the full production Version-B transition (install + activation + claim + auto-reload) byte-identically (provenance fields, payloadVersion/payloadHash, canonical payload, client key, sequence); integrity re-verifies under the Version-B-controlled runtime; no duplicate row appears and the item still replays exactly once (single replay authority)'), async () => {
  await stub.control({ action: 'resetAll' });
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  const seeded = await enqueueAsUser(harness, 2201);
  await stub.control({ action: 'setScenario', fn: 'post_pos_sale', clientKey: seeded.clientKey, status: 200, body: { id: 'r094-inv-upd-1', number: 'R094-UPD-2201', journal_entry_id: null, idempotent: false } });
  await performUpdate(page);
  const post = await rereadQueueState(harness, seeded.localId);
  // Single replay authority still: one production sync pass → exactly one rpc.
  await go('post-transition sync', ev(harness, (uid: string) => (window as any).r094.syncQueue(undefined, { currentUserId: uid }), USER_A));
  const calls = (await stub.control({ action: 'calls' })).calls.filter((c: any) => c.fn === 'post_pos_sale' && c.clientKey === seeded.clientKey);
  const itemFinal = await rereadQueueState(harness, seeded.localId);
  await ctx.close();
  const fieldsEqual = Object.entries(seeded.snap).every(([k, v]) => (post.snap as any)?.[k] === v);
  must(
    fieldsEqual === true && post.count === 1 && post.integrity === true
      && post.canonical === seeded.canonical && post.clientKey === seeded.clientKey
      && itemFinal.status === 'synced' && calls.length === 1,
    `queue-provenance shortfall: fieldsEqual=${fieldsEqual} count=${post.count} integrity=${post.integrity} canonicalPreserved=${post.canonical === seeded.canonical} clientKeyPreserved=${post.clientKey === seeded.clientKey} finalStatus=${itemFinal.status} replayRpcCalls=${calls.length}`,
  );
});

test(meta('R094.BROWSER.SW.IDENTITY-CONFIDENTIALITY', 'Identity transition around the update (User A → A→B SW update → logout wipe → User B): the R09.1 identity boundary holds across the version change — User B sees zero User-A persisted markers, the identity-triggered wipe still empties the runtime caches on the Version-B-controlled runtime, and the offline queue stays preserved (never treated as ordinary cache)'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  const seeded = await enqueueAsUser(harness, 2301);
  await go('warm A caches', ev(harness, async (org: any) => {
    const api = (window as any).r094;
    await api.warmRqPersist(org.business, 'upd-a-marker');
    const r = await fetch('https://r094.invalid/rest/v1/products?select=id&r094id=1');
    let entries = 0;
    for (let i = 0; i < 30; i++) {
      entries = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
      if (entries >= 1) break;
      await new Promise((x) => setTimeout(x, 150));
    }
    return { status: r.status, entries };
  }, ORG_A));
  await performUpdate(page);
  // Identity transition ON the Version-B-controlled runtime.
  const res = await go('wipe on vB runtime', ev(harness, async (bizB: string) => {
    const api = (window as any).r094;
    await api.wipeIdentityTransitionCaches('user-switch');
    const emptiness = await api.verifyBusinessCacheEmptiness();
    api.setCurrentBusiness(bizB);
    await api.warmRqPersist(bizB, 'upd-b-marker');
    const rq = await api.rqCacheEntries();
    const aRemaining = rq.queries.filter((q: any) => q.dataJson.includes('upd-a-marker') || JSON.stringify(q.queryKey ?? []).includes('r094-biz-a')).length;
    const bPresent = rq.queries.filter((q: any) => q.dataJson.includes('upd-b-marker') && JSON.stringify(q.queryKey ?? []).includes(bizB)).length;
    const apiEntries = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
    return { aRemaining, bPresent, apiEntries, emptiness: !!emptiness };
  }, BIZ_B));
  const queueState = await rereadQueueState(harness, seeded.localId);
  await ctx.close();
  must(
    res.aRemaining === 0 && res.bPresent >= 1 && res.apiEntries === 0
      && queueState.count === 1 && queueState.status === 'pending' && queueState.integrity === true,
    `identity-confidentiality shortfall: aRemaining=${res.aRemaining} bPresent=${res.bPresent} apiEntries=${res.apiEntries} queue=${queueState.status}/${queueState.count} integrity=${queueState.integrity}`,
  );
});

test(meta('R094.BROWSER.SW.HIJACK-STALE-INSPECT', 'Hijack/stale-worker inspection across the whole transition: never two registrations; active script digest always one of the two known build digests and never Version A after settle; the end-state document is never the obsolete Version-A shell (document assets = Version-B hashed names only); obsolete Version-A-only precache entries are gone post-activation; repeated update() checks settle idempotently (no update loop); the identity-scoped runtime caches show no unexpected deletion; any defect is recorded, never patched over'), async () => {
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  // Warm the identity-scoped runtime cache so "no unexpected deletion" has an object to inspect.
  await go('warm api cache', ev(harness, async () => {
    const api = (window as any).r094;
    const r = await fetch('https://r094.invalid/rest/v1/products?select=id&r094hij=1');
    let entries = 0;
    for (let i = 0; i < 30; i++) {
      entries = (await (await caches.open(api.WORKBOX_API_CACHE_NAME)).keys()).length;
      if (entries >= 1) break;
      await new Promise((x) => setTimeout(x, 150));
    }
    return { status: r.status, entries };
  }));
  const precacheA = await precacheEntries(page);
  const tx = await performUpdate(page);
  const precacheB = await waitPrecacheConverged(page, entryAssetA); // genuine activate-phase cleanup done
  // Repeated update() checks after the transition: must be a no-op (no update loop, still one registration).
  await go('post-settle update checks', ev(page, async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    await reg?.update();
    await new Promise((r) => setTimeout(r, 800));
    await reg?.update();
    await new Promise((r) => setTimeout(r, 800));
  }));
  const settle = await waitActiveDigest(page, digestSwB); // still exactly one B registration, active & activated
  const cachesAfter = await go('caches list', ev(page, () => caches.keys()));
  const apiEntriesAfter = await go('api entries after', ev(harness, async () => (await (await caches.open((window as any).r094.WORKBOX_API_CACHE_NAME)).keys()).length));
  const eventsNow = await go('events', ev(page, () => ((window as any).__r094SwEvents ?? []).map((e: any) => e.type)));
  await ctx.close();
  const after = tx.after;
  const aAssetGone = !precacheB.some((u) => u.includes(entryAssetA));
  const bAssetPresent = precacheB.some((u) => u.includes(entryAssetB));
  const documentAssetsAreB = after.entryAssets.some((u: string) => u.includes(entryAssetB)) && !after.entryAssets.some((u: string) => u.includes(entryAssetA));
  must(
    settle.registrations === 1 && settle.installing === null && settle.waiting == null && settle.active === 'activated' && settle.swDigest === digestSwB
      && after.swDigest === digestSwB && after.indexDigest === digestIndexB && after.indexDigest !== digestIndexA
      && after.registrations === 1
      && tx.claimed === true
      && aAssetGone === true && bAssetPresent === true
      && documentAssetsAreB === true
      && cachesAfter.includes('ledgr-api-cache') === true && apiEntriesAfter >= 1
      && precacheA.length >= 10 && precacheB.length >= 10,
    `hijack/stale inspection flag: settleActive=${settle.active} settleRegistrations=${settle.registrations} settleDigestB=${settle.swDigest === digestSwB} digestB=${after.swDigest === digestSwB} indexB=${after.indexDigest === digestIndexB} claimed=${tx.claimed} aAssetGone=${aAssetGone} bAssetPresent=${bAssetPresent} docAssetsB=${documentAssetsAreB} registrations=${after.registrations} apiCacheSurvived=${cachesAfter.includes('ledgr-api-cache')} apiEntriesAfter=${apiEntriesAfter} events=${JSON.stringify(eventsNow)}`,
  );
});

test(meta('R094.BROWSER.SW.DETERMINISM', 'Deterministic repeat: a second full Version-A→B transition cycle in a fresh context reproduces the same observable transition outcomes (digest convergence, single registration, Version-B authority of the end-state document, queue seeded-and-preserved with identical properties) — matching the canonical outcome captured by the first transition record'), async () => {
  must(canonicalTransition != null, 'canonical transition snapshot missing (update record did not run)');
  await stub.control({ action: 'setDistDir', dirAbs: DIST_A });
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const harness = await newHarnessPage(ctx);
  const page = await newAppPage(ctx);
  await waitActiveDigest(page, digestSwA);
  const seeded = await enqueueAsUser(harness, 2401);
  const tx = await performUpdate(page);
  const queueState = await rereadQueueState(harness, seeded.localId);
  const regCount = await go('registration count', ev(page, async () => (await navigator.serviceWorker.getRegistrations()).length));
  await ctx.close();
  const after = tx.after;
  const same = after.swDigest === canonicalTransition.finalActiveDigest
    && after.indexDigest === canonicalTransition.finalIndexDigest
    && regCount === canonicalTransition.registrations
    && after.controller === canonicalTransition.controller
    && tx.claimed === true
    && queueState.count === 1 && queueState.integrity === true;
  must(
    same,
    `deterministic repeat divergence: digest=${after.swDigest === canonicalTransition.finalActiveDigest} index=${after.indexDigest === canonicalTransition.finalIndexDigest} registrations=${regCount} controller=${after.controller} claimed=${tx.claimed} queue=${queueState.count}/${queueState.integrity}`,
  );
});
