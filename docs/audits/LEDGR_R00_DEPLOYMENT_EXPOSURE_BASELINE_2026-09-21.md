# R00 — Deployment and Exposure Baseline

**Inspection date:** 2026-09-21 (Africa/Johannesburg)  
**Repository:** `gremu-ship-it/Ledgr-react`  
**Branch:** `arena/01a0c215-ledgr-react`  
**Source commit:** `2e0ede303634d753710357077823eeafb9ecfb7d`  
**Package status:** **Requires Review** — the authorized repository/static baseline is complete; the deployed-state evidence gate remains open. No staging or production attestation is claimed.

## Scope and evidence rules

This is the single R00 deliverable. It follows the R00 entry in `docs/audits/LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md`, the architecture audit and the production-readiness plan in the same directory. The latest authorization permits discovery and documentation, not behavior changes, migrations, customer-data operations or unauthorized remote access.

**Changes:** this new report only. **No application code changed.** No configuration, SQL, IndexedDB, existing planning document or historical capture was changed. No dependencies were installed. No network requests, GitHub queries/workflow dispatches, deployment commands, database connections or browser sessions were used. No customer data was read or modified.

Evidence labels used throughout:

- **SOURCE-VERIFIED:** directly inspected source/configuration or a local static check. This proves what the checkout declares, not what is deployed.
- **RUNTIME-VERIFIED:** observed application/security behavior in a named running environment. **There is no such exposure evidence in this report.** The four local build-env guard checks in §14 are isolated configuration-script executions, not running-application security tests.
- **CONFIGURATION-DEPENDENT:** outcome depends on effective ACLs, enabled functions, dashboard settings, environment values, build configuration or external controls not available here.
- **UNKNOWN:** required evidence unavailable or not collected. Checked-in historical captures are historical source evidence only.

Exposure classifications are separate from evidence strength: **Confirmed exposure**, **Potential exposure**, **Configuration-dependent**, **Not reproducible from available environment**, **Not applicable**. No deployed exploit is classified as confirmed. Source-level defects are explicitly described as confirmed in source, without converting them into runtime claims. For all findings below: **Runtime exposure not verified.**

## 1. Deployment architecture

### 1.1 Declared topology — SOURCE-VERIFIED

```text
Browser / installed PWA
  ├─ Vercel-hosted React/Vite static application
  ├─ Supabase Auth (browser public key + user session)
  ├─ Supabase Data API / RPC / Storage (direct browser access)
  └─ Supabase Edge Functions (JWT, API key, HMAC or job secret)
        ├─ PostgreSQL / Auth Admin / Storage via service-role clients
        └─ AI, payment, mail and customer webhook providers

Optional Express gateway on Railway or Render
  └─ /api/v1/... proxy to configured TARGET_URL
     (not an authorization boundary for direct Supabase clients)

GitHub Actions
  ├─ CI: typecheck → lint → unit tests → frontend build
  ├─ deployment: backend migrations/functions → frontend activation
  ├─ manual staging metadata capture
  └─ scheduled logical backup/restore check

Device state: session persistence, app state, React Query IndexedDB cache,
Workbox response cache and separate unsynchronized transaction queue.
```

Sources: `src/lib/supabase.ts:6–7,108–115`; `src/main.tsx`; `vite.config.ts`; `vercel.json`; `server/src/index.ts`; `.github/workflows/ci.yml`; `.github/workflows/deploy.yml`.

The frontend is not mediated exclusively by the optional gateway. Gateway rate limiting or CORS cannot secure a direct Data API/RPC/Edge path. Client-side route restrictions likewise cannot supply backend authorization.

### 1.2 Deployment sequence

`.github/workflows/deploy.yml` declares main pushes/manual staging dispatches and `v*` tags/manual production dispatches. Staging and production use separate variable/secret names. This is intended separation, **not verification that their values refer to different projects**.

Both jobs build the frontend, push database migrations with `--include-all`, set Edge secrets, deploy functions, optionally deploy the Railway gateway and finally activate the Vercel frontend. Both sides of each Edge deployment conditional use `--no-verify-jwt` (`147–164`, `282–292`). This makes each handler's own authentication essential; it does not prove that every handler is anonymous.

Production migration commands are directly in the workflow (`263–266`); staging uses `scripts/ci/supabase-link-and-push.sh`. That script can retry migrations and invoke a final debug attempt. **It is a write/deploy script, not R00 capture tooling. It was not executed.**

The workflow names a GitHub `Production` environment, but required reviewers, protected tags/branches and enforced CI checks are external settings and **UNKNOWN**. Deploy YAML does not explicitly wait for the separate CI workflow. `vercel.json` disables automatic Git deployment for main; other Vercel dashboard settings and actual deployed commit are unknown.

### 1.3 Per-environment attestation

| Environment | What is known | What remains unknown |
|---|---|---|
| This checkout | Commit/branch; source configuration; 85 migration files; 26 Edge entrypoints; static checks in §14 | No running app/database; no fixture replay |
| Local Supabase | Declared configuration only; PG17 | No instance started; no effective grants/policies/seed result |
| Staging | Workflow and historical metadata artifacts exist | Current project identity, owners, deployed commit, schema, effective ACLs, redirects, buckets, jobs, active clients and recovery evidence |
| Production | Workflow and configuration references exist | All current deployed-state facts; whether optional gateway/AI/API are enabled; effective exposure and recovery |
| Customer devices | Queue/cache source versions exist | Installed service workers, active versions, pending queues and historical sync states |

No remote environment was selected or contacted. Named environment owners and explicit read-only access authorization are still needed before deployed attestation.

## 2. Environment/configuration inventory

### 2.1 Configuration surfaces

| Surface | Source baseline | Qualification |
|---|---|---|
| Frontend | React 19, Vite 8, TypeScript 6; root package scripts | Versions are manifest declarations, not an installed/runtime inventory |
| Build | `npm run build`: prebuild env guard, then `tsc -b && vite build`; `verify`: typecheck/lint/test/build | No install/build performed |
| Vite | `loadEnv(..., '')` in build config; public client variables use `VITE_*`; dev binds `0.0.0.0:5173`, `allowedHosts: true` | Loading all env for build-config use does not by itself inject all secrets into the browser |
| PWA | `generateSW`, automatic updates, REST GET `NetworkFirst` cache, auth `NetworkOnly`, 24-hour API cache | Running clients and cache headers not inspected |
| Supabase local | API schemas `public`, `graphql_public`; max rows 1,000; PG17; Realtime, Storage and Edge runtime enabled | Local TOML is not hosted-project configuration evidence |
| Database | 85 migrations, beginning `20250101000000_base_schema.sql`, ending `20260925000000_phone_accounts_access.sql` | Applied migrations unknown; filenames dated 2026-09-22–25 are later than inspection date |
| Schema/seed | Root `schema.sql` is empty; seeding enabled to `./seed.sql`, but `supabase/seed.sql` absent | R13 fixture/reset verification needed; no reset attempted |
| Gateway | Express; `PORT`, `TARGET_URL`, `ALLOWED_ORIGIN`, `APP_ENV`; Docker Node22 production image/nonroot user | Enabled deployments and actual upstream unknown |
| Railway/Render | Dockerfile and health check `/api/health`; environment-specific declarations | No dashboard/runtime inspection |
| Vercel | SPA rewrite excludes API/assets/files; security headers; no API proxy declared in root config | Actual delivered headers, custom domains and deployment protection unknown |

