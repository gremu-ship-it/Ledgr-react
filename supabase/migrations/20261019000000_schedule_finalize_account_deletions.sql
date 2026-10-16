-- ─────────────────────────────────────────────────────────────────────────
-- Declare the account-deletion finalizer as a pg_cron job (2026-10-16)
-- ─────────────────────────────────────────────────────────────────────────
-- supabase/functions/finalize-account-deletions has always been documented as
-- "run on a schedule (see the pg_cron setup in
-- schedule_finalize_deletions.sql)" — but that migration never existed in this
-- repository, and neither did any other declaration of the job. The job does
-- exist on production:
--
--   jobname  finalize-account-deletions-daily
--   schedule 0 3 * * *
--   active   true
--   command  net.http_post('https://<PROJECT_REF>.supabase.co/functions/v1/
--            finalize-account-deletions', … 'x-cron-secret', '<CRON_SECRET>')
--
-- i.e. it was created out-of-band (SQL editor, copying the placeholder
-- template used by the other schedule migrations) with the placeholders still
-- in it. pg_net swallows the DNS failure, so the job looked healthy in
-- cron.job and never finalized a single deletion.
--
-- Because no migration declared it, scripts/cron-jobs.sql never scheduled it
-- either, so nothing substituted its placeholders and the deploy's
-- verification (scripts/ci/apply-cron-jobs.sh) failed on every run:
--
--   Cron jobs on production still contain unsubstituted placeholders …
--   [{"jobname":"finalize-account-deletions-daily","schedule":"0 3 * * *",
--     "active":true,"username":"postgres"}]
--
-- This migration adopts that row under the same name, at the same schedule, so
-- the repository — not an out-of-band SQL editor — is the declaration of
-- record. scripts/cron-jobs.sql reschedules it on every deploy with the real
-- project ref and CRON_SECRET; this file deliberately keeps the
-- <PROJECT_REF> / <CRON_SECRET> placeholders, exactly like
-- 20260726000003 / 20260726000005 / 20260727000006 / 20260820000000.
--
-- IDEMPOTENT: cron.schedule() upserts on (jobname, username), and section 2
-- only touches a job whose command still holds a placeholder.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. Schedule the nightly finalizer ───────────────────────────────────────
-- 03:00 UTC (05:00 CAT) — the schedule the production row already carries.
-- Day 30 of a deletion request: ban the auth user permanently and stamp
-- deletion_finalized_at (see the function header for why the records
-- themselves are left intact).
select cron.schedule(
  'finalize-account-deletions-daily',
  '0 3 * * *', -- 03:00 UTC every day
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/finalize-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ── 2. Deactivate it while it still holds a placeholder ─────────────────────
-- Re-run of the 20261017000000 §3 guard. That section deactivates every job
-- carrying a placeholder, but migrations run once and in order — §3 already
-- ran on production before this job was declared here, so without this block a
-- freshly replayed database would end up with an ACTIVE job posting to
-- 'https://<PROJECT_REF>.supabase.co/...': the failure mode §3 exists to
-- prevent (pg_net swallows the DNS error, so `active` would lie).
--
-- Same contract and same privilege handling as §3: the job is deactivated,
-- never deleted, so it stays visible to an operator, and
-- scripts/ci/apply-cron-jobs.sh re-creates it active with real values. The
-- direct UPDATE is attempted first (a fresh/local database) and, when the push
-- role owns neither the extension nor its tables, the deactivation goes
-- through pg_cron's own SECURITY DEFINER entry point (cron.alter_job) — see
-- §3's comment and tests/database/cron_placeholder_sweep.test.js.
do $$
declare
  v_job record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not installed here — nothing to deactivate.';
    return;
  end if;

  -- `and active`: a job §3 already deactivated is in the state this block
  -- wants, so leave its row (and the log) alone.
  for v_job in
    select jobid, jobname from cron.job
     where (command like '%<PROJECT_REF>%' or command like '%<CRON_SECRET>%')
       and active
  loop
    begin
      update cron.job set active = false where jobid = v_job.jobid;
      raise warning 'Cron job % (%) still contains a deploy-time placeholder and has been deactivated — run scripts/ci/apply-cron-jobs.sh to schedule it properly.',
        v_job.jobname, v_job.jobid;
    exception
      when insufficient_privilege then
        begin
          -- Positional arguments with explicit NULLs: NULL means "leave this
          -- field alone" in pg_cron, and positional keeps the call working on
          -- every pg_cron version that has alter_job (added in 1.5).
          perform cron.alter_job(v_job.jobid, null, null, null, null, false);
          raise warning 'Cron job % (%) still contains a deploy-time placeholder and has been deactivated via cron.alter_job (the migration role cannot write cron.job) — run scripts/ci/apply-cron-jobs.sh to schedule it properly.',
            v_job.jobname, v_job.jobid;
        exception
          when others then
            raise warning 'Cron job % (%) still contains a deploy-time placeholder and could not be deactivated (%) — run scripts/ci/apply-cron-jobs.sh to schedule it properly.',
              v_job.jobname, v_job.jobid, sqlerrm;
        end;
    end;
  end loop;
end;
$$;
