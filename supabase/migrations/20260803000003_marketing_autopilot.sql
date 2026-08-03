-- Ledgr Marketing Agent — autopilot + analytics (Phase 4)
-- ------------------------------------------------------------------
-- Turns approved drafts into scheduled, auto-published content behind
-- guardrails, and captures post-performance metrics for the feedback loop.
--
--   marketing_settings gains autopilot controls (opt-in).
--   marketing_posts gains metrics_json (post insights, written by the
--   marketing-metrics-sync edge function).
--
-- "Autonomy" here = approved content is published on a schedule. The user must
-- still approve each draft (status 'approved' + scheduled_for). Nothing is ever
-- posted without that approval, and each business can cap posts per day.

-- ── Autopilot settings (per business) ───────────────────────────────
alter table public.marketing_settings
  add column if not exists autopilot_enabled boolean not null default false,
  add column if not exists max_posts_per_day integer not null default 1,
  add column if not exists ai_disclosure    boolean not null default true;

-- ── Post-performance metrics (populated by marketing-metrics-sync) ───
alter table public.marketing_posts
  add column if not exists metrics_json jsonb not null default '{}'::jsonb;

-- Helpful index for the scheduler's "what's due?" query.
create index if not exists marketing_posts_due_idx
  on public.marketing_posts (scheduled_for)
  where status = 'approved';
