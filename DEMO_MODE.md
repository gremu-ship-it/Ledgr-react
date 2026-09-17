# Demo mode — one-click live demo

Visitors arriving from the marketing site can use the **full Ledgr app** without
creating an account, without a password and without touching Supabase. One link
does everything:

```
https://app.ledgr.com/demo/enter
```

Opening that URL seeds a realistic Malawian business in the visitor's own
browser, signs them in as **`demo@ledgr.test`** (owner of *Zikomo Foods Ltd*),
and lands them on the dashboard. Every screen works: creating invoices and
expenses, recording payments, running payroll, posting journals, uploading
receipts, printing PDFs, the reports, and the AI insights.

Nothing is sent to a server. There is no demo tenant in Supabase, no demo user
row, and no credentials to leak — the demo lives entirely in the browser.

---

## 1. Linking to the demo from the landing page

The landing page is a separate Vercel + Supabase project. From that project,
the only integration point is a link — no API call, no token exchange, no
environment variable, nothing to configure in its Supabase project.

```html
<!-- Primary CTA -->
<a href="https://app.ledgr.com/demo/enter">Try the live demo</a>

<!-- Static, read-only product tour (no sign-in, kept as a lighter option) -->
<a href="https://app.ledgr.com/demo">See the 1-minute tour</a>
```

Notes for the landing page:

- Use `target="_self"`. A cross-origin `<iframe>` of the app is blocked by the
  app's own `frame-ancestors 'self'` CSP header (see `vercel.json`), so the demo
  cannot be embedded — link to it instead.
- The demo entry URL is stable and works from any origin, referrer or campaign
  link. Query parameters are preserved, so `?ref=instagram-bio` style tagging
  keeps working: `/demo/enter?ref=instagram-bio`.
- If the visitor already has the app open in a real session, opening the link
  switches them into the demo. Their real session is untouched server-side, and
  *Exit demo* restores the app to a signed-out state they can sign back into.

The marketing site in this repository (`website/`) is wired the same way — see
`website/src/components/Header.astro`, `website/src/components/CtaBanner.astro`
and the hero blocks in `website/src/pages/{en,ny}/index.astro`.

## 2. What the visitor sees

