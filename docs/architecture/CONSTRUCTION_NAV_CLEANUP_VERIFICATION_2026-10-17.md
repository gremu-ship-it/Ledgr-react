# Construction Vertical Cleanup — Verification Record and Implementation Notes

- **Date:** 2026-10-17
- **Branch:** `arena/cf491c5b-ledgr-react`
- **Spec:** "Construction Vertical Cleanup: POS Verification and Label Overrides"
- **Status:** ✅ Implemented. Tasks 1–3 complete on top of the merged Phase A–D work.

This file began as a pre-implementation blocker report. The blockers were real at the time
they were written and are recorded in §1 for the audit trail; §2 records how they were
resolved, §3 what was actually built, and §4 the one behavioural finding that still needs a
product decision.

---

## 1. Original finding: the Phase A–D plumbing was not in the checkout

The branch was cut from `09b30a1` ("Merge pull request #213"), which predated the
construction capability work. At that commit:

| Spec assumed | Actual state at `09b30a1` |
|---|---|
| `construction` in `ORGANISATION_CAPABILITIES` + CONSTRUCTION defaults | Only `['sales','pos','inventory','services']`; no construction defaults map |
| Construction nav child gated by `minPlan: 'enterprise'` + `requiresOrgCapability: 'construction'` | Only `allowAllAuthenticatedRoles: true` — visible to every authenticated user on every plan |
| Construction bypasses the `capability_org_layer` kill switch | No occurrence of "construction" in `resolve.ts` |
| `useCapability.ts` maps construction → enterprise | No construction entry in `PLAN_REQUIREMENT` / `ROLE_PATH` |
| Supply Chain section displays "Supply Chain" | `navigation.sections.inventory` rendered "Inventory" |
| `CONSTRUCTION` operating model | Not in `OPERATING_MODELS` |

Consequence: there was no way to express "a construction business", so neither the POS
verification (Task 1) nor the label overrides (Task 2) could be implemented or tested.
Baseline at that commit was green: 116 files / 1,058 tests.

## 2. Resolution

PRs **#215 (Phase A), #216 (BOQ), #217 (Phase C), #218 (Phase D)** — plus the Phase B
commit and #210 (Construction defaults / procurement workspace) — were already merged into
`main`; no GitHub merge action was required. The clone was shallow (depth 1), so history was
deepened (`git fetch --deepen 300`) and the branch rebased onto `origin/main`:

- Merge-base before rebase: `09b30a1` (the branch had **no unique commits**)
- After rebase: `5ccc0e0` ("Merge pull request #218"), a clean fast-forward, +35 commits /
  121 files
- Post-rebase baseline: **135 files / 1,242 tests passing**

Verified present after the rebase:

- `profile.ts` — `CONSTRUCTION` operating model (`OPERATING_MODELS`, `OPERATING_MODEL_LABELS`),
  `'construction'` in `ORGANISATION_CAPABILITIES`, and
  `MODEL_CAPABILITIES.CONSTRUCTION = ['sales','inventory','services','construction']`, i.e.
  defaults `{ sales: true, pos: false, inventory: true, services: true, construction: true }`
- `resolve.ts` — `ALWAYS_PROFILE_GATED = new Set(['construction'])`, so construction is
  profile-gated with the kill switch either way
- `useCapability.ts` — `PLAN_REQUIREMENT.construction = 'construction'`,
  `ROLE_PATH.construction = '/construction'`
- `navConfig.ts` — Construction is a Supply Chain child with `minPlan: 'enterprise'` +
  `requiresOrgCapability: 'construction'`, no `partnerFeature`, no
  `allowAllAuthenticatedRoles`; two-pass (remove vs. lock) visibility
- `en.json` — `navigation.sections.inventory` = "Supply Chain",
  `navigation.items.constructionWorkspace` = "Construction"
- `constructionWorkspaceNavigation.test.ts` — rewritten to assert the new gating (9 tests),
  including the removal of the old `sales_clerk` visibility

## 3. What this change adds

### Task 1 — POS verification (no production change needed)

The POS nav item already carries `requiresOrgCapability: 'pos'`
(`navConfig.ts`), and the CONSTRUCTION model does not union in `pos`, so
`resolveBusinessCapability('pos', { operating_models: ['CONSTRUCTION'] }, …)` is `false` and
pass 1 of `visibleSectionsFor` removes the item. **The POS module itself was not touched.**