`supabase/config.toml` declares local TLS disabled and database network restrictions disabled with all-address CIDRs. Studio, local SMTP, Edge inspector and analytics are local developer services. **Do not interpret these as proof of publicly exposed production database, Studio or debugger ports.** Hosted network/TLS settings remain unknown.

### 2.2 Variable names and trust boundaries — values deliberately omitted

| Boundary | Names observed | Treatment |
|---|---|---|
| Browser build-time | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_CHAT_URL`, `VITE_PLATFORM_ROOT_DOMAIN`, `VITE_SENTRY_DSN`, `VITE_APP_VERSION`, `VITE_LOG_LEVEL` | Public bundle configuration. An anon/public key is not an authorization secret; it must only receive intended public-role privileges. Never substitute a service-role key. Browser code also reads Vite `MODE`/`PROD`. |
| Build/CI only | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`; `SKIP_ENV_CHECK`, `VERCEL`, `VERCEL_ENV` | Upload credential must stay outside client code. Guard checks presence, not correct project/key role. |
| Deployment only | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, Vercel IDs, `RAILWAY_TOKEN`, project IDs and environment-suffixed variants | Privileged operational configuration; no values inspected or printed |
| Edge privileged access | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server runtime; all 26 entrypoint files reference the service-role variable |
| Edge origin/URL config | `ALLOWED_ORIGINS`, `APP_URL`, `PUBLIC_API_BASE_URL`, `PARTNER_ADMIN_URL`, `SB_ENV` | Correct origin/project binding must be checked per environment |
| AI | `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPPORT_AGENT_MODEL` | Provider secrets server-side in the active remote path |
| Payment/mail/jobs | `PAYCHANGU_SECRET_KEY`, `PAYCHANGU_WEBHOOK_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `INVOICE_TRACKING_SECRET`, `CRON_SECRET`, `INVOICE_CRON_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SUPPORT_EMAIL` | Runtime secrets and destinations; lifecycle, presence and rotation unknown |
| Telemetry/gateway | `SENTRY_DSN`, `LOG_LEVEL`, `NODE_ENV`, `PORT`, `APP_ENV`, `TARGET_URL`, `ALLOWED_ORIGIN` | DSN is client-visible when intentionally used in browser; upload auth token is not |
| Local optional integrations | `OPENAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`, `S3_HOST`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` referenced through local TOML | References, not discovered credential values or proof those services are enabled remotely |

The deployment workflow does not set every variable consumed by handlers. In particular, `INVOICE_CRON_SECRET` is read by invoice automation but not assigned by `deploy.yml`; general AI selection/key variables and `VITE_AI_CHAT_URL` also need independent configuration verification. Previously set/dashboard-managed values could exist. **Omission from YAML is not proof that a runtime value is absent.**

Browser values are baked into the bundle; changing an Edge secret does not replace an installed frontend's configuration. Conversely, Edge runtime secrets are not read from browser `VITE_*` variables.

### 2.3 Secret handling observations

A location-only scan of tracked text files checked JWT-shaped literals, several provider/key formats, private-key markers and credential-bearing database URLs. No JWT/provider/private-key match was returned by that scan. Database URL candidates were example placeholders plus the explicitly disposable backup-test credential. Only `.env.example` and `server/.env.example` were found as `.env*` files. This is **not** a complete secret-history, build-artifact or hosted-environment audit.

**SECRET/KEY FOUND:** hard-coded disposable restore-database test password; not evidence of a live customer-system credential.  
**LOCATION:** `.github/workflows/backup-verify.yml:54–58,78` (container password and matching restore connection URL).  
**RISK:** inappropriate reuse outside the isolated CI service would expose that service; the workflow alone does not establish misuse.  
**RECOMMENDED ACTION:** keep strictly test-only; R13/R14 should verify isolation and avoid reuse. If an environment owner discovers reuse, rotate that environment's credential through the approved incident process. **Value omitted.**

No production credential was confirmed in source by these checks. Secret references and placeholders are not themselves leaks. A real leakage *path* exists in source logging: `accept-invite-link/index.ts:102` logs an invitation token on the legacy fallback. No log or actual token was retrieved. R02/R14 must review token logging and retention.

## 3. Authentication baseline

### 3.1 Browser identity

`src/lib/supabase.ts:108–115` creates the browser client with a public key, persistent sessions, automatic refresh and URL-session detection. `LoginPage.tsx` uses Supabase password sign-in; phone identities are normalized/mapped through the phone-account mechanism. The login UI supports a TOTP challenge flow. `useAuthListener.ts` hydrates profile and active business memberships and clears app state, notifications and in-memory query data on identity changes.

`src/App.tsx:191–213` declares login/register/forgot-password, reset-password and invitation routes. Password recovery uses `${window.location.origin}/reset-password` in `src/pages/ForgotPasswordPage.tsx:22–23` (a second auth-directory component also exists). No dedicated OAuth callback route was identified in the enumerated `App.tsx` routes; URL session detection is enabled. This does not prove which external sign-in flows the hosted Auth service allows.

### 3.2 Local Auth settings, not hosted facts

`supabase/config.toml` declares:

- Site URL `http://127.0.0.1:3000`; additional redirect URL `https://127.0.0.1:3000`.
- JWT expiry 3,600 seconds; refresh rotation enabled; reuse interval 10 seconds.
- Signup enabled; anonymous sign-in and manual linking disabled.
- Minimum password length 6; no additional password requirement string.
- Email signup enabled, confirmations disabled, double-confirm email changes enabled, secure-password-change disabled.
- SMS signup/confirmations disabled; TOTP and phone MFA enrollment/verification disabled locally.
- External Apple provider and listed third-party Auth providers disabled locally.

The declared local redirect port differs from Vite's 5173. Hosted site URL, redirects, email templates, SMTP, MFA enforcement and password policy are **UNKNOWN**. UI MFA support does not demonstrate mandatory server-side assurance-level enforcement for sensitive operations.

### 3.3 Privileged identity paths

- `invite-team-member/index.ts` verifies the caller and owner/admin authority in the **requested business** before provisioning/inviting (`274–400`). It resolves global phone identities, including a `user_profiles.phone` fallback. The existing-phone branch can reset Auth credentials (`516–546`) before its later target-business membership lookup (`593–598`). The caller's business authority is not equivalent to authority to recover a global identity. **Source-verified authorization gap; Potential exposure; R02.**
- `accept-invite-link/index.ts` requires a valid user, checks expiry and invitation identity restrictions, but accepts profile-phone fallback (`174–199`). Effective profile edit privileges determine part of the risk. It also contains a legacy RPC fallback. **Potential exposure / R01–R02**, not a proven bypass in a live deployment.
- Create-invite authorization is owner/admin with additional owner restrictions on privileged role assignment. Its response link uses caller-supplied `origin` or a localhost fallback (`246–247`) rather than a demonstrated trusted origin allowlist. This is link construction, not proof of an Auth redirect bypass. **Configuration-dependent / R02, R14**.
- Deletion request/cancel handlers authenticate and target the caller; finalization is a separate privileged scheduled function. No account lifecycle operation was invoked.

## 4. Authorization baseline

### 4.1 Database and server controls actually present in source

