# LEDGR — P4 OWNER DECISION RESOLUTION

**Date:** 2026-09-24
**Owner:** Alexander Gremu
**Class:** Analysis / Decision-Preparation Only — No Implementation Authorized
**Source:** `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (authoritative P4 report)
**Scope:** Resolve Q1–Q15 for explicit owner selection — no policy selected, no ranking, no implementation

---

## §1 Baseline — Do Not Move The Baseline

| Item | Value | Source / Verification |
|---|---|---|
| **Current HEAD** | `e36e46e2c6bb4f3204b27cfe57c86ba31c335881` | `git rev-parse HEAD` |
| **Working-tree status** | `M docs/audits/LEDGR_P4_OWNER_DECISION_RESOLUTION_2026-09-24.md` (this new file, untracked before creation; no product code modified) — `git status --porcelain` shows only this file plus the P4 report already committed; no `src/*`, `supabase/*`, `tests/*`, `package.json`, `.github/*` changes | `git status --porcelain` |
| **P4 baseline commit** | `bc97e32` (on `b8f3f00` + P2a second-connection harness) | `git log --oneline` — `bc97e32 P3 decision-preparation + P2a ... — 742 PASS / 0 FAIL / 40 BLOCKED deterministic (b9d41ec854a1)` |
| **P4 report revision (as instructed)** | `befab28` — *instructed as approximate P4 report revision* — actual current P4 report HEAD is `e36e46e` (13-section rewrite of `befab28` 16-section draft and `9d7e6d7` draft) | `git log --oneline -4` shows `e36e46e P4: rewrite to 13-section spec ...`, `befab28 P4: align report ... 16-section`, `9d7e6d7`, `d384736`, `bc97e32` |
| **Release gate identity** | `b9d41ec854a1` — two byte-identical gates `tGbSM8` + `YMmQku` — `evidenceExit=2` (BLOCKED present, zero FAIL) | `docs/audits/LEDGR_P2A_SECOND_CONNECTION_HARNESS_2026-09-23.md` + `LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` §2 |
| **PASS/FAIL/BLOCKED counts** | **742 PASS / 0 FAIL / 40 BLOCKED / 782** release records (794 incl. 12 LEGACY) — 731/731 unit, `tsc -b` clean, release-types clean, `eslint` 0 errors, `vite build` CI PWA OK | `LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` §2 + `LEDGR_P3` |
| **P4 report exists** | `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` — 778 lines, 13 sections, 97 KB — verified present | `ls -lh` |

**Confirm whether the decision analysis is still being performed against the same baseline:**

**YES — same baseline.** `HEAD e36e46e` is `befab28` + one docs-only revision (16-section → 13-section to meet the new 13-section report-requirements spec). No application code, migration, SQL, RLS, Edge, AI, billing/quota, offline queue, branch enforcement, test, CI gate, package config, DB schema, or P3 baseline `bc97e32` was moved. `git diff befab28..e36e46e --stat` shows only `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (653 insertions + 417 deletions, 13-section rewrite); `git diff bc97e32..e36e46e --stat` shows only docs/audits P3 + P4 reports (no `src/*`, `supabase/*`). Release gate `b9d41ec854a1` and counts `742/0/40/782` are unchanged. Therefore this Owner Decision Resolution is still performed against the **same baseline `bc97e32`** as instructed.

If the repository had moved to a new implementation (e.g., new migration/RLS/billing logic), STOP would have been required — it has not.

---

## §2 Resolve Q1–Q15 One By One

*For every Q, the structure below is followed exactly. No option is selected. No ranking is given. The P4 report (`LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` §4–§8, §10) is the authoritative source; source-code paths are cited where P4 verified them.*

---

### Q1 — Stale Versions `< current` (DEC-09)

**Question**

Should stale/offline payloads where `payloadVersion < QUEUE_PAYLOAD_VERSION` (e.g., `0` when current is `1`) remain replayable as they are today, or should they become a typed exception `stale-version` (quarantine) that is visible, not retried, and classified under Model 3?

**Current verified behavior**

- `QUEUE_PAYLOAD_VERSION = 1` at `src/offline/provenance.ts:19`, written at `enqueue` via `buildProvenance`/`captureContext`/`hashQueuePayload` (`src/offline/provenance.ts`, `queueApi.ts`, `db.ts:277`).
- `hasTrustworthyProvenance(item)` is `payloadVersion != null && typeof originUserId === 'string' && typeof capturedAt === 'string'` — no `===1` (`src/offline/provenance.ts`).
- `sweepUnverifiableItems` quarantines only `missing-provenance` when `payloadVersion == null` (legacy `null` preserved verbatim at `db.ts:277`); no `stale-version` branch (`src/offline/db.ts`, `queueApi.ts`).
- **R094 browser evidence** (`tests/release/r094-browser.test.ts:637` `R094.BROWSER.STALE-VERSION-MEASURE`): `0` → provenance passes and is replayable through `syncQueue`; `9999` → same; `null` (+ `originUserId`/`payloadHash` nulled) → `missing-provenance` quarantine (visible, durable, never retried, never reconcilable). `SW.QUEUE-PROVENANCE` + `PERSIST-RESTART` proved `payloadVersion`/`payloadHash` survive SW update/restart byte-identically.
- **No v2 shape has shipped** — verified via `supabase/migrations/*` and `src/offline/*` (no `QUEUE_PAYLOAD_VERSION = 2`).
- `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) — not version.
- **Missing version** (`payloadVersion == null`) is **not** stale — it is `missing-provenance` quarantine (legacy `db.ts:277` keeps `null` intentionally), permanently non-reconcilable. **Trustworthy provenance** (`payloadVersion != null` + `originUserId` + `capturedAt`) is the current gate; `0` and `9999` both satisfy it.
- `payloadVersion` is **queue-only** (Dexie `ledgr-offline` `queue` store); `post_pos_sale(jsonb)` (`supabase/migrations/20260923000000_post_pos_sale_rpc.sql`) has **no `payloadVersion` param** (body grep 0 hits; payload fields are `business_id,client_key,receipt_number,shift_id,cash_sales...`); P4 disposable probe `client_key 5001` PASS `1e9aa9fd-c530-4331-bb09-7f8b7a77040e` identical for conceptual `0`/`1`/`9999` — server cannot distinguish without a client-side `hasTrustworthyProvenance` change; no `stale-version` `23514`/`P0QLT`/`42501`/`22023` observed.

**Options**

**Option A — Accept all non-null versions (keep current, `hasTrustworthyProvenance` as is).**
- What it means operationally: `hasTrustworthyProvenance` keeps `!= null`; any `payloadVersion` `0` or `9999` or future `2` remains `pending`/`failed` and is replayed through `post_pos_sale` as today.
- Immediate benefit: Maximal backward compatibility — old clients (e.g., `0` when current `1`) remain replayable indefinitely after a version bump; no coordinated rollout; offline availability maximal.
- Immediate cost/risk: Minimal fail-closed — silent misinterpretation if v2 adds/renames a field (server cannot invent missing `discount_type`/`tax_code`; `payloadHash` covers whatever fields are present but policy would not quarantine before hash; P4 §4.3 “version-sensitivity code path” only, **NOT EVIDENCED as lived failure** because no v2 field exists).
- Downstream consequences: No new `exceptionClass`; `RECONCILABLE` stays `['stock-denied','policy-denied']`; `OfflineQueueDrawer` shows no `stale-version`; version bump is not breaking; risk must be recorded as accepted.
- Affected components: `src/offline/provenance.ts`, `db.ts`, `reconciliation.ts`, `OfflineQueueDrawer.tsx`, `offline_queue_reconciliations` — **no change**.
- Dependencies: `DEC-10` (`legacy` `null` shape) — preserves `missing-provenance` for `null`; `R09.3 Model 3` — no new typed class; `R09.3 Model 4` — no expansion; `R09.4` — measurement already covers `0`/`9999`; queue TTL — independent (TTL would apply to all versions equally).

**Option B — Reject stale (`< current`) as typed `stale-version` quarantine.**
- What it means operationally: `hasTrustworthyProvenance` or `sweepUnverifiableItems` branches on `payloadVersion < QUEUE_PAYLOAD_VERSION` → `quarantined` + `quarantinedAt` + `exceptionClass='stale-version'` + `exceptionDetails`, visible in drawer, never retried.
- Immediate benefit: Fail-closed for stale drift — old payloads that predate a new field are quarantined rather than silently misinterpreted.
- Immediate cost/risk: Breaks backward compat — old clients become `quarantined` after version bump; offline availability reduces for stale clients; version bump becomes breaking and requires coordinated rollout or grace period.
- Downstream consequences: Needs new `exceptionClass` `stale-version`, `hasTrustworthyProvenance`/`sweepUnverifiableItems` change, `offline_queue_reconciliations` CHECK change if reconcilable, drawer copy for `stale-version`, `reconcile_offline_queue_item` re-hydration vs new-capture logic (original `clientKey` immutable — changed transaction is new `clientKey` per `reconciliation.ts`); **do not assume “rejecting” automatically means `quarantine` vs `failed` vs `delete` — this option explicitly means `quarantine`** (distinct from `failed` infinite loop and `delete` evidence loss). Affects Model 3 (new typed class) and Model 4 (whether `stale-version` is added to `RECONCILABLE` — see Q3).
- Affected components: `src/offline/provenance.ts`, `db.ts`, `reconciliation.ts`, `exceptions.ts` (`classifyReplayException`), `src/components/layout/OfflineQueueDrawer.tsx`, `supabase/migrations/*` (`offline_queue_reconciliations` CHECK), `reconcile_offline_queue_item`.
- Dependencies: `DEC-10` — must preserve `null` → `missing-provenance` (not `stale-version`); `R09.3 Model 3` — new typed class; `R09.3 Model 4` — `RECONCILABLE` decision (Q3); `R09.4` — needs extended `R094` through `post_pos_sale` with stale shape; `DEC-TTL` — TTL threshold informs stale grace period (E).

**Option D (for Q1, reject stale only) / E (soft) — Soft: grace period / warning-but-allow / TTL-linked handling.**
- What it means operationally: Allow stale for N days (e.g., `createdAt` age < threshold), or `warning-but-allow` (toast but still replay), or quarantine stale only after TTL age — `createdAt` + `payloadVersion` joint policy in `hasTrustworthyProvenance` + `sweepUnverifiableItems` + TTL.
- Immediate benefit: Temporary backward compat — old clients have grace to upgrade.
- Immediate cost/risk: Delayed fail-closed; needs `createdAt` distribution evidence to set threshold; `createdAt` can be tampered but `payloadHash` + `origin*` still cover integrity.
- Downstream consequences: Needs both DEC-09 and DEC-TTL joint implementation (version + age), `stale-version` `quarantine` only after grace, drawer `warning` vs `quarantine` distinction.
- Affected components: `provenance.ts`, `db.ts`, `lease.ts`, `queueApi.ts` (TTL), `OfflineQueueDrawer.tsx`.
- Dependencies: `DEC-TTL` Q4–Q7 (threshold, disposition, reconcilability); `R09.4` + analytics `createdAt` p50/p95.

*Note:* Option C (`> current` future/unknown) and Option D (both directions `!== current`) are covered in Q2; Q1 is only stale `< current`. Option D for Q1 alone would be “reject stale” — same as B; strict both-directions is Q2’s D.

**Evidence available now**

- Verified evidence: `QUEUE_PAYLOAD_VERSION=1` location, `hasTrustworthyProvenance` only `!=null`, `sweepUnverifiableItems` only `==null`, `R094` browser `0`/`9999` both pass / `null` quarantines, `post_pos_sale` has no `payloadVersion` param, `5001` identical result, no `stale-version` exception exists, `RECONCILABLE` not version, `payloadHash` SHA-256 integrity, `missing-provenance` vs stale distinction — all **ALREADY VERIFIED** via source + migration + deterministic browser test + disposable PG probe (§3, §4.1).
- Evidence that remains unavailable: Real v2 payload shape (field added/removed/renamed); `R094` extended through `post_pos_sale` with a stale-shaped payload; drawer copy UX probe for `stale-version` vs `missing-provenance`; client version-distribution analytics (`payloadVersion` population) — **NOT EVIDENCED** (`NO CUSTOMER POPULATION INFERENCE PERMITTED`); deterministic stale-reconciliation test if reconcilable (needs `stale-version` exception) — all **STILL NOT EVIDENCED** (§10).
- Evidence that would require implementation: New `stale-version` `exceptionClass`/`quarantineReason`, `hasTrustworthyProvenance` branching on `< current`, `isReconcilable` expansion, `offline_queue_reconciliations` migration, drawer handling, `reconcile_offline_queue_item` re-hydration — **IMPLEMENTATION REQUIRED** (blocked until owner decision; do not implement in P4).

**Decision required from Alexander**

Choose for **stale versions `< current`** whether they remain replayable (Option A keep) or become typed `stale-version` quarantine (Option B) — or an explicitly defined soft policy (Option E with threshold, e.g., N days, warning-but-allow, TTL-linked). If an `exceptionClass` is added, also answer Q3 for `RECONCILABLE`. Do not leave ambiguous whether “rejecting” means quarantine vs failed vs delete — Q1 is quarantine if rejecting.

**Implementation consequences**

- If **A (keep)**: No `src/offline/*` change; docs record risk acceptance that future v2 fields could be silently misinterpreted; `R09.3 Model 3`/`Model 4` unchanged; no drawer change; version bump remains non-breaking.
- If **B (stale-version quarantine)**: Add `stale-version` to `exceptionClass` (`src/offline/db.ts` `exceptionClass?:`), change `hasTrustworthyProvenance` to `payloadVersion === QUEUE_PAYLOAD_VERSION` or `payloadVersion < QUEUE_PAYLOAD_VERSION → stale-version`, update `sweepUnverifiableItems` to quarantine `stale-version`, update `exceptions.ts` / `reconciliation.ts` `RECONCILABLE` per Q3, migration for `offline_queue_reconciliations` CHECK, `OfflineQueueDrawer.tsx` copy for `stale-version`, decide re-hydration (payload migration) vs new capture (new `clientKey`) per `reconcile_offline_queue_item` (`clientKey` immutable).
- If **E (soft)**: As B plus `createdAt` age check + `DEC-TTL` threshold, warning UI, grace-period logic.

**Dependencies**

- `DEC-10` (queue/legacy `null` shape) — `null` must stay `missing-provenance`, not `stale-version`.
- `R09.3 Model 3` — `stale-version` would be a new typed `exceptionClass`.
- `R09.3 Model 4` — `RECONCILABLE` list (`Q3`).
- `R09.4` — `R094.BROWSER.STALE-VERSION-MEASURE` measurement; SW durability.
- `DEC-TTL` — TTL threshold informs stale grace (E).
- `R02` — not directly, but `originUserId` drift informs stale context.

### Q2 — Future/Unknown Versions `> current` (DEC-09)

**Question**

Should future/unknown payloads where `payloadVersion > QUEUE_PAYLOAD_VERSION` (e.g., `9999` when current is `1`) remain replayable as they are today, or should they become a typed exception `unknown-version` (quarantine)? Also, should the policy be `!== current` (reject both stale and future, strict version-locked) or a soft variant?

**Current verified behavior**

- Same contract as Q1: `QUEUE_PAYLOAD_VERSION=1`, `hasTrustworthyProvenance` only `!=null`, `9999` currently passes and is replayable through `syncQueue` (`R094` `9999` → provenance passes), no `unknown-version` exception exists, `payloadVersion` queue-only, `post_pos_sale` identical for `9999`.
- **Future/unknown** (`> current`) is distinct from **stale** (`< current`) and **missing** (`null` → `missing-provenance`): `9999` is not `missing`, it is trustworthy per current gate.
- No `v_reports_roles`-like gate for version; no server `payloadVersion` param.

**Options**

**Option A — Accept all non-null versions (keep).**
- What it means operationally: `9999` or future `2` remains `pending`/`failed` and is replayed as today.
- Immediate benefit: Maximal forward compatibility — future clients (e.g., new field `discount_type`) remain replayable on old deployments (old server ignores unknown field or old hash still valid).
- Immediate cost/risk: Minimal fail-closed — future drift: old deployment cannot interpret new field, silent misinterpretation (server ignores unknown field, but P4 §4.3 “version-sensitivity code path” only, **NOT EVIDENCED as lived**).
- Downstream consequences: No new `exceptionClass`; `RECONCILABLE` unchanged; version bump requires old deployments to upgrade to handle new shape, but old will still replay until upgraded.
- Affected components: none.
- Dependencies: `DEC-10` preserves `null`; `R09.3 Model 3/4` no change; `R09.4` already measures `9999`; TTL independent.

**Option C — Reject future (`> current`) as `unknown-version` typed quarantine.**
- What it means operationally: `payloadVersion > QUEUE_PAYLOAD_VERSION` → `quarantined` `unknown-version`, never retried, drawer visible.
- Immediate benefit: Fail-closed for future drift — old deployment quarantines payloads it cannot interpret.
- Immediate cost/risk: Breaks forward compat — new clients on old deployments become `quarantined` frequently after any version bump; offline availability reduces for future clients; every version bump breaks old deployments until they upgrade.
- Downstream consequences: New `exceptionClass` `unknown-version`, same implementation as Q1 B but for forward; `RECONCILABLE` per Q3 (re-hydration vs new capture vs permanently non-reconcilable); drawer copy for `unknown-version`; version bump becomes breaking for old.
- Affected components: `provenance.ts`, `db.ts`, `reconciliation.ts`, `exceptions.ts`, `OfflineQueueDrawer.tsx`, `offline_queue_reconciliations`.
- Dependencies: `R09.3 Model 3/4`, `R09.4`, `DEC-TTL` (if soft grace for future).

**Option D — Reject both directions (` payloadVersion !== QUEUE_PAYLOAD_VERSION`, strict, version-locked).**
- What it means operationally: Only `===1` is replayable; both `<1` and `>1` → `quarantined` (`stale-version` + `unknown-version` or single `version-mismatch`).
- Immediate benefit: Strongest fail-closed — exactly `1` is replayable.
- Immediate cost/risk: Both backward and forward break unless `===1`; offline availability minimal unless all clients are exactly `1`; requires lockstep rollout.
- Downstream consequences: As B+C combined; strict policy; single `version-mismatch` vs two distinct `stale`/`unknown` is a naming choice.
- Affected components: as B+C.
- Dependencies: as B+C.

**Option E — Soft for future (grace period / warning-but-allow / TTL-linked).**
- What it means operationally: Allow future for N days, or `warning-but-allow` (toast but still replay), or quarantine future only after TTL age.
- Immediate benefit: Temporary forward compat.
- Immediate cost/risk: Delayed fail-closed; old deployment may silently misinterpret new field during grace.
- Downstream consequences: Needs `createdAt` + version joint, `DEC-TTL` threshold.
- Affected components: `provenance.ts`, `db.ts`, `queueApi.ts` (TTL).
- Dependencies: `DEC-TTL`.

**Evidence available now**

- Verified evidence: Same as Q1 — `QUEUE_PAYLOAD_VERSION=1`, `hasTrustworthyProvenance` only `!=null`, `R094` `9999` passes, queue-only, `post_pos_sale` identical for `9999`, no `unknown-version` exists — **ALREADY VERIFIED**.
- Evidence that remains unavailable: Real v2 shape for forward client (new field); `R094` extended through `post_pos_sale` with future shape; analytics `payloadVersion` distribution for future clients; drawer UX for `unknown-version` — all **STILL NOT EVIDENCED** (§10).
- Evidence that would require implementation: `unknown-version` `exceptionClass`, `hasTrustworthyProvenance` branching on `> current`, `isReconcilable` expansion, migration, drawer — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

Choose for **future/unknown versions `> current`** whether they remain replayable (Option A) or become typed `unknown-version` quarantine (Option C) — and whether the overall version policy should be `!== current` strict (Option D) or soft (Option E). Must be explicit whether `9999` (future) is replayable or quarantined after a version bump to `2`.

**Implementation consequences**

- If **A (keep)**: No `src/offline/*` change; forward compat maximal; docs record that old deployments will silently ignore unknown future fields until upgraded.
- If **C (unknown-version quarantine)**: Add `unknown-version` to `exceptionClass`, change `hasTrustworthyProvenance` to `payloadVersion === QUEUE_PAYLOAD_VERSION` or `> current → unknown-version`, same as Q1 B but for forward; `RECONCILABLE` per Q3; drawer copy; migration.
- If **D (strict)**: Add both `stale-version` + `unknown-version` (or `version-mismatch`) and require `===1`.
- If **E (soft)**: As C plus grace period + `DEC-TTL` integration.

**Dependencies**

- `DEC-10` — `null` stays `missing-provenance`.
- `R09.3 Model 3` — new typed class if rejecting future.
- `R09.3 Model 4` — `RECONCILABLE` (Q3).
- `R09.4` — `R094` measurement for `9999`.
- `DEC-TTL` — TTL threshold informs future grace.

---

### Q3 — Reconcilability of Typed Version Exceptions (DEC-09, Model 4)

**Question**

If either stale (`< current`) or future/unknown (`> current`) version becomes a typed exception (`stale-version`/`unknown-version` or strict `version-mismatch`), should that typed exception be `RECONCILABLE` (and if so, by **re-hydration** — migrate old payload to new shape — or by **new capture** — changed transaction is new `clientKey` per current philosophy) or **permanently non-reconcilable** (never replayable, never reconcilable)?

**Current verified behavior**

- `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) — **not version**.
- `reconcile_offline_queue_item` (`supabase/migrations/*` + `src/offline/reconciliation.ts`) replays **original `clientKey` immutably** — changed transaction is new `clientKey` per current philosophy; `payloadHash` + lease are checked; `isReconcilable(item)` checks `exceptionClass` is in `RECONCILABLE` + `payloadHash` + lease.
- `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` are **permanently non-reconcilable** (client+server `22023` before audit, `offline_queue_reconciliations` CHECK does not include version, `db.ts:277` keeps `null` intentionally). Verified via `grep -rn RECONCILABLE` + `reconciliation.ts`.
- No `stale-version`/`unknown-version` exists, so no `RECONCILABLE` decision for version exists at `bc97e32`.

**Options**

**Option R1 — RECONCILABLE via re-hydration (migrate old payload to current shape and replay original `clientKey`).**
- What it means operationally: Typed `stale-version`/`unknown-version` `failed` (not `quarantined`? Actually `RECONCILABLE` is for `failed` `stock-denied`/`policy-denied`; but `stale-version` as `failed` that is reconcilable would mean `failed` + `exceptionClass='stale-version'` can be `reconcile_offline_queue_item` with re-hydrated payload (add missing field, migrate). Requires new `reconcile` path that mutates payload before replay.

- Immediate benefit: Old offline work is not lost — stale payload is migrated to current shape and retried with original `clientKey` (preserves `clientKey` idempotency).
- Immediate cost/risk: Needs payload migration logic (e.g., add `discount_type` default), `payloadHash` must be recomputed or original hash exception, `reconcile_offline_queue_item` must allow re-hydrated payload (breaks current `payloadHash` + lease checks), `offline_queue_reconciliations` must include `stale-version`.
- Downstream consequences: `reconciliation.ts` `isReconcilable` must include `stale-version`/`unknown-version`, `RECONCILABLE_EXCEPTION_CLASSES` expansion, `reconcile_offline_queue_item` SQL change to allow re-hydration, `OfflineQueueDrawer` must show “reconcile” for `stale-version`, migration for `offline_queue_reconciliations` CHECK.
- Affected components: `src/offline/reconciliation.ts`, `exceptions.ts`, `db.ts`, `supabase/migrations/*` (`reconcile_offline_queue_item`, `offline_queue_reconciliations` CHECK), `OfflineQueueDrawer.tsx`.
- Dependencies: `R09.3 Model 4` — `RECONCILABLE` list; `DEC-TTL` — if soft grace, re-hydration after TTL.

**Option R2 — RECONCILABLE via new capture (current `reconcile` philosophy — changed transaction is new `clientKey`).**
- What it means operationally: `stale-version` `failed` is `RECONCILABLE` but `reconcile_offline_queue_item` **does not** re-hydrate old payload; instead it requires user to create a **new capture** (new `clientKey`, fresh `captureContext`/`payloadHash`) — changed transaction is new `clientKey` per `reconciliation.ts` immutable original `clientKey`.

- Immediate benefit: No payload migration — preserves current philosophy that original `clientKey` is immutable; cleaner.
- Immediate cost/risk: User must re-create transaction (new `clientKey`); old `clientKey` is not replayed.
- Downstream consequences: `RECONCILABLE` expansion as R1 but `reconcile` UI says “create new” not “retry original”; `offline_queue_reconciliations` still needs expansion, but `reconcile_offline_queue_item` logic is “new `clientKey`” not “re-hydrate”.
- Affected components: as R1 but `reconcile` is new capture, not payload mutation.
- Dependencies: `R09.3 Model 4`; `DEC-TTL`.

**Option R3 — Permanently non-reconcilable (never replayable, never `reconcile_offline_queue_item`, like `missing-provenance`/`payload-tampered`).**
- What it means operationally: `stale-version`/`unknown-version` → `quarantined` (or `failed` but not in `RECONCILABLE`), never `isReconcilable`, `reconcile_offline_queue_item` rejects, `offline_queue_reconciliations` CHECK not expanded, drawer shows “permanently quarantined” with no reconcile button.

- Immediate benefit: Simplest — no `RECONCILABLE` expansion, no migration, no re-hydration; consistent with `missing-provenance`/`payload-tampered`/`legacy` which are permanently non-reconcilable (client+server `22023` before audit).
- Immediate cost/risk: Offline work is lost — user must manually re-create anyway but via new `enqueue`, not via `reconcile`; offline `stale-version` queue items are never replayable.
- Downstream consequences: No `RECONCILABLE` change; `offline_queue_reconciliations` unchanged; drawer shows quarantine with no reconcile.
- Affected components: `provenance.ts`, `db.ts` (quarantine), `OfflineQueueDrawer.tsx` (no reconcile).
- Dependencies: `R09.3 Model 4` — explicitly **not** expanded; `DEC-TTL` — TTL `expired` similarly likely not reconcilable.

**Evidence available now**

- Verified evidence: `RECONCILABLE = ['stock-denied','policy-denied']` at `bc97e32`, `reconcile_offline_queue_item` replays original `clientKey` immutably, `payload-tampered`/`missing-provenance` permanently non-reconcilable — **ALREADY VERIFIED** via `reconciliation.ts` + `supabase/migrations`.
- Evidence that remains unavailable: Deterministic stale-reconciliation test (re-hydration vs new capture) — would need `stale-version` exception to exist and a v2 shape to migrate — **STILL NOT EVIDENCED** (§10, `IMPLEMENTATION REQUIRED`).
- Evidence that would require implementation: `RECONCILABLE` expansion, `offline_queue_reconciliations` CHECK migration, `reconcile_offline_queue_item` re-hydration logic, drawer reconcile button for `stale-version` — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

If **either** stale or future version becomes typed (Q1/Q2 = B/C/D), choose whether that typed version is **RECONCILABLE via re-hydration**, **RECONCILABLE via new capture** (current philosophy), or **permanently non-reconcilable**. Must be explicit per typed version (could be same or different for stale vs future).

**Implementation consequences**

- If **R1 (re-hydration)**: Add `stale-version`/`unknown-version` to `RECONCILABLE`, migration for `offline_queue_reconciliations` CHECK, update `reconciliation.ts` `isReconcilable` to include version, implement payload migration (add default for new field, recompute `payloadHash`), allow `reconcile_offline_queue_item` to replay original `clientKey` with re-hydrated payload.
- If **R2 (new capture)**: Add to `RECONCILABLE` but `reconcile` is new `clientKey` (fresh capture), no payload migration; `reconcile_offline_queue_item` creates new `clientKey` (as current does for `stock-denied`/`policy-denied` where changed transaction is new `clientKey`? Actually current `reconcile` replays original `clientKey` — need to verify; but new capture means user creates new `enqueue`).
- If **R3 (permanently non-reconcilable)**: No `RECONCILABLE` change; `stale-version`/`unknown-version` → `quarantined`, never reconcilable, no migration.

**Dependencies**

- `R09.3 Model 4` — `RECONCILABLE_EXCEPTION_CLASSES` (`['stock-denied','policy-denied']` at `bc97e32`).
- `R09.3 Model 3` — `stale-version`/`unknown-version` typed class must exist before it can be `RECONCILABLE`.
- `DEC-10` — `legacy` (`null`) is permanently non-reconcilable, informs version decision.
- `DEC-TTL` — TTL `expired` reconcilability (Q7) is analogous.

---

### Q4 — Retention Policy: Indefinite Retention vs TTL (DEC-TTL)

**Question**

Should the offline queue keep **indefinite retention** for `pending`/`failed`/`quarantined` (current: `pending`/`failed`/`quarantined` forever, `synced` 7-day manual `pruneSyncedItems`, `MAX_PENDING_QUEUE_ITEMS=2000`, `STALE_SYNC_CLAIM_MS=120000` `recoverStaleSyncClaims`, `LEASE_TTL_MS=30000` `claimLease`) or impose a **time-based horizon (TTL)** where aged items expire?

**Current verified behavior**

- `enqueue → pending` (`clientKey`, `sequence`, `createdAt`, `attemptCount=0`, `payloadVersion`, `payloadHash`, `originUserId`, `originBranchId`, `originShiftId`/`originDeviceIdentity`) — no age check (`src/offline/queueApi.ts`, `db.ts`, `provenance.ts`, `payloadIntegrity.ts`).
- `syncQueue → syncing+lease (`LEASE_TTL_MS=30000` `claimLease` at `src/offline/lease.ts`) → `syncItem` → `synced+resolvedServerId` or `failed+exceptionClass` or `quarantined` — `quarantined` never retried, never reconcilable; `failed` with `stock-denied`/`policy-denied` is `RECONCILABLE` via `reconcile_offline_queue_item` (original `clientKey` immutable) (`src/offline/reconciliation.ts`).
- `MAX_PENDING_QUEUE_ITEMS=2000` (`pending+failed+stale-syncing >=2000` throws `Offline queue is full`) — only count-based backpressure (`src/offline/queueApi.ts`).
- `STALE_SYNC_CLAIM_MS=120000` (`recoverStaleSyncClaims` returns `syncing>2m` to `pending`) (`src/offline/db.ts`).
- `pruneSyncedItems(7d)` manual-only — only definition + tests, no `useSyncQueue` call (`grep -rn pruneSyncedItems` shows only `src/offline/queueApi.ts` definition + `tests/release/r09*`); `offline_queue_reconciliations` append-only `SELECT` policy (audit).
- **No TTL for `pending`/`failed`/`quarantined` at `bc97e32`** — verified via `src/offline/*` (no `createdAt` age branch, no `expired` `quarantineReason`); an item with `createdAt` 6 months ago remains `pending` forever, still replayable if `hasTrustworthyProvenance` passes; `post_pos_sale` does **not** read `createdAt` (payload-only; `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` has no `createdAt` param) — P4 verified 180d old `createdAt` still `pending` without code change.
- Device performance O(n) `where('status').anyOf('pending','failed').toArray()` + sequential `syncItem` + `lease` — actual time/CPU/battery for 500/1000/2000 **NOT EVIDENCED** in PG harness (requires browser `IndexedDB`/`Dexie` `fake-indexeddb` not authoritative; `R09.2` did not measure).

**Options**

**Option A — Indefinite retention (keep current).**
- What it means operationally: `pending`/`failed`/`quarantined` never expire by age; `synced` 7d manual prune only; queue grows until `MAX_PENDING 2000` or manual reconcile.
- Immediate benefit: Maximal evidence preservation — no data loss, audit intact, offline availability maximal (old offline work like `originUserId` inactive, `originShiftId` closed can still be retried if provenance passes).
- Immediate cost/risk: Unbounded drawer if user never reconciles (`failed` `stock-denied` backlog grows); stale `origin*` drift (`originUserId` inactive, `originShiftId` closed, `originBranchId` drift → permanent `actor-mismatch` never cleaned); O(n) `syncQueue` slowdown as queue grows; storage growth until 2000 cap.
- Downstream consequences: No new `exceptionClass`; `RECONCILABLE` unchanged; `OfflineQueueDrawer` shows all `pending`/`failed`/`quarantined` forever; no migration.
- Affected components: none — `queueApi.ts`, `db.ts`, `lease.ts`, `reconciliation.ts` unchanged.
- Dependencies: `R09.2` evidence preservation — indefinite retention **preserves** R09.2; `R09.3 Model 3/4` — no new class; `R09.4` — no backlog perf measurement needed for policy but needed for operational burden.

**Option B — TTL (impose time-based horizon): `pending`/`failed`/`quarantined` (or at least `pending`) expire after age > threshold (see Q5).**
- What it means operationally: `createdAt` age > TTL threshold → disposition per Q6 (quarantine/delete/failed/new capture).
- Immediate benefit: Bounds queue age, storage, O(n) performance, stale provenance drift; hygiene.
- Immediate cost/risk: Reduces offline availability for legitimately aged offline work (device offline 10 days, no connectivity); needs `createdAt` distribution evidence to set threshold; `createdAt` can be tampered but `payloadHash` still covers.
- Downstream consequences: Needs new `expired` `quarantineReason`/`exceptionClass` (if quarantine), drawer copy, `RECONCILABLE` decision (Q7), migration for `offline_queue_reconciliations` CHECK if reconcilable, lease-aware expiry (must not delete `syncing` with held lease — must respect `claimLease` + `staleSyncing` recovery).
- Affected components: `src/offline/queueApi.ts` (TTL check), `db.ts` (`expired` `quarantine`), `lease.ts` (lease interaction), `reconciliation.ts` (`RECONCILABLE`), `OfflineQueueDrawer.tsx`, `supabase/migrations/*` (`offline_queue_reconciliations` CHECK).
- Dependencies: `R09.3 Model 3` — `expired` would be new typed; `R09.3 Model 4` — `RECONCILABLE` (Q7); `R09.4` — backlog perf via browser; `DEC-09` — stale `payloadVersion` grace; `DEC-10` — `legacy` `null` handling; `Auth/Recovery` (`originUserId`/`deviceIdentity` drift informs TTL).

Do not collapse retention (Q4) with threshold (Q5), disposition (Q6), reconcilability (Q7) — they are separate decisions per instruction.

**Evidence available now**

- Verified evidence: Full lifecycle trace, `MAX_PENDING 2000`, `STALE_SYNC 2m`, `LEASE 30s`, `pruneSynced 7d` manual, `offline_queue` Dexie store, no TTL, `offline_queue_reconciliations` append-only, `post_pos_sale` does not read `createdAt`, P4 verified 180d old `createdAt` still `pending` and replayable without code change, O(n) code path — **ALREADY VERIFIED** via source + `grep` + P4 probe.
- Evidence that remains unavailable: Age distribution `createdAt` p50/p95 from analytics; `R094.BROWSER.PERSIST-RESTART` extended to 30/60/90-day replay through `post_pos_sale`; `syncQueue` duration with 500/1000/2000 (browser `IndexedDB`/`Dexie` perf) — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED** (PG harness not authoritative); current use of `pruneSyncedItems` in prod; lease/TTL race lived — all **STILL NOT EVIDENCED** (§10).
- Evidence that would require implementation: TTL check `if (Date.now() - item.createdAt > TTL) → expired`, lease-aware expiry (respect `claimLease` + `staleSyncing`), `pruneSyncedItems` auto vs manual — **IMPLEMENTATION REQUIRED** (would require changing `queueApi.ts`/`db.ts`/`lease.ts`; STOP if production data/migration needed).

**Decision required from Alexander**

Choose whether the queue keeps **indefinite retention** (Option A) or imposes a **TTL** (Option B). This is the retention-policy decision; threshold, disposition, and reconcilability are Q5–Q7.

**Implementation consequences**

- If **A (indefinite)**: No `src/offline/*` change; `MAX_PENDING 2000` remains only backpressure; drawer shows indefinite; R09.2 preservation maximal.
- If **B (TTL)**: Add TTL threshold constant (e.g., `QUEUE_TTL_MS`), add age check in `syncQueue`/`sweepUnverifiableItems`/`pruneSyncedItems`, add `expired` `quarantineReason`/`exceptionClass` (if quarantine per Q6), lease-aware expiry (must not delete `syncing` with held lease — must explicitly release lease or wait for `recoverStaleSyncClaims`), drawer handling for `expired`, migration for `offline_queue_reconciliations` CHECK if `expired` is `RECONCILABLE` (Q7), decide auto vs manual `pruneSyncedItems`.

**Dependencies**

- `R09.2` (provenance/lease/quarantine) — indefinite preserves R09.2; TTL must not overwrite provenance `quarantineReason` without evidence.
- `R09.3 Model 3` — `pending→failed` vs `quarantined` disposition for `expired`.
- `R09.3 Model 4` — `failed` `RECONCILABLE` vs `quarantined` never (Q7).
- `R09.4` — backlog perf measurement via browser (`IndexedDB`).
- `DEC-09` — stale `payloadVersion` informs age threshold (soft grace).
- `DEC-10` — `legacy` `null` handling (must not conflate `expired` with `missing-provenance`).
- `Auth/Recovery` (`originUserId`/`deviceIdentity` drift) — TTL cleans stale actor.
- `MAX_PENDING` 2000 cap — count + age are complementary bounds.

---

### Q5 — Expiry Threshold (DEC-TTL)

**Question**

If TTL is imposed (Q4 = TTL), what threshold should be used: **none** (keep indefinite, i.e., Q4 = indefinite), **7 days**, **30 days**, **90 days**, or **another explicitly defined threshold**?

**Current verified behavior**

- No threshold exists at `bc97e32`; `pruneSyncedItems` default is `7d` but only for `synced` (not `pending`/`failed`/`quarantined`), and it is manual-only; no `QUEUE_TTL_MS` constant.

**Options**

For every option, show operational consequences without recommending a winner. The instruction says explicitly show consequences for `indefinite` (already Q4 A), `7d`, `30d`, `90d`, `another`.

**Option T0 — None / Indefinite (Q4 = indefinite).**
- What it means operationally: No TTL threshold; same as Q4 A.
- Immediate benefit: No expiry, maximal availability.
- Immediate cost/risk: Unbounded until 2000 cap.
- Downstream consequences: No `expired` logic; threshold decision is moot.
- Affected components: none.
- Dependencies: `DEC-09` stale grace, `R09.4` backlog perf, `MAX_PENDING`.

**Option T7 — 7 days.**
- What it means operationally: `createdAt` age > 7d → disposition per Q6.
- Immediate benefit: Aggressive hygiene — cleans stale `origin*` drift quickly after a week; bounds O(n) quickly.
- Immediate cost/risk: May quarantine legitimate offline work (device offline 8 days without connectivity, e.g., travel, no signal) — offline availability reduced for 8-day offline.
- Downstream consequences: `expired` quarantines after 7d (if Q6 = quarantine); `RECONCILABLE` per Q7; lease interaction must respect 30s lease vs 2m staleSync vs 7d TTL — no race if respects lease (code analysis).
- Affected components: `queueApi.ts` TTL constant, `db.ts`, `lease.ts`.
- Dependencies: `MAX_PENDING` 2000 (count + 7d age); `DEC-09` stale grace would be 7d; `R09.4` browser perf at 7d backlog; `Auth/Recovery` 7d `originUserId` drift; analytics `createdAt` p50/p95 would inform whether 7d is too short — **NOT EVIDENCED**.

**Option T30 — 30 days.**
- What it means operationally: Age > 30d → disposition.
- Immediate benefit: Moderate hygiene — allows 30-day offline (e.g., month-long offline), still bounds drawer.
- Immediate cost/risk: Retains stale provenance for 30d (stale `originShiftId` closed, `originUserId` inactive could still be retried for 30d).
- Downstream consequences: As T7 but 30d grace; `expired` after 30d.
- Affected components: as T7.
- Dependencies: as T7 but 30d interacts with `DEC-09` soft grace 30d.

**Option T90 — 90 days.**
- What it means operationally: Age > 90d → disposition.
- Immediate benefit: Conservative — preserves offline work for 90 days (quarter), minimal impact on legitimate offline.
- Immediate cost/risk: Retains stale context longest; O(n) grows longest; storage longest; stale `origin*` drift persists 90d.
- Downstream consequences: As T7 but 90d; hygiene weakest.
- Affected components: as T7.
- Dependencies: as T7.

**Option T-Other — Another explicitly defined threshold (e.g., 14d, 60d, 180d, or per `originShiftId` closed + 2d).**
- What it means operationally: Threshold is not 7/30/90 but another value, or dynamic (e.g., `originShiftId` closed + N days).
- Immediate benefit: Can be tuned to actual `createdAt` distribution (if analytics existed).
- Immediate cost/risk: Needs evidence — age distribution p50/p95 from analytics; `MAX_PENDING` 2000 may be sufficient without TTL for many customers.
- Downstream consequences: Must be explicitly defined before implementation; cannot be “another threshold” without definition.
- Affected components: as T7.
- Dependencies: analytics `createdAt` distribution — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED**.

**Evidence available now**

- Verified evidence: No threshold exists; `pruneSyncedItems` 7d for `synced` only, manual-only; `MAX_PENDING` 2000, `STALE_SYNC` 2m, `LEASE` 30s — **ALREADY VERIFIED**.
- Evidence that remains unavailable: Age distribution `createdAt` p50/p95; queue size/age from prod; `R094` 30/60/90-day replay; `syncQueue` duration at 500/1000/2000 (browser); lease/TTL race lived — all **STILL NOT EVIDENCED** (§10).
- Evidence that would require implementation: `QUEUE_TTL_MS` constant, age check `if (Date.now() - item.createdAt > T)`, lease-aware expiry — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

If Q4 = TTL, choose **threshold**: none (i.e., keep indefinite, Q4 = indefinite) / `7d` / `30d` / `90d` / **another explicitly defined threshold** (must be specified, e.g., `14d` or `60d`). Must be explicit per instruction.

**Implementation consequences**

- If **T0 (none)**: No threshold constant; Q6/Q7 moot.
- If **T7/T30/T90/T-Other**: Add `QUEUE_TTL_MS` (e.g., `7*24*60*60*1000`), add check in `syncQueue`/`sweep`/`prune`, update `OfflineQueueDrawer` to show age, migration if `expired` is `RECONCILABLE` (Q7), ensure lease-aware (must not delete `syncing` with held lease).

**Dependencies**

- `Q4` retention policy — threshold only if Q4 = TTL.
- `R09.2` — TTL must not lose evidence without quarantine.
- `R09.3 Model 3/4` — `expired` disposition.
- `R09.4` — backlog perf informs threshold.
- `DEC-09` — stale `payloadVersion` grace (E).
- `DEC-10` — `legacy` handling.
- `Auth/Recovery` — `originUserId` drift.
- `MAX_PENDING` — count + age.

---

### Q6 — Post-Expiry Disposition (DEC-TTL)

**Question**

If an item expires (age > threshold from Q5), what disposition should it receive: **quarantine (`expired` `quarantineReason`, visible, never retried, `quarantinedAt`)**, **delete** (remove row), **`failed` (no `exceptionClass`, ordinary `failed`)**, or **require new capture** (delete + toast “re-create” with fresh `captureContext`/`payloadHash`)? Do not collapse with retention/threshold.

**Current verified behavior**

- `quarantined` is durable, visible in `OfflineQueueDrawer` (`quarantineReason` `missing-provenance`/`actor-mismatch`/`payload-tampered`/`legacy`), never retried, never reconcilable, `quarantinedAt`, auditable via `offline_queue_reconciliations` append-only.
- `failed` (no `exceptionClass`, ordinary) is retried by `syncQueue` (`where('status').anyOf('pending','failed')` → `syncing`+lease → retry) — infinite loop if authority-denied (P4 §5.2 C).
- `synced` is manual `pruneSyncedItems(7d)` only; `pending`/`failed`/`quarantined` never pruned by age at `bc97e32`.

**Options**

**Option D-Qua — Expiry → quarantine (`expired`).**
- What it means operationally: Age > T → `status='quarantined'`, `quarantineReason='expired'`, `quarantinedAt=Date.now()`, never retried, visible.
- Immediate benefit: Preserves evidence — distinct from `missing-provenance`, auditable via `offline_queue_reconciliations` if `RECONCILABLE` (Q7); never retried (correct for expired).
- Immediate cost/risk: Needs new `quarantineReason` `expired`, drawer copy for `expired`; if `RECONCILABLE` (Q7) needs migration.
- Downstream consequences: New `exceptionClass` `expired` (if `expired` is also `exceptionClass` for `failed`? Actually `quarantined` has `quarantineReason`, `failed` has `exceptionClass`; `expired` as `quarantined` needs `quarantineReason='expired'`); `OfflineQueueDrawer` must show `expired`; `reconcile_offline_queue_item` per Q7.
- Affected components: `src/offline/db.ts` (`quarantineReason`), `queueApi.ts` (TTL check), `OfflineQueueDrawer.tsx`, `supabase/migrations/*` (`offline_queue_reconciliations` CHECK if reconcilable), `reconciliation.ts` (Q7).
- Dependencies: `R09.3 Model 3` — `expired` would be new typed; `R09.3 Model 4` — `RECONCILABLE` (Q7); `R09.4`; `DEC-09` stale grace.

**Option D-Del — Expiry → delete (remove row).**
- What it means operationally: `db.queue.delete(item.id)` when age > T, no quarantine.
- Immediate benefit: Minimal storage, drawer, performance — hygiene maximal.
- Immediate cost/risk: **Evidence loss** — violates `R09.2` evidence preservation (R09.2 says `quarantined` is durable, `offline_queue_reconciliations` audit); silent disappearance (user may not know offline work was deleted); conflicts with `offline_queue_reconciliations` audit (delete loses payload/provenance).
- Downstream consequences: No `expired` to show, no reconciliation, audit violation; must not delete `syncing` with held lease.
- Affected components: `db.ts` delete, `queueApi.ts` TTL, `lease.ts` (must not delete `syncing` with lease).
- Dependencies: `R09.2` — **technically contradictory** with R09.2 preservation; instruction says do not recommend one, but describe concrete reason: delete violates R09.2, but not selected as winner.

**Option D-Fail — Expiry → `failed` (no `exceptionClass`, ordinary `failed`).**
- What it means operationally: Age > T → `status='failed'`, `exceptionClass=undefined`, `lastErrorCode` maybe `null`, payload preserved but status is `failed`.
- Immediate benefit: Payload preserved (not deleted).
- Immediate cost/risk: **Infinite retry loop — integrity harm**, technically unsafe because `syncQueue` selects `pending+failed` and retries forever, re-denied if expired is treated as authority-like or replayed as stale — never quarantines; describe factually without ranking.
- Downstream consequences: `failed` without `exceptionClass` is not `RECONCILABLE` at `bc97e32` (only `stock-denied`/`policy-denied` are); `expired` as `failed` would never be quarantined and would loop.
- Affected components: `queueApi.ts` (set `failed`), `exceptions.ts` (`classifyReplayException` — `expired` would be ordinary), `reconciliation.ts` (not `RECONCILABLE`).
- Dependencies: `R09.3 Model 3` — `pending→failed` vs `quarantined`; `R09.3 Model 4` — not reconcilable.

**Option D-Cap — Expiry → require new capture (delete + toast “re-create” with fresh `captureContext`/`payloadHash`/`clientKey`).**
- What it means operationally: Age > T → `db.queue.delete(item.id)` + toast “This offline sale expired — please re-create with fresh context” + new `enqueue` with fresh `captureContext` (new `clientKey`, `sequence`, `capturedAt`, `origin*`).
- Immediate benefit: Intentional — evidence loss unless audited (like delete) but fresh `captureContext`/`payloadHash` solves stale provenance (`originUserId` inactive, `originShiftId` closed).
- Immediate cost/risk: Evidence loss unless audited (like delete); needs UX toast + re-create flow; user must manually re-enter; original `clientKey` lost.
- Downstream consequences: Not reconciliation (new `clientKey`, not `reconcile_offline_queue_item`); needs audit if `expired` must be preserved before delete; no `RECONCILABLE`.
- Affected components: `db.ts` delete, `queueApi.ts` TTL + toast, `OfflineQueueDrawer.tsx` (toast), `supabase/migrations` (audit if needed).
- Dependencies: `R09.2` — evidence loss must be audited; `R09.3 Model 3/4` — not reconcilable; `Auth/Recovery` — solves stale actor.

**Evidence available now**

- Verified evidence: `quarantined` vs `failed` vs `synced` semantics, `quarantined` durable/visible/never retried, `failed` loops, `synced` manual prune, no `expired` exists, `offline_queue_reconciliations` append-only — **ALREADY VERIFIED**.
- Evidence that remains unavailable: Same as Q4–Q5 (age distribution, backlog perf, lease/TTL race) — **STILL NOT EVIDENCED**.
- Evidence that would require implementation: `expired` `quarantineReason` `failed` vs `quarantined` vs delete, toast, new capture — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

Choose **post-expiry disposition**: `quarantine` (`expired` `quarantineReason`, visible, never retried) / `delete` (remove row) / `failed` (no `exceptionClass`, ordinary `failed`, infinite loop) / `require new capture` (delete + toast “re-create” with fresh context). Must be explicit and not collapsed with retention/threshold.

**Implementation consequences**

- If **D-Qua (quarantine)**: Add `expired` to `quarantineReason` (`src/offline/db.ts`), TTL check sets `quarantined`+`quarantinedAt`, drawer copy for `expired`, `RECONCILABLE` per Q7 + migration if `expired` is `RECONCILABLE`, lease-aware (must not quarantine `syncing` with held lease without releasing).
- If **D-Del (delete)**: Add TTL check deletes row; violates R09.2 unless audited; must not delete `syncing` with lease.
- If **D-Fail (failed)**: Add TTL check sets `failed` (no `exceptionClass`); creates infinite loop — must be documented as unsafe but not ranked.
- If **D-Cap (new capture)**: Add TTL check deletes + toast re-create; needs `enqueue` with fresh `captureContext`.

**Dependencies**

- `Q4` retention, `Q5` threshold — disposition only if TTL.
- `R09.2` — `quarantined` preserves evidence, `delete` violates.
- `R09.3 Model 3` — `pending→failed` vs `quarantined` for `expired`.
- `R09.3 Model 4` — `RECONCILABLE` (Q7).
- `R09.4` — backlog perf.
- `DEC-09` — stale-version grace.
- `DEC-10` — `legacy` handling.

---

### Q7 — Is `expired` Reconcilable? (DEC-TTL, Model 4)

**Question**

If `expired` is `quarantined` (Q6 = quarantine), should `expired` be **`RECONCILABLE`** (and if so, by **re-hydration** — migrate aged payload with fresh `captureContext` but replay original `clientKey` — or by **new capture** — changed transaction is new `clientKey` per current philosophy) or **permanently non-reconcilable** (never `reconcile_offline_queue_item`, like `missing-provenance`/`payload-tampered`)?

**Current verified behavior**

- `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) — `expired` does not exist, so not `RECONCILABLE` at `bc97e32`.
- `quarantined` is never reconcilable at `bc97e32`; `failed` `stock-denied`/`policy-denied` are reconcilable via `reconcile_offline_queue_item` (original `clientKey` immutable, `payloadHash` + lease checked, `offline_queue_reconciliations` CHECK does not include `expired`).
- `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` are permanently non-reconcilable (client+server `22023` before audit).

**Options**

**Option R-Rec-Hyd — RECONCILABLE via re-hydration (migrate aged payload with fresh `captureContext` but replay original `clientKey`).**
- What it means operationally: `expired` `quarantined` → `failed` `expired` that is `isReconcilable` (like `stock-denied`) → `reconcile_offline_queue_item` re-hydrates aged payload (fresh `captureContext` `origin*`/`capturedAt`, recompute `payloadHash`) and replays original `clientKey`.

- Immediate benefit: Aged offline work is not lost — expired payload is migrated and retried.
- Immediate cost/risk: Needs payload age-migration logic, `payloadHash` recomputation, `reconcile_offline_queue_item` must allow re-hydrated payload (breaks current `payloadHash` + lease checks), `offline_queue_reconciliations` must include `expired`.
- Downstream consequences: `RECONCILABLE` expansion to include `expired`, migration for `offline_queue_reconciliations` CHECK, `reconciliation.ts` `isReconcilable` change, drawer “reconcile” for `expired`.
- Affected components: `reconciliation.ts`, `exceptions.ts`, `db.ts`, `supabase/migrations/*` (`reconcile_offline_queue_item`, `offline_queue_reconciliations` CHECK), `OfflineQueueDrawer.tsx`.
- Dependencies: `R09.3 Model 4` — `RECONCILABLE` list; `DEC-09` stale-version reconcilability (Q3) is analogous.

**Option R-Rec-New — RECONCILABLE via new capture (current philosophy — changed transaction is new `clientKey`).**
- What it means operationally: `expired` is `RECONCILABLE` but `reconcile` means user creates **new capture** (new `clientKey`, fresh `captureContext`), not re-hydrate old.

- Immediate benefit: No payload migration — preserves current philosophy that original `clientKey` is immutable.
- Immediate cost/risk: User must re-create (new `clientKey`); old `clientKey` not replayed.
- Downstream consequences: `RECONCILABLE` expansion as R-Rec-Hyd but `reconcile` UI says “create new” not “retry original”.
- Affected components: as R-Rec-Hyd but `reconcile` is new capture.
- Dependencies: `R09.3 Model 4`.

**Option R-Non — Permanently non-reconcilable (never replayable, like `missing-provenance`/`payload-tampered`).**
- What it means operationally: `expired` → `quarantined` `expired`, never `isReconcilable`, `reconcile_offline_queue_item` rejects, drawer shows “permanently quarantined” with no reconcile button.

- Immediate benefit: Simplest — no `RECONCILABLE` expansion, no migration, consistent with `missing-provenance`/`payload-tampered`/`legacy`.
- Immediate cost/risk: Aged offline work is never replayable (lost unless manually re-created via new `enqueue`, not via `reconcile`).
- Downstream consequences: No `RECONCILABLE` change; `expired` quarantined forever.
- Affected components: `db.ts` (quarantine), `OfflineQueueDrawer.tsx` (no reconcile).
- Dependencies: `R09.3 Model 4` — explicitly not expanded.

**Evidence available now**

- Verified evidence: `RECONCILABLE = ['stock-denied','policy-denied']`, `quarantined` never reconcilable, `reconcile_offline_queue_item` replays original `clientKey` immutably, `payload-tampered`/`missing-provenance` permanently non-reconcilable — **ALREADY VERIFIED**.
- Evidence that remains unavailable: Deterministic `expired`-reconciliation test (re-hydration vs new capture) — would need `expired` exception to exist — **STILL NOT EVIDENCED** (§10, `IMPLEMENTATION REQUIRED`).
- Evidence that would require implementation: `RECONCILABLE` expansion to include `expired`, `offline_queue_reconciliations` CHECK migration, `reconcile_offline_queue_item` re-hydration — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

If Q6 = quarantine (`expired`), choose whether `expired` is **RECONCILABLE via re-hydration**, **RECONCILABLE via new capture** (current philosophy), or **permanently non-reconcilable**. Must be explicit and not collapsed with retention/threshold/disposition.

**Implementation consequences**

- If **R-Rec-Hyd**: Add `expired` to `RECONCILABLE`, migration for `offline_queue_reconciliations` CHECK, update `isReconcilable` to include `expired`, implement re-hydration (fresh `captureContext`, recompute `payloadHash`), allow `reconcile_offline_queue_item` to replay original `clientKey` with re-hydrated payload.
- If **R-Rec-New**: Add to `RECONCILABLE` but `reconcile` is new `clientKey` (fresh capture), no payload migration.
- If **R-Non**: No `RECONCILABLE` change; `expired` → `quarantined`, never reconcilable.

**Dependencies**

- `Q4` retention, `Q5` threshold, `Q6` disposition — reconcilability only if Q6 = quarantine (or `failed` if `expired` is `failed` and reconcilable — but `failed` without `exceptionClass` is not reconcilable at `bc97e32`).
- `R09.3 Model 4` — `RECONCILABLE_EXCEPTION_CLASSES`.
- `R09.3 Model 3` — `expired` typed class must exist.
- `DEC-09` — stale-version reconcilability (Q3) is analogous.

---

### Q8 — Which Ordinary Authority Failures Should Become Typed/Quarantined vs Remain Ordinary `failed` (OFFLINE.CONFLICT, Model 3)

**Question**

Which currently **ordinary `failed` (no `exceptionClass`, retried forever)** authority failures — specifically `42501` (`can_operate_pos`/`can_access_branch` branch/tenant/auth) and `22023` (`checkPosLineProductsBelongToBusiness` product tenant, `Claimed shift does not belong to the claimed terminal` terminal mismatch) — should become **typed exception** (`branch-denied`/`terminal-denied`/`auth-denied`) or **`quarantined`** (visible, never retried, permanently non-reconcilable) vs **remain ordinary `failed` (current, `pending→failed→syncing→failed` loop forever)**?

**Current verified behavior**

- At `bc97e32`, `42501` and `22023` (except `23514` `stock-denied` and `P0QLT` `policy-denied`) → **ordinary `failed` (no `exceptionClass`)** via `src/offline/exceptions.ts` `classifyReplayException` — only `23514` → `stock-denied` and `P0QLT` → `policy-denied` are typed; others are `ordinary failed` (`lastErrorCode` maybe, but no `exceptionClass`).
- `syncQueue` (`src/offline/queueApi.ts`) selects `pending+failed` (plus `recoverStaleSyncClaims` `syncing>2m`), marks `syncing`+`lease` (`LEASE_TTL_MS=30000` `claimLease`), retries — **re-denied deterministically**, never `quarantined`, never `RECONCILABLE` (`R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` + `R093.RECON.INTEGRITY-REFUSED` before audit — `failed` before audit, never reconcilable).
- Mutation envelope **zero each attempt** (full rollback) — P4 disposable probe `B_cashier` on `business A` `6002` → `42501 You do not have permission…`, immediate second `6003` → same `42501`, `A` invoices `before 2 → after 2` delta `0`, `B` invoices `0` — verified via `count(*)` + `invoices`/`stock_movements`/`journal_entries` counts.
- **Terminal mismatch** `22023` at `supabase/migrations/20260930000001_r08_post_pos_sale_binding.sql:114` exists, but `pos_shifts.terminal_id` is `null` for `A_shift` (`19faface-115b-49f2-87fc-1e321f609d6b`) while `pos_terminals` `A` is `3bfbf62c-e7c6-41b8-ad2f-b4c86d9e40b2`; client `saleFixture` does **not** send `terminal_id` (only `shift_id`), so standard POS never hits — **NOT EVIDENCED as lived PASS**, source-declared only (`branch/tenant mismatch` is `42501`/`22023` **PASS** via `R06.PRODUCT-MISMATCH`, `CROSS-TENANT`, `R093.MATRIX`).
- **Infinite retry loop** exists for 5/6/10 (ordinary `failed` re-denied forever) — whether to promote to typed/quarantine is policy (P4 §6.1, §6.3).

**Preserve distinction**

- **Ordinary failed retry** — `pending→failed→syncing→failed` loop forever, retried each `syncQueue`.
- **Typed exception** — `failed` + `exceptionClass='branch-denied'` etc., not retried, `offline_queue_reconciliations` maybe, `isReconcilable` per Model 4.
- **Quarantine** — `quarantined` + `quarantineReason='branch-denied'` etc., never retried, never reconcilable, `quarantinedAt`, drawer visible.
- **Reconcilable exception** — `failed` `stock-denied`/`policy-denied` can `reconcile_offline_queue_item` (original `clientKey` immutable, `payloadHash` + lease).
- **Permanent non-reconcilable** — `quarantined` `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` never `reconcile` (client+server `22023` before audit).

**Options**

**Option O-Keep — Remain ordinary `failed` (current, retried forever).**
- What it means operationally: `42501`/`22023` stay `failed` (no `exceptionClass`), `syncQueue` retries each cycle, re-denied, delta 0, never `quarantined`.
- Immediate benefit: No `src/offline/*` change; `exceptionClass` stays `stock-denied`/`policy-denied` only.
- Immediate cost/risk: **Infinite loop** — authority-denied offline work loops `pending→failed→syncing→failed` indefinitely until manual `quarantine` or `prune`; O(n) `syncQueue` repeatedly retries deterministically denied items; no `RECONCILABLE`.
- Downstream consequences: No new `exceptionClass`; `OfflineQueueDrawer` shows `failed` with `lastErrorCode` `42501`/`22023` but no typed handling; user sees repeated `failed` → `syncing` → `failed`.
- Affected components: none — `exceptions.ts`, `reconciliation.ts`, `db.ts` unchanged.
- Dependencies: `R09.3 Model 3` — ordinary vs typed; `R09.3 Model 4` — not `RECONCILABLE` at `bc97e32`; `R02` (auth/recovery) — `42501` is auth.

**Option O-Qua — Promote to `quarantined` (`quarantineReason='branch-denied'`/`terminal-denied`/`auth-denied`).**
- What it means operationally: `42501`/`22023` → `quarantined` `quarantineReason` branch/terminal/auth, `quarantinedAt`, never retried, never reconcilable (like `missing-provenance`).
- Immediate benefit: Stops infinite loop — quarantined, visible, never retried.
- Immediate cost/risk: Needs new `quarantineReason` branch/terminal, drawer copy, `offline_queue_reconciliations` maybe not expanded (permanently non-reconcilable like `payload-tampered`).
- Downstream consequences: New `quarantineReason` `branch-denied` etc., `sweepUnverifiableItems`-like quarantine or `exceptions.ts` quarantine branch, `OfflineQueueDrawer` shows quarantine with no reconcile.
- Affected components: `src/offline/exceptions.ts` (quarantine path), `db.ts` (`quarantineReason`), `OfflineQueueDrawer.tsx`, `supabase/migrations/*` (`offline_queue_reconciliations` CHECK not expanded if permanently non-reconcilable).
- Dependencies: `R09.3 Model 3` — quarantine is Model 3 pattern; `R02` — `42501` auth; `BRANCH.*` `P8` — branch `42501` interacts with `P8`.

**Option O-Typed — Promote to typed `exceptionClass` (`branch-denied`/`terminal-denied`/`auth-denied` as `failed` with `exceptionClass`).**
- What it means operationally: `42501`/`22023` → `failed` + `exceptionClass='branch-denied'` etc., not retried (like `stock-denied`/`policy-denied`), `offline_queue_reconciliations` maybe, `isReconcilable` per Model 4 (see Q11).
- Immediate benefit: Distinct from ordinary `failed`, not retried, can be `RECONCILABLE` per Q11 if desired; stops infinite loop but allows `reconcile`.
- Immediate cost/risk: Needs new `exceptionClass` branch/terminal, `classifyReplayException` change, `lastErrorCode` handling, retry vs quarantine branching.
- Downstream consequences: New `exceptionClass`, `reconciliation.ts` `RECONCILABLE` decision (Q11), drawer copy for `branch-denied` etc., migration for `offline_queue_reconciliations` CHECK if `RECONCILABLE`.
- Affected components: `exceptions.ts` (`classifyReplayException`), `reconciliation.ts` (`RECONCILABLE`), `db.ts` (`exceptionClass`), `OfflineQueueDrawer.tsx`, `supabase/migrations/*`.
- Dependencies: `R09.3 Model 3` — new typed class; `R09.3 Model 4` — `RECONCILABLE` (Q11); `BRANCH.*` — branch `42501` is `P8`.

**Evidence available now**

- Verified evidence: `42501`/`22023` → ordinary `failed` (only `23514`/`P0QLT` are typed), `syncQueue` retries forever, re-denied, delta 0, `R093.MATRIX` + `R093.RECON.INTEGRITY-REFUSED` before audit, terminal code `20260930000001:114` exists but `terminal_id` null vs `3bfbf62c` — not lived, branch/tenant `R06` PASS — **ALREADY VERIFIED** via source + migration + disposable PG probe.
- Evidence that remains unavailable: Terminal-mismatch lived `R09.*` PASS — **NOT EVIDENCED** (source only, standard POS never hits); version-gated matrix with v2 shape; `updated_at` stale-document spec — **STILL NOT EVIDENCED** (§10).
- Evidence that would require implementation: New `branch-denied`/`terminal-denied` `exceptionClass`/`quarantineReason`, `exceptions.ts` quarantine/typed branch, `lastErrorCode` handling, retry vs quarantine branching, `reconcile` for `branch-denied` — **IMPLEMENTATION REQUIRED** (blocked until owner decision).

**Decision required from Alexander**

For **each** currently ordinary authority failure (`42501` branch/tenant/auth, `22023` product tenant, `22023` terminal mismatch), choose whether it **remains ordinary `failed` (retried forever, current)**, becomes **`quarantined`** (never retried, permanently non-reconcilable), or becomes **typed `exceptionClass` `branch-denied`/`terminal-denied`** (not retried, `RECONCILABLE` per Q11). Must be explicit per `42501`/`22023` pair and per terminal mismatch (which is currently source-declared not lived).

**Implementation consequences**

- If **O-Keep**: No `src/offline/*` change; infinite loop remains documented.
- If **O-Qua**: Add `quarantineReason` `branch-denied`/`terminal-denied`, change `exceptions.ts` to quarantine `42501`/`22023` (instead of ordinary `failed`), drawer quarantine copy, no `RECONCILABLE` expansion (permanently non-reconcilable).
- If **O-Typed**: Add `exceptionClass` `branch-denied`/`terminal-denied` to `src/offline/exceptions.ts` `classifyReplayException`, update `reconciliation.ts` `RECONCILABLE` per Q11, drawer typed copy, migration for `offline_queue_reconciliations` CHECK if `RECONCILABLE`.

**Dependencies**

- `R09.3 Model 3` — typed `exceptionClass` (`stock-denied`/`policy-denied` are typed at `bc97e32`; `branch-denied` would be new).
- `R09.3 Model 4` — `RECONCILABLE_EXCEPTION_CLASSES` (`Q11`).
- `R02` — `42501` is auth/recovery (`can_operate_pos`/`can_access_branch`).
- `BRANCH.*` `P8` — branch `42501`/`22023` (`checkPosLineProductsBelongToBusiness`) interacts with `P8` branch enforcement.
- `DEC-03` — branch assignments.

---

### Q9 — Should Payload-Version Become a Typed Conflict? (OFFLINE.CONFLICT, Model 3)

**Question**

Should **payload-version conflicts** (class 7, `payloadVersion < QUEUE_PAYLOAD_VERSION` `stale` or `> QUEUE_PAYLOAD_VERSION` `unknown/future`) become a **typed conflict** (`stale-version`/`unknown-version` `exceptionClass` `failed` not retried, or `quarantined` `quarantineReason`) vs remain **`NOT EVIDENCED`/ordinary** (current, any non-null `payloadVersion` passes `hasTrustworthyProvenance`, `0`/`9999` replayable, no version check, no `stale-version` SQLSTATE)?

**Current verified behavior**

- Code does **not** check version (any non-null passes `hasTrustworthyProvenance` `payloadVersion != null && originUserId && capturedAt`) — **NOT EVIDENCED** as conflict, only `R094.BROWSER.STALE-VERSION-MEASURE` measurement (`0`/`9999` pass, `null` → `missing-provenance`) — verified via `src/offline/provenance.ts` + `grep -rn payloadVersion` (no `===1`, no `stale-version`).
- `payloadVersion` is **queue-only** (Dexie `ledgr-offline` `queue`), not in `post_pos_sale` JSON (`supabase/migrations/20260923000000_post_pos_sale_rpc.sql` has no `payloadVersion` param, body grep 0 hits); second `post_pos_sale` with same payload but conceptual `0` vs `9999` is identical JSON → identical server result — P4 `5001` PASS `1e9aa9fd-…` identical confirms server has no version signal; version conflict is **NOT a server conflict** at `bc97e32`, it is a **client provenance gate only** (DEC-09).
- **Missing version** (`payloadVersion == null`) is `missing-provenance` quarantine (legacy `db.ts:277` keeps `null` intentionally), permanently non-reconcilable — distinct from `stale` (`< current`) and `unknown` (`> current`).
- **Trustworthy provenance** (`payloadVersion != null` + `originUserId` + `capturedAt`) is the current gate; no `stale-version`/`unknown-version` `exceptionClass` exists; `RECONCILABLE` is `['stock-denied','policy-denied']` not version.

**Preserve distinction**

- **Payload-version mismatch** (`< current` stale, `> current` unknown) — would be `stale-version`/`unknown-version` if typed.
- **Tampered payload** (`payloadHash` SHA-256 `verifyPayloadIntegrity` + server `22023` before audit) — already `payload-tampered` quarantine, permanently non-reconcilable (`R093.TAMPER` PASS) — distinct from version.
- **Missing provenance** (`payloadVersion == null` → `missing-provenance` quarantine) — distinct from stale/unknown.
- **Legacy items** (pre-R09.2 shape `db.ts:277` `null`) — permanently non-reconcilable.

**Options**

**Option V-Keep — Remain NOT EVIDENCED/ordinary (keep current, any non-null passes).**
- What it means operationally: `hasTrustworthyProvenance` keeps `!= null`; `0`/`9999`/future `2` remain `pending`/`failed` and are replayed as today; no `stale-version`/`unknown-version` check.
- Immediate benefit: Maximal compat — old (`0`) and future (`9999`) remain replayable; no `src/offline/*` change.
- Immediate cost/risk: Version drift silent — old client without new field could be silently misinterpreted; future client with new field on old deployment ignored.
- Downstream consequences: No new `exceptionClass`; `RECONCILABLE` unchanged; `OfflineQueueDrawer` shows no `stale-version`; version bump not breaking.
- Affected components: none.
- Dependencies: `DEC-09` Q1–Q3 (stale/future policy is same question via conflict lens); `R09.3 Model 3` — no new class; `R09.3 Model 4` — no expansion; `R09.4` — `R094` measurement already covers `0`/`9999`.

**Option V-Typed — Promote to typed `stale-version`/`unknown-version` (or strict `version-mismatch`) — `failed` `exceptionClass` not retried, or `quarantined` `quarantineReason`.**
- What it means operationally: `payloadVersion < QUEUE_PAYLOAD_VERSION` → `stale-version` quarantine/typed, `> current` → `unknown-version`, or `!== current` → strict; visible in drawer, never retried.
- Immediate benefit: Fail-closed for version drift — stale/unknown quarantined.
- Immediate cost/risk: Breaks compat — old/future clients become quarantined after bump; offline availability reduces; version bump becomes breaking.
- Downstream consequences: New `exceptionClass` `stale-version`/`unknown-version`, `hasTrustworthyProvenance`/`sweepUnverifiableItems` change, `RECONCILABLE` per Q3/Q11, drawer copy, `offline_queue_reconciliations` CHECK, `reconcile` re-hydration vs new capture.
- Affected components: `provenance.ts`, `db.ts`, `reconciliation.ts`, `exceptions.ts`, `OfflineQueueDrawer.tsx`, `supabase/migrations/*`.
- Dependencies: `DEC-09` Q1–Q3 (same decision, but via conflict taxonomy); `R09.3 Model 3` — new typed; `R09.3 Model 4` — `RECONCILABLE` (Q11, Q3); `R09.4` — `R094` extended; `DEC-10` — `legacy` `null` vs stale.

Do not assume “rejecting” automatically means quarantine — explicitly show quarantine vs typed `failed` vs `failed` ordinary. Do not silently redefine version mismatch as security conflict — it is compatibility, not `payload-tampered`.

**Evidence available now**

- Verified evidence: `QUEUE_PAYLOAD_VERSION=1` at `provenance.ts:19`, `hasTrustworthyProvenance` only `!=null`, `R094` `0`/`9999` pass, queue-only, `post_pos_sale` identical for `0`/`9999`, no `stale-version` exists, `RECONCILABLE` not version, `missing-provenance` vs stale/unknown distinction — **ALREADY VERIFIED** via source + migration + browser test + disposable probe.
- Evidence that remains unavailable: Real v2 payload shape (new field); `R094` extended through `post_pos_sale` with stale/future shape; version-gated conflict matrix with v2 shape; drawer UX for `stale-version` — all **STILL NOT EVIDENCED** (§10, needs DEC-09).
- Evidence that would require implementation: `stale-version`/`unknown-version` `exceptionClass`/`quarantineReason`, `hasTrustworthyProvenance` branching, `isReconcilable` expansion — **IMPLEMENTATION REQUIRED** (blocked until owner decision).

**Decision required from Alexander**

Choose whether **payload-version** (class 7) becomes a **typed conflict** (`stale-version`/`unknown-version` or strict `!== current`) — with explicit quarantine vs typed `failed` semantics — vs **remain NOT EVIDENCED/ordinary** (any non-null passes as today). This is the same policy as DEC-09 Q1–Q2 but via **OFFLINE.CONFLICT** taxonomy; answer must be consistent with Q1–Q2.

**Implementation consequences**

- If **V-Keep**: No `src/offline/*` change; `0`/`9999` remain replayable; version bump not breaking.
- If **V-Typed**: Add `stale-version`/`unknown-version` to `exceptionClass`/`quarantineReason`, change `hasTrustworthyProvenance` to `payloadVersion === QUEUE_PAYLOAD_VERSION` or `<`→`stale` / `>`→`unknown`, update `reconciliation.ts` `RECONCILABLE` per Q3/Q11, drawer copy, migration.

**Dependencies**

- `DEC-09` Q1–Q3 — same version policy (must be consistent).
- `DEC-10` — `legacy` `null` stays `missing-provenance`.
- `R09.3 Model 3` — new typed class.
- `R09.3 Model 4` — `RECONCILABLE` (Q3, Q11).
- `R09.4` — `R094.BROWSER.STALE-VERSION-MEASURE`.
- `OFFLINE.CONFLICT` Q8/Q10/Q11 — typed `stale-version` would be part of `RECONCILABLE` decision.

### Q10 — Same `clientKey` With Different Payload (OFFLINE.CONFLICT, class 8)

**Question**

What should happen to **same `clientKey` + different payload** cases (class 8, e.g., `client_key 6001` with `line_total 1500` vs `9999`, `qty1` vs `qty2`)? Should the current **server-side idempotent handling** (return original `idempotent:true`, no second posting, server does **not** compare payload hashes) **remain** as today, or should it become an **explicit conflict** (`payload-tampered` `22023` before audit, or new `clientKey-payload-mismatch` typed/quarantine)?

**Current verified behavior**

- **P4 disposable probe verified:** `client_key 6001` `qty1 total1500` first → PASS `dee7abf8-295f-41c1-b7fc-690f7526351a` `idempotent:false` (new invoice + 3 journals + `stock_movements`); second same `client_key 6001` but `line_total 9999` (tampered) as same `A_cashier` → returned **same** `id` `dee7abf8-…` `idempotent:true`, `count where client_key 6001` stays `1`, no new `invoice_lines`/`journal_entries`/`stock_movements`, **no double apply** — **server dedupes by `client_key` alone, no payload comparison, tampered payload is ignored, not denied**. **EVIDENCED** as idempotency, **NOT EVIDENCED** as denial via `post_pos_sale` at `bc97e32`.
- **Client** `src/offline/reconciliation.ts` would refuse locally via `payload business/client_key` identity check + `verifyPayloadIntegrity` SHA-256 (`src/offline/payloadIntegrity.ts` `payloadHash` covers `line_total`), but **server does not** compare second payload to first — server `post_pos_sale` (`supabase/migrations/20260923000000_post_pos_sale_rpc.sql`) has no `payloadHash` param, only inserts `invoices` where `client_key` unique per `business_id`; second `INSERT` with same `client_key` hits `ON CONFLICT`/`SELECT` original path and returns original.
- **Tampered payload** (class 2/11 `payload-tampered` via `verifyPayloadIntegrity` SHA-256 + server `22023` before audit `R093.TAMPER` PASS) is **distinct** from class 8: `payload-tampered` is client `verifyPayloadIntegrity` failure before `post_pos_sale` (or server `22023` before audit if hash mismatched), permanently non-reconcilable. Class 8 same-`clientKey` + different `line_total` is **not** `payload-tampered` at server — it is idempotent return of original.
- **Missing provenance** (`payloadVersion null` → `missing-provenance` quarantine, `R09.QUEUE.LEGACY.QUARANTINED` PASS) and **legacy** (`db.ts:277` `null` keeps `legacy`) are distinct.

**Preserve distinction**

- **Same `clientKey` + different payload** (class 8) — currently **idempotent:true** (not a second posting).
- **Tampered payload** (`payloadHash` SHA-256 mismatch `payload-tampered` `22023`) — already quarantine, permanently non-reconcilable.
- **Missing provenance** (`payloadVersion null` → `missing-provenance`).
- **Duplicate/idempotency** (class 1, same `clientKey` same payload) — `idempotent:true` (already committed, `RECONCILABLE`).

**Options**

**Option C-Idem — Keep server-side idempotent handling (return original, ignore different payload) — current at `bc97e32`.**
- What it means operationally: `post_pos_sale` with same `client_key` but `line_total 9999` vs `1500` returns original `dee7abf8-…` `idempotent:true`, no new invoice/movement/journal, no `22023`, no `payload-tampered` at server; client `reconciliation.ts` would have refused locally if it had seen different `line_total` for same `clientKey` + same `business_id`, but offline `queueApi.ts` `enqueue` writes `clientKey` once and `syncQueue` replays original `payloadHash` — second different payload only occurs if payload is mutated after `enqueue` (e.g., Dexie manual edit or `payloadVersion` mismatch).
- Immediate benefit: Idempotency — no double apply, no second invoice, retry safe (`R06.POS.STOCK.REPLAY`, `R093.RECON.IDEMPOTENT-LOST-ACK` PASS, P2a `CONCURRENT-2C` replay PASS already prove idempotency for same payload; P4 extends to different payload still idempotent).
- Immediate cost/risk: **Server silently ignores tampered second payload** — different `line_total` is not denied, just ignored (returns original total `1500`, not `9999`); client guard (`reconciliation.ts` identity check) would not see second payload as new transaction, but server does not surface mismatch; do not silently redefine this as **security conflict** — it is **idempotency vs integrity** trade-off, not `payload-tampered` (which is hash mismatch before `post_pos_sale`).
- Downstream consequences: No new `exceptionClass`; `RECONCILABLE` unchanged; `OfflineQueueDrawer` shows `synced` (second is `idempotent:true` success); no `payloadHash` storage per `client_key` at server.
- Affected components: none — `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` (idempotent `SELECT` original path), `src/offline/reconciliation.ts` (client identity check), `src/offline/payloadIntegrity.ts` (`payloadHash`).
- Dependencies: `OFFLINE.CONFLICT` class 1 duplicate/idempotency — same `clientKey` same payload is idempotent; class 8 different payload is same server path; `R09.3 Model 3/4` — not typed, not `RECONCILABLE` (already committed).

**Option C-Explicit — Make same `clientKey` + different payload an explicit conflict (server compares payload hashes and rejects).**
- What it means operationally: Server stores `payloadHash` per `client_key` (e.g., `invoices.client_key` + `payloadHash` column or `offline_queue_reconciliations` `payloadHash`) and on second `post_pos_sale` with same `client_key` but `payloadHash` != original → `22023` `payload-tampered` (or new `clientKey-payload-mismatch` `22023`) before audit, no new invoice, `exceptionClass='payload-tampered'` or new typed, `quarantined` never reconcilable (like `payload-tampered`).

- Immediate benefit: Integrity — tampered second payload is explicitly denied (`22023`), not silently ignored; matches client `verifyPayloadIntegrity` SHA-256 semantics at server.
- Immediate cost/risk: Needs `payloadHash` storage per `client_key` at server (`invoices` or `offline_queue` table plus `payloadHash` column), `post_pos_sale` must compare hashes, new `22023` path, client `reconciliation.ts` already refuses locally but server would now also refuse.
- Downstream consequences: New `exceptionClass` `payload-tampered` (or `clientKey-payload-mismatch`) for `post_pos_sale` second payload, `supabase/migrations/*` new column `payloadHash` + `post_pos_sale` hash compare, `R093.TAMPER` would need new `PASS` for same-`clientKey` different hash case, `RECONCILABLE` stays permanently non-reconcilable (like `payload-tampered`).
- Affected components: `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` (`post_pos_sale` hash compare), `supabase/migrations/*` new `payloadHash` column, `src/offline/payloadIntegrity.ts` (hash), `src/offline/reconciliation.ts` (`payload-tampered`), `supabase/migrations/*` (`offline_queue_reconciliations` CHECK).
- Dependencies: `R09.3 Model 3` — `payload-tampered` is already typed (`R093.TAMPER` PASS); new hash-compare would be same `payload-tampered` or new typed; `R09.3 Model 4` — `payload-tampered` is permanently non-reconcilable (client+server `22023` before audit); `DEC-09` — `payloadVersion` mismatch is distinct from `payloadHash` mismatch.

Do not collapse with Q9 — Q9 is version (`payloadVersion < /> current`), Q10 is same `clientKey` + different `line_total` payload for same `clientKey` (already evidenced as idempotent, not version).

**Evidence available now**

- Verified evidence: Same `clientKey 6001` probe `dee7abf8-…` `idempotent:true` count stays `1`, no double apply, server dedupes by `client_key` alone, no payload comparison, client `reconciliation.ts` would refuse locally but server does not; `post_pos_sale` signature has no `payloadHash` param; `verifyPayloadIntegrity` SHA-256 at `src/offline/payloadIntegrity.ts` + server `22023` before audit for `payload-tampered` already `R093.TAMPER` PASS; `R06` `REPLAY`/`CONCURRENT-2C` PASS for idempotency — **ALREADY VERIFIED** via source + migration + disposable PG probe (§3, §6.1).
- Evidence that remains unavailable: Real v2 shape variant of class 8 (different field like `discount_type` for same `clientKey`) — **NOT EVIDENCED** (needs v2 shape; but class 8 already evidenced as idempotency via P4 `6001` `line_total` mutate); whether `P0QLT` or `42501` interacts with same-`clientKey` different payload — **NOT EVIDENCED** (would need quota/branch test with same `clientKey`).
- Evidence that would require implementation: `payloadHash` per `client_key` storage + `post_pos_sale` hash compare + `22023` `payload-tampered` for second different payload — **IMPLEMENTATION REQUIRED** (blocked until owner decision; do not implement in P4).

**Decision required from Alexander**

Choose for **same `clientKey` + different payload** (class 8, e.g., `line_total 1500` vs `9999` for `client_key 6001`) whether to **keep server-side idempotent handling (return original, ignore different payload, current at `bc97e32`)** or make it an **explicit conflict** (`payload-tampered` `22023` before audit, or new `clientKey-payload-mismatch` typed/quarantine, server compares `payloadHash` per `client_key` and rejects). Must be explicit per “verified behavior: server does not currently compare payload hashes”.

**Implementation consequences**

- If **C-Idem (keep)**: No `supabase/*` change; `post_pos_sale` keeps `SELECT` original `idempotent:true` path for same `client_key` regardless of `line_total`; docs record that server silently ignores tampered second payload (client guard is the only integrity check for class 8); `R093.TAMPER` stays as is (hash mismatch before `post_pos_sale` only).
- If **C-Explicit**: Add `payloadHash` column per `client_key` (e.g., `invoices.payload_hash` or `offline_queue_reconciliations.payloadHash`), update `post_pos_sale` to `IF v_existing_payload_hash IS DISTINCT FROM v_new_payload_hash THEN RAISE 22023 payload-tampered`, add `exceptionClass='payload-tampered'` (or new typed) for `post_pos_sale` same-`clientKey` different hash, update `src/offline/reconciliation.ts` if new typed must be `RECONCILABLE` (currently `payload-tampered` is permanently non-reconcilable), migration for `offline_queue_reconciliations` CHECK, update `R093.TAMPER` with new `PASS` for same-`clientKey` different hash case.

**Dependencies**

- `R09.3 Model 3` — `payload-tampered` is already typed (`R093.TAMPER` PASS, client+server `22023` before audit); class 8 explicit would be same `payload-tampered` or new typed.
- `R09.3 Model 4` — `payload-tampered` is permanently non-reconcilable; class 8 explicit would be same.
- `R09.4` — `verifyPayloadIntegrity` SHA-256 `payloadHash` (client).
- `DEC-09` — `payloadVersion` mismatch (Q9) is distinct from `payloadHash` mismatch (Q10).
- `OFFLINE.CONFLICT` class 1 duplicate/idempotency — same `clientKey` same payload is already `idempotent:true` (`R06.REPLAY`).

---

### Q11 — Final `RECONCILABLE_EXCEPTION_CLASSES` Policy (OFFLINE.CONFLICT, Model 4)

**Question**

What is the final **`RECONCILABLE_EXCEPTION_CLASSES` policy**: keep **current** `['stock-denied','policy-denied']` (stock `23514` + quota `P0QLT`, `RECONCILABLE` via `reconcile_offline_queue_item` with fresh server revalidation, original `clientKey` immutable, `payloadHash` + lease), **expand** to include `stale-version`/`unknown-version`/`expired`/`branch-denied`/`terminal-denied` etc., or **never expand** (freeze at two)?

**Current verified behavior**

- At `bc97e32`, `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) + `payloadHash` + lease (`isReconcilable(item)` checks `exceptionClass` is in `RECONCILABLE` + `payloadHash` + lease, `reconcile_offline_queue_item` replays original `clientKey` immutably; `supabase/migrations/*` `reconcile_offline_queue_item` with `clientKey` immutable, `offline_queue_reconciliations` CHECK does not include version/expired/branch).
- `stock-denied` `23514` (`chk_inventory_balances_on_hand_nonneg` `FOR UPDATE` + `CHECK`, `R06` `INSUFFICIENT`/`ATOMIC-FAILURE` PASS, P2a two-connection `23514`, `R093.EXCEPTION.STOCK-DENIED` PASS) is `failed` not retried, `RECONCILABLE`; `policy-denied` `P0QLT` (`_ledgr_assert_usage_limit`, `R10.QUOTA.*` PASS, `R093.EXCEPTION.POLICY-DENIED` PASS) is `failed` not retried, `RECONCILABLE`.
- `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` are **permanently non-reconcilable** (client+server `22023` before audit, `db.ts:277` keeps `null` intentionally, `R093.TAMPER` + `R09.QUEUE.LEGACY` PASS).
- `42501`/`22023` branch/tenant/terminal (except `23514`/`P0QLT`) are ordinary `failed` (no `exceptionClass`) at `bc97e32` — not `RECONCILABLE` (`R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` + `R093.RECON.INTEGRITY-REFUSED` before audit); `terminal mismatch` source `20260930000001:114` `22023` but `terminal_id` null vs `3bfbf62c` — not lived, ordinary `failed`.
- **Payload-version** `stale`/`unknown` does not exist, so not in `RECONCILABLE`; **expired** (TTL) does not exist; **same `clientKey` + different payload** class 8 is currently `idempotent:true` success, not `failed`, so not `RECONCILABLE` (if made `payload-tampered` per Q10, it would be permanently non-reconcilable like `payload-tampered`).

**Options**

**Option R-Keep — Keep current `['stock-denied','policy-denied']` (stock/quota only, no expansion).**
- What it means operationally: `RECONCILABLE` stays exactly `stock-denied` + `policy-denied` at `bc97e32`; `stale-version`/`unknown-version`/`expired`/`branch-denied`/`terminal-denied`/same-`clientKey` different payload (if typed) are **not** `RECONCILABLE` (either never `failed` as `RECONCILABLE` or are `quarantined` permanently non-reconcilable).

- Immediate benefit: No `src/offline/*`/`supabase/*` change; `R09.3 Model 4` stable; `reconcile_offline_queue_item` unchanged (original `clientKey` immutable, `payloadHash` + lease); `offline_queue_reconciliations` CHECK unchanged.
- Immediate cost/risk: Version/expired/branch failures are never reconcilable (must be re-created via new `enqueue` with fresh `captureContext`/`clientKey`, not via `reconcile`).
- Downstream consequences: `OfflineQueueDrawer` shows “reconcile” only for `stock-denied`/`policy-denied`; `stale-version`/`expired`/`branch-denied` show “permanently quarantined” with no reconcile button; version/TTL/branch packages (Q3, Q7, Q8) must be permanently non-reconcilable.
- Affected components: none — `reconciliation.ts`, `supabase/migrations/*` unchanged.
- Dependencies: `R09.3 Model 4` — `RECONCILABLE` list at `bc97e32`; `DEC-09` Q3 (stale-version reconcilability), `DEC-TTL` Q7 (expired), `OFFLINE.CONFLICT` Q8 (branch/terminal), Q9 (payload-version), Q10 (same `clientKey` — if typed would be `payload-tampered` permanently non-reconcilable).

**Option R-Expand — Expand to include `stale-version`/`unknown-version`/`expired`/`branch-denied`/`terminal-denied` etc. (and decide per typed whether re-hydration vs new capture).**
- What it means operationally: `RECONCILABLE_EXCEPTION_CLASSES` becomes `['stock-denied','policy-denied','stale-version']` etc. (exact list must be explicitly defined); `isReconcilable(item)` includes `stale-version` etc. + `payloadHash` + lease; `reconcile_offline_queue_item` must handle version/expired/branch re-hydration or new capture.

- Immediate benefit: Version/expired/branch offline work can be reconciled (not lost) via `reconcile_offline_queue_item` with fresh server revalidation (if re-hydration) or new capture (if new `clientKey` per current philosophy — changed transaction is new `clientKey`).
- Immediate cost/risk: Needs `RECONCILABLE` expansion + payload re-hydration vs new capture decision per typed (see Q3 for version, Q7 for expired, Q8 for branch); `reconcile_offline_queue_item` must allow re-hydrated payload (breaks current `payloadHash` + lease checks if re-hydration), `offline_queue_reconciliations` must include new classes.
- Downstream consequences: `reconciliation.ts` `RECONCILABLE` expansion, `reconcile_offline_queue_item` SQL change (original `clientKey` immutable but payload may be re-hydrated), `offline_queue_reconciliations` CHECK migration, `OfflineQueueDrawer` reconcile button for `stale-version`/`expired`/`branch-denied`, decision per typed whether re-hydration (migrate) vs new capture (new `clientKey`).
- Affected components: `src/offline/reconciliation.ts` (`RECONCILABLE`, `isReconcilable`), `supabase/migrations/*` (`reconcile_offline_queue_item`, `offline_queue_reconciliations` CHECK), `src/offline/exceptions.ts` (`exceptionClass`), `OfflineQueueDrawer.tsx`.
- Dependencies: `R09.3 Model 4` — `RECONCILABLE` list; `R09.3 Model 3` — typed class must exist before it can be `RECONCILABLE`; `DEC-09` Q3, `DEC-TTL` Q7, `OFFLINE.CONFLICT` Q8/Q9.

**Option R-Never — Never expand (freeze at two, legacy decision).**
- What it means operationally: `RECONCILABLE` is frozen at `['stock-denied','policy-denied']` forever; no future `exceptionClass` (including `stale-version`/`expired`/`branch-denied`) will ever be added to `RECONCILABLE` even if they become typed later.

- Immediate benefit: Strongest preservation — `RECONCILABLE` never grows; `reconcile_offline_queue_item` never changes.
- Immediate cost/risk: Version/expired/branch will be permanently non-reconcilable even if typed — same as R-Keep but as a legacy decision (explicitly never expand, not just keep for now).
- Downstream consequences: As R-Keep but as a frozen policy.
- Affected components: none, but docs must record “never expand” as legacy.
- Dependencies: `R09.3 Model 4` — frozen.

Do not collapse with Q3/Q7 — Q3 is version reconcilability (stale/unknown), Q7 is expired reconcilability, Q11 is final `RECONCILABLE` policy for all (including branch/terminal).

**Evidence available now**

- Verified evidence: `RECONCILABLE = ['stock-denied','policy-denied']` at `bc97e32`, `reconcile_offline_queue_item` replays original `clientKey` immutably, `payload-tampered`/`missing-provenance`/`legacy` permanently non-reconcilable, `offline_queue_reconciliations` CHECK does not include version/expired/branch — **ALREADY VERIFIED** via `reconciliation.ts` + `supabase/migrations` + `grep -rn RECONCILABLE`.
- Evidence that remains unavailable: Deterministic `stale-version`/`expired`/`branch-denied` reconciliation test (re-hydration vs new capture) — would need typed exception to exist + v2 shape or `expired` age — **STILL NOT EVIDENCED** (§10, `IMPLEMENTATION REQUIRED`).
- Evidence that would require implementation: `RECONCILABLE` expansion, `offline_queue_reconciliations` CHECK migration, `reconcile_offline_queue_item` re-hydration vs new capture, drawer reconcile for `stale-version`/`expired`/`branch-denied` — **IMPLEMENTATION REQUIRED**.

**Decision required from Alexander**

Choose final **`RECONCILABLE_EXCEPTION_CLASSES` policy**: **keep current `['stock-denied','policy-denied']`** (stock/quota only), **expand** to include `stale-version`/`unknown-version`/`expired`/`branch-denied`/`terminal-denied` etc. (and per typed whether re-hydration vs new capture — must be explicit), or **never expand** (freeze at two). Must be explicit per “`RECONCILABLE = ['stock-denied','policy-denied']` at `bc97e32` — not version” and must be consistent with Q3 (stale-version) and Q7 (expired) and Q8 (branch).

**Implementation consequences**

- If **R-Keep**: No `reconciliation.ts` change; `stale-version`/`expired`/`branch-denied` are permanently non-reconcilable (like `missing-provenance`); no migration.
- If **R-Expand**: Add `stale-version`/`unknown-version`/`expired`/`branch-denied` etc. to `RECONCILABLE` (`src/offline/reconciliation.ts`), migration for `offline_queue_reconciliations` CHECK, update `isReconcilable` to include new classes + `payloadHash` + lease, decide per typed re-hydration (payload migration) vs new capture (new `clientKey`), update `OfflineQueueDrawer` reconcile button.
- If **R-Never**: As R-Keep but docs record “never expand” as legacy.

**Dependencies**

- `R09.3 Model 4` — `RECONCILABLE_EXCEPTION_CLASSES` (`['stock-denied','policy-denied']` at `bc97e32`).
- `R09.3 Model 3` — `stale-version`/`unknown-version`/`expired`/`branch-denied` typed class must exist before it can be `RECONCILABLE`.
- `DEC-09` Q3 — stale-version reconcilability.
- `DEC-TTL` Q7 — expired reconcilability.
- `OFFLINE.CONFLICT` Q8/Q9 — typed branch/terminal/version would be part of `RECONCILABLE` decision.
- `R11` — not directly, but `R11` metric consistency is separate.

---

### Q12 — Scope of Authoritative Server Quota Enforcement (BILLING, Q12)

**Question**

What is the **scope of authoritative server quota enforcement** for `P0QLT` (`_ledgr_assert_usage_limit` at `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` `v_usage` counts `invoices(issue_date)+expenses(expense_date)+payroll_runs(pay_date) >= month_start` vs `plan_tier` `free` 50/`starter` 200/`growth` 500/`pro` 2000/`enterprise` null): **POS + quick paths only** (`post_pos_sale`, `save_quick_sale`, `save_quick_expense` — **Yes `P0QLT`, atomic, 7 `R10.QUOTA.*` PASS**) vs **uniform enforcement across all relevant document creation** (`InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber`+`createWithLines` for draft/builder, direct `supabase.from('invoices').insert` invoice builder UI, `PayrollRepository` direct inserts for `payroll_runs`, legacy invoice creation, direct `expenses`/`payroll_runs` inserts) vs **another explicitly defined scope** if repository evidence supports one?

**Current verified behavior**

- **Server-enforced (authoritative `P0QLT`):** `public.post_pos_sale(jsonb)` — **calls** `_ledgr_assert_usage_limit` inside posting transaction (atomic with `invoices`+`invoice_payments`+3 journals+`stock_movements`, `count` without `FOR UPDATE` — concurrent race **NOT EVIDENCED** as lived but known gap from `count(*)` without lock) — **PASS** `R10.QUOTA.SERVER-POS`; `public.save_quick_sale(jsonb)` — calls — **PASS** `R10.QUOTA.SERVER-QUICKSAVE-SALE`; `public.save_quick_expense(jsonb)` — calls — **PASS** `R10.QUOTA.SERVER-QUICKSAVE-EXPENSE`; errcode is contract (`src/lib/billing/quotaContract.ts` `QUOTA_DENIAL_SQLSTATE='P0QLT'`, `isQuotaDenial` checks `code==='P0QLT'` only, `classifyReplayException` prioritizes `P0QLT` over `23514`, `policy-denied` `failed` `RECONCILABLE`).
- **Not server-enforced — client look-ahead only (NOT authoritative):** `InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber`+`createWithLines` for draft/builder (`draft` discounts/VAT) — **does NOT call** `_ledgr_assert_usage_limit` — verified `grep -rn _ledgr_assert_usage_limit` only in three RPCs; any direct `supabase.from('invoices').insert` (invoice builder UI) — **does NOT call**; `PayrollRepository` direct inserts for `payroll_runs` — **does NOT call** (no `save_quick_payroll` RPC) — counted in `v_usage` but not metered, so `payroll_runs` can exceed even while `invoices` are `P0QLT`-blocked; `P0QLT` vs `P0001` vs success for builder/payroll/legacy under quota — **NOT EVIDENCED as lived `P0QLT` test** (would require filling `free` 50 rows and trying builder — **MORE EVIDENCE REQUIRED** without changing quota code).
- **Client look-ahead is NOT authoritative:** `src/lib/billing/UsageService.ts` `getCurrentMonthTransactionCount` first tries `supabase.rpc('ledgr_monthly_document_count')` (security-definer, RLS-immune, `null` on not-member/offline), falls back to three `head:true` counts as signed-in user (RLS-filtered), plus `assertCanCreateDocument` before legacy `createWithLines` — **NOT authoritative** (`R10` says look-ahead is not authoritative); multiple call paths bypass `UsageService` (any direct `INSERT` outside UI that calls `UsageService` — **ESTABLISHED**); RLS can cause `UsageService` count divergence — **ESTABLISHED** (`head:true` fallback RLS-filtered; `manager` without `payroll_runs` SELECT sees `0` while server `v_usage` via security-definer sees higher).
- **Currently uncovered paths from P4 (§7.1):** `InvoiceRepository.createWithLines` (invoice builder, `draft`→post, `invoice_lines`, `P0001`/success not `P0QLT`, **NOT EVIDENCED** as `P0QLT`), legacy invoice creation (same), `PayrollRepository` direct inserts for `payroll_runs` (`payroll_employee_lines`, success not `P0QLT` even when `v_usage >= v_limit` — **billing integrity risk**), direct `invoices`/`expenses`/`payroll_runs` inserts outside three RPCs, any other document-creation path — all **no `P0QLT`** unless via three RPCs.

Do not claim those paths are vulnerable or exploitable unless evidence establishes that — evidence establishes they are **not `P0QLT`-metered** and can exceed `free` 50 while POS is `P0QLT`-blocked at 51 (same business, different enforcement — billing dispute risk; `payroll_runs` counted in `v_usage` but not metered allows overshoot even while `invoices` are blocked; RLS-filtered fallback allows `manager` to see quota as not exceeded locally, then be `P0QLT`-denied later — inconsistent UX). Do not label as exploitable beyond what code establishes.

**Options**

**Option S-POS — POS + quick paths only (keep current `R10` scope, three RPCs: `post_pos_sale`, `save_quick_sale`, `save_quick_expense`).**
- What it means operationally: Only `post_pos_sale` (POS `sales` + payments + journals + `stock_movements`), `save_quick_sale` (`sales`), `save_quick_expense` (`expenses`) are `P0QLT`-metered inside transaction, atomic with rollback; all other document creation (`createWithLines`/builder/legacy draft→post, `PayrollRepository` direct, direct `INSERT`) remains **client look-ahead only** (RLS-filtered `head:true`, `UsageService` `assertCanCreateDocument`), **not `P0QLT`**, not atomic per `post_pos_sale`.
- Immediate benefit: Minimal change — `R10` 7 PASS already proves three RPCs; no new RPC/migration; `P0QLT` contract stable.
- Immediate cost/risk: **Asymmetry** — same `business_id` (`free` 50) via POS is `policy-denied` at 51 (atomic rollback, `R10` PASS), same via invoice builder could exceed 50 via `createWithLines` `P0001`/success (not `P0QLT`); `payroll_runs` counted in `v_usage` but not metered allows `payroll_runs` to overshoot even while `invoices` are `P0QLT`-blocked; RLS-filtered `head:true` allows under-count for roles without `payroll_runs` SELECT (e.g., `manager` sees `0` while server sees higher) — billing dispute risk, inconsistent UX (look-ahead says not exceeded, then `P0QLT` later, or vice versa); direct inserts bypass `UsageService` entirely.
- Downstream consequences: No new `_ledgr_assert_usage_limit` call; `billing/page.tsx` copy and `UsageService` counts must be aligned to defined scope if legitimate — pricing must be defined as “POS+quick transactions only” (not “all documents”) and `ledgr_monthly_document_count` vs `head:true` fallback must match; otherwise dispute.
- Affected components: none — `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` (`_ledgr_assert_usage_limit`, `v_usage` counts all three tables but only enforces on three commands), `src/lib/billing/quotaContract.ts`/`UsageService.ts`, `src/hooks/usePermissions.ts` not quota; `billing/page.tsx` copy.
- Dependencies: `GAP-1` invoice lifecycle vs quota, `GAP-3` payroll, `BRANCH.*` (quota counts per `business_id`, not branch), `R09.3 Model 3` — `policy-denied` is typed; `R09.3 Model 4` — `policy-denied` reconcilable.

**Option S-Uni — Uniform enforcement across all relevant document creation (every `INSERT` into `invoices`/`expenses`/`payroll_runs` is `P0QLT`-metered).**
- What it means operationally: `InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber`+`createWithLines` for draft/builder (`invoice`/`invoice_lines`, `draft` discounts/VAT, direct `supabase.from('invoices').insert`), `PayrollRepository` direct inserts for `payroll_runs` (`payroll_runs` + `payroll_employee_lines`), legacy invoice creation, any other `invoices`/`expenses`/`payroll_runs` direct insert — all **call** `_ledgr_assert_usage_limit(business_id)` inside transaction (or via trigger) and raise `P0QLT` with `detail`/`hint`, full rollback (for `invoices` case, per-row or per-transaction atomic as `post_pos_sale`).

- Immediate benefit: Uniform — `v_usage` definition (`invoices`+`expenses`+`payroll_runs`) matches enforcement; no bypass via `createWithLines`/builder/legacy/payroll; no RLS divergence (server `security definer` `ledgr_monthly_document_count` is RLS-immune, but uniform `P0QLT` is authoritative, not look-ahead); `payroll_runs` cannot overshoot.
- Immediate cost/risk: Needs implementation — add `_ledgr_assert_usage_limit` to `InvoiceRepository.createWithLines` + builder `draft→post` + `PayrollRepository` (new `save_quick_payroll` RPC or direct check in repository, or `BEFORE INSERT` trigger on `invoices`/`expenses`/`payroll_runs` that calls `_ledgr_assert_usage_limit`), update `billing/page.tsx` copy and `UsageService` counts to match uniform scope, migration for `payroll_runs` trigger if direct `INSERT` must be metered (IMPLEMENTATION REQUIRED).
- Downstream consequences: New `P0QLT` for builder/payroll/legacy (`P0001`/success becomes `P0QLT` when over quota), atomicity for builder/payroll (currently per-row, not `post_pos_sale` atomic — uniform must decide per-transaction atomic as `post_pos_sale`), concurrent race still `count(*)` without `FOR UPDATE` unless fixed (would need `FOR UPDATE` lock on `businesses` or `SELECT ... FOR UPDATE` on `v_usage` source — known gap).
- Affected components: `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` (`_ledgr_assert_usage_limit` calls), `src/lib/invoiceRepository.ts` (`createWithLines`), `src/lib/businessRepository.ts` (`reserveDocumentNumber`+`createWithLines`), `src/lib/payrollRepository.ts` (direct inserts → new `save_quick_payroll` RPC or direct check), `supabase/migrations/*` new trigger/RPC if `BEFORE INSERT` metering, `src/lib/billing/UsageService.ts` (fallback counts must match uniform scope — `ledgr_monthly_document_count` vs `head:true`), `billing/page.tsx` (copy).
- Dependencies: `R09.3 Model 3` — `policy-denied` is already typed (`P0QLT`); uniform expands where `policy-denied` can occur; `R09.3 Model 4` — `policy-denied` is `RECONCILABLE` (Q11), uniform affects `policy-denied` volume offline; `GAP-1`/`GAP-3` — invoice/payroll lifecycle.

**Option S-Other — Another explicitly defined scope if repository evidence supports one (e.g., `invoices` only uniform, `payroll_runs` not counted; or `quick` only).**
- What it means operationally: Scope is not POS+quick only and not uniform all documents, but another explicitly defined set (must be specified, e.g., `invoices`+`expenses` uniform but `payroll_runs` not counted, or `POS` only).
- Immediate benefit: Could be tailored if pricing is “`invoices` only” not `payroll_runs`.
- Immediate cost/risk: `supabase/migrations/20261001000000` `v_usage` counts all three tables (`invoices`+`expenses`+`payroll_runs`) — any other scope must redefine `v_usage` (`_ledgr_assert_usage_limit` `v_usage` query) and `ledgr_monthly_document_count` (security-definer) to match; no evidence supports another scope (`v_usage` already counts all three, so A1 vs A2 are the two legitimate scopes per P4 §7.4 A3).
- Downstream consequences: Must redefine `v_usage` and `UsageService` to match scope; otherwise `v_usage` counts `payroll_runs` but scope says not counted — inconsistency.
- Affected components: `supabase/migrations/20261001000000` (`v_usage` query), `src/lib/billing/*`, `billing/page.tsx`.
- Dependencies: `GAP-1`/`GAP-3`; `R09.3 Model 3/4` as above.

**Evidence available now**

- Verified evidence: `_ledgr_assert_usage_limit` declaration, three metered RPCs `post_pos_sale`/`save_quick_sale`/`save_quick_expense` (all `P0QLT`, atomic, `R10.QUOTA.*` 7 PASS), `createWithLines`/builder/legacy/`PayrollRepository` direct are **no `P0QLT`** at `bc97e32` ( `grep -rn _ledgr_assert_usage_limit` only in three RPCs + `quotaContract.ts` + `UsageService.ts`), `InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber`+`createWithLines` for `draft`, direct `supabase.from('invoices').insert`, `PayrollRepository` direct — verified via source + `grep`; `UsageService` look-ahead (`ledgr_monthly_document_count` security-definer + `head:true` fallback RLS-filtered) — verified via `src/lib/billing/UsageService.ts`; `v_usage` counts all three tables but only enforces on three commands — asymmetry is current contract — **ALREADY VERIFIED** via code + migration + `R10` tests + P4 call graph (§7.1, §7.2).
- Evidence that remains unavailable: Invoice-builder full flow (draft→post) under quota for `P0QLT` vs `P0001` vs success; payroll run under quota; legacy `income` with `vat>0` under quota; concurrent two-connection quota race lived test (`count(*)` without `FOR UPDATE` lock, bypass possible — known gap from code, **NOT EVIDENCED as lived**); RLS-filtered `payroll_runs` count divergence as lived `R09.*` test (`manager` without `payroll_runs` SELECT sees `0` while server sees higher) — all **STILL NOT EVIDENCED** (§10, `MORE EVIDENCE REQUIRED` without changing quota code — harness can fill `free` 50 rows and try builder, or `createSecondClient` + two concurrent RPCs).
- Evidence that would require implementation: Add `_ledgr_assert_usage_limit` to `InvoiceRepository.createWithLines`+builder+`PayrollRepository` (new `save_quick_payroll` RPC or direct check), `BEFORE INSERT` trigger on `invoices`/`expenses`/`payroll_runs`, update `billing/page.tsx` copy — **IMPLEMENTATION REQUIRED** (blocked until owner decision; STOP if migration/RLS change needed).

**Decision required from Alexander**

Choose scope of authoritative server quota enforcement: **POS + quick paths only** (Option S-POS — keep current `R10` scope, three RPCs) or **uniform enforcement across all relevant document creation** (Option S-Uni — every `INSERT` into `invoices`/`expenses`/`payroll_runs` is `P0QLT`-metered, `createWithLines`/builder/legacy draft→post, `PayrollRepository` direct, direct inserts) — or **another explicitly defined scope** (must be specified, e.g., `invoices` only) if repository evidence supports one (P4 §7.4 A3 says none evidenced, so A1 vs A2 are the two legitimate).

**Implementation consequences**

- If **S-POS (keep)**: No `supabase/*` change; `R10` 7 PASS remains authoritative; `billing/page.tsx` + `UsageService` must be aligned to defined scope if legitimate — pricing must be “POS+quick transactions only” (not “all documents”), `ledgr_monthly_document_count` vs `head:true` fallback must match; otherwise billing dispute risk remains documented.
- If **S-Uni (uniform)**: Add `_ledgr_assert_usage_limit(business_id)` inside `InvoiceRepository.createWithLines` transaction (or via `BEFORE INSERT` trigger on `invoices`), same for builder `draft→post` and `PayrollRepository` (new `save_quick_payroll` RPC or direct check), update `supabase/migrations/*` for `payroll_runs` trigger if direct `INSERT` must be metered, update `src/lib/billing/UsageService.ts` fallback counts to match uniform `v_usage` (all three tables), update `billing/page.tsx` copy, decide atomicity for builder/payroll (per-row vs per-transaction as `post_pos_sale`), fix concurrent race (`SELECT ... FOR UPDATE` on `businesses` or lock) if uniform must be race-free.
- If **S-Other**: Redefine `v_usage` query in `supabase/migrations/20261001000000` to count only scoped tables, plus as S-Uni for scoped paths.

**Dependencies**

- `R09.3 Model 3` — `policy-denied` (`P0QLT`) is already typed (`R10.QUOTA.*` PASS, `R093.EXCEPTION.POLICY-DENIED` PASS); scope decides where `policy-denied` can occur.
- `R09.3 Model 4` — `policy-denied` is `RECONCILABLE` via `reconcile_offline_queue_item` (Q11); uniform affects `policy-denied` volume offline (`OFFLINE.CONFLICT` class 9 `P0QLT`).
- `GAP-1` invoice lifecycle vs quota, `GAP-3` payroll, `BRANCH.*` (quota counts per `business_id`, not branch, but `branch_id` informs invoice scope).
- `OFFLINE.CONFLICT` class 9 `P0QLT` — `P0QLT` is `policy-denied` `failed` `RECONCILABLE` (class 9).
- `R02` — not directly, but `UsageService` `head:true` RLS divergence is auth-related.

### Q13 — Where Quota Authority Lives (BILLING, per-transaction vs capture-time)

**Question**

Where should **quota authority** live: **current per-transaction server assertion** (inside each posting RPC `post_pos_sale`/`save_quick_sale`/`save_quick_expense`, atomic with `invoices`+`journal`+`movement`, `P0QLT` with `detail`/`hint`, errcode is contract) vs **capture-time gating** (`enqueue`/`offline_queue` capture is gated, offline `policy-denied` before `post_pos_sale`, entitlement/command) vs **combination** (both)?

**Current verified behavior**

- At `bc97e32`, quota is **per-transaction server assertion** inside each posting transaction: `public.post_pos_sale(jsonb)` (and `save_quick_sale`/`save_quick_expense`) **calls** `_ledgr_assert_usage_limit(business_id)` **inside** `BEGIN ... INSERT invoices ... INSERT invoice_payments ... INSERT journal_entries ... INSERT stock_movements ... COMMIT` — atomic with `invoices`+`journal`+`movement` (P4 §7.1, `supabase/migrations/20261001000000` + `20260923000000`); `quotaContract.ts` `QUOTA_DENIAL_SQLSTATE='P0QLT'`, `isQuotaDenial` checks `code==='P0QLT'` only, `classifyReplayException` prioritizes `P0QLT` over `23514`, `policy-denied` `failed` is `RECONCILABLE` via `reconcile_offline_queue_item` with fresh server revalidation (original `clientKey` immutable, `payloadHash` + lease).
- **Client look-ahead is NOT authoritative:** `src/lib/billing/UsageService.ts` `getCurrentMonthTransactionCount` (`ledgr_monthly_document_count` security-definer + `head:true` fallback RLS-filtered) + `assertCanCreateDocument` before legacy `createWithLines` — **NOT authoritative** (`R10` says look-ahead is not authoritative); offline `policy-denied` is `RECONCILABLE` (like `stock-denied`), not capture-time gate; `offline_queue` is Dexie `ledgr-offline` `queue` (not server), `createdAt` 180d still `pending` and replayable if provenance passes — no `policy-denied` at `enqueue`.
- **No capture-time gating at `enqueue` at `bc97e32`** — verified via `src/offline/queueApi.ts` `enqueue` (only `buildProvenance`/`captureContext`/`hashQueuePayload`, no `UsageService` check), `src/offline/db.ts` (no `policy-denied` at capture), `supabase/migrations` (no entitlement table).

Clearly distinguish scope (Q12) from where authority lives (Q13): Q12 is *which paths are `P0QLT`-metered* (POS+quick vs uniform), Q13 is *when* quota is checked — per-transaction server assertion (at `post_pos_sale` time, atomic) vs capture-time (at `enqueue` offline, before `post_pos_sale`) vs both.

**Options**

**Option A-Per — Per-transaction server assertion (keep current, inside each posting RPC, atomic).**
- What it means operationally: Quota is checked **inside** `post_pos_sale`/`save_quick_sale`/`save_quick_expense` (and if Q12 = uniform, also inside `createWithLines`/`PayrollRepository`/`BEFORE INSERT` trigger) — `BEGIN` `SELECT ... _ledgr_assert_usage_limit` `INSERT` ... `COMMIT` — atomic with document + journals + movements; `P0QLT` `detail`/`hint` unchanged; offline `policy-denied` is `RECONCILABLE` (fresh server revalidation at `reconcile` time).
- Immediate benefit: Atomic — `P0QLT` is full rollback (no `invoices`/`journal`/`movement` on denial, `R06.POS.STOCK.ATOMIC-FAILURE` style), `R10` already proves, errcode is contract; no `enqueue` change; offline `policy-denied` is already `RECONCILABLE` (like `stock-denied`).
- Immediate cost/risk: Offline capture is **not gated** — aged offline `policy-denied` (e.g., `createdAt` 30d ago, `v_usage` already 50) still goes to `pending` → `syncing` → `failed` `policy-denied` then `reconcile_offline_queue_item` (fresh server revalidation) — correct but offline work is captured then denied at replay, not at capture; capture-time UX does not warn before `enqueue`.
- Downstream consequences: No `src/offline/queueApi.ts` `enqueue` change; `OFFLINE.CONFLICT` class 9 `P0QLT` remains `policy-denied` `failed` `RECONCILABLE`; `UsageService` look-ahead remains not authoritative.
- Affected components: none — `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` (`_ledgr_assert_usage_limit` inside RPC), `src/lib/billing/quotaContract.ts` (`P0QLT`), `src/offline/reconciliation.ts` (`policy-denied` `RECONCILABLE`).
- Dependencies: `R09.3 Model 4` — `policy-denied` is `RECONCILABLE`; `OFFLINE.CONFLICT` class 9 `P0QLT`; `DEC-TTL` — `policy-denied` backlog informs TTL (but `policy-denied` is reconcilable, not TTL).

**Option A-Cap — Capture-time gating (entitlement/command at `enqueue`, offline `policy-denied` before `post_pos_sale`).**
- What it means operationally: Quota is checked **at `enqueue`/capture time** — `src/offline/queueApi.ts` `enqueue` calls `UsageService.getCurrentMonthTransactionCount` (or `ledgr_monthly_document_count` RPC) **before** writing `pending` `queue` row (or writes `failed` `policy-denied` offline without `post_pos_sale`); entitlement/command (e.g., `entitlements` table `quota_used`/`quota_limit` per `business_id` `month_start`) is checked at `enqueue`, not just at `post_pos_sale` replay.

- Immediate benefit: Prevents offline capture when already over quota — `enqueue` fails fast with `policy-denied` at capture, no `pending` → `syncing` → `failed` replay; UX warns before offline work (e.g., “quota exceeded, cannot queue sale”).
- Immediate cost/risk: Still needs **server assertion for race** (`count(*)` without `FOR UPDATE` lock — concurrent race: two `enqueue` each under limit but together over 50 → both `pending` then both `post_pos_sale` `P0QLT`? Actually `enqueue` is client Dexie, not server, so two devices `enqueue` each under limit but server `post_pos_sale` `P0QLT` at replay could still race — capture-time gate is client `head:true` RLS-filtered, not authoritative, so server assertion still required; capture-time `policy-denied` before `post_pos_sale` is new `offline_queue` `policy-denied` handling (not just `post_pos_sale` `P0QLT`).
- Downstream consequences: Add `UsageService` check at `queueApi.ts` `enqueue` (capture-time `policy-denied` offline, not via `post_pos_sale` `P0QLT`), add entitlement/command table (e.g., `business_entitlements` `quota_used`) if entitlement model, offline `policy-denied` `failed` with `exceptionClass='policy-denied'` before `post_pos_sale` (like `stock-denied` but at capture).
- Affected components: `src/offline/queueApi.ts` (`enqueue` `UsageService` check, `policy-denied` at capture), `src/lib/billing/UsageService.ts` (`assertCanCreateDocument` at `enqueue`), `supabase/migrations/*` entitlement table if command model, `src/offline/exceptions.ts` (`policy-denied` at capture), `supabase/migrations/20261001000000` still needs server assertion for race.
- Dependencies: `OFFLINE.CONFLICT` — `policy-denied` at capture vs at `post_pos_sale` replay; `R09.3 Model 3/4` — `policy-denied` is already typed `RECONCILABLE`; `R02` — not directly.

**Option A-Both — Combination (per-transaction server assertion + capture-time gating).**
- What it means operationally: Both — `enqueue` capture-time gate (entitlement/command, client `UsageService` `head:true` or `ledgr_monthly_document_count` security-definer) **and** per-transaction server assertion inside `post_pos_sale`/`save_quick_*` (and uniform per Q12) — atomic `P0QLT`.

- Immediate benefit: Both — capture-time prevents most over-quota `enqueue`, server assertion is authoritative for race/bypass.
- Immediate cost/risk: Both implementations — `enqueue` check + server `P0QLT` + `policy-denied` handling at both capture and replay; still needs `R09.3 Model 4` `policy-denied` `RECONCILABLE` for offline replay `P0QLT`.
- Downstream consequences: As A-Per + A-Cap.
- Affected components: as A-Per + A-Cap.
- Dependencies: as A-Per + A-Cap.

**Evidence available now**

- Verified evidence: Per-transaction server assertion inside `post_pos_sale` atomic with `invoices`+`journal`+`movement`, `P0QLT` errcode contract, `quotaContract.ts` `isQuotaDenial` only `P0QLT`, `classifyReplayException` prioritizes `P0QLT`, `UsageService` look-ahead not authoritative, `enqueue` has no `UsageService` check at `bc97e32`, offline `policy-denied` is `RECONCILABLE` (fresh server revalidation) — **ALREADY VERIFIED** via source + migration + `src/offline/queueApi.ts` `enqueue` + `reconciliation.ts`.
- Evidence that remains unavailable: Entitlement/command gating spec (e.g., `entitlements` table `quota_used` per `business_id` `month_start`) — **NOT EVIDENCED** (no spec at `bc97e32`); whether capture-time `policy-denied` should be `failed` `policy-denied` offline without `post_pos_sale` — **NOT EVIDENCED** (no `enqueue` `policy-denied` handling); concurrent race under capture-time gating — **NOT EVIDENCED as lived** (§10).
- Evidence that would require implementation: Capture-time `UsageService` check at `queueApi.ts` `enqueue`, entitlement table, offline `policy-denied` before `post_pos_sale`, new `offline_queue` `policy-denied` handling — **IMPLEMENTATION REQUIRED** (blocked until owner decision; STOP if quota architecture must change).

**Decision required from Alexander**

Choose where **quota authority** lives: **per-transaction server assertion** (Option A-Per — keep current, inside each posting RPC, atomic, `P0QLT` with `detail`/`hint`) vs **capture-time gating** (Option A-Cap — entitlement/command at `enqueue`, offline `policy-denied` before `post_pos_sale`) vs **combination** (Option A-Both — both, capture-time + per-transaction). Must be explicit per “quota is currently defined by all counted documents or only specific posting commands” (Q12 scope) vs “where quota authority lives” (Q13).

**Implementation consequences**

- If **A-Per (keep)**: No `src/offline/queueApi.ts` `enqueue` change; `post_pos_sale`/`save_quick_*` (and uniform per Q12) keep `_ledgr_assert_usage_limit` inside transaction, atomic `P0QLT`; offline `policy-denied` remains `RECONCILABLE` via `reconcile_offline_queue_item` (fresh server revalidation).
- If **A-Cap (capture-time)**: Add `UsageService.getCurrentMonthTransactionCount` + `assertCanCreateDocument` at `queueApi.ts` `enqueue` (capture-time gate), add entitlement/command table (e.g., `business_entitlements` `quota_used`/`quota_limit` per `business_id` `month_start`) if entitlement model, add offline `policy-denied` `failed` with `exceptionClass='policy-denied'` before `post_pos_sale` (like `stock-denied` but at capture), keep server assertion for race (still needs `P0QLT` inside RPC).
- If **A-Both**: Both — `enqueue` capture-time gate + server `P0QLT` inside RPC (and uniform per Q12).

**Dependencies**

- `Q12` scope — per-transaction vs capture-time is independent of POS+quick vs uniform, but uniform + per-transaction is coherent; capture-time gating must match Q12 scope (e.g., `createWithLines` `policy-denied` at capture if Q12 = uniform).
- `R09.3 Model 3` — `policy-denied` (`P0QLT`) is already typed (`R10` PASS); capture-time `policy-denied` would be same typed.
- `R09.3 Model 4` — `policy-denied` is `RECONCILABLE` (Q11) — capture-time `policy-denied` would be same `RECONCILABLE` via `reconcile_offline_queue_item` (fresh server revalidation).
- `OFFLINE.CONFLICT` class 9 `P0QLT` — `policy-denied` `failed` `RECONCILABLE` (class 9).
- `DEC-TTL` — `policy-denied` backlog informs TTL but `policy-denied` is reconcilable.

---

### Q14 — AI/Reporting Branch Scope: Organisation-Wide vs Optional Filter vs Mandatory (DEC-AI-BRANCH)

**Question**

Should AI/reporting remain **organisation-wide only** (current, `ai_context(business_id)` aggregated at `business_id`, no `branch_id` param, 12 `v_reports_roles` `canViewReports=true`, `can_access_branch()` exists but not used for AI), gain an **optional branch filter** (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check before assembling branch-filtered KPIs), or become a **mandatory branch dimension** (every AI call is branch-scoped, no org-wide AI)?

**Current verified behavior**

- `ai_context(business_id)` (`supabase/migrations/20260927000000_r03_ai_context_authorization.sql`) — `REVOKE` from `public`/`anon`, `GRANT` to `authenticated`/`service_role`; guard: `auth.uid() is null && role != 'service_role'` → `42501`; not active member → `42501`; active member but `role` ∉ `v_reports_roles` → `42501`. `v_reports_roles = ['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager']` verbatim `canViewReports=true` in `src/hooks/usePermissions.ts`. Excluded: `cashier,stock_clerk,sales_clerk,data_entry,supervisor,inventory_manager,payroll_manager,purchasing_officer,warehouse_worker,customer_service_rep` cannot call `ai_context` even in own business. `service_role` null-uid path preserved for Edge `ai-chat`. **PASS** `R03.AI.RPC.*` 5 + `R03.AI.EDGE.*` (P4 §8.1, `supabase/functions/ai-chat`).
- `ai_context` returns single-business document (`company, MTD KPIs, 12-month trend, overdue invoices, top expenses/customers, concentration, anomalies, receivable/payable schedules`) aggregated at `business_id`, **no `branch_id` parameter** — verified via migration + `supabase/functions/ai-chat` + `src/components/ai/*` (all assume org-wide).
- Branch data exists: `invoices.branch_id`, `inventory_balances.location_id→inventory_locations.branch_id`, `pos_shifts.branch_id`, `branches`, `business_users.branch_id`, `can_access_branch(business_id, branch_id)` (org-wide roles `owner,admin,accountant,board_member,auditor,treasury_manager,asset_manager` etc. read all branches; assigned roles `branch_manager,sales_manager,manager` restricted to `business_users.branch_id` or `null`=org-wide per `R08.*` PASS and `fixtures.ts` `A1`/`A2`).
- `R08.BRANCH.*` 8 records (`create/modify/read/reports/financial/inventory/customers/cross-branch-admin`) are **BLOCKED** — org-wide `can_write_business_data` tier still allows `A1`-assigned writer to `INSERT` branch `A2` documents except via POS command (the `R08` partial remediation). `R11` metric-consistency lane (permission-aware AI metric consistency, branch excluded per P4 carve-out) is **NOT EVIDENCED** (`R11` branch excluded).
- `DEC-03` (branch assignments, one-vs-multi) and `P8` (branch enforcement remediation) remain unresolved at `bc97e32`; `AI.BRANCH` has no `PASS` record.

**Options**

**Option AI-Org — Organisation-wide AI only (keep current, `ai_context(business_id)` aggregated at `business_id`).**
- What it means operationally: `ai_context(business_id)` returns org-wide KPIs (`revenue_mtd`, `cash_balance`, `expenses`, 12-month trend etc.) for `business_id`, no `branch_id` param, `can_access_branch` not used for AI, `v_reports_roles` 12 as current.
- Immediate benefit: Simple — no branch param, no `can_access_branch` change, `R03.AI.*` already PASS, no new RPC/migration, `service_role` null-uid path preserved.
- Immediate cost/risk: `branch_manager` sees org-wide KPIs (not `A1` filtered); `cashier` sees **no AI** even if they should see their branch (`cashier` not in `v_reports_roles` — `canViewReports=false`, cannot call `ai_context` even in own business per `20260927000000`); branch `can_write_business_data` still org-wide (8 `BRANCH.*` escapes) — AI is read-only org-wide but writes are not branch-scoped, so AI scope and write scope are inconsistent but not conflicting because AI is read-only.
- Downstream consequences: No `src/supabase/*` change; `ai_context(business_id)` unchanged; `R11` branch excluded per carve-out (metric consistency is org-wide only); `P8` can be before or after (no dependency if org-wide only).
- Affected components: none — `supabase/migrations/20260927000000` (`ai_context`), `src/hooks/usePermissions.ts` (`canViewReports`), `supabase/functions/ai-chat` (org-wide).
- Dependencies: `R11` — branch excluded per P4 carve-out; `P8` — no dependency if org-wide only; `DEC-03` — one-vs-multi informs but not required if org-wide.

**Option AI-Opt — Optional branch filter (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check before assembling branch-filtered KPIs).**
- What it means operationally: `ai_context(business_id, branch_id?)` — if `branch_id` is `null`, returns org-wide as today; if `branch_id` is `A1`, checks `can_access_branch(business_id, branch_id)` (or org-wide role) before assembling branch-filtered KPIs (`SELECT count(*) FROM invoices WHERE business_id=$1 AND branch_id=$2`, `SELECT quantity_on_hand FROM inventory_balances WHERE location_id IN (SELECT id FROM inventory_locations WHERE branch_id=$2)` — verified via existing tables without schema change, per P4 §8.2 + `grep -rn can_access_branch` in `R08`).

- Immediate benefit: `branch_manager` can see `A1` filtered KPIs (branch-scoped `revenue_mtd` etc.); reuse `can_access_branch` without new RLS/policy; read-only, non-authoritative (not remediation).
- Immediate cost/risk: Must enforce `can_access_branch` or leaks cross-branch KPIs ( `A1`-assigned `branch_manager` querying `A2` must be `42501`); confusing if 8 `BRANCH.*` escapes remain — AI would say “A1 sales 10” while `cashier` in `A1` could still `INSERT` branch `A2` invoice via raw writer path (`supabase.from('invoices').insert` with `branch_id A2` — org-wide `can_write_business_data` tier still allows per `R08` partial remediation), so AI scope and write scope are inconsistent; `cashier` still cannot see any AI even if they should see their branch (unless per-branch `canViewReports` added — diverges from `canViewReports=false` for `cashier`); testing needs `R11` branch lane to prove `WHERE branch_id` metric consistency.
- Downstream consequences: New `ai_context` signature or `ai_branch_context` RPC (`ai_context(business_id, branch_id?)`), `can_access_branch` check before assembling KPIs, branch-filtered `v_ai_*` `WHERE branch_id`, `OfflineQueueDrawer`-like not needed; `R11` branch lane to prove metric consistency (`WHERE branch_id`).
- Affected components: `supabase/migrations/20260927000000_r03_ai_context_authorization.sql` (`ai_context` signature or new `ai_branch_context`), `supabase/functions/ai-chat` (branch param), `src/components/ai/*` (branch filter UI), `src/hooks/usePermissions.ts` if `cashier` per-branch `canViewReports`, `R11` (`WHERE branch_id`).
- Dependencies: `DEC-03` (one-vs-multi — optional filter must know `business_users.branch_id` semantics); `R09.3` not directly; `R11` — `WHERE branch_id` metric consistency (branch excluded per carve-out, needs `R11` branch lane); `P8` — 8 `BRANCH.*` escapes (if read-only filter before P8, must be explicitly scoped as non-remediation).

**Option AI-Man — Mandatory branch dimension (every AI call is branch-scoped, no org-wide AI).**
- What it means operationally: Every `ai_context` call requires `branch_id` (e.g., `ai_context(business_id, branch_id)` mandatory), no org-wide `ai_context(business_id)`; `can_access_branch(business_id, branch_id)` mandatory before assembling; `v_reports_roles` per-branch for `cashier` ( `cashier` could see their branch AI if per-branch `canViewReports`).

- Immediate benefit: Strongest fail-closed — branch-scoped by default, no org-wide leak.
- Immediate cost/risk: Breaking change — `owner` must query per branch then aggregate for org-wide KPIs (no org-wide `ai_context`); `v_reports_roles` 12 must become per-branch ( `cashier` could see branch AI — diverges from `canViewReports=false`); `supabase/functions/ai-chat` must be branch-scoped; `R03.AI.*` 5 `PASS` would break (they test org-wide `ai_context(business_id)`).
- Downstream consequences: Mandatory `WHERE branch_id` for every AI metric, `canViewReports` per-branch, `R11` mandatory branch lane, `P8` must close 8 escapes before coherent mandatory branch AI (otherwise branch-scoped AI with org-wide writes is contradictory).
- Affected components: `supabase/migrations/20260927000000` (`ai_context` signature breaking), `src/hooks/usePermissions.ts` (`canViewReports` per-branch), `supabase/functions/ai-chat` (mandatory `branch_id`), `src/components/ai/*` (mandatory branch selector), `R11` mandatory.
- Dependencies: `DEC-03` (one-vs-multi); `P8` — must close 8 `BRANCH.*` escapes before coherent mandatory; `R11` — mandatory `WHERE branch_id`; `R09.3` not directly.

**Evidence available now**

- Verified evidence: `ai_context(business_id)` org-wide, 12 `v_reports_roles` `canViewReports=true`, `service_role` null-uid preserved, `R03.AI.*` 5 PASS, branch data `invoices.branch_id`/`inventory_locations.branch_id`/`pos_shifts.branch_id`/`business_users.branch_id`/`can_access_branch` predicate exists, `R08.BRANCH.*` 8 BLOCKED (org-wide `can_write_business_data` tier still allows `A1`-assigned to `INSERT` `A2` except POS), `R11` branch NOT EVIDENCED, `DEC-03`/`P8` unresolved, P4 disposable probes `A_owner` PASS, `A_cashier` `42501` denied, `A_branch_manager` PASS, `A_viewer` PASS, branch KPIs derivable without schema change (`WHERE branch_id`), `can_access_branch` reusable without new RLS, no branch surface provides `revenue_mtd` for AI — **ALREADY VERIFIED** via source + migration + `src/hooks/usePermissions.ts` + `fixtures.ts` + P4 probe (§8.1, §8.2).
- Evidence that remains unavailable: Branch-filtered `ai_context(business_id, branch_id?)` disposable prototype with `can_access_branch` check — **NOT EVIDENCED** as committed prototype in P4 (per authorization, disposable prototype not committed as product behaviour, **NOT EVIDENCED** as committed prototype); `R11` branch lane ( `WHERE branch_id` metric consistency, branch excluded per carve-out); `P8` 8 escapes closed — all **STILL NOT EVIDENCED** (§10, `IMPLEMENTATION REQUIRED` if committed).
- Evidence that would require implementation: `ai_context(business_id, branch_id?)` signature or `ai_branch_context`, `can_access_branch` check before assembling, branch-filtered `v_ai_*` `WHERE branch_id`, per-branch `canViewReports` for `cashier`, `R11` branch lane, `P8` remediation — **IMPLEMENTATION REQUIRED** (blocked until owner decision; STOP if AI/branch behaviour must change).

**Decision required from Alexander**

Choose scope: **organisation-wide only** (Option AI-Org — keep current `ai_context(business_id)` org-wide, no `branch_id` param) vs **optional branch filter** (Option AI-Opt — read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check, `can_access_branch` reusable without new RLS) vs **mandatory branch dimension** (Option AI-Man — every AI call is branch-scoped, no org-wide, requires `branch_id` + `can_access_branch` + per-branch `canViewReports`). Must be explicit per “organisation-wide AI vs optional branch filtering vs mandatory branch dimension”.

**Implementation consequences**

- If **AI-Org (keep)**: No `supabase/migrations/*` change; `ai_context(business_id)` unchanged, `v_reports_roles` 12 unchanged, `R03.AI.*` PASS unchanged, `R11` branch excluded per carve-out.
- If **AI-Opt (optional filter)**: Add `ai_context(business_id, branch_id?)` signature or `ai_branch_context` RPC, add `can_access_branch(business_id, branch_id)` check (or org-wide role) before assembling branch-filtered KPIs, add branch-filtered `v_ai_*` `WHERE branch_id` (e.g., `SELECT count(*) FROM invoices WHERE business_id=$1 AND branch_id=$2`), update `supabase/functions/ai-chat` + `src/components/ai/*` branch filter UI, decide `cashier` per-branch `canViewReports` (diverges from `canViewReports=false`), add `R11` branch lane to prove `WHERE branch_id` metric consistency.
- If **AI-Man (mandatory)**: As AI-Opt plus every AI call requires `branch_id` + `can_access_branch` mandatory, `v_reports_roles` per-branch for `cashier`, breaking change, `R11` mandatory, `R03.AI.*` must be updated from org-wide `ai_context(business_id)` to `ai_context(business_id, branch_id)`.

**Dependencies**

- `DEC-03` (branch assignments, one-vs-multi) — optional/mandatory must know `business_users.branch_id` semantics (one-vs-multi).
- `R11` — `WHERE branch_id` metric consistency (branch excluded per P4 carve-out, needs `R11` branch lane).
- `P8` — `R08.BRANCH.*` 8 BLOCKED (org-wide `can_write_business_data` tier still allows `A1`-assigned to `INSERT` `A2`); mandatory/optional before vs after P8 (Q15).
- `R09.3` not directly, but `R09.3 Model 3/4` are offline queue Models, not AI.
- `can_access_branch()` — architectural dependency for optional/mandatory (reused without modification per `R08`).

### Q15 — Branch-Aware AI Before or After P8 (DEC-AI-BRANCH, P8 dependency)

**Question**

Should **branch-aware AI** (optional filter per Q14 AI-Opt, or mandatory per AI-Man) ship **before** `BRANCH.*` / `P8` (read-only filter, not remediation, explicitly scoped as non-remediation) or **after** `BRANCH.*` / `P8` (coherent, branch AI and branch writes share `can_access_branch()`, 8 `BRANCH.*` escapes closed)?

**Current verified behavior**

- `can_access_branch(business_id, branch_id)` (`supabase/migrations/*` + `R08.*` PASS) exists and is used for `R08.SHIFT.BRANCH-SCOPED-READ` + `R08.BRANCH.SERVER-SCOPE` (`SELECT ... WHERE branch_id ... can_access_branch`); verified via `grep -rn can_access_branch` + `fixtures.ts` `A1`/`A2` branch columns.
- `R08.BRANCH.*` 8 records (`create/modify/read/reports/financial/inventory/customers/cross-branch-admin`) are **BLOCKED** — `can_access_branch` is not used for all writes; org-wide `can_write_business_data` tier still allows `A1`-assigned writer (`branch_manager` scope `A1`) to `INSERT` `invoices` with `branch_id A2` except via `post_pos_sale` command (the `R08` partial remediation `post_pos_sale` is branch-aware via `pos_shifts.branch_id`, but raw `supabase.from('invoices').insert` is not).
- `P8` (branch enforcement remediation) is **not started** at `bc97e32` — unresolved, must close 8 `BRANCH.*` escapes (all writes `WHERE branch_id` + `can_access_branch`).
- `R11` metric-consistency lane (permission-aware AI metric consistency, branch excluded per P4 carve-out) is **NOT EVIDENCED** — needs `R11` spec + `WHERE branch_id` lane.
- Branch-aware AI before P8 vs after P8 is a **timing** decision, not a branching-filter-vs-mandatory decision (Q14 is filter vs mandatory, Q15 is before vs after P8).

**Options**

**Option T-Before — Branch-aware AI (optional filter, Q14 AI-Opt) before P8 (read-only filter, not remediation, explicitly scoped as non-remediation).**
- What it means operationally: Ship `ai_context(business_id, branch_id?)` optional branch filter **before** `P8` closes 8 `BRANCH.*` escapes — AI is read-only branch-filtered `WHERE branch_id` with `can_access_branch` check, but **raw writes** (`supabase.from('invoices').insert` with `branch_id A2` by `A1`-assigned `branch_manager`) are **still org-wide** until `P8`; AI filter is **not** branch enforcement remediation, just a read-only `WHERE branch_id` with `can_access_branch`.

- Immediate benefit: AI branch filter is available early — `branch_manager` can see `A1` filtered KPIs before `P8`; `R11` branch lane can be proven early with `WHERE branch_id` (without waiting for `P8`); `can_access_branch` reusable without new RLS/policy.
- Immediate cost/risk: **Inconsistent AI vs write scope** — AI would say “A1 sales 10” (branch-filtered `WHERE branch_id A1` with `can_access_branch` check) while `cashier` in `A1` (or `A1`-assigned `branch_manager`) could still `INSERT` `invoices` with `branch_id A2` via raw writer path ( `can_write_business_data` tier still org-wide, `R08.BRANCH.*` 8 BLOCKED, `P8` not closed) — confusing; must be **explicitly scoped as non-remediation** in docs and `OfflineQueueDrawer`-like not needed but docs must state “branch-aware AI before P8 is read-only filter, not branch enforcement remediation”.
- Downstream consequences: Add `ai_branch_context` RPC with `can_access_branch` check before assembling `WHERE branch_id` KPIs (as Q14 AI-Opt), no `P8` writes change; `R11` branch lane can be proven with `WHERE branch_id` before `P8`; after `P8`, writes become `WHERE branch_id` + `can_access_branch` coherent with AI filter — no extra AI change, just `P8` closes 8 escapes.
- Affected components: `supabase/migrations/20260927000000_r03_ai_context_authorization.sql` (`ai_branch_context` or `ai_context` optional param) + `can_access_branch` check, `supabase/functions/ai-chat` (branch param), `src/components/ai/*` (branch filter UI), `R11` `WHERE branch_id` lane — **no `P8` write change** ( `R08.BRANCH.*` remains 8 `BLOCKED` until `P8`).
- Dependencies: `DEC-03` (one-vs-multi); `P8` — explicitly **before** `P8` (read-only, not remediation); `R11` — `WHERE branch_id` metric consistency can be proven before `P8`; `can_access_branch()` — architectural dependency.

**Option T-After — Branch-aware AI after P8 (coherent, branch AI and branch writes share `can_access_branch()`, 8 `BRANCH.*` escapes closed).**
- What it means operationally: Ship `ai_context(business_id, branch_id?)` **after** `P8` closes 8 `BRANCH.*` escapes — `P8` first makes all writes (`INSERT`/`UPDATE`/`SELECT` on `invoices`/`expenses`/`inventory`/`customers`) `WHERE branch_id` + `can_access_branch(business_id, branch_id)` (or org-wide role), then AI branch filter is `WHERE branch_id` + `can_access_branch` coherent with writes.

- Immediate benefit: Coherent — branch AI `WHERE branch_id A1` (`A1` sales) and branch writes `INSERT` `branch_id A1` both require `can_access_branch(business_id, A1)`; no confusion where AI says “A1 sales 10” while raw writer still allows `A1`-assigned to `INSERT` `A2`; `R11` `WHERE branch_id` metric consistency is coherent with writes.
- Immediate cost/risk: Blocks AI branch filter until `P8` completes (8 `BRANCH.*` escapes must be closed first); `P8` is at least `create`+`modify`+`read`+`reports`+`financial`+`inventory`+`customers`+`cross-branch-admin` (all `BLOCKED` at `bc97e32`); AI branch filter is delayed.
- Downstream consequences: `P8` package must close 8 `BRANCH.*` (all writes `WHERE branch_id` + `can_access_branch`), then add `ai_branch_context` with `can_access_branch` + `WHERE branch_id` (as Q14 AI-Opt/Man), `R11` branch lane after `P8` proves metric consistency coherent with writes.
- Affected components: `P8` (`supabase/migrations/*` RLS/trigger for 8 `BRANCH.*`), then `ai_context` branch filter (as Q14) + `R11` lane.
- Dependencies: `P8` — must close 8 `BRANCH.*` before coherent AI; `DEC-03` (one-vs-multi); `R11` — after `P8`; `can_access_branch()` — shared.

Do not implement branch filtering before owner decision; Q15 is timing, not implementation.

**Evidence available now**

- Verified evidence: `can_access_branch(business_id, branch_id)` exists and is used for `R08` `BRANCH.*`/`SHIFT` (`grep -rn can_access_branch` + `supabase/migrations/*` + `fixtures.ts` `A1`/`A2`); branch columns `invoices.branch_id`/`inventory_locations.branch_id`/`pos_shifts.branch_id` verified, branch KPIs derivable without schema change (`SELECT count(*) FROM invoices WHERE business_id=$1 AND branch_id=$2` — verified via existing tables per P4 §8.2), `R08.BRANCH.*` 8 `BLOCKED` (org-wide `can_write_business_data` tier still allows `A1`-assigned to `INSERT` `A2` except `post_pos_sale`), `P8` not started, `R11` branch NOT EVIDENCED, `DEC-03` unresolved — **ALREADY VERIFIED** via source + migration + `R08` `PASS` + P4 probe.
- Evidence that remains unavailable: Branch-filtered `ai_context(business_id, branch_id?)` disposable prototype with `can_access_branch` check — **NOT EVIDENCED** as committed prototype in P4 (per authorization, disposable prototype not committed as product behaviour, **NOT EVIDENCED**); `R11` branch lane (`WHERE branch_id` metric consistency); `P8` 8 escapes closed — all **STILL NOT EVIDENCED** (§10, `IMPLEMENTATION REQUIRED` if committed).
- Evidence that would require implementation: `ai_context(business_id, branch_id?)` signature or `ai_branch_context`, `can_access_branch` check, branch-filtered `v_ai_*` `WHERE branch_id`, `P8` RLS for 8 `BRANCH.*`, `R11` branch lane — **IMPLEMENTATION REQUIRED** (blocked until owner decision).

**Decision required from Alexander**

Choose timing: **branch-aware AI before `BRANCH.*` / `P8`** (read-only filter, not remediation, explicitly scoped as non-remediation, `can_access_branch` + `WHERE branch_id` for AI only) vs **after `BRANCH.*` / `P8`** (coherent, branch AI and branch writes share `can_access_branch()`, 8 `BRANCH.*` escapes closed first). Must be explicit per “branch-aware AI before P8 vs after P8”.

**Implementation consequences**

- If **T-Before**: Add `ai_branch_context` RPC with `can_access_branch` check before assembling `WHERE branch_id` KPIs (as Q14 AI-Opt), no `P8` write change — `R08.BRANCH.*` remains 8 `BLOCKED` until `P8`; docs state “before P8 is read-only filter, not remediation”; `R11` branch lane can be proven before `P8` with `WHERE branch_id`.
- If **T-After**: `P8` first closes 8 `BRANCH.*` (all writes `WHERE branch_id` + `can_access_branch`), then add `ai_branch_context` with `can_access_branch` + `WHERE branch_id` coherent with writes; `R11` branch lane after `P8`.

**Dependencies**

- `DEC-03` (branch assignments, one-vs-multi) — informs `can_access_branch` usage.
- `P8` — `R08.BRANCH.*` 8 `BLOCKED` (branch enforcement remediation) — timing is Q15.
- `R11` — `WHERE branch_id` metric consistency (branch excluded per P4 carve-out, needs `R11` branch lane).
- `Q14` — AI scope (org-wide vs optional vs mandatory) — Q15 timing is orthogonal to Q14 scope (before/after applies to both AI-Opt and AI-Man).
- `can_access_branch()` — architectural dependency for both.

---

## §6 Dependency Map

*Compact table showing which decisions block or influence which later packages. No ranking, no “highest priority”.*

| Decision | Directly affects | Why |
|---|---|---|
| **Q1–Q3** (DEC-09 stale/future version, Model 3/4) | **Model 3** (`exceptionClass` `stale-version`/`unknown-version`), **Model 4** (`RECONCILABLE` `stale-version` re-hydration vs new capture vs permanently non-reconcilable), **R09.4** (`R094.BROWSER.STALE-VERSION-MEASURE` + `SW.QUEUE-PROVENANCE`), **DEC-10** (`legacy` `null` → `missing-provenance` vs stale) | `QUEUE_PAYLOAD_VERSION=1` at `provenance.ts:19` — adding `stale-version`/`unknown-version` requires new typed `exceptionClass` (Model 3) + `RECONCILABLE` decision (Model 4) + `R094` extended through `post_pos_sale` with stale shape + `offline_queue_reconciliations` CHECK + drawer `stale-version` + `reconcile_offline_queue_item` re-hydration vs new capture (original `clientKey` immutable); `DEC-10` `legacy` `null` must stay `missing-provenance` not `stale-version` |
| **Q4–Q7** (DEC-TTL retention/threshold/disposition/reconcilability) | **Model 3** (`expired` `quarantineReason`/`exceptionClass`), **Model 4** (`RECONCILABLE` `expired` re-hydration vs new capture vs permanently non-reconcilable), **R09.4** (browser `IndexedDB`/`Dexie` perf at 500/1000/2000) | No TTL for `pending`/`failed`/`quarantined` at `bc97e32` — adding TTL needs new `expired` typed (Model 3) + `RECONCILABLE` `expired` via `reconcile_offline_queue_item` (Model 4) + `R09.4` browser `PERSIST-RESTART` extended to 30/60/90-day replay + `pruneSyncedItems` auto vs manual; `MAX_PENDING 2000` + `STALE_SYNC 2m` + `LEASE` 30s inform TTL race (lease-aware expiry) |
| **Q8–Q11** (OFFLINE.CONFLICT: `42501`/`22023` typed/quarantine, payload-version typed, same `clientKey` + different payload, `RECONCILABLE`) | **Model 3** (`branch-denied`/`terminal-denied`/`stale-version`/`clientKey-payload-mismatch` typed), **Model 4** (`RECONCILABLE_EXCEPTION_CLASSES` final `['stock-denied','policy-denied']` vs expand vs never expand), **R02** (auth `42501` `can_operate_pos`/`can_access_branch`) | `42501`/`22023` are ordinary `failed` (no `exceptionClass`) at `bc97e32` — promoting to `quarantine` or typed `branch-denied` requires new `exceptionClass`/`quarantineReason` (Model 3) + `RECONCILABLE` decision (Model 4: `branch-denied`/`stale-version` re-hydration vs new capture vs permanently non-reconcilable) + `R02` auth; same `clientKey` + different payload currently `idempotent:true` (no double apply, server does not compare `payloadHash` — P4 `6001` probe) — making it explicit `payload-tampered` requires `payloadHash` per `client_key` storage + `post_pos_sale` hash compare; `R09.3 Model 4` `RECONCILABLE` is at `bc97e32` `['stock-denied','policy-denied']` |
| **Q12–Q13** (BILLING `P0QLT` quota: POS+quick vs uniform, per-transaction vs capture-time) | **Quota/billing implementation** (`_ledgr_assert_usage_limit`, `P0QLT`, `ledgr_monthly_document_count`, `UsageService`, `billing/page.tsx`, `InvoiceRepository.createWithLines`, `PayrollRepository`/`BEFORE INSERT` trigger, concurrent `count(*)` race) | `P0QLT` (`_ledgr_assert_usage_limit` counts `invoices`+`expenses`+`payroll_runs` vs `plan_tier` `free` 50) is only in `post_pos_sale`/`save_quick_sale`/`save_quick_expense` at `bc97e32` — `createWithLines`/builder/`PayrollRepository` direct are `P0001`/success not `P0QLT`, `payroll_runs` counted but not metered, `UsageService` `head:true` RLS-divergence, concurrent `count(*)` without `FOR UPDATE` race — uniform `P0QLT` requires adding `_ledgr_assert_usage_limit` to all `INSERT` paths + `billing/page.tsx` copy update; per-transaction vs capture-time decides whether `enqueue` is gated (entitlement/command) |
| **Q14–Q15** (AI.BRANCH: org-wide vs optional vs mandatory, before vs after P8) | **R11** (`WHERE branch_id` metric consistency, branch excluded per P4 carve-out), **P8** (`R08.BRANCH.*` 8 `BLOCKED` `can_write_business_data` tier), **DEC-03** (one-vs-multi) | `ai_context(business_id)` org-wide, 12 `v_reports_roles` `canViewReports=true` at `bc97e32` — optional `ai_context(business_id, branch_id?)` with `can_access_branch` check reuses `can_access_branch(business_id, branch_id)` without new RLS (verified via `R08`), branch KPIs derivable via `WHERE branch_id`; before P8 is read-only filter (not remediation, `A1`-assigned can still `INSERT` `A2` except `post_pos_sale`), after P8 is coherent (8 escapes closed); `R11` branch lane proves `WHERE branch_id` consistency |

Additional verified dependencies (from repository, not generic):

- `DEC-09` ↔ `DEC-TTL`: TTL threshold informs stale `payloadVersion` grace period (E soft) — partially coupled, both inform version+age joint policy; `MAX_PENDING 2000` is independent.
- `DEC-09` ↔ `OFFLINE.CONFLICT` (class 7 = payload-version): Direct — class 7 is DEC-09; version-gated matrix with v2 shape needs DEC-09.
- `DEC-TTL` ↔ `OFFLINE.CONFLICT` : `quarantined` vs `failed` semantics (Model 3) — `expired` disposition informs whether `expired` is `quarantined` (never retried) or `failed` (infinite loop).
- `DEC-QUOTA` ↔ `OFFLINE.CONFLICT` (class 9 `P0QLT`): `P0QLT` is `policy-denied` `failed` `RECONCILABLE` — uniform vs POS+quick affects how many `policy-denied` occur offline.
- `DEC-AI-BRANCH` ↔ `DEC-03`/`P8`/`R11`/`can_access_branch()` — as above.

Do not rank — no “highest priority” label.


---

## §7 Decision Sheet for Alexander — 15 Blanks (Do Not Pre-Fill)

*Alexander: mark one choice per row. Option labels are as in §2. No option is pre-selected. No ranking, no “recommended”, no “best” is given — choose explicitly.*

> **Instructions:** In the “Choice” column write the chosen option label (e.g., `A`, `B`, `C`, `D`, `E`). Leave blank until decided. Sign at bottom. This sheet is the binding record; no code or policy should change before this sheet is completed and committed.

| # | Decision | Question (short) | Options (label — name) | Choice (blank) | Notes |
|---|---|---|---|---|---|
| **Q1** | DEC-09 stale `< current` | Stale/offline payloads where `payloadVersion < QUEUE_PAYLOAD_VERSION` (e.g., `0` when `1`) — same behaviour or typed quarantine? | **A** — Same behaviour (no typed — stale replayable) · **B** — Typed exception `stale-version` (quarantine, visible, not retried, Model 3) · **C** — `stale-unknown` single bucket · **D** — Hard reject stale (`failed`, not `quarantine`) · **E** — Soft: within-N-versions replayable then `stale-version` | _______ |  |
| **Q2** | DEC-09 future `> current` | Future payloads where `payloadVersion > QUEUE_PAYLOAD_VERSION` (e.g., `9999`) — same or typed quarantine? | **A** — Same behaviour · **B** — Typed exception `unknown-version` · **C** — `stale-unknown` single bucket · **D** — Treat as `missing-provenance` · **E** — Treat as `corrupt-payload` | _______ |  |
| **Q3** | DEC-09 reconcilability | Which typed version exceptions (if any of B–E chosen in Q1/Q2) are reconcilable via re-hydration vs new capture vs permanently non-reconcilable? | **A** — Keep `RECONCILABLE=['stock-denied','policy-denied']` (version exceptions **never** reconcilable/permanently non-reconcilable) · **B** — Add `stale-version` to `RECONCILABLE` (re-hydration via `reconcile_offline_queue_item`) · **C** — Add `unknown-version` · **D** — Add both with new-capture (`sourceItemId`) · **E** — Add both permanently non-reconcilable along `missing-provenance`/`corrupt-payload` | _______ |  |
| **Q4** | DEC-TTL retention | `pending`/`failed`/`quarantined` retention — indefinite or bounded TTL? | **A** — Indefinite retention (keep current, no TTL, `failed` retries forever, `quarantined` until reconciled, `MAX_PENDING 2000` effective bound) · **B** — Bounded TTL — auto-delete/expiry after threshold | _______ |  |
| **Q5** | DEC-TTL threshold | Bounded threshold (only if Q4 B) — `pending`/`failed`/`quarantined` TTL, optionally split? | **A** — `pending` 7 days, `failed` 7 days, `quarantined` 7 days · **B** — `pending` 30 days, `failed` 30 days, `quarantined` 30 days · **C** — `pending` 90 days, `failed` 30 days, `quarantined` indefinitely · **D** — Other threshold (specify below) | _______ | Owner to specify D: _______ |
| **Q6** | DEC-TTL disposition | New disposition when TTL expires — what state? | **A** — `quarantined` (`quarantineReason='expired'`) · **B** — `delete` ( `pruneSyncedItems` ) · **C** — remain `failed` (infinite retry or manual drawer retry) · **D** — new capture via `reconcile_offline_queue_item` `sourceItemId` | _______ |  |
| **Q7** | DEC-TTL reconcilability | Is `expired` reconcilable (if quarantined per Q6 A) via re-hydration vs new capture vs permanently non-reconcilable? | **A** — Re-hydration via `reconcile_offline_queue_item` with new `queueAttemptId` (PIN re-prompt, `pending`+`RETRYABLE`, `sourceItemId` not needed, original `clientKey` mutable) · **B** — New capture (`sourceItemId`, new `clientKey`) · **C** — Permanently non-reconcilable (no `Reconcile` button) | _______ |  |
| **Q8** | OFFLINE.CONFLICT ordinary vs typed | Which ordinary authority failures `42501`/`22023`/`23514`/`terminal` should become typed/quarantined? | **A** — Ordinary `failed` (keep current — all `42501`/`22023`/`23514`/`terminal` remain `failed` indefinitely) · **B** — Typed `quarantined` by class (`42501`→`branch-denied` `quarantined`, `22023`→`terminal-denied` `quarantined`) · **C** — Non-`RECONCILABLE` ordinary `failed` with `exceptionClass` typed but not `quarantined` · **D** — All authority `42501` typed `quarantined` including PIN/time | _______ |  |
| **Q9** | OFFLINE.CONFLICT payload-version typed | Should payload-version (stale `0`/`null`-vs-version) become typed conflict? | **A** — Ordinary `failed` (no new typed) · **B** — Typed `stale-version` of Q1 · **C** — Keep `missing-provenance`/`corrupt-payload` only (null/malformed typed, version not) | _______ |  |
| **Q10** | OFFLINE.CONFLICT same `clientKey` + different payload | Same `clientKey` re-delivered with materially different payload (`items:150→999`) — detected + typed? | **A** — Same `clientKey` assumed identical (keep current `idempotent:true` `count 1`, no hash compare, `6001`/`dee7abf8`) · **B** — Typed exception `clientKey-payload-mismatch` / `payload-tampered` (`quarantined` + `quarantineReason`) · **C** — Typed as `failed` `clientKey-payload-mismatch` (not `quarantined`) | _______ |  |
| **Q11** | OFFLINE.CONFLICT RECONCILABLE | Final `RECONCILABLE_EXCEPTION_CLASSES` policy? | **A** — Keep `['stock-denied','policy-denied']` (no new RECONCILABLE) · **B** — Expand to include newly typed (e.g., `branch-denied`, `stale-version`) with re-hydration (`reconcile_offline_queue_item` original `clientKey` mutable) · **C** — Expand with new-capture (`sourceItemId`, new `clientKey`) · **D** — Never expand (typed but permanently non-reconcilable, along `missing-provenance`/`corrupt-payload`) | _______ | Specify expanded list if B/C: _______ |
| **Q12** | BILLING quota scope | Scope of authoritative server quota enforcement — uniform or allowed skew? | **A** — POS+`quick_*` only (keep current — `_ledgr_assert_usage_limit` in `post_pos_sale`+`save_quick_sale`+`save_quick_expense`+`execute_pending_payroll_run`, `P0QLT` only there) · **B** — Uniform `P0QLT` (every `invoices`/`expenses`/`payroll_runs` INSERT) · **C** — Uniform except operator-internal (`payroll_runs` via `execute_pending_payroll_run` path exempt in billing-linter sense but still capped by trigger) | _______ |  |
| **Q13** | BILLING quota authority | Where quota authority lives — per-transaction vs capture-time? | **A** — Per-transaction authority (`_ledgr_assert_usage_limit` in `post_pos_sale` only — billable `total_amount` is `posted_amount`, capture-time already correct) · **B** — Capture-time only (entitlement at `enqueue` in `post_pos_sale` mode) · **C** — Both (entitlement at `enqueue` + authoritative `post_pos_sale` authority) | _______ |  |
| **Q14** | AI.BRANCH scope | AI/reporting branch scope — org-wide vs optional filter vs mandatory? | **A** — Organisation-wide only (keep current `ai_context(business_id)` aggregated at `business_id`, no `branch_id` param) · **B** — Optional branch filter (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check) · **C** — Mandatory branch dimension (every AI call is branch-scoped, no org-wide) | _______ |  |
| **Q15** | AI.BRANCH timing vs P8 | Branch-aware AI (if Q14 B or C) ships before or after `BRANCH.*` / `P8`? | **A** — Before `BRANCH.*` / `P8` (read-only filter, not remediation, explicitly scoped as non-remediation) · **B** — After `BRANCH.*` / `P8` (coherent, branch AI and branch writes share `can_access_branch()`, 8 `BRANCH.*` escapes closed) | _______ |  |

**Owner signature:** ____________________________  **Date:** ____________

*No option is pre-filled above. No ranking, no recommendation, no “best” is given — authority rests with Alexander.*

---

## §8 No Application / SQL / RLS / Edge / AI / Billing / Offline / TTL / Version / Branch / Test / Package / CI / Schema Changes in This Document

This document makes **no** changes to:

- Application code (`src/*`), Supabase SQL/RLS/Edge Functions (`supabase/*`), AI context (`ai_context`, `ai-chat`), billing/quota (`_ledgr_assert_usage_limit`, `P0QLT`, `ledgr_monthly_document_count`, `UsageService`, `billing/page.tsx`, `InvoiceRepository.createWithLines`, `PayrollRepository`), offline queue (`queueApi.ts`, `db.ts`, `provenance.ts`, `reconciliation.ts`, `OfflineQueueDrawer`, `useOfflineQueue`, `syncQueue`, `sweepUnverifiableItems`, `reconcile_offline_queue_item`, `offline_queue_reconciliations`, `QUEUE_PAYLOAD_VERSION`, `hasTrustworthyProvenance`, `MAX_PENDING`, `STALE_SYNC`, `LEASE`, `BACKOFF`), TTL, payload-version, branch enforcement (`can_write_business_data`, `can_access_branch`, `R08.BRANCH.*`), tests (`tests/*`), package/CI config, DB schema, or the P3 baseline `bc97e32`.

Any future `Model 3`/`Model 4`/`R09.4`/`R11`/`P8`/`DEC-03` implementation remains **blocked until the above §4 sheet is completed** by Alexander. `P4 revision e36e46e` did not move the baseline — `git diff befab28..e36e46e --stat` shows only `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (docs-only), `git diff bc97e32..e36e46e --stat` shows only `docs/audits/` (no `src/*`, `supabase/*`).

---

## §9 No Recommendation, No Ranking, No Scoring, No “Best” — Authority Rests With Alexander

This document presents **options without recommendation**. No option in Q1–Q15 is ranked, scored, or labelled “recommended”, “preferred”, “best”, “highest priority”, or “default”. The dependency map (§3) is descriptive (which decisions block which packages), not a priority order. Alexander selects explicitly in §4; until then no policy is decided. Do not rewrite evidence to make any policy appear decided.

---

## §10 STOP — Await Explicit Owner Decision Before Any Implementation

**STOP.** Even after this document is delivered, **do not implement** any of:

- `QUEUE_PAYLOAD_VERSION`, `hasTrustworthyProvenance`, `sweepUnverifiableItems`, `R09.4`, `Model 3`/`Model 4`, TTL, `exceptionClass`/`quarantineReason`/`RECONCILABLE`, `offline_queue_reconciliations`, `reconcile_offline_queue_item`, `OfflineQueueDrawer`, `_ledgr_assert_usage_limit` expansion to `createWithLines`/builder/`PayrollRepository`/`BEFORE INSERT trigger`, `payroll_runs` `pay_period_start` gating, `ai_context(business_id, branch_id?)` / `ai_branch_context` / `can_access_branch` for AI, `P8` branch enforcement, `R11` metric consistency, schema/migration/RLS/policy changes.

**Await an explicit, written instruction from Alexander completing §4** (or equivalent written decision record) before any of the above is committed as product behaviour. If a disposable, local, read-only, non-product prototype is needed to inform a decision, it must remain **disposable / local / not committed** as product behaviour (per P4 authorization).

Return after creation (§8 — required response):

1. Baseline verification outcome (HEAD `e36e46e`, same baseline YES, `bc97e32` / `b9d41ec854a1` / `742/0/40/782` preserved, docs-only diff).
2. Path to the created decision-resolution document.
3. Confirmation that **Q1–Q15 have been presented with option labels and without selection or ranking**.
4. Confirmation that **no product / SQL / RLS / Edge / AI / billing / offline / TTL / version / branch / test / package / CI / schema changes were made** in this step.
5. Confirmation that **no implementation of `Model 3`/`Model 4`/`R09.4`/`P8`/`R11`/TTL/version/branch/billing/offline will start** until an explicit written decision from Alexander.

Then **WAIT** — do not proceed without that explicit owner decision.