New tests (`constructionWorkspaceNavigation.test.ts`, block "construction vertical
navigation cleanup") drive the chain from a real profile through the real resolver rather
than a hand-written predicate stub:

- construction on Enterprise ⇒ `/pos` absent, `/construction` and `/products` still present
- retail on Starter / Growth / Pro / Enterprise ⇒ `/pos` present (no regression)
- Construction + Retail ⇒ `/pos` present (models union, one does not win)
- kill-switch posture documented — see §4

Plus a render-level test in `BottomNav.test.tsx`: a construction cashier gets no POS tab.

### Task 2 — label overrides (Option B, as chosen)

`navConfig.ts` gains one static table and two small pure helpers:

```ts
CONSTRUCTION_LABEL_OVERRIDES = {
  'navigation.items.products':  'navigation.items.materials',
  'navigation.items.warehouse': 'navigation.items.siteStores',
  'navigation.items.transfers': 'navigation.items.materialTransfers',
}
resolveNavLabelKey(labelKey, isConstruction)      // pure, idempotent
navLabelResolver(isOrgCapabilityEnabled)          // builds it from the existing predicate
```

`visibleSectionsFor` applies the resolver as a documented **pass 3** (vocabulary), after
pass 1 (remove) and pass 2 (mark locked). Only `labelKey` is rewritten — paths, icons,
`requiresOrgCapability`, `requiresCapability`, `partnerFeature` and `minPlan` are untouched,
and `NAV_SECTIONS` stays static, so `navItemForPath` and the plan/lock helpers still return
the default keys.

Surfaces covered:

| Surface | How it gets the override |
|---|---|
| `Sidebar.tsx` | Reads `visibleSectionsFor` output; also routes its collapsed-rail tooltip and upgrade prompt through `navLabelResolver` so all three strings agree |
| `MobileDashboard.tsx` | Reads `visibleSectionsFor` output — inherits it with no change |
| `BottomNav.tsx` | Keeps its own item lists, so it resolves through the shared `navLabelResolver`; the two derived lists moved into a `useMemo` (and `allowedForRole` into a `useCallback`) to keep the array identity stable for the existing FAB-split memo and the React Compiler lint rule |

`en.json` gains `navigation.items.materials` = "Materials", `siteStores` = "Site Stores",
`materialTransfers` = "Material Transfers". The `inventory.*` namespace (page-level strings)
was deliberately left alone — the spec scopes the override to the Supply Chain nav children.
`fr/ny/pt/sw` fall back to `en` (`fallbackLng: DEFAULT_LANGUAGE` in `src/i18n/index.ts`);
translations can follow as a parity pass.

The section label stays "Supply Chain" for every vertical — the spec's override table lists
the three children only.

### Task 3 — tests

- `constructionWorkspaceNavigation.test.ts`: 9 existing + 12 new = 21
- `BottomNav.test.tsx`: 9 existing + 3 new = 12
- Full suite after the change: **135 files / 1,257 tests passing**; `tsc -b` clean;
  `eslint src/components/layout src/i18n` clean

New label tests assert: construction ⇒ Materials / Site Stores / Material Transfers;
retail ⇒ Products / Warehouse / Transfers; routes+icons+gates unchanged; `NAV_SECTIONS`
still default; unrelated labels (`/income`, `/reports`, `/dashboard`, `/construction`)
untouched for both profiles; the override table's shape and idempotence; the mobile
workspace list inherits it; the three keys exist in `en.json`; and a BottomNav render test
for the More menu in both directions.

## 4. Open finding for product: POS narrowing still depends on the kill switch

`capability_org_layer` defaults to **false** (`src/lib/featureFlags.ts`). The
construction bypass is scoped to `ALWAYS_PROFILE_GATED = {'construction'}`, so with the
layer off the four Phase-1 capabilities keep their frozen pre-architecture semantics —
including the POS fail-open. A construction business therefore still sees POS in a build
where `VITE_FEATURE_CAPABILITY_ORG_LAYER` is not `true`:

```ts
// resolve.ts, layer off, capability 'pos'
organisationAllows = !false || … === true      // POS stays visible
```

This is the posture that was confirmed for this task ("the four Phase-1 capabilities keep
their existing switch semantics"), so it is **asserted as documented behaviour** in the new
test *"documents that POS narrowing needs the organisation layer on…"* rather than changed —
adding `pos` to `ALWAYS_PROFILE_GATED` would alter gating for every non-construction
business, which the spec's constraints forbid. If the acceptance criterion
"construction does not see POS" must hold in builds with the kill switch off, that is a
separate decision: either enable the flag for the vertical, or extend the bypass list.

## 5. Constraints honoured

- No construction module logic touched (projects, BOQ, valuations, reporting)
- POS module untouched — only its nav visibility was verified and tested
- Supply Chain section structure and the Construction child item unchanged
- No nav gating change for non-construction businesses (asserted by the retail tests)
- All user-facing strings are i18n keys in `src/i18n/locales/en.json`
- Single branch, single PR; all pre-existing tests still pass