- `auth.uid()` identifies the authenticated user in database helpers.
- `business_users` links users to businesses, roles and active membership.
- `is_business_member`, `can_write_business_data`, `can_admin_business_data` are `SECURITY DEFINER` helpers with membership-based predicates; their PUBLIC execution is explicitly revoked and execution granted to authenticated/service roles in `20260728000008_role_aware_master_data_rls.sql:76–166`.
- Reconstructed policies provide member reads and role-dependent writes; additional platform-admin/partner and payroll-specific paths exist. These paths must be included in later tests, not treated as all-member access by assumption.
- `post_pos_sale` checks POS authority, with PUBLIC/anon execution revoked and authenticated execution granted (`20260923000000_post_pos_sale_rpc.sql:596+,823–824`). Internal helper revokes also exist.
- `apply_subscription_payment` explicitly revokes PUBLIC/anon/authenticated execution and grants service-role execution (`20260726000002_subscription_payments.sql:145–148`). This is a positive control requiring live confirmation.

**Effective** grants, default privileges, column grants, role inheritance, object ownership, permissive-policy combinations and hosted API exposure are not yet verified. An RLS predicate is not the complete privilege model.

### 4.2 Privileged profile risk

`20260815000003_phase8b_rls_policies.sql:196–205` permits own-profile UPDATE with an identity predicate, not a column-level privileged-field guard. `is_platform_admin` reads a flag on that row (`20260726000004_platform_admin_and_reminders.sql:18–32`). No old/new `is_platform_admin` trigger guard was found in the migration scan. This confirms the source concern, **not that the authenticated role can update that column in the live database**. Actual column/table grants and any deployed guards are needed. **Configuration-dependent; R01.**

### 4.3 Client-side assumptions

`ProtectedRoute`, `PlatformAdminRoute`, `PartnerAdminRoute`, `App.tsx`'s `RoleRoute`, `usePermissions`, `usePosPermissions`, `PlanGate` and `PlanGuard` improve navigation and UX. They are not authorization boundaries.

Specific differences requiring later review:

- UI finance/cost/report restrictions versus member-wide financial SELECT policies.
- Custom POS permissions and branch/all-branch booleans versus database rules that largely check business/role, not assigned branch.
- Plan feature gates versus independently callable tables/RPCs/Edge handlers.
- Manager-approval UI versus the ignored PIN callback in the active POS path.

These are source-verified mismatches assigned to R04/R07/R08/R10. They are not repaired in R00.

## 5. Tenant-isolation baseline

**Architecture classification: D — combination of A (database), B (server/API) and C (frontend filtering).** Database and server controls are intended to be authoritative, but they do not uniformly express the finer role/branch restrictions shown by the UI.

| Path | Existing propagation/enforcement | Limitation to verify |
|---|---|---|
| Business selection | Browser stores active `currentBusiness`; repositories receive `businessId`; active memberships loaded using authenticated user ID | Stored business choice is untrusted input, not proof of authority |
| Direct table reads/writes | Many repository queries add `.eq('business_id', ...)`; RLS uses active membership/role helpers | Base repository ID-only methods rely on RLS; every relationship/child row needs tenant-qualified validation |
| Business creation | `create_business_with_owner` RPC | Effective execution grants and atomic owner creation must be tested |
| Financial/stock/POS RPCs | Business IDs in payloads, function authorization and constraints | Cross-business account/contact/product/location/branch references and internal helper access need isolated tests |
| Public API | Hashed/revocation-checked key determines business; GETs filter by key-bound business; journal command receives server-derived business | Key scopes, present entitlement and role provenance do not follow merely from business filtering |
| Service-role Edge handlers | Authenticate user/key/job first, then explicit queries to select permitted business/record | RLS bypass means missing handler checks are not repaired by browser filters |
| AI chat | Server derives active membership business before calling aggregate RPC | Broad role/branch context; direct RPC is a separate entrypoint |
| Branch | Optional branch filters and POS permission flags exist | `PosPage.tsx` uses null branch; no universal assigned-branch security contract was established |
| Storage | Business prefix membership for logo metadata/upload; private user exports | Logo writes allow active members, not only business admins; signed URLs delegate access |
| Device cache | In-memory identity cleanup exists | Persistent queue/query cache/Workbox account-bound isolation is not demonstrated |

Do not generalize this into “RLS missing everywhere” or “business_id filtering is enough.” Both statements would be inaccurate. Tenant-qualified parent/child constraints and service-role checks remain critical even when RLS is enabled.

## 6. AI access baseline

### 6.1 Entry points and data flow

| Entry point | Access path | Authentication/tenant context | Role/branch authorization |
|---|---|---|---|
| Browser financial assistant (`src/components/ai/Assistant.tsx`, `src/lib/ai/context.ts`) | Browser public client calls `ai_context(p_business_id)`; deterministic forecast/advice can run locally | Current company ID passed to RPC; authenticated session supplies JWT | Client context alone is insufficient; DB aggregate needs explicit scope |
| `ai-chat` Edge Function | Auth verification → active `business_users` selection → service-role `ai_context` → forecast/advice → remote provider | `getUser` checked; requested business is a hint validated against active memberships (`120–149`, `449–509`) | No equivalent field/finance/branch permission filtering found in context-building path; R11 |
| `support-agent` Edge Function | Auth verification → product guidance plus caller-supplied diagnostic context → provider | Valid user; service-role usage counter | Does not query arbitrary tenant financial records in this path; diagnostic disclosure still needs review |
| `suggest-bank-matches` Edge Function | Auth verification → bounded caller-supplied bank/ledger arrays → provider | Valid user, but no organization binding of the submitted arrays (`73–136`) | Data origin/permission depends on upstream read path; no server-side tenant-record fetch/verification here |
| Direct `ai_context` RPC / `v_ai_*` views | Public-schema PostgREST/RPC surface subject to effective grants | Function uses `SECURITY DEFINER`; skips membership rejection when UID is null | Null UID does not identify service role; anon execution/ownership/default ACL must be resolved under R03 |

`src/lib/ai/provider.ts:36–38` chooses remote chat only when `VITE_AI_CHAT_URL` exists; otherwise rules-based local answers. Remote mode forwards the bearer token and context to that configured URL (`98–118`). Trusted endpoint binding is therefore important. Vercel's declared CSP restricts connections to self/Supabase hosts but is not a substitute for selecting the right project endpoint. The deployed build value is unknown.

### 6.2 Functions/tools available to the model

- Financial chat receives a prebuilt data context, forecast and advice; no arbitrary-SQL or arbitrary-database tool executor was found in the inspected active path.
- Support exposes the structured-output `support_response` tool (`support-agent/index.ts:222–299`) for reply/navigation/escalation data, not unrestricted database access.
- Bank matching requests structured suggestions from provided arrays; it does not post financial records in that handler.
- `LLM_ADAPTERS` in `src/lib/ai/provider.ts:676–699` are reference request builders. The non-test search found their declaration, not an active browser caller. Their existence alone is **not evidence that live provider secrets are shipped to the browser**.

### 6.3 Authorization conclusion

Authorization exists **before** service-role AI chat data access at business-membership level. It also exists **inside** `ai_context` for non-null authenticated user IDs. It is **missing as an explicit service-role distinction** for null UIDs, and role/branch/field filtering is incomplete in the aggregate path.

Latest source: `20260823000003_repair_ai_view_tenant_scope.sql:302–320,437–443`; explicit grants to authenticated/service roles do not by themselves remove PUBLIC execution. No explicit `ai_context` revoke was found in migration text. Current effective function/default ACLs remain unknown. **Configuration-dependent anonymous exposure (R03); Potential excessive member access (R04/R11). Runtime exposure not verified.**

