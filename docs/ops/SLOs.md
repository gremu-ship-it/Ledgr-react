# Ledgr SLOs / SLIs / Error Budgets (Phase 10.4)

**Owner:** product/engineering lead · **Review cadence:** monthly, first Monday.
**Status:** draft v1 — needs the Sentry/Vercel dashboards wired to the SLIs below before the numbers are measurable.

## SLO 1 — Frontend availability
- **SLI:** successful page loads / total page loads (Vercel Web Analytics + Sentry `pageload` transactions), excluding bots.
- **Target:** 99.5% monthly availability.
- **Error budget:** 0.5% ≈ ~3.6 hours of downtime-equivalent per 30-day month.
- **Burn policy:** > 2% error rate for 10 consecutive minutes → page (Sentry alert + on-call contact).

## SLO 2 — Sign-in success
- **SLI:** successful `signInWithPassword` calls / total (Sentry transaction `LoginPage` + Supabase Auth logs).
- **Target:** 99.0% monthly.
- **Error budget:** 1% ≈ ~7.2 hours/month.
- **Why separate:** the P0 blank-page incident (A-01) was a login-path failure; a dedicated SLI would have caught it instantly.
- **Burn policy:** > 5% failure for 5 minutes → page.

## SLO 3 — Public API + webhook delivery
- **SLI (API):** 2xx responses / total requests to `functions/v1/api` (excluding 429 rate-limits).
- **SLI (webhooks):** deliveries with `delivered_at` set / deliveries attempted, within 5 minutes of trigger.
- **Target:** 99.0% API, 98.0% webhook delivery within 5 min.
- **Error budget:** 1% / 2% respectively per month.
- **Burn policy:** API 5xx rate > 2% for 15 min → page; any webhook stuck at `attempt >= 3` for > 24 h → page (dead-letter monitor).

## Error budgets & action
- Spending the monthly budget → stop risky releases; mandatory postmortem; restore first.
- Half budget spent → review alert thresholds and add a mitigations PR.
- Budget NOT tracked automatically yet: capture the SLI numbers in a monthly ops note until a metrics pipeline (Sentry dashboards / Grafana) is wired.

## Alert-rule draft (Sentry / Vercel)
| Rule | Condition | Action |
|---|---|---|
| Frontend error rate | ≥ 2% of transactions in 10 min | Slack #alerts + email on-call |
| Login failure rate | ≥ 5% of `signInWithPassword` in 5 min | Slack + page |
| API 5xx | ≥ 2% in 15 min | Slack + page |
| Webhook dead-letter | any delivery `attempt >= 3` undelivered > 24 h | Slack daily digest |
| Cron failure | any scheduled edge function errors | Slack |
| Backup verify | `backup-verify.yml` run fails | Slack + page (data safety) |
