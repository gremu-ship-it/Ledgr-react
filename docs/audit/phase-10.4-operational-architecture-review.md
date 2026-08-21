# Phase 10.4 — Operational & Architecture Review (111 topics)

**Date:** 2026-08-20 · **Subject:** Ledgr (React + Vite + Supabase + Vercel + Railway gateway + edge functions)
**Method:** static verification against `main` (`710c27b`), production deploy history (verified this session), captured staging-schema artifacts, and DEPLOYMENT.md. Items marked ⛔ N/A are not applicable to this architecture; ❌ = absent; 🟡 = partial; ✅ = implemented.

---

## 0. Executive summary

Ledgr runs on **managed platforms** (Vercel for the frontend, Supabase for Postgres/edge functions/auth/storage, Railway for a small Express gateway, GitHub Actions for CI/CD). That means many classic infra concerns (load balancing, TLS, DDoS, replicas, autoscaling) are **inherited from the platform** rather than self-operated — which is sound for a team of this size, provided the platform defaults are documented and the gaps that matter are closed.

**Strengths verified in code:** rate limiting (3 layers: edge-API sliding window, Express gateway per-IP, webhook dispatcher), webhook delivery with HMAC signing + 3 attempts + exponential backoff + SSRF protection (DNS-resolved private-IP blocking), offline sync with idempotency (`client_key`), atomic document-number reservation, schema-aware migrations (66), automated weekly backup-restore verification, Sentry (frontend + edge + gateway) with tracing, CSP/HSTS/security headers, RLS-based IAM, and the pagination fix this session (PostgREST 1000-row truncation).

**Key gaps (highest-value first):**
1. **No circuit breakers / bulkheads** anywhere (webhook dispatcher, gateway, AI, sync) — a slow downstream can pile up.
2. **No SLOs/SLIs/error budgets, no on-call, no alert routing** — observability is collect-only (Sentry + platform logs); nothing pages a human.
3. **`nextEntryNumber` uses the client/edge **local clock** — duplicate `JNL-` numbers across devices/regions under clock skew (document numbers are DB-atomic and safe; journal entry numbers are not).
4. **No optimistic locking / version columns** — last-write-wins on concurrent edits of the same record (payments/invoices are protected by atomic RPCs; general record edits are not).
5. **`package.json` version is `0.0.0`** — no semantic versioning discipline; release identity relies on git SHAs/Vercel.
6. **No Dependabot / dependency scanning** in the repo (npm audit only locally, if at all).
7. **Supabase read replicas, PITR, Vercel WAF, SSO** — available on the platform but **unverified enabled** (dashboard-only).
8. **No dead-letter queue** for webhooks (3 failed attempts are recorded but never retried later or alerted).
9. **No feature-flag system** (one code comment references the idea).
10. **Chaos engineering / multi-region / sharding / K8s / service discovery / gRPC / message queues** — absent, and **correctly so** at this scale (see N/A table).

---

