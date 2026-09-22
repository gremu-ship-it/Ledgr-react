# R02 — Phone Recovery, Identity Matching & Token Lifecycle Remediation

Date: **2026-09-21** (Africa/Johannesburg). Repository: `gremu-ship-it/Ledgr-react`; branch: `arena/01a0c215-ledgr-react`; baseline HEAD: `2e0ede303634d753710357077823eeafb9ecfb7d`.

## 1. R02 status — BLOCKED, with interim fail-closed containment

**R02 STATUS: Requires Review — presented for approval (§28.5: all six decision-rule conditions met with evidence). INTERIM SECURITY CONTAINMENT — NOT PERMANENT RECOVERY IMPLEMENTATION.** The original foreign-identity recovery failure is reproduced and contained server-side. DEC-02 is **approved** (§26/§28.5); the last identity-matching failure is classified a **CONTAINED SECURITY FINDING**, not a blocker (§28.1); the 13 remaining BLOCKED records are test-environment/future-capability items, not untested Ledgr-controlled security boundaries (§28.2). No production/staging system, real account, message or credential was touched or deployed.

Legend used throughout this report:

| Classification | Meaning in this document |
|---|---|
| Proven current vulnerability | Demonstrated by actual-handler synthetic evidence before containment |
| Approved containment | The implemented, authorized `RECOVERY_UNAVAILABLE` guard — interim, by decision of this stage |
| Proposed design | DEC-02 contract in §26; consistent and testable, but **unapproved** and unimplemented |
| Permanent implementation | Future authorized work restoring legitimate recovery; nothing of it exists yet |
| Unverified assumption | Anything dependent on deployed Auth/provider configuration or delivery |

> **Scope note (single-owner product clarification, superseding earlier shared-phone framing):** Ledgr operates on **one registered phone number = one Ledgr account**. Shared-phone detection, account-selection logic, ambiguity resolution between multiple users and admin selection among shared-phone accounts are **out of model — not designed, built or tested**; the two shared-phone-class diagnostics were removed from the suite. Uniqueness ≠ possession: with no phone-possession challenge (SMS/OTP), phone-only self-service recovery remains **RECOVERY_UNAVAILABLE by design**. The approved containment is unchanged and was extended within its existing boundary: reset attempts against numbers with **no account** are denied (404 `ACCOUNT_NOT_FOUND`) instead of being silently turned into onboarding.

Directive-item map: proven vulnerability §2; ownership analysis and existing factors §23; phone ownership model §24; partial provisioning §25; DEC-02 §26; containment decision §27; permanent recovery requirements §26.9; implementation dependencies §19; customer impact §17; security impact §18; tests executed §13/§14; R01 regression §11; remaining blockers §20; release gate §22; **final classification of remaining blockers §28**.

## 2. Proven vulnerability (reproduced, then contained)

Pre-containment evidence (`.cache/r13/ledgr-r13-8zOlKR/evidence.json`, totals 550/19/51) proved with the **unmodified handler**:

1. `EDGE.RECOVERY.foreign-identity` (original R13 record, unmodified test): an Org A owner submitting a phone number with `reset_password: true` invoked `auth.admin.updateUserById(B_viewer.id, {password: ...})` before any target-membership/self/owner guard. `client.authUpdates` recorded the credential write; the assertion of zero updates failed.
2. Stateful probes: Org A owner → Phone B returned **200** with B's synthetic credential revision 0→1 (A unchanged); Org B owner → Phone A the reverse. Phone A mapped to mismatched account B also reached B's password update. An unavailable map fell through into the same mutation class. An unregistered reset request created a brand-new account. (Two further multi-source diagnostics from that run are superseded by the single-owner scope note in §1 and removed from the active matrix.)
3. Architecture note (unchanged, for accuracy): the caller's tenant context is an administrative session, **not** an A-bound recovery transaction; there was no issued token to substitute. The exploit is global phone resolution plus authority conflation, not a token swap.

**Post-containment result (the same unmodified negative assertions):** every one of those requests now terminates with HTTP **403 `RECOVERY_UNAVAILABLE`** before any Auth call or database write; full synthetic before/after state for both identities, the new-account counter and the database-write counter is byte-identical. State is asserted **before** the HTTP status so a late rejection cannot mask a completed mutation.

| Probe | Before containment | After containment | Protected state |
|---|---|---|---|
| Org A owner → reset Phone B/account B | 200, B credential 0→1 | 403 RECOVERY_UNAVAILABLE | Byte-identical, 0 Auth writes, 0 DB writes |
| Org B owner → reset Phone A/account A | 200, A credential 0→1 | 403 RECOVERY_UNAVAILABLE | Byte-identical |
| Phone A mapped to mismatched account B | 200, B credential 0→1 | 403 | Byte-identical |
| Reset request for number with no account | 200, a brand-new account provisioned | 404 ACCOUNT_NOT_FOUND | Byte-identical, 0 creations |
| Implicit never-signed-in re-credentialing | Password rotated without any proof flag being set by the caller | 403 | Byte-identical |
| Repeated unproven requests | Each rotated the credential again | Each refused; no write | Byte-identical |

The remaining FAIL `R02.INVITATION.PROFILE-NOT-PROOF` (accept-invite-link display-phone fallback) is **not** credential mutation and is deliberately left open for the permanent identity work; see §20. Removed out-of-model diagnostics remain visible in containment-stage evidence (xDVNzc).

## 3. Root cause

- **Authority conflation:** authority to administer a tenant membership was treated as authority to rotate a global Auth credential that controls every membership of the target user.
- **Unbound resolution:** `findPhoneAccount` accepted the first resolvable map/profile/scan account, without confirming the canonical phone/login identity matches the submitted number or comparing conflicting sources.
- **Fail-open lookup:** map/profile read errors were treated as misses and could fall through to another source; a duplicate profile phone was not an identity proof.
- **Wrong mutation order:** the password replacement ran before target-membership examination, self-target rejection and the R01 protected-owner guard. A later error cannot roll back a completed Auth Admin call.
- **No recovery ownership/lifecycle:** the authenticated caller's session is the tenant administrator's, not proof of ownership by the recovered user. A `temporary_password` boolean and `last_sign_in_at` never constituted recovery proof, challenge binding, expiry or consumption.
- **Restriction matching (residual):** the invitation consumer can treat display-profile phone data as evidence of phone identity. R01 protects direct profile writes; that does not retroactively verify historical values — still open (FAIL retained).

Containment closes the **mutation boundary**. It intentionally does not redesign resolution order, and its removal without the permanent implementation is a security regression.

## 4. Files, functions, database objects inspected

Planning baseline: Architecture Audit §S2, Production-Readiness Plan decision register/DEC-02, Remediation Change-Impact Register R02, R13 reproducible harness/report, and completed R01 source/report.

| Area | Inspected source / objects |
|---|---|
| Administrative phone recovery | `supabase/functions/invite-team-member/index.ts`: `findPhoneAccount`, `userById`, `findUserByEmail`, `attachPhone`, `ensureProfile`, create/adopt/reset branches, mutation ordering |
| Identity matching | `supabase/functions/accept-invite-link/index.ts`: Auth phone, profile fallback, synthetic-email fallback, R01 private mutation invocation |
| Phone normalization / credentials | `supabase/functions/_shared/phone.ts`, `src/lib/phone.ts`, existing phone/parity tests |
| Link lifecycle context | `supabase/functions/create-invite-link/index.ts`, existing R01 acceptance implementation; inspected, not changed |
| Recovery UI | `src/pages/settings/TeamManagementPage.tsx` `handleResendPassword`; phone invite/error UI tests |
| Active email reset routes | `src/pages/auth/ForgotPasswordPage.tsx`, `src/pages/auth/ResetPasswordPage.tsx`, `src/App.tsx` route imports; legacy duplicates `src/pages/ForgotPasswordPage.tsx`, `src/pages/ResetPasswordPage.tsx` (not active routes) |
| Authenticated self-service | `src/pages/SettingsPage.tsx` `supabase.auth.updateUser({password})` — separate from recovery, preserved |
| MFA / factors | `src/components/auth/MFASetup.tsx`, `src/pages/LoginPage.tsx` TOTP enroll/challenge/verify for already-authenticated users |
| Delivery integrations | `supabase/functions/request-account-deletion/index.ts` (dedicated SMTP env secrets, deletion confirmations only); `smsShareLink` client share helper (no service messaging) |
| Config | `supabase/config.toml`: disabled-by-default `auth.sms`/Twilio section, `secure_password_change = false`, email OTP length/expiry settings |
| Database | `20260924000000_phone_team_members.sql`, `20260925000000_phone_accounts_access.sql`, `phone_accounts` (PK phone, service-only), `user_profiles.phone` (non-unique), `business_users`, `business_invitations`, Auth Admin API usage; R01 guards |
| Harness | `tests/release/edge.test.ts`, `edge-loader.mjs`, `evidence.ts`, `gate.mjs`, `vitest.config.ts`, fixtures/database runner; demo-client OTP stubs (`src/lib/demo/client.ts`) |

