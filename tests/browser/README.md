# R09.4 — real-browser evidence harness

Test/instrumentation only. Zero product-code changes; all release records use
the additive `R094.BROWSER.*` namespace and R13 gate semantics are unchanged.

## Components

- `build-pages.mjs` — bundles the harness page with esbuild. Production
  modules under `src/offline`, `src/lib/cacheWipe.ts`, `src/lib/queryPersister.ts`
  and `src/components/layout/OfflineQueueDrawer.tsx` are bundled VERBATIM.
  Only the designated seams are redirected (MOCK_MAP): `'@/lib/supabase'`
  (including relative `./supabase` imports) → the in-origin protocol stub
  client; `'@/store/useAppStore'` → scenario-controlled hydrated actor;
  drawer context hooks → scenario-controlled role/online values.
- `stub-server.mjs` — one localhost origin serving the real `dist` PWA (SPA
  fallback, SW-friendly headers), the bundled harness pages, a PostgREST-shaped
  in-origin stub for rpc/table/auth traffic with per-clientKey scenarios and a
  call log, plus the SW-traffic plumbing: a self-signed TLS terminator for
  `r094.invalid` and a CONNECT proxy (denying every host except the harness
  host), because Playwright cannot intercept service-worker-originated
  fetches. The SW's workbox fetch is a real network request end to end.
- `browser-runtime.mjs` — launches a genuine headless Chromium binary via
  `playwright-core` + `@sparticuz/chromium`. The sandbox image lacks
  `libnspr4/libnss3/libnssutil3`; they come from sparticuz's own `al2023`
  companion pack (real builds) via `LD_LIBRARY_PATH`. `--single-process` /
  `--no-zygote` are filtered (a second page would otherwise kill the browser).
- `mock-*.ts` — the three seams (supabase client, app-store actor/business,
  drawer contexts). Nothing else is mocked.
- `pages/harness.ts` + `pages/harness.html` — loads the production modules and
  exposes them as `window.r094.*` so release tests drive the real code inside
  the real browser.
- `../release/r094-browser.test.ts` — the 17 free-standing evidence records.
  Run via the gate (`node tests/release/run.mjs`) or focused:
  `R13_EVIDENCE_DIR=$(mktemp -d) node_modules/.bin/vitest run --config tests/release/vitest.config.ts r094-browser.test.ts`.
  Set `R094_DEBUG=1` for page/error piping during development.

## Seams (labelled on every record that touches them)

1. In-origin synthetic Supabase wire (PostgREST-shaped; rpc outcomes are
   scenario-registered per client key).
2. Scenario-controlled hydrated actor/business (the app's session values, not
   fabricated server-side identity).
3. Scenario-driven rpc responses (success / P0QLT / 23514 shapes).
4. Environmental substitution: local TLS termination + CONNECT proxy for the
   compiled-in `r094.invalid` host (cert is synthetic, TLS/TCP is real), and
   the al2023 library pack for the sandbox image's missing system libs.

The suite never simulates the service worker, never replaces IndexedDB or
CacheStorage, and never asserts server-side truth. The server-authoritative
reconciliation revalidation from a browser session is recorded BLOCKED with
its exact environmental limitation (see `R094.BROWSER.SERVER-REVALIDATION`).
