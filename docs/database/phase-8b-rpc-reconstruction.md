# Phase 8B.1 — RPC/Function Reconstruction

**Status:** ✅ COMPLETE — 9/9 RPCs reconstructed from repository evidence,
20/20 functional tests passing on a fresh replay (PostgreSQL 18.4).

> **Honesty statement:** the original production bodies were NOT captured
> (Phase 8A.1 had no authorization to inspect production). Every reconstructed
> behaviour below is tagged **[VERIFIED]** (direct repository evidence),
> **[INFERRED]** (reconstruction from evidence, no direct proof of the original
> implementation), or **[UNKNOWN]** (no evidence — deliberately not
> fabricated). This is a *reconstruction*, not a *recovery*.

## Migration

- `supabase/migrations/20260815000000_phase8b_reconstruct_rpcs.sql`
- `supabase/migrations/20260815000001_phase8b_fix_shadowed_defaults.sql`
  (fixes six NOT NULL columns whose defaults the Phase 8A.1 base migration
  shadowed — see §5)

## Evidence matrix

| # | Function | Signature (generated types) | Evidence sources | Verdict |
|---|---|---|---|---|
| 1 | `create_business_with_owner` | 18 args → `uuid` | CreateBusinessPage.tsx (args, post-creation memberships reload), RegisterPage.tsx (full_name metadata), reserve_document_number RPC (counter semantics), 20260726000001 (plan_tier default), live capture (businesses defaults) | ✅ reconstructed |
| 2 | `seed_new_business` | `(p_biz jsonb) → void` | seedChartOfAccounts.ts (full COA: 171 accounts, gaap/ifrs templates, column mapping), fiscalYear.ts (paye_bands 'YYYY/YY' label, 07-01 start) | ✅ reconstructed |
| 3 | `accept_invitation` | `(p_token text) → jsonb` | AcceptInvitationPage.tsx (return contract: business_id/role/business_name/already_member; error handling), accept-invite-link edge function (acceptance flow) | ✅ reconstructed |
| 4 | `invite_member` | `(p_business_id, p_email, p_role) → text` | TeamManagementPage.tsx (token return), create-invite-link edge function + local-backup/index.ts (permission model), 20260723000001 (business_invitations shape) | ✅ reconstructed |
| 5 | `current_user_role` | `(p_business_id uuid) → user_role` | generated types (signature); business_users model; no live callers | ✅ reconstructed |
| 6 | `get_user_role` | `(p_business_id uuid) → user_role` | same as #5 (legacy alias) | ✅ reconstructed |
| 7 | `get_enum_values` | `(enum_name text) → text[]` | generated types (signature); no live callers | ✅ reconstructed |
| 8 | `log_manual_audit_event` | 8 args → void | JournalRepository.writeAuditLog + PeriodRepository.writeAuditLog (exact args), audit_log live schema (columns) | ✅ reconstructed |
| 9 | `verify_audit_chain` | `(p_business_id, p_resource_type?) → table` | AuditLogRepository.ChainVerificationResult (8 output columns) | ✅ reconstructed |

## 1. `create_business_with_owner` — CRITICAL (the only business-creation path)

### Workflow specification (traced from the app)

```
CreateBusinessPage.handleSubmit
  → rpc('create_business_with_owner', 18 named args)   [VERIFIED]
  → rpc('record_business_terms_acceptance', {p_business_id, p_terms_version:'1.1'})  [VERIFIED]
  → (optional) PartnerClientRepository.addClientToPartner  [VERIFIED]
  → reloads business_users memberships joined to businesses  [VERIFIED]
```

### What must exist after creation (per the app's immediate follow-up queries)

1. `businesses` row — all 18 args + evidenced defaults:
   - `coa_template='gaap'` [INFERRED — AccountsPage defaults to 'gaap']
   - `plan_tier='free'` [VERIFIED — 20260726000001 adds `default 'free'`]
   - `is_active=true` [VERIFIED — live default]
   - counters `invoice_next_number/expense_next_number/payroll_next_number = 1`
     [INFERRED — reserve_next_document_number returns counter−1, so first
     document = `<prefix>-0001`; SettingsPage defaults display to 1]
   - prefixes default `INV`/`EXP`/`PAY` when omitted [INFERRED — the RPC's own
     fallback in reserve_next_document_number: `coalesce(invoice_prefix,'INV')`]
   - `timezone` default `Africa/Blantyre` [INFERRED]
2. `business_users` row (owner, active, accepted_at) [VERIFIED — page reloads
   memberships; 20260728000003 documents the app's membership contract]
3. `user_profiles` row for the caller [INFERRED — nothing else creates it;
   `full_name` sourced from `auth.users.raw_user_meta_data->>'full_name'`
   VERIFIED via RegisterPage signUp options]
4. Chart of accounts — 166 accounts (gaap template) [VERIFIED — see §2]
5. Audit row `business_created` [INFERRED — legacy behaviour unknown; row is
   chain-consistent]

### Required test (from the phase brief)

A brand-new fake user must create a fake business successfully — **verified**:
- business exists ✅ · owner membership ✅ · role=owner ✅ · defaults ✅ ·
  166 accounts ✅ · parent_id resolution ✅ · no cross-tenant data ✅ (fresh DB,
  single tenant) · audit trail ✅ · atomic ✅ (single SECURITY DEFINER function)

## 2. `seed_new_business(p_biz jsonb)`

- **COA:** transcribed 1:1 from `src/services/seedChartOfAccounts.ts` — the
  repository's COA source of truth (171 accounts total; 166 in the default
  `gaap` template, 171 in `ifrs`). Same column mapping as the frontend
  seeder. `parent_id` resolved by code in a second pass. [VERIFIED]