Inspection is source/local-fixture inspection, not deployed schema, gateway, Auth settings or provider verification.

## 5. Files/functions/database objects changed

1. **Modified** `supabase/functions/invite-team-member/index.ts`: added the interim containment guard refusing credential rotation of any account the call did not create (403 `RECOVERY_UNAVAILABLE`, returned **before any Auth or database write**); removed the unproven password-mutation branch it replaces; updated three now-stale comments/behaviour descriptions; and, per the single-owner clarification, split the unknown-target case out of onboarding: a reset request for a number with no account returns 404 ACCOUNT_NOT_FOUND before any provisioning. No resolution, role, membership, R01 or provisioning change.
2. **Modified** `src/pages/settings/TeamManagementPage.tsx`: JSDoc-only accuracy note on the admin reset action (surfaces the controlled response; no behavioural/UI change).
3. **Modified** `tests/release/r02-recovery.test.ts`: suite now asserts the containment contract — 12 former FAIL negatives pass as denials, the unregistered-phone record is repurposed as the documented provisioning-only contract, one new `CONTAINMENT.RESPONSE-LABELLED` record verifies the controlled body carries no credential material. No assertion was weakened; the accept-invite fallback FAIL and all BLOCKED records are untouched.
4. **Modified** `tests/release/gate.mjs`: unchanged this turn (suite registration from the previous stage).
5. **Updated** this report.

Pre-work SHA-256 manifest comparison: exactly `supabase/functions/invite-team-member/index.ts`, `src/pages/settings/TeamManagementPage.tsx` and `tests/release/gate.mjs` differ among snapshotted files. **No migration, database object, R01 source, invitation/role logic, dependency, deployment configuration or original R13 fixture/assertion was changed.** The approved R01 audit report is unchanged.

## 6. Exact security correction — interim containment implemented

**Change:** in the phone branch of `invite-team-member`, the condition `isPhoneLoginEmail(...) && !provisionedNow && (wantsPasswordReset || !last_sign_in_at)` now returns a controlled 403 with `code: RECOVERY_UNAVAILABLE` and an explanatory message, instead of minting a password and calling `auth.admin.updateUserById`. The guard sits before the membership/self/owner guards by design order — but crucially it sits before **any** Auth mutation, profile write, map write or membership write for that request.

**Deliberately unchanged:**