AI remains an intelligence layer in this baseline; no authority to alter records or add AI tools is granted by R00.

## 7. Storage baseline

`20260815000004_phase8b_storage.sql` declares:

| Bucket | Intended exposure | Source control |
|---|---|---|
| `business-logos` | Public object URLs | Authenticated insert/select/update require first path segment to be an active member's business ID (`45–91`). No dedicated delete policy in this migration. |
| `user-exports` | Private | No client allow policies added; service-role export uploads and returns a 3,600-second signed URL (`93–103`; `export-my-data/index.ts:250–268`). |

`SettingsPage.tsx` uploads under the business-ID prefix and requests public URLs. The logo bucket uses null per-bucket size/MIME limits unless existing values are already present. Local global storage limit is 50 MiB; hosted effective limits are unknown. Public logos are intentional public content, **not evidence that private exports are public**.

`export-my-data` authenticates the caller and selects owned-business links before tenant-filtered exports. It is privileged and needs separate role/payload/retention verification; it was not invoked. Signed URLs can be used by anyone possessing them until expiry, so they must not be logged or included in source artifacts.

Historical `storage_buckets.json` and `storage_policies.json` are empty. They predate reconstruction and **cannot certify current storage deny-all behavior or current bucket presence**. Extra deployed policies, public flags and Storage object backups remain unknown. Ownership: R04 authorization; R14 retention/recovery.

## 8. API/RPC baseline

### 8.1 Edge inventory — all 26 source entrypoints

Paths below are relative to `supabase/functions/`; each is `<name>/index.ts`. These are declared handler checks, not per-endpoint runtime passes.

| Handler(s) | Authentication/control in inspected source | Follow-up |
|---|---|---|
| `invite-team-member`, `create-invite-link` | User verification and requested-business owner/admin checks; privileged role restrictions | R01/R02 global identity and transition authority |
| `accept-invite-link` | Authenticated user, token/expiry/identity checks; legacy RPC fallback | R02 identity provenance and token logging |
| `list-team-members` | User verification and active business membership | R04 role-appropriate team/identity fields; source returns invitation-token fields |
| `create-api-key` | User verification; active owner/admin; random key returned once, SHA-256 stored | R10/R12 entitlement, scopes and lifecycle |
| `api` | API-key hash lookup and revocation check; database rate-limit RPC; business-bound queries | R12 API authorization/contracts; R05 journal command |
| `webhook-dispatcher` | User verification, active membership, event allowlist; caller-supplied payload | R12 trusted event provenance, not UI authorization |
| `retry-failed-webhooks` | `x-cron-secret` comparison; fallback to `INVOICE_CRON_SECRET` then empty string | R12/R14 verify missing/empty configuration fails closed; no request attempted |
| `ai-chat`, `support-agent`, `suggest-bank-matches` | User verification plus handler-specific context described in §6 | R03/R11/R10 |
| `initiate-subscription-payment` | User verification; active business owner | R10 |
| `verify-subscription-payment` | User verification; active membership of payment's business | R10 |
| `grant-manual-subscription` | User verification and `user_profiles.is_platform_admin` | R01 then R10 |
| `paychangu-webhook` | HMAC of raw body; rejects missing webhook secret/signature; provider verification when configured | R10 full amount/currency/transaction contract; no provider call made |
| `send-invoice` | User verification; active membership of invoice's business; signed tracking token | R04 finer action authority; R14 mail operation |
| `invoice-open` | Public tracking-pixel handler; validates invoice HMAC token before event update | Deliberately not user-JWT gated; R14 privacy/replay behavior |
| `request-account-deletion`, `cancel-account-deletion` | User verification and caller-specific operations | R14 lifecycle/retention |
| `export-my-data` | User verification; own profile and owned-business export path | R04/R14 |
| `expire-subscriptions`, `send-renewal-reminders`, `generate-partner-invoices`, `generate-vat-returns`, `finalize-account-deletions` | Required configured `CRON_SECRET` and `x-cron-secret` equality before service-role job | R10/R14 execution, audit and recovery |
| `process-invoice-automation` | Required `INVOICE_CRON_SECRET` and header equality | R14 configuration/scheduling; R05 effects |

No service-role credential was printed. A service-role variable reference in all entrypoints means review must trace **which client actually performs each query**: some clients attach the user's Authorization header for `getUser`, while separate admin clients perform privileged operations. A JWT check does not automatically transfer user RLS to subsequent admin queries.

### 8.2 Public API and gateway

`api/index.ts:53–60` declares GET/POST invoices, GET/POST expenses, GET accounts, GET/POST journal entries. It also serves health/OpenAPI routes. Key-authenticated GETs filter by the key-bound business (`191–214,387`); journal creation calls `create_api_journal_entry`. Invoice/expense POST creation is explicitly disabled (`403–416`), despite route/schema advertising. No R00 attempt was made to enable it.

API key existence and business binding do not establish per-key scopes, current paid entitlement, branch restrictions or authorization of every financial field. `create-api-key` correctly restricts issuance to active owners/admins but does not establish the full R10/R12 contract.

The gateway has Helmet/security headers, body size limits, rate limiters and bounded upstream calls. It forwards credentials rather than verifying application identity. `/api/health` and the unconditionally registered `/api/test-error` are outside the `/api/v1` limiter chain (`server/src/index.ts:116–152`). The latter raises an error without an environment/auth guard in source. Enabled deployment, emitted error body and telemetry behavior are unknown.

The configured-target host check is a positive proxy control, but `new URL(rawPath, target)` uses an absolute `/api/v1/...` path, replacing the configured target path; the path allowlist does not permit `?` query strings (`169–182`). Compatibility with the intended `/functions/v1/api` upstream needs synthetic gateway tests. No routing correction was made. Package: R12/R13/R14.

### 8.3 RPC and privilege inventory

The local config exposes public-schema Data API functions subject to privileges. Source searches found **71 distinct function names in migration CREATE FUNCTION text**; this regex count is not a final deployed function/signature inventory. Literal browser RPC calls include `ai_context`, `post_pos_sale`, `create_business_with_owner`, document/payment/numbering helpers, partner/admin operations and inventory backfill. Dynamic RPC wrapper calls also exist, so a literal-call search is not exhaustive.

| Critical object | Latest relevant source evidence | Historical capture | Current deployed state |
|---|---|---|---|
| `is_platform_admin(uuid)` | `20260726000004_platform_admin_and_reminders.sql:18` | Definition present | UNKNOWN |
| `ai_context(uuid)` | `20260823000003_repair_ai_view_tenant_scope.sql:302` | Absent | UNKNOWN |
| `post_pos_sale(jsonb)` | `20260923000000_post_pos_sale_rpc.sql:561` | Absent | UNKNOWN |
| `_ledgr_post_entry` | `20260911000002_quick_save_rpc_source_id_uuid.sql:40` | Absent | UNKNOWN, including signature/ACL |
| `_ledgr_complete_pos_sale(uuid,uuid)` | `20260923000000_post_pos_sale_rpc.sql:276` | Absent | UNKNOWN |
| `apply_subscription_payment` | `20260726000002_subscription_payments.sql:89` | Definition present | UNKNOWN, including service-only grant |
| `enforce_plan_tier_change()` | Same migration, `165` | Function and business trigger present | UNKNOWN |
| Actual stock-balance updater | Source callsites assume balance maintenance; full effective trigger/function inventory required | No stock-balance trigger in the 11 captured user triggers | UNKNOWN — do not install a second updater based on absence from old capture |