- **PAYE bands:** the fiscal-year *label format* is VERIFIED
  (`YYYY/YY`, from `fiscalYear.ts`), but the **actual statutory band values
  are [UNKNOWN]** — they were never in the repository. Bands are only seeded
  when supplied via `p_biz->'paye_bands'`; `create_business_with_owner` does
  not supply them. **Gap:** payroll PAYE computation has no bands on a fresh
  environment until approved reference data is added (see §7).
- `p_biz` shape is internal (defined by us; the page never calls this
  function directly) — [INFERRED] by design.

## 3. `accept_invitation(p_token text) → jsonb`

Return contract [VERIFIED from AcceptInvitationPage]:
- success: `{ success: true, business_id, role, business_name }`
- already member: `{ success: true, already_member: true, business_id, role,
  business_name }`
- failures raise exceptions whose messages the page matches:
  'Invitation not found or expired.', 'Invitation already accepted.',
  'This invitation is for a different email address.'

Flow mirrors the accept-invite-link edge function: token lookup →
expiry/email checks → reactivate-or-insert `business_users` →
mark invitation accepted. SECURITY DEFINER, `search_path=public`.

## 4. `invite_member(...) → text` (token)

- Permission model [VERIFIED]: owners only may invite as owner/admin; owners
  and admins may invite other roles; other roles cannot invite.
- Creates a `business_invitations` row (token = 32 random bytes hex,
  expires +7 days, invited_by = caller) and returns the token [VERIFIED —
  TeamManagementPage builds `/accept-invitation?token=<token>` from it].

## 5. Audit chain (`log_manual_audit_event` + `verify_audit_chain`)

- **Args** [VERIFIED]: `p_business_id, p_event_type, p_resource_type,
  p_resource_id, p_resource_ref, p_old_values, p_new_values, p_notes`
  (resource_id is **text** — matches the live `audit_log.resource_id` column;
  a uuid-typed signature was found and corrected during testing).
- **Hash algorithm** [INFERRED]: `sha256` over a canonical, timezone-
  independent concatenation (`chr(1)` separators; epoch for timestamps):
  `entry_hash = H(prev_hash, business_id, user_id, occurred_at, event_type,
  resource_type, resource_id, resource_ref, old_values, new_values, notes)`.
  Centralised in `public.audit_chain_hash(...)` so writers and verifiers
  cannot drift. **The original algorithm is UNKNOWN** (production was not
  captured); on a fresh database the chain is self-consistent, and
  `verify_audit_chain` validates it end-to-end. If the legacy chain must be
  readable, production capture is required (reported separately).
- **ip_address** [INFERRED]: `'0.0.0.0'` (column NOT NULL; RPC has no
  client-IP source).
- **Permissions:** `log_manual_audit_event` requires
  `can_write_business_data`; `verify_audit_chain` requires `can_read_audit`
  (owner/admin/accountant/payroll_manager/auditor/board_member — VERIFIED
  from 20260728000009).

## 6. Corrective migration — shadowed defaults

The Phase 8A.1 base migration created six NOT NULL columns **without the
defaults** that incremental migrations declare for them (`add column if not
exists` became a no-op). Confirmed on the live staging capture:

| Column | Intended default | Evidence |
|---|---|---|
| `user_profiles.is_platform_admin` | `false` | 20260726000004 |
| `invoices.rate_is_stale` | `false` | 20260727000000 (IAS21) |
| `invoice_payments.rate_is_stale` | `false` | 20260727000000 |
| `expenses.rate_is_stale` | `false` | 20260727000000 |
| `expense_payments.rate_is_stale` | `false` | 20260727000000 |
| `journal_lines.rate_is_stale` | `false` | 20260727000000 |

`20260815000001_phase8b_fix_shadowed_defaults.sql` restores them.

## 7. Remaining UNKNOWNs

| Item | Risk | Recommended action |
|---|---|---|
| PAYE band values (Malawi statutory schedule) | Payroll PAYE = 0 without bands | Approved reference data migration (Phase 8B.5 seed); or authorized production capture |
| Original audit hash algorithm | Legacy audit rows unverifiable | Authorized production capture of one legacy row to reverse-check; fresh DB unaffected |
| Original `business_created` audit event | Cosmetic | None |
| `timezone` default `Africa/Blantyre` | Cosmetic | None |

## 8. Test evidence

`tests/database/rpc_reconstruction.test.js` — 20 assertions, all PASS:
business creation (defaults/membership/profile/COA/parents), role and enum
RPCs, invite permission + token flow, invitation acceptance (grant, double-
accept, expiry checks), audit chain (append, verify, **tamper detection**,
non-member denial), second business.

Run: `node tests/database/rpc_reconstruction.test.js` (requires
`embedded-postgres` + `pg` in a scratch dir; see the harness header).