- Onboarding a genuinely new number via a **plain invite** (`reset_password` not set): `createUser` + one-time handover password + map/profile/membership provisioning. The account did not exist before the call, so no existing credential is touched (`PHONE.UNREGISTERED-ONBOARDING` documents this contract). A **reset request for a number with no account** is a recovery attempt against an unknown target and is refused (404 `ACCOUNT_NOT_FOUND`, `PHONE.UNREGISTERED-RESET`) — recovery can no longer masquerade as provisioning.
- Existing, signed-in members with no reset requested: membership reactivation/role flow identical (R01's owner-protection 403 path untouched; `MEMBER.EDGE-REACTIVATE.owner` still 200 with its single membership update, `...admin` still 403).
- Email invite path: no credential mutation existed there; untouched.
- Authenticated self-service password change (`SettingsPage`) and provider email recovery (`Forgot/ResetPasswordPage`): outside this endpoint, untouched.
- Response contract: no credentials, tokens, OTPs or identifiers in the containment body; `CONTAINMENT.RESPONSE-LABELLED` asserts key-level absence of credential material recursively.

A same-business membership check, matching caller-supplied user ID, trusting map creator/tenant metadata or an administratively confirmed number is **not** the permanent correction and was not implemented as one.

## 7. Identity-matching behavior

Resolution semantics are unchanged this stage: exact normalized phone in `phone_accounts` → profile phone → paginated Auth synthetic-email scan; `userById` falls through on failure. **That order is now safe at the credential boundary** because no resolution outcome can reach a credential mutation: every existing account resolution that would reset (explicitly or implicitly) terminates in the 403 guard, and full-state equality is asserted for the map-unavailability probe. (Conflicting/ambiguous multi-account probes were removed with the single-owner clarification; fail-open lookup remains tracked in §20.)

Open permanent-work items (not hidden by containment): fail-closed semantics **inside** `findPhoneAccount` (error vs miss), single-owner consistency of the map/profile fallback sources (§24 data-integrity finding), and removal/verification of the display-profile phone fallback in `accept-invite-link`. A caller-supplied `user_id` remains ignored — correctly so; binding targets must come from the approved recovery proof, not the request body.

## 8. Token lifecycle behavior

No token infrastructure was added; no invitation, provider-recovery or demo mechanism was repurposed.

| Stage | Administrative phone reset (contained) | Provider email recovery (unchanged) | Invitation links (R01 boundary retained) |
|---|---|---|---|
| Creation | None — recovery credential creation is refused | `resetPasswordForEmail` delegates issuance to Supabase Auth | 32 random bytes hex, existing |
| Storage | None — no recovery transaction exists in the app | Provider-owned; unverified locally | Invitation row/token; R01 eligibility applies |
| Delivery/reference | New-account onboarding handover only (account created this call) | Email link redirects to `/reset-password` | Link returned to authorized issuer |
| Verification | Refusal requires no verification; previously: none existed | Auth client detects recovery session; server Auth enforces subject (provider) | Existing token/status/expiry/identity checks and R01 atomic boundary |
| Consumption | None | Provider semantics — BLOCKED isolated verification | R01 atomic acceptance preserved |
| Expiry | None | Provider expiry/config not verified | Seven days, existing Edge behavior |
| Replay | Repeated requests all refused (PASS) | BLOCKED | No invitation lifecycle redesign |

Temporary-password generation (new-account onboarding only) is unchanged: `crypto.getRandomValues`, default length 12 with class guarantees and modulo-selection bias; the `temporary_password` boolean on the map is a marker, not single-use enforcement. These are onboarding credentials, and a permanent lifecycle (first-use rotation/expiry) remains deferred DEC-02 work, **not** silently claimed fixed.

The token interpolated into a fallback log message in `accept-invite-link` remains a documented source finding; no raw token/password/OTP value appears in this report or R02 evidence.

## 9. Phone-number behavior

Normalization is unchanged (Malawi +265 default, local 0/prefix/00 forms); the four controls pass and root phone/parity suites pass. `phone_accounts.phone` is a PK lookup, service-only; `user_profiles.phone` is non-unique. `attachPhone` sets `phone_confirm: true` at provisioning only — administrative, not an observed ownership challenge. Ambiguity and conflict now fail closed **at the credential mutation boundary**; resolver-level hardening remains permanent work (§20). Existing legitimate phone login semantics are preserved.

## 10. Password/account mutation protection

The sole credential-mutation site in scope (`admin.updateUserById(target, {password})` in `invite-team-member`) is now unreachable for any account the request did not create. Evidence discipline is unchanged: complete synthetic before/after state (both identities' credential/account revisions, new-account count, database-write count) is compared **before** HTTP status assertions; Auth mutation evidence retains identities as labels and field names only.

PASS records proving the boundary: the eight mutation-boundary negatives (isolation ×4, map-unavailability, implicit never-signed-in, no-ownership-proof, repeated-request), `PHONE.UNREGISTERED-RESET` (unknown target denied 404 **before any creation**), `PHONE.UNREGISTERED-ONBOARDING` (plain invite: exactly one creation; Auth mutation list exactly `[new synthetic identity: phone, phone_confirm]`, never `password` on an existing identity), `CONTAINMENT.RESPONSE-LABELLED` (403 body: `code == RECOVERY_UNAVAILABLE`, no key matching `password|temporary|token|secret|otp` anywhere in the payload) and `PRESERVED.SESSION-OWNED-PASSWORD-CHANGE` / `PRESERVED.EMAIL-RECOVERY-ROUTES` (source-preservation checks that the session-owned self-change and provider email recovery routes are untouched).

## 11. R01 regression results

**All 436 approved R01 records pass with every outcome object byte-identical to the approved R01 evidence (`LeOZM6`).** Specifically verified: `MEMBER.EDGE-REACTIVATE.owner`/.`admin` (the only R01 records invoking this handler) use `reset_password: false` against a signed-in fixture, so the guard never engages and their 200/403 statuses and membership-write counts are unchanged. Issuance/acceptance authorization, inactive/demoted issuer denials, legacy fail-closed handling, owner protection, ACLs, provisioning requirements and UI role-picker records are untouched. Root suite: **76 files / 658 tests, exit 0** (includes TeamManagementPage phone-error UI tests, which mock function responses and are unaffected). No R01 file, migration or approved report changed; if a future change alters any R01 outcome the stage will stop.

## 12. R13 original baseline preservation

Original baseline history preserved exactly: **153 of 154 original outcome objects are identical to `.cache/r13/ledgr-r13-c7vMfF/evidence.json`**; original suites/fixtures/assertions were not modified. The single intentional transition:

| Original failure | Attribution / disposition |
|---|---|
| `EDGE.RECOVERY.foreign-identity` | R02 — **FAIL → PASS under approved interim containment** (the unauthorized mutation can no longer execute). Explicitly *not* a claim of permanent recovery implementation; the legitimate-recovery path remains BLOCKED |
| `AI.ANON` | R03 — unchanged FAIL |
| `AI.ROLE` | R11/R03 — unchanged FAIL |
| `ROLE.cashier.write` | R04 — unchanged FAIL |
| `POS.STOCK` | R06 — unchanged FAIL |
| `EDGE.RETRY.no-secret` | R12/R14 — unchanged FAIL |
| `EDGE.WEBHOOK.viewer` | R12 — unchanged FAIL |

Original set is now **107 PASS / 6 FAIL / 41 BLOCKED** (history baseline of 106/7/41 remains preserved as evidence, not rewritten). All 41 original blockers are byte-identical. All 590 pre-containment objects beyond the 12 intended transitions and one addition are unchanged.

## 13. R02 test totals and reproducibility

R02 suite: **35 records — 22 PASS / 0 FAIL / 13 BLOCKED / 0 N/A.**

- PASS (22): three input/session/caller-organisation denials, four normalization controls, actual-phone mismatch denial (**INVITATION.PHONE-MISMATCH**), eight mutation-boundary negatives (isolation ×4, map-unavailability, implicit never-signed-in, no-ownership-proof, repeated-request), unknown-target reset denial (**PHONE.UNREGISTERED-RESET**, 404), plain-invite onboarding contract (**PHONE.UNREGISTERED-ONBOARDING**, 200 / one creation), labelled-response contract (**CONTAINMENT.RESPONSE-LABELLED**), two `PRESERVED.*` source checks, and the reclassified contained-finding record **INVITATION.PROFILE-NOT-PROOF** (§28.1).
- FAIL (0): none. The former **INVITATION.PROFILE-NOT-PROOF** failure is reclassified with structural + stateful proof as a **CONTAINED SECURITY FINDING** (§28.1) — the membership-layer finding itself remains documented for future hardening and was not "fixed away".
- BLOCKED (13): nine provider token/session lifecycle scenarios (no isolated Auth recovery service in the harness; never faked with mocks), **DEC-02.LEGITIMATE-PHONE-RECOVERY** (contract approved; capability pending authorization) and three single-owner OTP scenarios recorded as design-pending — never simulated with mocks: `RECOVERY.OTP.WRONG-DENIED`, `RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED`, `RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY`. Per-record classification in §28.2.

Stage delta for the final classification investigation (single-owner stage run `vYDKTb` → this stage):

| Record | Status delta | Note |
|---|---|---|
| `R02.INVITATION.PHONE-MISMATCH` | PASS → PASS | reclassification per §28 (classification/accuracy); no product change |
| `R02.INVITATION.PROFILE-NOT-PROOF` | FAIL → PASS | reclassification per §28 (classification/accuracy); no product change |

No product code changed in this stage; the suite records reclassifications documented in §28 only. Earlier deltas remain in effect: pre-containment `8zOlKR` → containment `xDVNzc` (12-record FAIL→PASS), and `xDVNzc` → `vYDKTb` single-owner re-scope (2 removed, 6 added, 2 updated, 617 byte-identical). 623 records are byte-identical to the previous stage; the rest are exactly the two rows above.

Final evidence: `.cache/r13/ledgr-r13-8Q0OcU/evidence.json`; independent repeat `.cache/r13/ledgr-r13-c9a6sV/evidence.json` — all outcome objects and harness manifests identical. State-of-the-run integrity: `.cache/r02/comparison.json`.

## 14. Full PASS / FAIL / BLOCKED / N/A breakdown

| Set | PASS | FAIL | BLOCKED | N/A | Total |
|---|---:|---:|---:|---:|---:|
| Original R13 | 107 | 6 | 41 | 0 | 154 |
| Approved R01 additions | 436 | 0 | 0 | 0 | 436 |
| R02 diagnostics | 22 | 0 | 13 | 0 | 35 |
| **Combined release** | **565** | **6** | **54** | **0** | **625** |

Stage references: pre-containment 550/19/51 (620, `8zOlKR`); containment 563/7/51 (621, `xDVNzc`); single-owner 564/7/54 (625, `vYDKTb`); **final classification 565/6/54 (625, `8Q0OcU`)**. The original 154-record history snapshot and its 106/7/41 totals are preserved unchanged as evidence.

### Requested scenario applicability

| Requested scenario | Disposition |
|---|---|
| A cannot recover B (and reverse) | PASS under containment: 403, protected state byte-identical |
| Phone/account mismatch (map identity substitution) | PASS under containment: mutation boundary refuses |
| Cross-organisation identity substitution | PASS under containment |
| Caller-supplied user ID / business ID substitution | Field remains ignored → phone-resolved path; mutation still refuses; PASS |
| Multiple accounts sharing one phone (detection/selection/ambiguity) | **Out of product model (single-owner, §1/§24)** — not designed, built or tested; the previous such diagnostics were removed with this clarification |
| Unregistered phone — reset request | PASS: 404 ACCOUNT_NOT_FOUND, zero writes/creations (recovery must not masquerade as provisioning) |
| Plain invite for a genuinely new number (onboarding) | PASS: exactly one new account; existing identities byte-identical |
| Correct phone + correct identity recovery (legitimate owner) | **BLOCKED**: single-owner possession contract proposed (§26), unapproved; Ledgr has no phone-possession challenge |
| Unique registered phone + valid OTP (future) | **BLOCKED**: no possession capability exists; single-owner contract defined (§26.3), not implemented |
| Wrong OTP; OTP issued for A used against B | **BLOCKED**: pending authorized OTP design; the transaction must bind the phone-resolved user |
| Correct recovery token + identity; missing/malformed/invalid/expired/consumed/replayed/substituted token; identity changed post-issuance | **BLOCKED**: requires isolated Auth recovery service; mocks are not provider evidence |
| Organisation-tagged email recovery token | Structurally N/A (Auth identity is global; no business ID in reset API). Not emitted as an outcome; different-user token substitution remains an applicable BLOCKED check |
| Phone admin-reset token lifecycle fields | Structurally N/A for the tokenless endpoint; its absence does not waive the required ownership proof |
| Display-profile phone satisfies the invitation phone-restriction screen | **CONTAINED SECURITY FINDING (§28.1)**: membership-layer influence documented; zero Auth identity mutations proven; deferred to invitation hardening, not a blocker |
| R01 minimum regression set | PASS: all 436 objects identical (§11) |

Recorded N/A count remains **0** (the two applicability notes above are documentation, not emitted outcomes).

### Other verification executed this stage

- Release typecheck (`tsc -p tests/release/tsconfig.json`): PASS. Release harness run + independent repeat: identical 565/6/54.
- Full comparison script: original-154 preservation (153 identical + 1 intended flip), R01 436-object equality, the single-owner stage delta (2 removed, 6 added, 2 updated, 617 continuation records), the final-classification delta (2 reclassified records, 623 byte-identical continuation records) and the 3-file changed manifest — all asserted and written to `.cache/r02/comparison.json`. Exhaustive credential-mutation call-site sweep evidence: `.cache/r02/credential-sweep.txt` (16 sites, §28.4).
- Root suite: 76 files / 658 tests, exit 0. App typecheck: PASS. Lint: exit 0, one preexisting warning. Node `--check` on the five release `.mjs`: PASS. esbuild syntax on all 29 Edge TypeScript files: zero errors.
- Placeholder-config production build: PASS (documented public placeholder URL/anon key; no env-guard bypass, no real credentials).
- `git diff --check` and explicit new-file whitespace checks: PASS. Full `npm run verify` was not re-run as one command because it exits 1 by design at the still-red gate; every constituent check was run individually with the results above.
- Logs: `.cache/r02/{types,apptypes,root,lint,build,final,repeat,comparison}.*`.

## 15. Migration details

**No migration created, required or applied.** The containment is an application-layer refusal; it adds no column, table, policy or function, touches no constraint, deletes no recovery record/token/history and performs no backfill. The existing 87 source migrations continue to replay unchanged inside the owned disposable R13/R01 fixture (not evidence for a hypothetical R02 schema). Permanent recovery design work may later require recovery-transaction/provenance storage; its pre/post, idempotency and rollback safety cases are not applicable until such a migration is authorized and written. None is fabricated here.

## 16. Rollback / containment procedure

**Containment applied (this stage, approved):** the §6 guard. Its "rollback" is application-level only:

- To revert: restore the prior branch in `invite-team-member/index.ts` (and the two JSDoc notes). **Reverting re-opens the proven unauthorized credential-rotation vulnerability**; rollback is only acceptable paired with the permanent recovery implementation, never alone.
- No data rollback exists or is needed: zero schema changes, zero data writes from containment itself; no deployment occurred, so no hosted state changed at all.
- Operational containment for an actually-exposed endpoint additionally requires deploying this code — a separately authorized step (§19). Local code presence alone protects nothing hosted.
- Irreversibility reminder: any Auth password update that already occurred in a live environment is external to membership transactions and cannot be undone by SQL or redeploy; incident response would require an approved identity-verification/credential-rotation/session-revocation procedure, not this report.

R01 protections remain installed; no unsafe capability was restored as part of any rollback concept, and no legitimate active credential was invalidated.

## 17. Data/customer impact

**Occurred:** none — no production/staging/customer access, no real password reset, no message delivery, no token consumption. Synthetic identities and stateful adapters only; password values were transient fake-method arguments, never recorded; response bodies containing onboarding credentials were never serialized into evidence.

**If containment is deployed (must be stated honestly):**

- Organisation admins can no longer reset any existing member password through Team Management; the action returns "Account recovery is temporarily unavailable" (the UI surfaces the server message; a blank/error-only display is the interim UX).
- Re-inviting a member whose account exists but never signed in (previous handover lost/failed) now refuses; such members are **locked until the permanent recovery path or an approved support-verification process exists**. This is the explicit cost of fail-closed containment and was judged required given the proven cross-organisation credential mutation.
- Reset attempts against numbers with no account now fail (404 ACCOUNT_NOT_FOUND) instead of silently provisioning; a plain invite (no reset flag) remains the onboarding path.
- Members who know their password sign in unchanged; signed-in users can still change their own password; real-email accounts can still use email recovery; inviting a **new** phone number works exactly as before.

**Unverified assumption:** which fraction of real accounts is phone-only without a verified email — analysis requires production data review, not performed.

## 18. Security impact

Positive: the proven cross-organisation credential-rotation primitive, the mapped-identity substitution primitive, the ambiguous/failed-lookup fallthrough into mutation, the implicit never-signed-in re-credentialing and unbounded repeated rotation are **all unreachable at the mutation boundary**, with byte-level state-equality evidence for every negative. Containment adds no secret to clients, logs no identifier or credential, and cannot be satisfied by retrying (idempotent refusal).

Not claimed: resolver-level fail-closed consistency (permanent work, currently safe only *at* the credential boundary); the membership-layer profile-phone fallback (still FAIL); provider recovery token/session guarantees (BLOCKED, needs isolated fixture); first-use/expiry enforcement of onboarding handover passwords; deployment (hosted endpoint is only protected once this code is deployed); audit-log coverage for refused attempts (console warning only, identifier-free by design).

## 19. Deployment dependencies

1. **DEC-02 approval** of §26 (or amendments) before permanent implementation begins.
2. **Deployment authorization** for the containment itself to take effect on the hosted endpoint — verified deployed behavior (function version, gateway, JWT/session settings) remains unverified; no deployment happened.
3. **Support/customer-access plan** for locked-out phone-only members and for members whose initial handover failed (§17); communications are outside this engineering stage.
4. **Isolated Auth recovery/delivery fixture** in R13 for provider lifecycle tests (expiry/consumption/replay/session revocation) — required to ever un-block the nine provider records; mocks are not substitutes.
5. If phone recovery is desired at all: an explicit **OTP/possession decision** covering SMS provider, delivery cost, OTP generation, expiration, retry/rate limits, replay protection, normalization, enrollment/change-of-phone, loss-of-phone recovery, audit logging and provider failure behavior — per the clarification, shared-phone handling is **not** among the design problems. Not made, not implemented (see §26.9). Reusing the existing SMTP edge-function secrets for recovery delivery would itself be a new authorization.
6. Service-role secrets remain server-side; none were requested, stored or added to public configuration.

## 20. Remaining limitations and blockers

1. **DEC-02 approved (2026-09-21)**: the recovery contract stands (§26/§28.5); phone-only self-service recovery remains unavailable **by approved design** until a separately authorized phone-possession mechanism exists. `DEC-02.LEGITIMATE-PHONE-RECOVERY` therefore remains BLOCKED as future-capability verification, not as an unresolved policy question.
2. **`R02.INVITATION.PROFILE-NOT-PROOF` → CONTAINED SECURITY FINDING (§28.1)**: display-profile phone can satisfy the invitation phone-restriction screen (membership-layer consequence documented), while structural + stateful evidence proves zero Auth identity mutation is possible through it; deferred to invitation-acceptance hardening — per the directive, not an R02 approval blocker.
3. **Thirteen lifecycle records BLOCKED (nine provider-token + three single-owner OTP + the legitimate phone-recovery contract record)**: per-record classifications in §28.2 — test-environment limitation / requires isolated Auth fixture / future capability. **No Ledgr-controlled security boundary is untested**, and none is simulated as passing.
4. **Resolver hardening deferred**: fail-open miss/error distinction (an unavailable map falls through to profile/scan) and single-owner consistency of the map/profile sources are future hardening; safe today because every credential decision terminates at the contained boundary.
5. **Onboarding credentials lifecycle**: one-time-use/first-use-rotation/expiry for handover passwords is design work (DEC-02), not implemented.
6. **User-impact mitigation outstanding**: locked-out phone-only members have no approved assisted path yet (§17/§19.3).
7. **Hosted configuration unverified**: deployment, gateway, effective Auth settings and delivered email behavior were not touched and cannot be inferred from local evidence.

## 21. Deferred findings/packages and scope protection

R01 remains approved and closed. R03 AI authorization, R04 permissions, R05 finance, R06 POS/stock, subscriptions/billing, offline sync, AI context, webhooks/jobs and all later packages are untouched; their original failures/blockers keep existing attribution. No R03 work began. R14 support/recovery process design is a coordination dependency (§19.3), not authorization to implement it. No second test framework, no provider replacement, no authentication redesign, no unrelated cleanup was introduced.

## 22. Explicit release-gate status and stop

**Release gate: RED — 565 PASS / 6 FAIL / 54 BLOCKED / 0 N/A (625 records).** The R02 suite itself carries **zero FAIL records**. Historical R13 is preserved (106/7/41); the post-containment replay is 107/6/41. The remaining six failures belong to other packages (R03/R04/R06/R11/R12/R14 attribution) and the blocked records are environment/future-capability items with per-record classifications (§28.2). This is not release readiness: other packages and deployment-stage verification remain.

**R02 STATUS: Requires Review — presented for approval (§28.5: all six decision-rule conditions met with evidence).** Interim containment is the approved standing state; permanent recovery (phone-possession mechanism, support process) remains separately-authorized future scope. Stopped after the final classification stage exactly as instructed: no next R02 cycle without a concrete security blocker, no R03, no deployment, no customer-data operations.

## 23. Recovery-ownership analysis — what proof already exists?

Investigation of the five candidate factors (directive §2), against repository source only:

**A. Verified phone ownership — NOT AVAILABLE.** Phone sign-in is synthetic email + password (`src/lib/phone.ts` documents that `signInWithOtp({phone})` would need an SMS gateway and is not used). `supabase/config.toml` ships the SMS/Twilio sections commented/disabled by default; no SMS provider secrets exist anywhere in source. There is no OTP table, challenge store, attempt counter or rate limit in any of the 87 migrations. `phone_confirm: true` is set administratively at provisioning — it records that *we* attached a number, not that the holder answered a challenge. Building this is precisely the §8-prohibited speculative OTP work; it was **not** done. Under the single-owner model the number would *identify* the one account; verified *possession* (OTP) would be the authorization factor — §24/§26.3.

**B. Verified email ownership — PARTIALLY AVAILABLE.** The active provider flow exists and is wired: `ForgotPasswordPage` → `resetPasswordForEmail`, `PASSWORD_RECOVERY` handling → session-owned `updateUser({password})` + global sign-out on `ResetPasswordPage`. This is a legitimate recovery factor **for accounts with a real, delivered email** — presumably most email-signup accounts (`email_confirmed_at` meaning depends on Auth settings, unverified). It is **unusable for phone login accounts**: their address is synthetic (`265…@phone.ledgr.app`) with no inbox, and `email_confirm: true` at creation does not create one. Delivery verification (hosted SMTP actually sending) is also unverified locally.

**C. Existing authenticated session — AVAILABLE, separate concern.** `SettingsPage` performs session-owned `updateUser({password})`; `secure_password_change = false` means no old-password re-entry (provider default*; *config value of the local project file, hosted value unverified). This is a self-service credential change for users who are **not locked out** and must stay distinct from recovery. Untouched.

**D. Organisation-assisted recovery — NOT A PROOF (current failure).** Tenant membership/admin role authorizes tenant data, not a global credential. An org admin can legitimately *initiate* a recovery for a member only if completion is gated by the member's own proof; the current design completes and mutates immediately. Containment removes this path entirely pending design.

**E. Existing recovery infrastructure — INVENTORY.** Found: provider email recovery (above); MFA TOTP enroll/challenge/verify (requires an authenticated session owning the factor — useless for lockout, correct for step-up); invitation link tokens (invitation-scoped — must not be repurposed as recovery proof); demo-client OTP stubs (`src/lib/demo/client.ts`, demo only); the deletion-confirmation SMTP Edge function with dedicated env secrets (single-purpose; reuse for recovery delivery would be a new authorization); `smsShareLink` client share helper (user's own SMS app, not service messaging). **Not found:** any generic OTP/challenge store, rate limiter, recovery transaction record, or notification service. Conclusion: the only existing *trusted recovery mechanism* is provider email recovery, which covers real-email accounts only.

## 24. Phone ownership model (single-user)

> **Phone ownership model:** Ledgr is designed around one registered phone number per user/account. The phone number identifies the account, but possession of the phone must still be verified before it can authorize credential recovery. Because the current implementation has no phone-possession challenge such as SMS/OTP, phone-only self-service recovery remains unavailable and fails closed.

Product clarification received: shared-phone detection, account-selection logic for shared phones, ambiguity resolution between multiple users and administrator selection of which account owns a shared phone are **out of model — not designed, built or tested**. The previous stage’s shared-phone-class diagnostics (conflicting map/profile sources, ambiguous profile duplicates) were removed from the active suite accordingly; unique-phone-without-proof, substitution, unknown-target and never-signed-in denials now carry the matrix (§13).

**Uniqueness-enforcement inspection (directive §5):**

| Storage | Normalized? | Uniqueness actually enforced? | Notes |
|---|---|---|---|
| `phone_accounts.phone` | Yes — shared `normalizePhone` (Malawi +265) on all write paths | **Yes — PRIMARY KEY**, one phone → one user | Canonical map; service-role only, RLS-revoked from app roles, explicitly non-enumerable by design |
| `user_profiles.phone` | Written normalized by handlers | **No** — `idx_user_profiles_phone` is a plain partial index | Display/fallback data; duplicates structurally possible; backfill only fills empty values |
| `auth.users.phone` | Attached best-effort (`attachPhone`) | No constraint found in any app migration | Hosted GoTrue uniqueness/config behavior unverified from source |
| `business_invitations.phone`, directory/contact phone columns (`customers`, `suppliers`, etc.) | Plain text | No | Restriction/display fields, never identity authority |

**Design/data-integrity finding (reported, not silently changed):** the one-phone-per-user model is enforced only in the service-only map. Nothing in the applied migrations enforces it for `user_profiles.phone` or `auth.users.phone`, and no existing records were deleted, merged or backfilled. Enforcing uniqueness beyond the map (a normalized UNIQUE constraint, or a provider-side phone-unique setting if one exists) requires duplicate-impact analysis of live data and a separately reviewed migration — explicitly **not** introduced during R02 per the directive. This is compatible with today’s security posture: duplicate-capable display phones are never recovery authority, and even the canonical map gates membership only — never credentials — while no possession proof exists.

## 25. Partial-provisioning analysis

Observed distinct states (source-derived) and the approved-containment semantics for each:

| State | Onboarding | Password creation | Password reset | Recovery |
|---|---|---|---|---|
| No account for number | Allowed (existing flow; one-time handover) | At creation only | N/A (nothing to reset) | N/A |
| Account created, never signed in (handover possibly lost) | Membership paths unchanged | — | **Denied (containment)** — previously this silently minted a replacement | Unavailable until DEC-02 (§17 impact) |
| Active account, knows password / signed in | Membership paths unchanged | Session-owned `updateUser` (Settings) | Session-owned change ≠ recovery | N/A |
| Active phone account, locked out | — | — | **Denied (containment)** | Unavailable until DEC-02 |
| Real email account, locked out | — | — | Provider email recovery (factor B) | Provider email recovery |
| Profile/auth/org rows only partially present | No implicit ownership rule anywhere; resolver treats display data as hints only and the credential boundary refuses regardless | | | |

The naming discipline stands: **provisioning can never again masquerade as credential rotation**; "never signed in" was deleted as an authorization heuristic. A safe re-handover for the second row is part of the permanent design (e.g., support-verified re-issue), an explicit user-impact item.

## 26. DEC-02 — Recovery Ownership Proof (formal decision record)

Status: **APPROVED 2026-09-21.** The contract direction was explicitly approved: provider email recovery remains available; a unique phone without verified possession is `RECOVERY_UNAVAILABLE` (the current containment); a future phone-possession mechanism may be separately authorized; never-signed-in accounts receive no automatic credential minting; session-owned self-service password change remains available. The items below are the record of that contract; implementation beyond the containment (item 9) remains future authorization; item 8 is the sanctioned standing state.

1. **What constitutes recovery ownership?** Demonstration of control over a recovery factor that the system has independently bound to *that specific Auth account*: (i) the provider-verified email inbox on the account, exercised through the existing provider recovery flow; or (ii) an explicitly approved, documented support-verification process with recorded operator identity and evidence. Everything else is a hint, never a proof.
2. **What factors are trusted?** Trusted: provider email recovery session; an existing authenticated session for self-change (not recovery); the future support process. **Untrusted:** submitted phone number, `phone_accounts`/`user_profiles` match, `phone_confirm` flag, tenant membership or role, `created_by` metadata, `last_sign_in_at`, caller-supplied user/business IDs.
3. **Can phone-only recovery ever change credentials?** **No — unique phone number = identity lookup/association; verified possession = recovery authorization.** A phone string may *locate* the one account it belongs to; it may never *authorize* a credential change by itself. The authorized future model is: unique registered phone → OTP delivered to that phone → OTP verified → recovery authorized for the server-resolved user, with the transaction bound to that user and the caller unable to replace the user ID (no account-selection step is ever needed). Until such a possession mechanism exists, phone-only accounts remain RECOVERY_UNAVAILABLE for self-service recovery — the current containment is the designed interim state, not an accident.
4. **How are shared phone numbers handled?** They are not part of the Ledgr product model: one registered phone number belongs to one account (§24). No shared-phone detection, selection or ambiguity-resolution logic will be built. Binding rule for the future flow: after successful phone verification the server resolves the user from the registered phone and binds the recovery transaction to that user; caller-supplied identity fields never replace it (today they are already ignored). Duplicate-capable display phones are the §24 data-integrity finding, not a sharing design.
5. **How are partially provisioned accounts handled?** Per §25 matrix: onboarding, password creation, password reset and recovery are distinct operations with distinct gates; "never signed in" never again authorizes re-credentialing; lost handovers route to the approved recovery/support path, at the cost the containment makes explicit.
6. **How are expired/used recovery challenges handled?** Deny. Provider recovery tokens: expiry/consumption are provider-enforced (to be verified via the isolated fixture). Any future app-owned challenge must be single-use, atomically consumed, time-limited and replay-resistant, with attempt limits and identifier-free logging.
7. **What happens when no recovery factor exists?** Fail closed. The member gets the support-verification path (to be specified with R14 coordination) — never a fallback to weaker signals such as knowing the phone number, the org name or a teammate's confirmation.
8. **What is the temporary containment policy?** The implemented 403 `RECOVERY_UNAVAILABLE` guard for any credential rotation of an account the call did not create, both explicit and implicit, identifier-free logging, no credential material in responses. Labelled **INTERIM SECURITY CONTAINMENT — NOT PERMANENT RECOVERY IMPLEMENTATION** in code, UI comment, tests and this report. Removable only together with the approved permanent implementation.
9. **What permanent implementation is required?** (a) Wire phone-account recovery to an approved factor: minimum is routing phone-account recovery through the support-verification process; optional enhancement is the single-owner OTP design (SMS provider, delivery cost, OTP generation, expiration, retry/rate limits, replay protection, normalization, enrollment/change-of-phone process, loss-of-phone recovery, audit logging, provider failure behavior) requiring its own authorization — shared-phone handling is deliberately **excluded** from that design. (b) Resolver hardening: fail-closed miss/error distinction, cross-source consistency, no display-data proofs. (c) Fix `accept-invite-link` display-phone identity fallback (open FAIL). (d) Onboarding credential lifecycle: first-use rotation flag with expiry, delivered-channel review. (e) Isolated Auth fixture verifying provider binding/expiry/consumption/replay/session revocation. (f) Then — and only then — removal of the containment guard with the negative suite kept green by the real mechanism.

## 27. Containment decision record

**Decision (this stage, per directive §6):** implement the smallest fail-closed containment preventing unauthorized credential mutation. **Implemented:** §5/§6. **Explicit label:** INTERIM SECURITY CONTAINMENT — NOT PERMANENT RECOVERY IMPLEMENTATION (code comment, UI JSDoc, test metadata, this report).

| Directive constraint | Compliance evidence |
|---|---|
| Smallest necessary change | One guard block replacing one mutation branch; conditions on `provisionedNow` keep new-account onboarding fully functional |
| Controlled recovery-unavailable response | 403 + `code: RECOVERY_UNAVAILABLE` + human message; asserted by `R02.CONTAINMENT.RESPONSE-LABELLED` |
| Prevent reaching password update without proof | Guard executes before any Auth call/DB write; nine negatives + repeated-request probe show byte-identical state |
| Must not delete accounts / invalidate credentials / modify passwords / delete records / weaken auth / create replacement accounts / bypass the problem | No destructive operation exists in the change; no existing credential touched (only *refusals*); provisioning of new numbers unchanged and is not a "replacement" (the target did not exist); legitimate paths (session self-change, email recovery, new onboarding) remain — nothing merely papers over the flaw, which is why legitimate phone recovery stays BLOCKED rather than silently disabled |
| Do not blindly disable all recovery / identify existing mechanisms first | §23 inventory: only provider email recovery exists and is preserved; the disabled one was the vulnerable phone-only path — fail-closed chosen and impact documented (§17) per directive §7 |
| Preserve R01 / stop on regression | §11: 436/436 records identical; the only handler-invoking R01 records don't engage the guard |
| Retain proven negatives; don't fabricate positives | Negatives kept verbatim as denials; legitimate-recovery, OTP and provider-token records remain BLOCKED/FAIL, not faked |
| Single-owner model clarification honored | Shared-phone diagnostics removed (2 records); unknown-target reset denial, plain-invite onboarding contract and three single-owner OTP blockers added; no shared-phone design, detection or selection logic built |
| Final classification investigation (2026-09-21) | `PROFILE-NOT-PROOF` proven CONTAINED (structurally + statefully — not "fixed"), reclassified with the finding documented; 12 lifecycle records individually classified; no product code changed in the final stage |

**Not done on purpose:** disabling the whole invite endpoint (would break legitimate onboarding), blocking membership flows for existing signed-in members (no credential mutation there), changing resolution order (permanent redesign, not containment), touching `accept-invite-link` (different mutation class; permanent identity work), and no shared-phone selection/ambiguity logic (out of product model).

## 28. Final classification of remaining blockers (2026-09-21 — final R02 investigation)

Directive scope: exactly two investigations — `INVITATION.PROFILE-NOT-PROOF` and the 12 Auth-lifecycle BLOCKED records. No OTP, no R03, no deployment, no production/customer data. DEC-02 was not reopened; the approved contract is recorded in §26.

### 28.1 `INVITATION.PROFILE-NOT-PROOF` — the actual risk, resolved

**A. Exact code path.** `supabase/functions/accept-invite-link/index.ts`, `serve()` POST `{token}` (the legacy-RPC fallback carries no phone restriction; only the `business_invitations` path does). For `invitation.phone`, step 4 resolves the caller's number from three sources: **(1)** `auth.users.phone` on the caller's own Auth record; **(2)** `user_profiles.phone` — the display field, read for the **caller's own** id; **(3)** the caller's synthetic login email (derived from the number by construction). On a match it proceeds to the R01 RPC `accept_invitation_membership(p_invitation_id, p_recipient_id = session user id, p_expected_invitation)`; step 6 upserts / blank-fills the **caller's own** profile row. The only Auth call in the entire file is the read-only `auth.admin.getUserById(callerId)` in step 6 — it contains **no** `updateUserById`, `createUser`, `deleteUser` or password handling at all.

**B. What `user_profiles.phone` actually controls.** It can influence **identity screening** (satisfying the phone-restriction check on acceptance) and **identity selection** in `invite-team-member.findPhoneAccount` (a membership-layer fallback). It cannot influence: credential creation, credential rotation, password reset, Auth identity mutation or password handling (the acceptance file has no mutation call site); the **membership target** (always the session-derived caller — a caller cannot accept "as" B); R01 role/issuer authority (an independent RPC boundary re-validating current issuer authority under database locks); and the R02 containment boundary (a profile-resolved invite target with any reset intent terminates in 403 before any write — §6). Direct client writes to the field are blocked by R01's `r01_profile_write_guard` trigger; its only writers today are service-role handlers (blank-fill, self-referential), so a *manipulated* value is a historical/integrity problem rather than something a caller can mint through the current UI (no client code path writes `user_profiles` at all).

**C. Synthetic exploit test (recorded exactly).** Intended recipient: User A's phone-restricted link. Caller: **User B's own Auth session**, with B's display profile carrying A's number (manipulated/historical display data). Recorded by `R02.INVITATION.PROFILE-NOT-PROOF`: HTTP **200**; the restriction screen was satisfied by display data; `accept_invitation_membership` invoked **1×** (the membership-layer effect — the finding); caller's own-profile write **2** (upsert + blank-fill only); **`authMutationCalls: []`** across `updateUserById` / `createUser` / `deleteUser`; zero credential-bearing fields anywhere; User A's account never referenced; no network/mail effects.

**D. Does containment prevent credential/takeover consequences?** Yes, proven two ways plus an independent boundary: (i) **structural** — the file cannot mutate Auth identities because it contains no Auth-mutation call site; (ii) **stateful** — the exploit executed **zero** Auth mutations of any class while bypassing the screen (before/after evidence, not HTTP status); (iii) the other consumer of the same field (invite-team-member) is independently contained (any reset intent → 403 pre-write; §6/§10). Account takeover is definitionally impossible: acceptance always binds the caller's own session identity.

**Classification: CONTAINED SECURITY FINDING.** The SECURITY BLOCKER test — "unauthorized identity selection **and** credential/account mutation or takeover" — provably fails on its second half. Residual: a phone-restricted link's screen can be passed by display data, yielding an organization membership the restriction intended to prevent (bounded by R01 issuer/current-authority checks, the invitation's fixed role, atomic consumption and 7-day expiry). Deferred to invitation-acceptance hardening (match restrictions against verified `auth.users.phone` / synthetic login only, or treat profile phone as a hint requiring a second factor). Per the directive: documented for future scope and **not a reason to keep R02 blocked**.

### 28.2 The 12 Auth-lifecycle BLOCKED records

| Record | What it requires | Why the current harness cannot execute it | Security significance | Can safely defer? |
|---|---|---|---|---|
| `PROVIDER-TOKEN.valid-own-identity` | Delivery → link → recovery session → password change | No isolated Supabase Auth service/delivery in R13; adapters are not the provider | Availability of the approved email factor, not a security boundary | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.missing` | Provider rejection of an absent token | UI-source harness only; Ledgr **never parses or accepts tokens** (it waits for the provider `PASSWORD_RECOVERY` event) | Provider-side validation; no Ledgr handling exists to weaken | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.malformed` | Provider/SDK rejection of a malformed token | Same — no token parsing anywhere in either page | Provider-side validation | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.invalid` | Provider rejection of a wrong/forged token | Same | Provider-side validation | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.expired` | Provider expiry enforcement | Provider owns expiry; deployed config review is a deployment-stage item | Provider-side | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.consumed` | Provider single-use consumption | Provider owns consumption; app only observes auth events | Provider-side | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.replay` | Provider replay resistance / session invalidation | Provider owns it; Ledgr additionally signs out globally after a successful change (static evidence) | Provider-side with app-level defense | Yes — requires isolated Auth fixture |
| `PROVIDER-TOKEN.substituted` | Token issued for A must not mutate B | **Already covered at the app layer**: both reset pages mutate only through session-owned `updateUser({password})` — no target identifier exists anywhere in those calls, and source assertions prove neither page references `auth.admin` / `updateUserById`. The only remnant (provider binds the session to the token subject) is provider-side | App substitution boundary **verified by construction** | Yes — already covered (app layer); fixture for provider remnant |
| `PROVIDER-TOKEN.identity-changed-after-issuance` | Provider subject binding to the token as issued | Provider-side semantics; no Ledgr token handling | Provider-side | Yes — requires isolated Auth fixture |
| `RECOVERY.OTP.WRONG-DENIED` | A phone-possession OTP mechanism to reject a wrong code | **Capability does not exist** (contract: RECOVERY_UNAVAILABLE); never simulated as passing | Future-capability validation; the CURRENT phone boundary is verified by PASS denial records | Yes — not applicable until OTP is authorized |
| `RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` | OTP issued for A provably bound to A only | Same — no capability | Future-capability validation; the binding rule is fixed in §26.3 | Yes — not applicable until OTP is authorized |
| `RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` | An authorized OTP design end-to-end | Same — no capability | Future availability | Yes — not applicable until OTP is authorized |

**Bottom line:** none of the 12 is an untested **Ledgr-controlled** security boundary. Ledgr code contains no recovery-token parsing, validation or acceptance anywhere — there is nothing in our code for these scenarios to break through. The untested enforcement is provider-internal (GoTrue) plus a not-yet-existing OTP capability; both stay honestly BLOCKED rather than simulated.

### 28.3 Minimal deterministic Auth adapter (directive §5)

A narrow adapter **already exists** in the R02 suite — the stateful synthetic Auth/DB adapters driving the real handlers — and covers every listed capability for the **app-controlled** Admin-API surface:

| Required capability | Adapter evidence |
|---|---|
| New identity creation | Creation counter + returned id (`PHONE.UNREGISTERED-ONBOARDING`) |
| Existing identity | id-keyed user resolution in all isolation probes |
| Never-signed-in identity | `last_sign_in_at: null` toggle (`RECOVERY.IMPLICIT-NEVER-SIGNED-IN`) |
| Credential creation | `createUser` / `updateUserById` field-name tracking (never `password` on an existing account) |
| Credential mutation | Per-party revision counters; every denial asserts zero-delta state FIRST |
| Failed credential mutation | Error injection supported; **no live code path remains** (the old error branch was removed with the contained rotation branch) |
| Exact mutation target | id→party label mapping in every probe |

Extending it to the **provider token lifecycle** (delivery, binding, expiry, consumption, replay, identity-change) would mean emulating GoTrue's token state machine and email delivery — reproducing Supabase Auth itself. Per the directive it was **not built**; the §28.2 records remain test-environment/provider-fixture blocked.

### 28.4 No alternate credential-mutation path bypasses containment

Exhaustive call-site enumeration (`.cache/r02/credential-sweep.txt`; reproducible `rg` over `supabase/functions` + `src`, excluding tests/demo/locales):

| Site | Call | Class | Bypasses containment? |
|---|---|---|---|
| `invite-team-member:213` | `auth.admin.updateUserById(id, {phone, phone_confirm})` | NEW-account phone attachment only (`attachPhone`, called solely on `provisionedNow` accounts) | No — cannot target an existing account |
| `invite-team-member:467/481` | `auth.admin.createUser({…})` | NEW-account provisioning (plain invites); duplicate→adopt path re-enters membership only | No |
| `invite-team-member` (former rotation branch) | `updateUserById(id, {password})` | **Removed/refused by the containment guard** — unreachable for existing accounts | No — that is the containment |
| `accept-invite-link` | none (read-only `getUserById`) | No Auth mutation call site in the file | No — §28.1 |
| `create-invite-link` | none | Invitation token row creation only | No |
| `finalize-account-deletions:53` | `updateUserById(id, {ban_duration})` | Scheduled **account-deletion** lifecycle (ban) — not recovery or credential issuance | No — separate lifecycle, untouched |
| `ResetPasswordPage:35`, legacy `ResetPasswordPage:64`, `SettingsPage:796` | `supabase.auth.updateUser({password})` | **Session-owned self-service** (no target identifier) | No — approved contract path |
| `ForgotPasswordPage:20`, legacy `:22` | `resetPasswordForEmail` | Provider-delegated email recovery | No — approved contract path |
| `RegisterPage:65` | `signUp` | Self-registration of a NEW own account | No |

Every remaining credential-affecting call is new-account onboarding, session-owned self-service, provider-delegated recovery or the unrelated deletion lifecycle. **No alternate path bypasses the R02 containment.**

### 28.5 DEC-02 approval record and decision-rule evaluation

**DEC-02 — decided 2026-09-21 (approved direction).** Unique registered phone identifies the account; **possession must be verified** before it authorizes credential recovery; until a verified phone-possession mechanism exists, phone-only self-service recovery is unavailable (the current containment); never-signed-in accounts receive no automatic credential minting; provider email recovery and session-owned self-service change remain available; a future phone-possession mechanism may be separately authorized.

| Approval condition | Evidence | Met |
|---|---|---|
| `PROFILE-NOT-PROOF` proven contained / non-security-critical | §28.1 structural + stateful proof; CONTAINED SECURITY FINDING | Yes |
| No alternate credential-mutation path bypasses containment | §28.4 exhaustive sweep | Yes |
| The 12 Auth records are test-environment limitations or otherwise covered | §28.2 per-record classification | Yes |
| R01 unchanged | §11: all 436 outcome objects byte-identical | Yes |
| Recovery containment remains intact | §6/§10 unchanged; every denial green | Yes |
| No production/customer data touched | §17; synthetic adapters only | Yes |

**Outcome: R02 presented for approval.** It does not self-declare Complete — acceptance is the reviewer's. Remaining items are future scope (§28.1 invitation hardening, §19 dependencies, optional OTP authorization) and fixture/deployment-stage verification, not R02 approval blockers. STOP per directive.

## Appendix A — Complete R02 diagnostic inventory

| ID | Status | Expected result | Safe observation |
|---|---|---|---|
| `R02.CONTAINMENT.RESPONSE-LABELLED` | PASS | Refusal is a controlled 4xx RECOVERY_UNAVAILABLE response before any Auth/database write, and its body carries no credential material | Expected assertion observed in the labeled local layer. |
| `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` | BLOCKED | A verified phone owner can recover their own unique phone account while tenant administrators never gain global credential authority | DEC-02 single-owner model (per clarification): the phone number identifies the unique account, but possession must be proven before it authorizes credential recovery. Ledgr currently has no phone-possession challenge, so phone-only self-service recovery remains RECOVERY_UNAVAILABLE by design pending the authorized OTP/possession design. No shared-phone selection logic will be built. |
| `R02.DENIAL.FOREIGN-ORGANISATION` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.DENIAL.INVALID-PHONE` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.DENIAL.UNAUTHENTICATED` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.INVITATION.PHONE-MISMATCH` | PASS | A phone-restricted invitation is denied with zero mutations when the caller holds a different phone number | Expected assertion observed in the labeled local layer. |
| `R02.INVITATION.PROFILE-NOT-PROOF` | PASS | Display-profile phone can satisfy the invitation phone-restriction screen (documented membership-layer finding), while the flow provably performs zero Auth identity mutations — no credential creation/rotation/reset or takeover is possible through it; contained finding deferred to invitation hardening | Expected assertion observed in the labeled local layer. |
| `R02.ISOLATION.A-TO-B` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.ISOLATION.B-TO-A` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.ISOLATION.CALLER-SUPPLIED-ID-MISMATCH` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.ISOLATION.MAPPED-IDENTITY-SUBSTITUTION` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.NORMALIZATION.00265990000001.plain` | PASS | Existing Malawi local/international phone semantics resolve the same synthetic login, not ownership proof | Expected assertion observed in the labeled local layer. |
| `R02.NORMALIZATION.0990000001.plain` | PASS | Existing Malawi local/international phone semantics resolve the same synthetic login, not ownership proof | Expected assertion observed in the labeled local layer. |
| `R02.NORMALIZATION.265990000001.plain` | PASS | Existing Malawi local/international phone semantics resolve the same synthetic login, not ownership proof | Expected assertion observed in the labeled local layer. |
| `R02.NORMALIZATION.265990000001.plus` | PASS | Existing Malawi local/international phone semantics resolve the same synthetic login, not ownership proof | Expected assertion observed in the labeled local layer. |
| `R02.PHONE.MAP-LOOKUP-ERROR` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.PHONE.UNREGISTERED-ONBOARDING` | PASS | Legitimate new-account onboarding: a plain invite (no reset flag) for a genuinely new number provisions exactly one new account and never touches an existing identity | Expected assertion observed in the labeled local layer. |
| `R02.PHONE.UNREGISTERED-RESET` | PASS | A reset request for a number with no account is denied as an unknown recovery target; it must NOT silently provision a replacement/new account | Expected assertion observed in the labeled local layer. |
| `R02.PRESERVED.EMAIL-RECOVERY-ROUTES` | PASS | The existing provider email recovery routes are untouched and still delegate issuance/session to Supabase Auth | Expected assertion observed in the labeled local layer. |
| `R02.PRESERVED.SESSION-OWNED-PASSWORD-CHANGE` | PASS | The existing authenticated self-service password change (session-owned, no target ID) is untouched by recovery containment | Expected assertion observed in the labeled local layer. |
| `R02.PROVIDER-TOKEN.consumed` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.expired` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.identity-changed-after-issuance` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.invalid` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.malformed` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.missing` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.replay` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.substituted` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.PROVIDER-TOKEN.valid-own-identity` | BLOCKED | Supabase recovery proof binds mutation to its own subject and enforces lifecycle without modifying an unauthorized identity | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge adapters cannot prove provider token binding, expiry, consumption or session revocation. No real tokens used. |
| `R02.RECOVERY.IMPLICIT-NEVER-SIGNED-IN` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.RECOVERY.NO-OWNERSHIP-PROOF` | PASS | Reject invalid/unproven recovery and leave BOTH identities, new-account count and database state unchanged | Expected assertion observed in the labeled local layer. |
| `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` | BLOCKED | With an authorized OTP capability, verified possession of the registered phone authorizes recovery of exactly its one account (one phone = one user; no account-selection logic needed) | Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage. Future model per product clarification: unique registered phone -> OTP delivered to that phone -> OTP verified -> recovery authorized for the server-resolved user only. Requires separate authorization of SMS provider, delivery cost, OTP generation/expiry, retry and rate limits, replay protection, normalization, enrollment/change-of-phone process, loss-of-phone process, audit logging and provider failure behavior. |
| `R02.RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` | BLOCKED | An OTP issued to the phone of User A cannot authorize a credential change for User B; the recovery transaction is bound to the phone-resolved user and the caller cannot replace that user ID | Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage. Future model per product clarification: unique registered phone -> OTP delivered to that phone -> OTP verified -> recovery authorized for the server-resolved user only. Requires separate authorization of SMS provider, delivery cost, OTP generation/expiry, retry and rate limits, replay protection, normalization, enrollment/change-of-phone process, loss-of-phone process, audit logging and provider failure behavior. |
| `R02.RECOVERY.OTP.WRONG-DENIED` | BLOCKED | A wrong or non-matching OTP is denied, consumes an attempt within the approved limit and changes no state | Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage. Future model per product clarification: unique registered phone -> OTP delivered to that phone -> OTP verified -> recovery authorized for the server-resolved user only. Requires separate authorization of SMS provider, delivery cost, OTP generation/expiry, retry and rate limits, replay protection, normalization, enrollment/change-of-phone process, loss-of-phone process, audit logging and provider failure behavior. |
| `R02.RECOVERY.REPEATED-UNPROVEN-REQUEST` | PASS | Repeated requests without identity-bound recovery proof cannot repeatedly rotate any account credential | Expected assertion observed in the labeled local layer. |

## Appendix B — Stateful observations (labels, counters and field names only; no credential material)

### `R02.CONTAINMENT.RESPONSE-LABELLED`

```json
{
  "status": 403,
  "code": "RECOVERY_UNAVAILABLE",
  "topLevelKeys": [
    "code",
    "error",
    "message"
  ]
}
```

### `R02.DENIAL.FOREIGN-ORGANISATION`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.DENIAL.INVALID-PHONE`

```json
{
  "status": 400,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.DENIAL.UNAUTHENTICATED`

```json
{
  "status": 401,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.INVITATION.PHONE-MISMATCH`

```json
{
  "status": 403,
  "after": {
    "membershipMutations": 0,
    "profileMutations": 0
  }
}
```

### `R02.INVITATION.PROFILE-NOT-PROOF`

```json
{
  "status": 200,
  "membershipScreen": "passed-via-display-data",
  "membershipInvocations": 1,
  "callerProfileWrites": 2,
  "authMutationCalls": []
}
```

### `R02.ISOLATION.A-TO-B`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.ISOLATION.B-TO-A`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.ISOLATION.CALLER-SUPPLIED-ID-MISMATCH`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.ISOLATION.MAPPED-IDENTITY-SUBSTITUTION`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.PHONE.MAP-LOOKUP-ERROR`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.PHONE.UNREGISTERED-ONBOARDING`

```json
{
  "status": 200,
  "authMutations": [
    {
      "identity": "new synthetic identity",
      "fields": [
        "phone",
        "phone_confirm"
      ]
    }
  ],
  "existingIdentitiesUnchanged": true,
  "creations": 1
}
```

### `R02.PHONE.UNREGISTERED-RESET`

```json
{
  "status": 404,
  "unchanged": true
}
```

### `R02.RECOVERY.IMPLICIT-NEVER-SIGNED-IN`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

### `R02.RECOVERY.NO-OWNERSHIP-PROOF`

```json
{
  "status": 403,
  "mutations": [],
  "before": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "after": {
    "A": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "B": {
      "credentialRevision": 0,
      "accountRevision": 0
    },
    "creations": 0,
    "databaseWrites": 0
  },
  "unchanged": true
}
```

## Appendix C — Integrity fingerprints

- Original 154-outcome canonical map SHA-256: `80d8521e5322591d1bbabf4da807ab2dd91a81c5ddf578bbf24cf2c2f4c12d18`; 153 objects identical in both final runs, plus the single intended R02-attributable flip.
- Approved 436 R01-outcome canonical map SHA-256: `fb75192fbd863708e92e479842bce656d259f9d20374034509e5f56728eef803`; identical in both final runs.
- Final 625-outcome canonical map SHA-256: `dc80d012b74397b5efa762d7ab7a2f3601741af894a06f0cd80590a3b90f2549`; identical in the independent repeat.
- Full 12-record transition set, added record, changed-file manifest and digests: `.cache/r02/comparison.json`.

| File | SHA-256 |
|---|---|
| `.cache/r13/ledgr-r13-8Q0OcU/evidence.json` | `48c7c7f28c02ff6622a80e8f13294db0a8f8671ce94045191bf78dfb9beabead` |
| `.cache/r13/ledgr-r13-c9a6sV/evidence.json` | `48c7c7f28c02ff6622a80e8f13294db0a8f8671ce94045191bf78dfb9beabead` |
| `tests/release/r02-recovery.test.ts` | `20872ce69cc19a7047b4ce282ffdf58d2b58c799d4e50fb1a5d35bd50ba760d2` |
| `supabase/functions/invite-team-member/index.ts` | `27ad7bbe6136b3b84f331f7a65f356487e37c07d047cdb1d0b4295d6e8309283` |
| `tests/release/gate.mjs` | `4a41f46e686114615af951a6a0a5d657349b0fb1ed7a24206450ee6a331c6f47` |

Canonical outcome hashes use sorted-key compact JSON over the ID-to-outcome map. Re-run `npm run test:release` to regenerate the diagnostics; the remaining failure and blockers are intentional evidence of still-open work, not an allowed-to-fail bypass.
