# LEDGR — R12 / P-WEBHOOK REMEDIATION AUDIT REPORT

**Date:** 2026-09-23 (Africa/Blantyre)
**Mode:** Implementation + verification of the authorized R12/P-WEBHOOK package only.
**Final status:** **R12 COMPLETE**

---

## A. Baseline

- Branch: `arena/01a0c215-ledgr-react`
- Baseline commit at start: `ccd37ac`; effective parent: `de8c54a` (Decision & Architecture Gate report — docs-only on top of `ccd37ac`).
- Starting release counts (verified by re-run of the existing harness before this work, and during the coverage/gate phases): **PASS 678 / FAIL 2 / BLOCKED 53 / 733 records**.
- Exact two FAILs: `EDGE.RETRY.no-secret [R12/R14]`, `EDGE.WEBHOOK.viewer [R12]`.

## B. Root cause (verified in code before editing; §4 investigation completed)

### B.1 `retry-failed-webhooks` (EDGE.RETRY.no-secret)

- Function: `supabase/functions/retry-failed-webhooks/index.ts` — scheduled dead-letter redispatch for `webhook_deliveries`.
- Vulnerable path: the secret guard compared `req.headers.get('x-cron-secret') !== CRON_SECRET` where `CRON_SECRET = env(CRON_SECRET) ?? env(INVOICE_CRON_SECRET) ?? ''`. **When no job secret is configured, `CRON_SECRET` is `''` and an explicitly empty `x-cron-secret` header equals it** → the guard authorized the entire privileged redispatch (service-role queries + cross-function invocation) for any unauthenticated caller.
- Why the existing control was insufficient: the guard compared values but never enforced the *precondition* (a configured, non-empty secret). Absent configuration = silent authorization-by-empty-string, violating fail-closed semantics expected by the release record.

### B.2 `webhook-dispatcher` (EDGE.WEBHOOK.viewer)

- Function: `supabase/functions/webhook-dispatcher/index.ts` — emits signed financial-event webhooks (`invoice.created/paid`, `expense.created`, `payroll.run`, `tax.due_soon`, `journal_entry.created`; HMAC-signed) to third-party HTTPS endpoints.
- Vulnerable path: `assertMember()` selected only `id` from `business_users` — **any active member, including the read-only `viewer` role, passed** and could enqueue an authoritative arbitrary financial-event payload, which would then be delivered and signed as the tenant to subscribed endpoints.
- Why the existing control was insufficient: membership ≠ write authority. The event stream is authoritative financial output; the read-only tiers defined by the application's own writer model (`can_write_business_data`) were not checked anywhere on the path.

## C. Remediation (minimal server-side enforcement points)

### C.1 `EDGE.RETRY.no-secret` — exact fix

File changed: `supabase/functions/retry-failed-webhooks/index.ts` (guard block only).

- Enforcement point: **first statement of the request handler**, before any client creation/query — so an unauthorized request produces zero calls (asserted by the record).
- Mechanism: `if (!CRON_SECRET || !providedSecret || providedSecret !== CRON_SECRET) → 401`. Unconfigured secret, missing header, and wrong secret all fail closed identically.
- No alternate auth mechanism invented; the existing `x-cron-secret` contract (same pattern as the other scheduled functions) is preserved exactly for valid invocations. Secret never appears in responses/logs/evidence (response bodies stay `{error:'Unauthorised'}`; test asserts secret strings absent from output).

### C.2 `EDGE.WEBHOOK.viewer` — exact fix

File changed: `supabase/functions/webhook-dispatcher/index.ts` (`assertMember` only).

- Enforcement point: inside the existing `assertMember()` member check, executed **before** `deliverWebhooks()` — a denied request produces zero delivery inserts and zero outbound network (asserted).
- Mechanism: the membership query now selects `id, role`, and a role outside the writer tier is denied with HTTP 403. The tier (`EVENT_EMITTER_ROLES`) **mirrors the application's existing authority model verbatim**: the 18-role set from `public.can_write_business_data` (migration `20260728000008`, itself mirroring `canWrite` in `src/hooks/usePermissions.ts`), which deliberately excludes `viewer`, `auditor`, `board_member`, `payroll_manager`. The role is read **server-side from the membership row** — client-supplied role claims (including payload-embedded ones) play no part.
- No new role/hierarchy/policy invented; no role meaning changed; the established Edge idiom (service-role membership `select('role')` + inline tier check, exactly as in `create-api-key`) is followed. The pre-existing comment acknowledging that the browser invokes dispatch from "permitted business actions" is now actually enforced.
- Why no common helper was touched: no shared Edge helper exists — each Edge Function currently inlines its tier (verified across the 27 functions); introducing a shared helper only here would split the idiom, not converge it. The keep-in-sync annotation is embedded at the site.