| Surface | Behaviour in demo mode |
|---|---|
| Persistent amber banner | "Demo account — sample data, not your books", time until reset, plus **Reset data**, **Create free account**, **Exit demo** |
| Header | `Demo` badge instead of the plan badge; *Sign out* exits the demo |
| Reads & writes | Fully functional against the seeded books, stored in `localStorage` for this browser only |
| Billing & subscriptions | Replaced by an explanation + **Create free account** |
| Team invitations | Replaced by an explanation (invites would send real email) |
| API keys, webhooks | Replaced by an explanation (they'd be inert against a fake tenant) |
| Password change, account deletion | Replaced by an explanation (`demo@ledgr.test` has no password) |
| Idle logout | Disabled, so a visitor walking through screens is never signed out |
| Offline cache (IndexedDB) | Bypassed, so demo data never mixes into a real user's cache |
| AI insights | Work offline against the seeded numbers (`ai_context` is computed locally) |

**Reset policy.** The seeded snapshot is stored per browser and is regenerated
automatically once it is more than 24 hours old (`DEMO_RESET_AFTER_MS` in
`src/lib/demo/constants.ts`), so the books always look current. *Reset data* in
the banner reseeds immediately. Because state is per browser, two visitors on
different machines never see each other's changes.

## 3. How it works

```
src/lib/demo/
├── constants.ts      demo identity, storage keys, reset window, UUID helpers
├── mode.ts           the demo flag (localStorage + memory, SSR-safe)
├── persistence.ts    reading/writing the snapshot + the reset countdown
├── loader.ts         loads the engine chunk on demand, holds the client
├── dataset.ts        buildDemoDataset(now) → seeded tables (deterministic)
├── store.ts          per-browser snapshot: seed / persist / auto-reset / clear
├── views.ts          v_trial_balance, v_ar_ageing, v_cash_flow, v_asset_register, v_reorder_alerts
├── queryBuilder.ts   in-memory PostgREST: select, filters, embeds, order, writes, counts
├── client.ts         demo SupabaseClient stand-in: from(), rpc(), auth, storage, functions
└── session.ts        enterDemoMode() / exitDemoMode() / hydrateDemoSession()

src/pages/DemoEntryPage.tsx        /demo/enter — seeds, signs in, redirects to /dashboard
src/components/demo/DemoBanner.tsx persistent banner with reset / sign-up / exit
src/components/demo/DemoNotice.tsx guardrail panel for the blocked features
src/hooks/useDemoMode.ts           reactive `isDemo` for components
```

The seam is a **Proxy facade** in `src/lib/supabase.ts`. Repositories capture the
client at module load, so the swap has to happen behind a stable object:

```ts
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop) {
    const target = activeClient();          // demoClient when isDemoMode(), else realSupabase
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
```

Every existing `supabase.from(...)`, `.rpc(...)`, `.auth.*`, `.storage.from(...)`
and `.functions.invoke(...)` call therefore keeps working unchanged; in demo mode
it is answered from the seeded tables instead of the network. Writes mutate the
in-memory snapshot and mark it dirty so the next read (and the next page load)
sees them. RPCs that cannot be simulated — real payments, partner payouts,
invites, MFA — return a clear `DEMO_MODE` error, which the UI surfaces as an
explanation rather than a crash.

`enterDemoMode()` loads the engine, sets the flag, clears the React Query cache
(so no real data is mixed in) and hydrates `useAppStore` with the demo user and
business, which is what makes `ProtectedRoute` and the tenant header render.
`useAuthListener` checks the demo flag before asking Supabase for a session, so
no auth request is made on a demo page load.

**Bundle cost.** The seeded books, query builder and views are ~22 kB gzipped,
and nobody who is not using the demo should download them — "works on flaky
connections" is a product claim, not a footnote. So the app shell imports only
`mode.ts`, `persistence.ts` and `loader.ts` (~1.8 kB gzipped together); the
engine sits behind `import('@/lib/demo/client')`. It is loaded from exactly two
places, both of which await it before anything can query: `enterDemoMode()` for
a visitor arriving from the landing page, and the bootstrap in `main.tsx` for a
page load that starts already inside the demo. Until the chunk lands the facade
falls back to the real client and logs one warning, so a race degrades instead
of throwing inside a Proxy getter.

## 4. The seeded dataset

`buildDemoDataset(now)` is deterministic and generates six months of trading
history ending in the current month, so the demo never looks stale:

- **Business** — Zikomo Foods Ltd, Lilongwe, MWK, VAT registered (17.5%), Pro
  plan, two branches, three departments, 12 accounting periods (the months
  before the ledger cut-over are locked). The tier matters: `PlanGate` wraps
  Reports, Journals, Tax, Assets, Period Management and the Chart of Accounts in
  the `accounting_organisation` capability, so a Free-tier demo would meet an
  upgrade wall on the core of the product. Pro unlocks all of them while still
  reporting a real usage meter (Enterprise's is unlimited).
- **Chart of accounts** — the real `getCoaTemplate('gaap')` seed (~120 accounts),
  with a balanced opening position (assets = liabilities + equity).
- **Contacts** — 10 customers and suppliers with Malawian names, VAT numbers and
  credit limits.
- **Sales** — 18 invoices across six months with lines, VAT, payments, one aged
  debtor and a draft, so the ageing report and the invoice list have content.
  Cost of sales is recognised **per invoice**, on the invoice date, the way the
  app's own quick-save does it.
- **Purchases** — monthly supplier stock bills that replenish what was sold
  (posted to Trading Stock, so inventory never drains negative), plus operating
  receipts and bills with VAT recovery.
- **Inventory** — products, categories, units, locations, balances and stock
  movements, including items below reorder level for the alerts view.
- **Payroll** — a run for every month of the window, three employees, PAYE from
  the real `calculatePAYE()` and 5%/10% pension, with PAYE and pension remitted
  to the MRA and the fund for every paid run.
- **Tax** — a VAT return per month; each is filed and paid once its MRA deadline
  has passed, so only the newest return is still pending.
- **Assets** — two fixed assets, capitalised by a posted
  `fixed_asset_acquisition` journal (so `getSOFP`'s register fallback does not
  count them twice), with depreciation schedules and a register.
- **Cash** — receipts land mainly in the bank, and a final sweep moves till cash
  and mobile money above their floats into it, so no cash account holds an
  implausible balance.
- **Journals** — every transaction above posts a balanced journal entry, so the
  trial balance, ledger, P&L and balance sheet all reconcile.

The resulting business is deliberately ordinary rather than spectacular: ~MWK
65m revenue over six months, a ~27% gross margin (staples are thin), ~9% net
margin, profit in every month of the trend chart, positive cash, and a current
ratio a lender would accept. `SALES_VOLUME` in `dataset.ts` is the one knob that
scales throughput if the catalogue or the cost base changes.

One honest wrinkle: the balance sheet reports `isBalanced = false` with the
difference equal to the year's unclosed profit — exactly what `getSOFP` does for
any live business that has not run a period close, and the report explains it in
those words. The tests pin the difference to the year-to-date net profit so it
can never silently become something else.

Changing the demo therefore means editing `src/lib/demo/dataset.ts`; bump
`DEMO_STATE_VERSION` in `constants.ts` when the shape changes so existing
browser snapshots are discarded rather than mismatched.

## 5. Testing and safety

```bash
# Engine: dataset integrity, query builder, session lifecycle, plan access
npx vitest run src/lib/demo

# The screens a visitor actually lands on (jsdom, real components and hooks)
npx vitest run src/pages/__tests__/DemoEntryPage.test.tsx \
               src/hooks/__tests__/useDashboardData.demo.test.tsx
```

- `demoDataset.test.ts` asserts the books balance, invoice/expense/payroll
  arithmetic agrees with lines and payments, and each computed view matches the
  SQL it stands in for.
- `demoQueryBuilder.test.ts` runs the repositories' actual query strings —
  including the aliased `businesses!inner` embed the app boots with — against the
  seeded tables.
- `demoSession.test.ts` covers entering, using, resetting, auto-reset, and
  leaving the demo, and that the facade stops serving demo rows on exit.
- `demoPlanAccess.test.ts` asserts the seeded tier unlocks every module
  `PlanGate` wraps, and that the seeded month leaves transaction creation
  enabled — a prospect who cannot press "New invoice" is not seeing a demo.
- `DemoEntryPage.test.tsx` (`src/pages/__tests__/`) renders the real
  `/demo/enter` page: the visitor lands signed in on `/dashboard`, `?to=` deep
  links are honoured, and neither an absolute nor a protocol-relative `?to=` can
  turn the entry point into an open redirect.
- `useDashboardData.demo.test.tsx` (`src/hooks/__tests__/`) renders the seven
  real hooks behind the first screen and asserts they resolve against the demo
  client, that the reporting month anchors to the **newest** record (an ignored
  `.order()` would still return valid-looking rows — just January's), and that
  the trend, outstanding invoices and journal period-lock flag carry real values.

Safety properties worth preserving:

- **No network.** Demo mode makes no Supabase, PayChangu or AI-backend calls.
- **No credential.** `demo@ledgr.test` cannot sign in for real; `.test` is a
  reserved TLD, so even an accidental signup attempt cannot deliver mail.
- **No cross-tenant leakage.** Demo rows are keyed to a fixed demo business id
  and live only in that browser's `localStorage`; the IndexedDB query cache is
  bypassed so demo data can never be restored into a real session.
- **No irreversible action.** Billing, invites, API keys, webhooks, password
  changes and account deletion are replaced by guardrail panels.
- **Real writes still require a real account.** *Create free account* in the
  banner is the conversion path; the demo's data is intentionally not portable.

## 6. Turning the demo off

The demo is compile-time present but runtime-gated. To disable it entirely,
remove the `/demo/enter` route from `src/App.tsx` and the CTA links — the flag
can then never be set. To keep the route but shorten or lengthen the sample
books' freshness window, edit `DEMO_RESET_AFTER_MS`.