Later R04/R05/R06/R15 must also inventory callable repair/backfill helpers. A repair page or RPC existing in source is not authorization to execute it. No financial SQL or RPC was run.

## 9. Deployment exposure findings

All rows carry **Runtime exposure not verified.** “Confirmed in source” refers only to the described declaration/control gap.

| ID | Finding and current evidence | Exposure classification | Owner / required evidence |
|---|---|---|---|
| E01 | Own-profile UPDATE predicate does not protect privileged columns; effective column privileges unknown | Configuration-dependent | R01; actual grants/guards and synthetic ordinary-user test |
| E02 | Existing global phone credentials can be reset before target-business membership authority is established | Potential exposure; gap confirmed in source | R02; deployment/identity map verification and synthetic cross-business recovery test |
| E03 | Invitation phone restriction trusts a profile fallback; legacy token is logged | Potential exposure; paths confirmed in source | R01/R02/R14; edit authority, identity provenance, sanitized logging |
| E04 | `ai_context` treats null UID as bypass; explicit PUBLIC execution revoke not found | Configuration-dependent | R03; effective PUBLIC/anon ACLs/defaults and null-UID roles |
| E05 | AI chat validates business membership but supplies broad financial aggregate without corresponding role/branch filtering | Potential exposure | R04/R11; restricted-role context tests |
| E06 | UI role/cost/report restrictions exceed member-wide SELECT policies; cross-tenant relationships need compound validation | Potential exposure | R04/R05; direct API/RPC role matrix and foreign-ID tests |
| E07 | POS has null branch/placeholder stock, ignored approval PIN and incomplete correction/stock completion semantics | Not reproducible from available environment; source defects persist | R06/R07/R08; isolated POS/stock/approval tests; do not touch accepted sales |
| E08 | Service-role operations depend on per-handler authority, not caller's UI or merely `getUser` | Potential exposure where authority checks are incomplete | R01–R04/R10–R12; endpoint-specific negative tests |
| E09 | API key business filtering exists; fine-grained scope/entitlement enforcement and trusted webhook event provenance incomplete | Potential exposure | R10/R12; disabled writes remain disabled pending design |
| E10 | Active members can request webhook events with supplied payload; public-destination HTTPS/DNS/redirect checks do exist | Potential exposure, not a claim of absent SSRF controls | R12; trusted event source and outbound safety tests |
| E11 | Logo upload policy permits any active business member; bucket limits unspecified; public/private deployed flags unknown | Configuration-dependent | R04/R14; storage role/path matrix |
| E12 | Cache cleanup does not establish clearing/partitioning all persistent layers; queue selects pending/failed items across queue | Potential exposure | R09; two-user offline/cache tests; preserve every unsynced record |
| E13 | Plan-tier guard is not an expiry-column guard; paid-access/quota correctness depends on broader contracts/jobs | Configuration-dependent | R10; effective privileges, concurrency, grace/payment cases |
| E14 | All Edge functions are declared no-gateway-JWT; custom checks vary by purpose | Configuration-dependent, not automatically vulnerable | Per-handler packages; verify deployed function settings and missing/malformed credentials |
| E15 | Gateway CORS reflects origins when `ALLOWED_ORIGIN` is empty; test-error route is unconditional | Configuration-dependent | R12/R14; determine whether gateway enabled and externally reachable |
| E16 | Shared Edge CORS fallback uses localhost string prefixes, not parsed-host equality | Configuration-dependent | R14 with R12/R11 consumers; malicious-prefix/allowed/absent origin tests |
| E17 | Auth redirect/MFA/password settings available only as local defaults; invitation origin accepted from request | Configuration-dependent | R02/R14; hosted Auth allowlist/assurance and link-origin review |
| E18 | Deploy pipeline has no explicit CI dependency; environment approval settings unverified | Configuration-dependent | R13/R14; hosted branch/environment/check settings |
| E19 | Browser AI endpoint, telemetry and operational URLs depend on build/runtime configuration; raw error strings appear in several handlers | Configuration-dependent | R11/R14; endpoint binding, emitted errors and telemetry redaction |
| E20 | Existing capture scripts redact after raw files are written; target checks and capture completeness insufficient for current attestation | Potential exposure during future capture; not executed | R00 follow-up/R13 tooling review; isolated sanitized fixture first |
| E21 | Backup script strips ownership/privileges, dumps public only and can continue after restore errors | Not reproducible from available environment; source gap confirmed | R14; full restore incl. Auth/Storage/ACL/invariants |
| E22 | Missing seed file, differing gateway startup paths, stale capture definitions and future-dated migrations can cause environment drift | Configuration-dependent | R00 verification; R13/R14 fixes only on separate approval |
| E23 | Retry job fallback can be empty string; invoice automation expects a separately configured secret | Configuration-dependent | R12/R14; no-secret/empty-header cases and scheduler configuration |

**Confirmed exposure category:** no current deployed exposure was confirmed by R00. Several unsafe source paths above are confirmed source facts; exploitability has not been tested.

**Not applicable in the inspected path:** unrestricted model-driven SQL tools were not found; active browser LLM adapters receiving real provider keys were not found; intentionally public logos are not confidential exports; local-only developer services do not establish production debug exposure. These exclusions are scoped observations, not whole-system security guarantees.

## 10. Configuration-dependent findings

### 10.1 CORS and origins

`supabase/functions/_shared/cors.ts` uses `ALLOWED_ORIGINS`, also permits configured app/project origins, and omits the allow-origin header for other origins. It adds `Vary: Origin`. With no explicit allowlist it permits strings starting with local-development prefixes (`96–99`), without an environment-mode guard or URL-host equality check. Thus similarly prefixed, non-local hostnames can satisfy that source predicate. No browser exploit was attempted.

The helper's omission of a CORS header is **not a server authorization rejection**. Non-browser requests can still invoke handlers; credentials and authority must be checked independently. Some responses use static rather than request-specific CORS construction, so exact frontend compatibility also needs runtime checks.

Gateway `ALLOWED_ORIGIN` is singular and distinct from Edge `ALLOWED_ORIGINS`. Empty gateway configuration reflects origins (`server/src/index.ts:90–94`). Do not confuse the two settings during later validation.

### 10.2 Debugging, errors, maps and headers

- Frontend logger defaults to warn+ in production, with `VITE_LOG_LEVEL` override (`src/lib/logger.ts:64–70`). It is not a universal payload-redaction guarantee.
- Several Edge catches return raw error messages, including `ai-chat/index.ts:538–541`; invitation fallback logs a token reference. Actual logs/error payloads were not retrieved.
- Frontend Sentry disables default PII and removes cookies/extra fields (`src/main.tsx:37–63`), but attaches a user UUID and can receive other event context. A UUID is a persistent identifier, not proof of anonymity. R14 must review actual telemetry/retention rather than trust the comment.
- Sentry build plugin is conditional on a server-side build token. There is no explicit `build.sourcemap` setting in `vite.config.ts`; no built bundle/map was inspected. **Public source-map availability is UNKNOWN**, not confirmed.
- Vercel declares CSP/HSTS/frame denial/nosniff and related headers. No deployed response verified them. CSP does not explicitly allow generic Sentry/external AI origins; integration compatibility is configuration-dependent, not a reason to weaken CSP here.
- Vite dev `allowedHosts: true`, enabled dev PWA and local inspectors must not be exposed as production hosting. No dev server was started.
- `server/package.json` preloads `dist/sentry.js` although corresponding source is absent; Docker directly runs `dist/index.js`. Which startup path is active is unknown.

