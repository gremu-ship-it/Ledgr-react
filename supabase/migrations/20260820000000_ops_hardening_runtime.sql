-- ============================================================================
-- Phase 10.4 ops hardening — runtime correctness (2026-08-20)
--
-- Addresses review findings:
--   1. CLOCK SKEW: journal entry numbers were stamped from the client/edge
--      LOCAL clock (JNL-YYYYMMDDHHMMSS) — collision risk across devices and
--      regions. Replaced by a DB sequence: JNL-YYYYMMDD-NNNNNN (date prefix
--      for readability, sequence for uniqueness). Document numbers were
--      already DB-atomic (reserve_next_document_number); this closes the
--      journal-number gap.
--   2. WEBHOOK DEAD-LETTER: deliveries that exhaust their 3 attempts were
--      recorded but never retried or surfaced. Adds consecutive_failures
--      tracking on webhooks (auto-deactivate after 5 consecutive failures)
--      and a daily retry job (retry-failed-webhooks edge function) that
--      re-dispatches undelivered deliveries from the last 7 days.
--
-- IDEMPOTENT: create-if-not-exists / create-or-replace / drop-then-insert.
-- ============================================================================

-- ── 1. Journal entry number sequence + RPC ──────────────────────────────────
create sequence if not exists public.journal_entry_number_seq;

create or replace function public.next_journal_entry_number(p_business_id uuid default null)
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'JNL-' || to_char(now(), 'YYYYMMDD') || '-' ||
         lpad(nextval('public.journal_entry_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_journal_entry_number(uuid) from public, anon;
grant execute on function public.next_journal_entry_number(uuid) to authenticated, service_role;

comment on function public.next_journal_entry_number(uuid) is
  'Phase 10.4: DB-backed journal entry number (JNL-YYYYMMDD-NNNNNN). The sequence guarantees uniqueness regardless of client/edge clock skew; p_business_id is accepted for forward compatibility with per-business sequences and is currently unused.';

-- ── 2. Webhook dead-letter support ──────────────────────────────────────────
alter table public.webhooks
  add column if not exists consecutive_failures integer not null default 0;

comment on column public.webhooks.consecutive_failures is
  'Phase 10.4: count of consecutive delivery failures. Reset to 0 on success; the dispatcher deactivates the webhook after 5 consecutive failures so a dead endpoint stops burning retries.';

-- Daily retry of undelivered webhook deliveries (attempt >= 3, < 7 days old).
-- The edge function supabase/functions/retry-failed-webhooks re-dispatches
-- them via webhook-dispatcher. Idempotent: remove any prior job for this
-- command, then insert fresh.
delete from cron.job
 where command like '%retry-failed-webhooks%';

insert into cron.job (jobid, schedule, command, active)
values (
  nextval('cron.jobid_seq'),
  '0 6 * * *',
  'select net.http_post(url := ''https://<PROJECT_REF>.supabase.co/functions/v1/retry-failed-webhooks'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-secret'', ''<CRON_SECRET>''), body := ''{}''::jsonb);',
  true
);

-- ── 3. Maintain invoices.updated_at (optimistic-locking primitive) ──────────
-- The BaseRepository.updateIfUnchanged path compares-and-sets on updated_at.
-- Ensure the column exists (production's original schema may predate it) and
-- is always touched on UPDATE for invoices.
alter table public.invoices
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_invoices_touch_updated_at on public.invoices;
create trigger trg_invoices_touch_updated_at
  before update on public.invoices
  for each row execute function public.touch_updated_at();