Test files changed: `tests/release/edge.test.ts` — **additive only**: +4 new records (all R12-labeled, per §7 of the authorization); the two pre-existing records are **byte-for-byte unmodified**.

## D. Verification (exact results — R13 evidence lane, synthetic fixtures)

| Probe | Result |
|---|---|
| `EDGE.RETRY.no-secret` — empty/absent config + explicitly empty header → 401, zero DB calls | **PASS** (previously FAIL) |
| `EDGE.RETRY.invalid-secret` (new) — wrong secret → 401, zero DB calls | **PASS** |
| `EDGE.RETRY.valid-secret-reaches` (new) — valid secret → HTTP 200 on the authorized path; reached protected query surface; **zero mutations** (empty queue), zero outbound dispatch; response exposes no secret material | **PASS** |
| `EDGE.WEBHOOK.viewer` — viewer emits authoritative arbitrary payload → 403, zero outbound network | **PASS** (previously FAIL) |
| `EDGE.WEBHOOK.role-spoof` (new) — viewer with `payload.role:'owner'` claim still → 403; **zero inserts/updates anywhere** | **PASS** |
| `EDGE.WEBHOOK.writer-ok` (new) — owner-tier emitter on allowlisted event reaches delivery core (HTTP 200 `ok:true`); zero deliveries when no subscribed webhooks; zero outbound network | **PASS** |
| Unauthorized/non-member caller | remains **403** via pre-existing records (`EDGE.webhook-dispatcher.invalid/.missing` — PASS, unchanged) |

No production or customer data was used at any point.

## E. Full validation (post-implementation, this exact tree)

| Gate | Result |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run test:release:types` | OK |
| Vite build | OK |
| Unit suite `npm run test` | **709/709 pass (83 files)** — unchanged vs R10 baseline (no app-code surface affected) |
| Focused edge lane (VM-loaded, unchanged handlers + fixed ones) | **64 pass / 7 skipped** |
| Release harness run #1 | **PASS 684 / FAIL 0 / BLOCKED 53 / 737 records** |
| Release harness run #2 | **PASS 684 / FAIL 0 / BLOCKED 53 / 737 records** — per-record identical to run #1 |

Count reconciliation (additive-evidence convention): baseline 678 + 2 flipped FAILs = 680; +4 new R12 records (§7-requirement: invalid secret, valid secret, role spoof, writer-ok) = **684 PASS / 0 FAIL / 53 BLOCKED / 737**. The authorization's "≈680" target is met by the flips; the additional four are the mandated focused proofs of the same two findings.

## F. Preservation (explicit)

R05, R06, R07, R08, R09.1, R09.2 (including both seals), R10: **all evidence unchanged** — identical outcomes in both post-fix harness runs to the R10 baseline (their records were not touched, merely re-executed by the normal harness). The 53 BLOCKED records are all still BLOCKED (none silently cleared; none newly blocked). No historical audit artifact was edited. The two fixed records kept their exact IDs, expectations, and text.

## G. Scope confirmation

Files changed (complete list):

| File | Why |
|---|---|
| `supabase/functions/retry-failed-webhooks/index.ts` | the failing guard itself (C.1) |
| `supabase/functions/webhook-dispatcher/index.ts` | the failing authorization gate itself (C.2) |
| `tests/release/edge.test.ts` | +4 additive R12 records mandated by the authorization's testing requirements |
| `docs/audits/LEDGR_R12_WEBHOOK_REMEDIATION_2026-09-23.md` | this report |

Nothing else was modified: no R09/R10/R08/R07/R06/R05 surfaces, no offline, POS, quota, branch, storage, auth/recovery, or CI semantics; no unrelated Edge Functions; no shared helpers. Two explicit STOP-condition checks evaluated negative: role semantics unchanged (the tier mirrors the existing helper); no broader webhook architecture change was required (fixes are single-gate, both localized inside the existing entry points).

## H. Final status

**R12 COMPLETE.** Ledgr release remains **not complete**: 53 BLOCKED records and the open architecture/decision packages (P-D3-FINAL, DEC-03, D-05, D-06, D-07, runtime evidence, R14/R15) remain governed by their own gates. Under the current hard-gate semantics (BLOCKED → nonzero), the CI release job will remain red until the BLOCKED class is addressed through its own authorized paths — the FAIL class is now empty.