### 10.3 Jobs and scheduling

Source schedule definitions are in `scripts/cron-jobs.sql`, migrations `20260726000003_schedule_expire_subscriptions.sql`, `20260726000005_schedule_send_renewal_reminders.sql`, `20260727000006_schedule_generate_partner_invoices.sql`, and `20260820000000_ops_hardening_runtime.sql`. These are executable operational definitions, not safe discovery commands.

The historical capture contains three active schedules: expiry at `0 1 * * *`, renewal reminders at `0 8 * * *`, partner invoices at `0 2 1 * *`. Raw commands/headers were deliberately not reproduced. This does not prove they are active now or establish current timezone/execution success.

Current job list, configured job secrets, invoice automation, retry/deletion/VAT schedules, duplicate schedules and run outcomes are unknown. The VAT handler requires `x-cron-secret` but its embedded scheduling example still shows a different authorization pattern; R14 must reconcile deployed schedules against handler contracts. No job was triggered.

### 10.4 Capture and backup tooling must not be mistaken for verification

The SQL capture file contains **25 SELECT/SHOW statements**; the inspected capture commands do not invoke migration push, restore or data-repair scripts. However:

1. Direct capture writes raw function/cron text before its later `.txt` redaction pass; API capture similarly writes raw `.json`/`.txt` first. Error logs are outside those redaction file selections. Interrupted capture or redaction failure can retain sensitive content.
2. The direct script checks whether the URL string contains the staging host; the API script checks a project substring in an overrideable endpoint. These are not strict parsed endpoint-identity checks.
3. The direct script still uses `pg_get_expr` on `pg_policies` text (`258–291`); the shared SQL file correctly selects text expressions (`163–197`). The two transports are not equivalent. No failing SQL was executed to reproduce this.
4. Function definitions lack captured `proacl`; relation `relacl` is not function ACL. Column ACLs, default privileges, effective privilege checks, migration history and job-run history are absent from this historical inventory.
5. Captures are independent queries, not demonstrated transactionally consistent snapshots; function ordering by name alone does not prove deterministic overload/signature reporting.
6. The GitHub capture workflow uploads and commits captures automatically, with a stale default ref unrelated to this session. It is not a non-writing local check. **It was not dispatched.**

`build-live-inventory.py` and `render-inventory-md.py` read local captures and write derived artifacts. They were inspected and syntax-checked in memory, **not executed**, to preserve prior work. No new capture was produced.

Backup verification (`scripts/verify-backup.sh:69–105`) dumps only public schema without owner/privileges and falls back to a restore whose errors can be ignored. Row-count checks cannot certify authorization, Auth/Storage recovery, financial/stock invariants or point-in-time consistency. The weekly workflow defaults to production and would read customer data: **it was not run**. Adequate recovery evidence is required before risky later migrations, not postponed until final R14 completion.

## 11. Confirmed versus unverified exposures

### 11.1 What is confirmed

Confirmed **source evidence** includes direct browser database access; membership-based controls; service-role Edge architecture; explicit service-only subscription activation grant; no-gateway-JWT deployment declarations; profile/phone/AI source gaps; client/backend role/branch mismatches; the unconditional gateway test route; incomplete capture/redaction/restore controls; and the inventory/configuration facts recorded above.

Confirmed **local check results** are syntax/configuration checks and the build-env guard outcomes in §14. None is a security exploit reproduction.

### 11.2 What is not verified

No running application, actual tenant boundary, profile privilege escalation, phone-account takeover, anonymous AI read, storage bypass, quota race, financial corruption or customer cache disclosure was reproduced. No current deployed header, redirect allowlist, function secret, grant, trigger or job status was observed. **Runtime exposure not verified.**

### 11.3 Historical evidence comparison

The 25 checked-in capture JSON files parse successfully. They contain 71 function records, 102 public policies, 216 relation-grant records, 11 user triggers, three cron records and zero storage bucket/policy records. Those counts describe old capture files, not the current environment.

The capture lacks AI/POS/quick-save functions added later and cannot settle the critical ACL questions. It also has no captured stock-balance trigger. It must not be used to justify a new stock updater or declare storage absent. `supabase/config.toml` comments attribute historical staging PG17.6 capture and separate replay evidence; R00 did not independently reproduce either.

This is **historical-to-repository divergence**, not confirmed live deployment drift. The deployed-state comparison is pending.

## 12. Security-sensitive findings requiring later remediation

| Package | Evidence/action handed off; no implementation performed |
|---|---|
| R01 | Protect privileged profile fields and membership transitions; verify effective grants and legitimate admin/partner workflows |
| R02 | Global identity recovery authority, trustworthy phone proof, invitation restrictions/origins and token logging |
| R03 | Explicit role-aware AI RPC execution/authorization, including null UID and PUBLIC/anon privileges |
| R04 | Authoritative tenant/role/branch/field/storage controls; preserve legitimate paths before cashier-write lockdown |
| R05 | Financial command invariants and tenant-qualified references; no historical correction in R00 |
| R06 | Effective stock updater and POS atomic completion; do not infer missing deployed triggers from old files |
| R07 | Server approval/refund/void authority and preservation of accepted records |
| R08 | Branch/terminal/shift provenance and scope |
| R09 | Account/device cache and queue isolation; active-version inventory; never delete pending device records |
| R10 | Protect commercial state, payment validation, quota concurrency, jobs and existing paid access |
| R11 | AI field/role/branch permission context, trusted endpoint binding, diagnostic/provider disclosure |
| R12 | Key scopes, API contracts, trusted webhook events, gateway behavior and retry-job guard |
| R13 | Isolated actual-role test harness; seed/startup configuration; CI/deploy gate; capture fixture/redaction testing |
| R14 | Recovery prerequisites, schedules, job secrets, debug/error/telemetry controls, origins and operational verification |
| R15 | Read-only historical reconciliation under separate approval; repairs require quantified approved manifests |

Assignments identify review owners, not automatic scope expansion. A new configuration/code fix must be matched against its package register and approved if it falls outside that scope. No design-pending table or function is approved by this report.

## 13. Evidence/source locations

The earlier three planning documents remain unchanged. SHA-256 baselines:

| Document | SHA-256 |
|---|---|
| `LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` | `8ff05e30ed66a580b8766234818b8ffb573bfa5aa818e72eb6a9ade3655c69e6` |
| `LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md` | `2216425f9970c6c3f9b59c19d0c8ee8c07a630e9dfbfd0a426475f99a053d27d` |
| `LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md` | `2080d48b236e88d401a3af84a97b009464dfb759c4a8a56104eafc0976d2a65e` |

Additional evidence map, all relative to repository root:

