# Ledgr — 10-minute dashboard health checklist (Phase 10.4)

Run monthly (or after any infra change). Each item is a dashboard toggle/read —
no code changes. Record the date + result in the ops log.

## Supabase (project `hsuhuvuxfuufrlejsatw` production, `bkxzgkurcqvccsdjmqzg` staging)
- [ ] **Backups**: Database → Backups → last successful backup timestamp is recent (< 24 h); manual backup runs.
- [ ] **PITR**: enabled (recommended for production; RPO ≤ 24 h → PITR gives point-in-time).
- [ ] **Read replicas**: off (not needed at current scale — leave off).
- [ ] **Log retention**: Settings → Logging → retention ≥ 7 days.
- [ ] **Edge function logs**: spot-check `webhook-dispatcher`, `api`, `ai-insights`, `process-invoice-automation` for recurring errors in the last 7 days.
- [ ] **Cron jobs**: Database → Cron → the 4 jobs (expire-subscriptions, send-renewal-reminders, generate-partner-invoices, retry-failed-webhooks) all present and last-run OK.

## Vercel (projects `ledgr-react` production, `ledgr-react-prod` staging)
- [ ] **WAF**: Security → WAF → enabled + managed rules on.
- [ ] **SSO / team members**: team `gremu` members are current (remove leavers).
- [ ] **Environment variables**: production has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_APP_VERSION`; staging mirrors.
- [ ] **Speed Insights / Web Analytics**: enabled (already on per project JSON — confirm data flowing).
- [ ] **Usage limits**: plan usage % (bandwidth, builds) — no surprises before month end.

## GitHub
- [ ] **Actions secrets**: `VERCEL_TOKEN` matches a current token; `SUPABASE_DB_PASSWORD_PROD` matches the live DB password; no stale secrets.
- [ ] **Dependabot**: PRs reviewed/merged weekly; no critical `npm audit` findings open > 7 days.
- [ ] **Environments**: `Production` protection rules still enforce the approval gate; `staging` has no secrets.

## Sentry
- [ ] **Alert rules** (per SLOs.md draft) configured and firing to the right channel.
- [ ] **Release health**: latest release = current `VITE_APP_VERSION`; no old-release error flood.
- [ ] **Rate/sample**: tracesSampleRate 0.1 acceptable for volume.

## Railway (gateway)
- [ ] Gateway `/api/health` responds (uptime check green).
- [ ] No sustained 5xx in gateway logs; upstream circuit breaker never stuck open.

## Backup-restore drill
- [ ] Run `backup-verify.yml` manually (workflow_dispatch) once a quarter and confirm green.