## 1. Traffic & edge

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Rate limiting | ✅ | 3 layers: `supabase/functions/api` sliding-window per-bucket (`consume_api_rate_limit`, 100 auth / 10 anon per min, fail-closed 429); Express gateway `express-rate-limit` (100/10 per IP, Redis-backed per deps); webhook dispatcher per-webhook | Add per-user quotas for AI Insights if usage grows; document limits in API docs |
| Caching | 🟡 | PWA workbox runtime caching (GET `/rest/v1/` NetworkFirst 4s, images/fonts CacheFirst); Vercel edge CDN; no server-side query cache (react-query default staleTime 0) | Set react-query `staleTime` for slow aggregate queries (SOFP/TB) |
| Load balancing | ✅ | Platform-managed: Vercel edge network + Supabase pooler (multiple connections per instance) | — |
| Reverse proxy | ✅ | Platform-managed (Vercel edge; Railway proxy — gateway sets `trust proxy`) | — |
| API gateway | ✅ | Supabase gateway (PostgREST + Auth + storage) + `functions/v1/api` (public API, zod-validated, rate-limited, Sentry) + Express gateway (partner-facing) | Keep public API surface small; consider versioning (below) |
| CDN | ✅ | Vercel global edge network; static assets immutable-cached (`vercel.json` `Cache-Control: immutable` for `/assets/*`) | — |
| Edge caching | ✅ | Vercel + service-worker runtime caching | — |
| Cache invalidation | 🟡 | SW `cleanupOutdatedCaches` + `autoUpdate`; Vercel immutable hashed assets; **manual hard-refresh was needed after deploys** (observed this session) | Add a visible "new version available" prompt (SW update → toast + reload) |
| WAF | ❓ | Vercel WAF available; **not verifiable** from here | Check Vercel → Security → WAF is on; enable managed rules |
| DDoS protection | ✅ | Platform-managed (Vercel + Supabase edge) | — |
| CORS | ✅ | `ALLOWED_ORIGINS` allowlist in edge functions (trailing-slash tolerant after #110); gateway `cors` package; `vercel.json` CSP | — |
| DNS | ✅ | Platform-managed (Vercel nameservers) | — |
| HTTP/2 & HTTP/3 | ✅ | Platform-managed (Vercel serves h2/h3) | — |
| TCP vs UDP | ⛔ N/A | HTTP(S)-only stack | — |

## 2. Deployment & delivery

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| CI/CD | ✅ | `ci.yml` (typecheck/lint/test/build on PR+main) + `deploy.yml` (staging on main push; production on `v*` tag or dispatch, env-gated) | Solid; keep prod gated |
| Docker | ✅ | `server/` containerised for Railway; backup-verify uses throwaway Postgres container | — |
| Kubernetes | ⛔ N/A | Managed platforms only | Revisit only at >10x scale |
| Service discovery | ⛔ N/A | Railway/Vercel resolve internally | — |
| Blue-green | ✅ | Staging/prod are separate Vercel+Supabase projects; Vercel instant promotion | — |
| Canary | ❌ | No traffic-split deployment | Add Vercel "preview → promote" for risky frontends if desired |
| Rolling deployments | ✅ | Vercel/Supabase managed | — |
| Rollbacks | ✅ | Vercel instant rollback; `git revert` + redeploy; DB migrations are forward-only (documented) | Test one rollback run per quarter |
| Feature flags | ❌ | Only a code comment (`supportAgent.ts`) | Adopt a lightweight flag (env-based) before next risky rollout |
| Build caching | ✅ | `actions/setup-node` cache npm; Vercel build cache | — |
| IaC | 🟡 | Supabase migrations + GitHub Actions are declarative; **no Terraform** | Acceptable; add Terraform only if provisioning grows |
| Terraform | ❌ | Not used | N/A at this scale |
| Helm | ⛔ N/A | No K8s | — |
| Dependency hell | 🟡 | Lockfiles present (`package-lock.json`); **no Dependabot** | Enable Dependabot (npm) + `npm audit` in CI |
| Semantic versioning | ❌ | `package.json` `"version": "0.0.0"`; tag `v1.0.0` exists but is manual | Set real versions (e.g. `1.0.0`) and stamp `VITE_APP_VERSION` (already wired) |
| API versioning | 🟡 | `api/v1` path exists in the public API | Keep `/v1`; add deprecation headers when v2 comes |

## 3. Reliability patterns

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Circuit breakers | ❌ | None found | Add a small breaker (e.g. `cockatiel`) around webhook delivery, AI calls, gateway upstreams |
| Timeouts | 🟡 | Webhook delivery `AbortSignal.timeout(10_000)`; **no Supabase client timeout**, no gateway upstream timeout | Set `supabase-js` global fetch timeout; gateway `timeout` middleware |
| Retries | ✅ | Offline sync `retryNonCritical` (2 attempts, backoff ×2); webhook 3 attempts; react-query defaults | — |
| Exponential backoff | ✅ | Webhook: `2^(attempt-1) * 1000` (1s, 2s); sync backoffMultiplier 2 | — |
| Idempotency | ✅ | `client_key` unique index (invoices/expenses/payments) + `findByClientKey`; webhook duplicate-delivery guard; DB-tested this session | — |
| Health checks | ✅ | Gateway `GET /api/health` (not rate-limited); Railway uptime | Add a canary check for the frontend (fetch login page, assert non-blank) |
| Liveness/readiness | 🟡 | N/A for serverless; gateway health only | If gateway grows, add `/ready` (DB/Redis ping) |
| Autoscaling | ✅ | Vercel/Supabase managed (hobby plan: constrained) | Revisit plan at scale |
| Horizontal scaling | ✅ | Platform-managed (stateless frontend/edge) | — |
| Vertical scaling | ✅ | Platform-managed | — |
| Disaster recovery | 🟡 | Weekly automated backup-restore verify (`backup-verify.yml`); **no documented RTO/RPO, no cross-region** | Define RTO/RPO (e.g. RPO ≤ 24h w/ daily backups); consider PITR |
| Backups | ✅ | Supabase backups + weekly restore verification (row-count compare) — pending A-12 evidence run | Confirm PITR enabled (dashboard) |
| Failover | ✅ | Platform-managed (Vercel edge, Supabase multi-AZ) | — |
| Multi-region | ❌ | Single region (Vercel iad1 default; Supabase eu-west-1) | Fine for MW market; revisit if latency matters |
| Chaos engineering | ❌ | None | Not warranted now; the offline layer is a partial mitigation |

## 4. Async & messaging

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Message queues | ❌ | None (no SQS/RabbitMQ) | Use Supabase pg_cron + tables as a poor-man's queue only while volume is low |
| Pub/Sub | ❌ | Supabase Realtime unused (only auth listeners) | Could use Realtime for live dashboards later |
| Event-driven | ✅ | DB triggers + `invoice.created`/`invoice.paid` webhooks; edge functions on events | — |
| Distributed transactions | ⛔ N/A | Single Postgres → ACID transactions suffice | — |
| Saga pattern | ⛔ N/A | No multi-service write flows | — |
| Dead letter queues | 🟡 | Webhook deliveries recorded with `attempt`+`status_code` (acts as an implicit DLQ — queryable) but **no alert/retry-after-failure** | Add a scheduled edge function that re-delivers or alerts on `attempt=3 & delivered_at is null` |
| Cron jobs | ✅ | pg_cron ×3 (expire-subscriptions 01:00, renewal reminders 08:00, partner invoices 1st 02:00) + scheduled edge functions (invoice automation daily) | — |
| WebSockets | ❌ | Not used | N/A now |
| Long polling | ⛔ N/A | Not used | — |
| Server-Sent Events | ⛔ N/A | Not used | — |
| Webhooks | ✅ | Inbound (paychangu, invoice tracking — signed secrets, `--no-verify-jwt` guarded) + outbound dispatcher (HMAC `X-Ledgr-Signature`, 3 attempts, backoff, SSRF-blocked) | Document webhook retry semantics for consumers |

## 5. Database

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Indexing | ✅ | 33 index statements across migrations (incl. `client_key` unique, FK indexes, `reserve_next_document_number` support) | Re-check with `pg_stat_user_indexes` on prod |
| Query optimization | 🟡 | Views (`v_trial_balance`, `v_ar_ageing`…); recent pagination fix (#114–#116) | Profile the SOFP/P&L queries on prod data (EXPLAIN) |
| N+1 queries | 🟡 | `findByIdWithLines` (2 queries, fine); report joins embedded; no obvious hot N+1 | Spot-check with Sentry spans |
| Connection pooling | ✅ | Supabase pooler (used by owner's `gen types` via pooler); `supabase-js` HTTP keep-alive; gateway uses its own client | — |
| Read replicas | ❓ | Supabase offers them; **unverified enabled** | Not needed at this scale; skip |
| Sharding | ⛔ N/A | Single Postgres; tenant-scoped via RLS | — |
| Partitioning | ⛔ N/A | `journal_lines` may need time-range partitioning at very high volume only | Revisit if >10M rows |
| Replication | ✅ | Platform-managed (Postgres streaming, multi-AZ) | — |
| Leader election | ⛔ N/A | Single primary | — |
| CAP theorem | ✅ | Single-node Postgres = CP (strong consistency); offline layer adds client-side AP | Document the trade-off for offline mode |
| Eventual consistency | 🟡 | Offline sync is eventually consistent by design; server is strong | Document offline sync semantics (already in code comments) |
| Optimistic locking | ❌ | No version columns; concurrent edits last-write-wins | Add `updated_at` compare-and-set for invoice/expense forms |
| Pessimistic locking | ✅ | Atomic RPCs (`increment_amount_paid` WHERE-guarded, `reserve_next_document_number`) serialize on row locks | — |
| Distributed locks | ⛔ N/A | Single DB; advisory locks would work if ever needed | — |
| Race conditions | ✅ | Document-number reservation concurrency-tested (25 sequential + 10 parallel unique); amount_paid atomic | — |
| Deadlocks | ✅ | None observed; RPCs are short and single-statement | — |
| Database migrations | ✅ | 66 ordered, idempotent migrations; `supabase db push --include-all`; schema-aware (amount_due GENERATED fix #112) | — |
| Schema versioning | ✅ | `supabase/migrations/` timestamped; captured schema diff tooling | — |

## 6. Performance

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Memory leaks | 🟡 | Not verifiable statically; PWA + listeners cleaned up in code (SessionManager etc.) | Use Safari/Chrome memory timeline on staging |
| Garbage collection | ⛔ N/A | Managed runtimes (JS/Deno) | — |
| Thread safety | ⛔ N/A | Single-threaded JS; Deno workers not used | — |
| Backpressure | 🟡 | Offline queue caps? Not explicit; webhook 3-attempt bounded | Add a queue-size cap for offline sync |
| Cold starts | 🟡 | Vercel/Supabase edge functions (Deno) — low; gateway on Railway always-on | Keep gateway warm or move to Vercel functions if cold starts bite |
| Serverless limits | ✅ | Hobby plan limits known (Vercel/Supabase dashboards) | Know the ceilings before launch marketing |
| Latency | 🟡 | No synthetic monitoring | Add a cron ping (e.g. UptimeRobot) on `/api/health` + login page |
| Throughput | 🟡 | Not load-tested | One k6/Artillery pass against staging before any public launch |
| P99 latency | ❌ | Not measured | Sentry traces give this — add a dashboard |
| Tail latency | ❌ | Not measured | See above |

## 7. Security

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Secrets management | ✅ | GitHub secrets/env-protection, Vercel envs, Supabase edge-function secrets (CLI), signing secrets never returned to browser; **token rotation incident handled this session** | Add secret rotation calendar |
| IAM | ✅ | Supabase RLS (41-test suite), role expansion (owner/admin/accountant/viewer), platform-admin routes gated; env protection rules on Production | — |
| OAuth | 🟡 | Supabase Auth (email/password + MFA); OAuth providers not evidenced | Add Google OAuth if signup friction matters |
| JWT rotation | ✅ | Supabase-managed JWT expiry/refresh; anon key rotated in incident | — |
| TLS | ✅ | Vercel-managed; HSTS preload header in `vercel.json` | — |
| Encryption at rest | ✅ | Platform-managed (Supabase, Vercel) | — |
| Encryption in transit | ✅ | HTTPS everywhere; edge functions require https webhook URLs | — |
| WAF | ❓ | Vercel WAF available; unverified | Verify enabled (see above) |
| DDoS protection | ✅ | Platform-managed | — |
| CORS | ✅ | Allowlist + CSP (see §1) | — |
| CSRF | ✅ | Token-in-header auth (Supabase localStorage JWT), no cookies → CSRF not applicable; CSP `frame-ancestors 'none'`, `X-Frame-Options DENY` | — |
| SQL injection | ✅ | PostgREST parameterised; RPCs validate table names (`increment_amount_paid` whitelist); no raw SQL in app | — |
| XSS | ✅ | React escaping + strict CSP (`script-src 'self' 'wasm-unsafe-eval'`) | Keep CSP tight; watch for inline handlers |
| SSRF | ✅ | Webhook dispatcher: https-only, DNS-resolved private-IP blocking (IPv4+IPv6) — verified in code | — |

## 8. Observability & ops

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Monitoring | 🟡 | Sentry (frontend `tracesSampleRate 0.1`, edge, gateway) + Vercel Analytics/Speed Insights (enabled per project JSON) + Supabase logs | Add uptime monitoring (Sentry Cron / UptimeRobot) |
| Logging | ✅ | `createLogger` structured logger (Sentry capture, env-aware), edge function console, gateway logging | Ensure log retention policy set |
| Distributed tracing | 🟡 | Sentry tracing across frontend + edge + gateway (0.1 sample) | Raise sample to 0.2–0.5 for key routes |
| Metrics | 🟡 | Vercel Web Analytics + Speed Insights (observed in project JSON) | Add Sentry dashboards for P95/P99 |
| Alerting | 🟡 | Sentry alerts exist (A-08 says rules unconfigured); Supabase function alerts available | **Configure Sentry alert rules + a Slack/email channel** |
| SLOs | ❌ | None defined | Define 3 SLOs (uptime ≥ 99.5%, login success, API error budget) |
| SLIs | ❌ | None formalised | Derive from Sentry/Vercel (availability, error rate, latency) |
| Error budgets | ❌ | None | Compute from SLOs once SLIs exist |
| Observability | 🟡 | Good collection; weak correlation (no single trace across webhook retries) | Sentry already spans — add webhook `delivery_id` to logs |
| Production incidents | ✅ | This session: P0 blank page (A-01), staging deploy (A-06), amount_due 428C9, pagination truncation — all documented in `docs/audit/` | — |
| On-call | ❌ | None | Define a simple rotation (even "owner gets paged") once alerting exists |
| Postmortems | ✅ | `docs/audit/phase-10-remediation-report.md` §11–13 + phase reports are de-facto postmortems (root cause, fix, verification) | Add a 5-whys template to speed them up |

## 9. Other

| Topic | Status | Evidence | Recommendation |
|---|---|---|---|
| Network partitions | 🟡 | Offline-first layer (Dexie + queue + sync) mitigates; server CP | Document offline guarantees |
| Clock skew | 🟡 | **`nextEntryNumber` uses local clock** (`JNL-YYYYMMDDHHMMSS`) — collision risk across devices/regions; document numbers are DB-atomic (safe) | Use a DB sequence/timestamp for `JNL-` too |
| gRPC | ⛔ N/A | REST only | — |
| Cost optimization | 🟡 | Hobby plans; Vercel/Supabase managed; no spend analysis | Review plan tiers quarterly; Supabase cold storage for exports |
| Cold starts | 🟡 | See §6 | — |

---

## 10. Top recommendations (priority order)

**P0 (do first — correctness/security):**
1. **Fix `nextEntryNumber` clock dependency** — journal entry numbers can collide under clock skew; make it DB-backed (sequence or `reserve_next_document_number`-style).
2. **Enable Dependabot + `npm audit` in CI** — no dependency scanning today.
3. **Configure Sentry alert rules + on-call contact** (A-08) — alerts currently collect but don't page anyone.

**P1 (reliability):**
4. **Add circuit breakers + timeouts** around webhook dispatch, AI, and gateway upstreams (small lib: `cockatiel`); set a Supabase client fetch timeout.
5. **Webhook dead-letter handling** — a scheduled function that re-delivers or alerts on `attempt = 3` undelivered webhooks.
6. **Define SLOs/SLIs/error budgets** (3 simple ones) and a monthly review.
7. **Optimistic locking** (`updated_at` compare-and-set) on the invoice/expense edit forms.

**P2 (quality of life):**
8. **Semantic versioning** — real `package.json` version, auto-bumped on tag; keep `VITE_APP_VERSION` stamping.
9. **Version-update prompt** in the PWA (toast on new service worker).
10. **Feature flags** (env-based) before the next big rollout.
11. **Synthetic uptime check** on `/api/health` + login page.
12. **Quarterly load test** against staging (k6) to measure throughput/P99.

## 11. Not verifiable from the sandbox (dashboard checks — 10 min)
- Supabase: **read replicas**, **PITR**, **daily backup schedule + last success**, log retention.
- Vercel: **WAF enabled**, **SSO/team security**, **usage limits**, **Speed Insights config**.
- Sentry: **alert rules**, **project keys**, **DSN per env** (verified present in secrets).
- Railway: gateway **uptime/health history**, Redis instance.
- GitHub: org-level secrets (verified none interfering), environment protection details (branch policy present).