- Deployment: `.github/workflows/{ci,deploy,capture-staging-schema,backup-verify}.yml`; `scripts/ci/supabase-link-and-push.sh`; `Dockerfile`; `docker-compose.yml`; `railway.json`; `render.yaml`; `vercel.json`.
- Configuration/build: `package.json`; `server/package.json`; `supabase/config.toml`; `vite.config.ts`; `scripts/check-env.mjs`; `.env.example`; `server/.env.example` (variable/reference inventory; values not reproduced).
- Auth/permissions: `src/lib/supabase.ts`; `src/hooks/useAuthListener.ts`; `src/routes/ProtectedRoute.tsx`; `src/hooks/usePermissions.ts`; `src/hooks/usePosPermissions.ts`; `src/App.tsx`; `src/pages/LoginPage.tsx`; `src/pages/ForgotPasswordPage.tsx`; `src/routes/PlanGuard.tsx`; `src/components/billing/PlanGate.tsx`.
- Tenant/RLS: `supabase/migrations/20260728000008_role_aware_master_data_rls.sql`; `20260815000003_phase8b_rls_policies.sql`; `20260922000000_pos_role_write_scope.sql` in the same directory; `src/dal/repositories/{BaseRepository,BusinessRepository}.ts`.
- Identity: `supabase/functions/{invite-team-member,accept-invite-link,create-invite-link,list-team-members}/index.ts`; `supabase/functions/_shared/phone.ts`; phone-account migrations dated 2026-09-24/25.
- AI: `src/lib/ai/{context,provider,forecast,advisor}.ts`; `src/lib/supportAgent.ts`; the three AI Edge handlers in §6; `supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql`.
- Storage: `supabase/migrations/20260815000004_phase8b_storage.sql`; `src/pages/SettingsPage.tsx`; `supabase/functions/export-my-data/index.ts`.
- API/origins: `supabase/functions/{api,create-api-key,webhook-dispatcher,retry-failed-webhooks}/index.ts`; `supabase/functions/_shared/cors.ts`; `server/src/index.ts`; `public/openapi.json`.
- Client persistence: `src/offline/db.ts` (version 1 queue); `src/offline/syncEngine.ts:398–404`; `src/lib/queryPersister.ts` (version 1 cache); `src/hooks/useAuthListener.ts:35–56`; `vite.config.ts:91–129`.
- Recovery/capture: `scripts/database/{capture-staging-schema.sh,capture-staging-schema-via-api.sh,capture-staging-schema.sql,build-live-inventory.py,render-inventory-md.py}`; `scripts/verify-backup.sh`; `artifacts/database/capture/`.

Line references refer to the source commit above. This evidence map is not a claim that every listed path has a complete runtime regression suite.

## 14. Recommended verification tests and checks actually run

### 14.1 Executed checks — safe local/static only

Working directory for all commands: `/home/user/Ledgr-react`.

Repository identification commands executed: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git diff --stat`. Initial tracked/index diffs were empty; only the three planning documents were untracked. Final checks verify only this report was added and the original hashes were preserved.

Exact syntax-check commands executed:

```bash
for f in scripts/database/capture-staging-schema.sh scripts/database/capture-staging-schema-via-api.sh scripts/ci/supabase-link-and-push.sh scripts/verify-backup.sh; do
  bash -n "$f"
done
node --check scripts/check-env.mjs
```

**Result:** all four Bash syntax checks and the Node syntax check exited successfully. `bash -n` does not run the scripts. Syntax success does not validate their SQL, redaction, safety or runtime behavior.

The following is the exact substantive Python check body executed through `python - <<'PY' ... PY` (no dependency installation):

```python
from pathlib import Path
import json,tomllib,re,hashlib,subprocess,os
files=[Path(f) for f in ['package.json','package-lock.json','server/package.json','server/package-lock.json','vercel.json','railway.json','public/openapi.json']]+sorted(Path('artifacts/database/capture').glob('*.json'))
for p in files:json.loads(p.read_text())
print('PASS JSON syntax:',len(files),'files (7 configs/manifests plus 25 historical captures)')
cfg=tomllib.loads(Path('supabase/config.toml').read_text())
assert cfg['db']['major_version']==17 and cfg['api']['schemas']==['public','graphql_public']
print('PASS TOML syntax and declared PG/API schema assertions (not live validation)')
for f in ['scripts/database/build-live-inventory.py','scripts/database/render-inventory-md.py']:
 compile(Path(f).read_text(),f,'exec')
print('PASS Python syntax: 2 inventory scripts compiled in memory, not executed')
sql=Path('scripts/database/capture-staging-schema.sql').read_text()
clean=re.sub(r'^\s*(?:--|\\).*$', '',sql,flags=re.M)
statements=[s.strip() for s in clean.split(';') if s.strip()]
assert all(re.match(r'^(select|show)\b',s,re.I) for s in statements)
assert not re.search(r'\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|call|do)\b',clean,re.I)
for f in ['scripts/database/capture-staging-schema.sh','scripts/database/capture-staging-schema-via-api.sh']:
 assert not re.search(r'(?m)^\s*(?:supabase\s+db\s+(?:push|reset)|pg_restore|psql.*\s-f\s+.*(?:repair|backfill))',Path(f).read_text())
print('PASS static capture SQL:',len(statements),'SELECT/SHOW statements; no matched DDL/DML. No DB execution or end-to-end capture certification.')
assert len(list(Path('supabase/migrations').glob('*.sql')))==85
assert len(list(Path('supabase/functions').glob('*/index.ts')))==26
print('PASS inventory counts: 85 migrations; 26 Edge entrypoints')
print('OBSERVATION: seed file exists:',Path('supabase/seed.sql').exists(),'; server Sentry preload source exists:',Path('server/src/sentry.ts').exists())
base={'PATH':os.environ['PATH']}
cases=[('missing variables',{},1),('synthetic populated variables',{'VITE_SUPABASE_URL':'https://example.invalid','VITE_SUPABASE_ANON_KEY':'synthetic-public-placeholder'},0),('preview placeholders',{'VERCEL':'1','VERCEL_ENV':'preview'},0),('explicit bypass',{'SKIP_ENV_CHECK':'1'},0)]
for name,extra,expected in cases:
 r=subprocess.run(['node','scripts/check-env.mjs'],env=base|extra,capture_output=True,text=True)
 assert r.returncode==expected,(name,r.returncode)
 print('PASS local env-guard case:',name,'expected/actual exit',expected,r.returncode)
print('No build, application test, network request, migration, capture, restore or customer-data access performed.')
```

Results:

| Check | Observed result |
|---|---|
| JSON syntax | 32 files parsed successfully |
| TOML syntax/local configuration assertions | Passed |
| Python script syntax | Two scripts compile in memory; not executed |
| Capture SQL static scan | 25 SELECT/SHOW statements; no matched DDL/DML; no SQL run |
| Inventory assertions | 85 SQL migrations; 26 Edge entrypoints |
| File-existence observations | Seed and gateway preload source both absent |
| Local env guard: missing vars | Expected and actual exit 1 |
| Local env guard: synthetic populated vars | Expected and actual exit 0 |
| Local env guard: preview placeholders | Expected and actual exit 0 |
| Local env guard: explicit bypass | Expected and actual exit 0 |

Final document checks passed: all 15 numbered sections, 23 finding rows and 17 recommended verification rows are present; 51 explicit source-path references resolve except the seed file deliberately documented as absent. The initial path validator rejected that known absent seed; its expected-absence rule was corrected and the check rerun successfully. This was a documentation-validator assertion, not an application test failure. Original planning-document SHA-256 hashes, branch/HEAD, empty tracked/staged diffs and the exact four-file untracked set were verified. `git diff --check` exited 0 for tracked changes (the new untracked report was checked separately). The documented Python check body compiles, and the report's credential-pattern check returned no matches; this remains heuristic, not secret certification.

Additional read-only `rg`/Python inspections enumerated frontend/Edge/API/RPC paths, env **names**, historical record keys/counts and critical object definitions. The location-only secret scan used regex heuristics for JWTs, common provider/API key forms, private-key headers and credential-bearing database URLs; candidate values were not emitted. Its scope excludes Git history, external dashboards, running process environments and generated bundles. These discovery searches are not penetration tests or comprehensive secret certification.

**Not run:** `npm ci`, typecheck, ESLint, Vitest, frontend/server builds, database tests, migration reset/push, metadata capture, restore tests, browser/PWA tests or production/staging tests. Dependencies and database tooling were not provisioned. YAML was manually inspected, not schema-validated; PyYAML was unavailable and not installed. SQL was text-inspected, not parsed/executed by PostgreSQL.

### 14.2 Required before future remote capture

1. Obtain a named environment owner and explicit authorization for that environment and metadata-only scope. Production remains separately gated.
2. Approve a safe capture method: strict target binding, least-privilege/read-only session, bounded query/lock timeouts and consistency expectations. Do not use deployment/backup/repair commands as discovery.
3. First validate with synthetic isolated metadata containing fake embedded secrets, cron headers, overloads and denied objects. Verify redaction **before persistence**, error paths, deterministic signature/ACL reporting and no accidental writes. Register-required before/after capture fixture tests remain **NOT RUN**.
4. Capture only necessary sanitized metadata; no customer payloads, raw cron credentials, credentials in function bodies or Auth-user exports. Do not automatically commit raw artifacts.
5. Manually cross-check effective privileges under real roles against the capture. A generic grant-all fixture is insufficient.

### 14.3 Verification matrix — recommended, NOT executed

| ID | Verification | Safe target / acceptance evidence | Package |
|---|---|---|---|
| V01 | Target identity, deployed commit, PG version, migration IDs/checksums | Authorized metadata; distinct staging/production, exact version/signature inventory | R00 |
| V02 | Table/column/function/default ACLs, role inheritance, owners, RLS/FORCE RLS, policy combinations and function search paths | Authorized metadata, then isolated actual-role fixture; include `pg_proc.proacl`, `pg_default_acl`, column grants and effective privilege checks | R00/R01/R03/R04/R13 |
| V03 | Own-profile harmless update vs privileged flag; admin/membership transition matrix | Synthetic users/businesses only; allowed benign update and denied escalation without breaking legitimate administration | R01 |
| V04 | Global phone account used by two businesses; inviter from unrelated business; profile-phone restriction | Synthetic identities; recovery must not cross identity authority; no credential disclosed | R02 |
| V05 | AI direct RPC/view and Edge access: anon/null UID, unrelated tenant, restricted role/branch and service role | Synthetic financial/customer/report fields; expected denials plus legitimate authorized output | R03/R11 |
| V06 | Cross-tenant parent/child IDs, branch restrictions, direct Data API bypass of UI | Synthetic finance/stock records with quantified before/after invariants | R04–R08 |
| V07 | Storage public/private flags, other-tenant paths, member/admin writes, export signing/expiry | Metadata first; synthetic objects in isolated buckets only | R04/R14 |
| V08 | All 26 handlers: missing/malformed/expired auth; role/tenant mismatch; key/HMAC/job-secret cases | Local/test provider adapters; no production endpoints or provider spending | Owning package/R13 |
| V09 | Empty/absent origins, disallowed origins, localhost-prefix lookalikes, legitimate app origins, preflight | Local handler/gateway tests; verify auth separately from CORS | R11/R12/R14 |
| V10 | Hosted site/redirect allowlists, MFA assurance, password/email settings; callback paths | Authorized settings metadata; synthetic Auth flow in staging/test after separate approval | R02/R14 |
| V11 | Public-key role correctness, bundle contents/maps, CSP, dev/test route deployment, telemetry redaction | Synthetic build + approved staging response checks; no secret values retained | R13/R14 |
| V12 | API revocation/scope/entitlement and signed webhook event provenance | Synthetic keys/destinations/provider responses; disabled writes remain denied | R10/R12 |
| V13 | Queue owner/scope, reload/reopen, multiple offline transactions then reconnect, exactly-once posting | Synthetic devices/data; preserve IDs, metadata, all unsynced items; never clear customer queues | R09 |
| V14 | Subscription active/expired/cancelled/failed/grace/upgrade/downgrade/quota/reset; payment amount/currency | Isolated synthetic provider responses and concurrent requests; preserve paid access | R10 |
| V15 | Schedules, target identity, secret contracts, job history and duplicate prevention | Authorized sanitized cron/job metadata; effects tested only in isolated fixtures | R14 |
| V16 | Backup/restore of financial/stock totals, relationships, Auth, Storage and ACLs; recovery time/point | Synthetic isolated restore first, separately approved operational evidence later; zero ignored restore errors | R14 |
| V17 | CI required checks, environment protection, release approval, active PWA versions/queue compatibility | Authorized settings and sanitized version/queue metadata, not customer transaction payloads | R00/R13/R14 |

The source-to-live catalog comparison must cover `pg_policies`, `pg_proc`, `pg_trigger`, `pg_class`, `pg_default_acl`, `pg_constraint`, indexes, table/column grants, migration history, cron jobs/run history and storage metadata. Record “unavailable” rather than infer a missing object when the inspection role cannot see it.

## 15. R00 conclusion

The repository's deployment and security architecture is now documented with source evidence, environment-dependent risks, a classified exposure inventory and a verification backlog. Existing safeguards and unsafe patterns are both recorded; neither source comments nor old captures have been promoted into current production facts.

**Authorized documentation/static work: complete. Package status: Requires Review.** The R00 deployed-state release evidence gate remains open because no environment was accessed and the register's isolated capture/determinism/actual-ACL verification has not been run. This is not a paid-pilot or production-readiness approval.

- **Application/configuration changes:** none.
- **Database/IndexedDB changes:** none. **Migration result: not applicable; no migration created or executed.**
- **Customer-data impact:** none; no customer transactions, users, organizations, stock, subscriptions or device records were accessed or modified.
- **Security impact:** improved documented baseline only; all existing application risks remain until their separately approved packages are verified.
- **Rollback:** no application/database rollback required. If this report is rejected, remove only this newly created report; preserve the original three planning documents and all source/capture files. If a sensitive artifact is discovered later, restrict it under the incident/retention process rather than indiscriminately deleting user work.
- **Unexpected findings:** capture transports differ; raw-before-redaction writes and incomplete ACL evidence; unconditional gateway test route; configuration-dependent CORS fallback and job-secret behavior; local Auth settings do not match evidence needed for hosted attestation. No fix was folded into R00.
- **Remaining risks:** effective deployed grants/guards, global recovery scope, AI null-UID/role exposure, branch/role enforcement, persistent caches/queues, service-role paths, job configuration, CI approvals, active client compatibility and genuine full recovery remain unverified.
- **Next package in the reviewed dependency order:** **R13 — Reproducible release test harness**, after this report is reviewed and that package is explicitly authorized. Carry R00's unresolved deployed-state items forward as gates; starting a local harness must not imply those gates passed. Recovery evidence is required before risky migrations.

**STOP: R01–R15 have not been implemented. Await review; no automatic continuation.**
