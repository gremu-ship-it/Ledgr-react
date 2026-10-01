# artifacts/database — FROZEN SNAPSHOTS, NOT CURRENT STATE

Everything in this directory is a **historical artefact**. None of it tracks
the live databases, and none of it is updated by CI.

| Artefact | What it is |
|---|---|
| `capture/*.json`, `capture/*.txt` | Read-only Management API capture of **ledgr-staging** taken **2026-08-15T19:26Z** (Phase 8A.1) |
| `staging-schema-inventory.json` | The same capture, rendered (`scripts/database/build-live-inventory.py`) |
| `fresh-schema.json`, `fresh-database*.{json,ts}` | A disposable Postgres instance with **57** migrations replayed, compared against the capture |

## Read this before citing any of it

At the time of writing there are **122 migrations** in `supabase/migrations`;
the capture predates **61** of them. Two further traps:

1. **Migration version labels are authoring timestamps, not apply times.** The
   Phase 8B batch (`20260815000000`–`20260815000003`) sorts *before* the
   19:26 capture but was applied *after* it. Filtering by "version ≤ capture
   time" still produces ~45 phantom gaps unless that batch is excluded.
2. **Policies and functions created inside `DO $$ … execute format(…) $$`
   blocks** are invisible to text-matching tools. Phase 8B creates the
   policies for 21 tables that way, so a naive diff reports core tables such
   as `invoices` and `journal_entries` as having RLS enabled with no policy.

Both traps produced incorrect conclusions during the 2026-10-01
subscription-expiry investigation — including a claim that the Starter tier
migration had never been applied (it is simply newer than the capture) and
that `billing_cycle = 'custom'` had been hand-patched (migration
`20260726000004` adds it). See
`docs/audits/SUBSCRIPTION_EXPIRY_VERIFICATION_2026-10-01.md`.

## To learn what is actually deployed

```bash
# Offline, against the frozen capture — informational only, never exits 1.
python3 scripts/database/compare-capture-to-migrations.py

# Authoritative: queries the project itself and exits 1 on real drift.
SUPABASE_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> \
  python3 scripts/database/compare-capture-to-migrations.py --source live
```

`.github/workflows/schema-drift.yml` runs the live check weekly against
staging and production, and can be triggered manually from the Actions tab.

## Re-capturing

The capture scripts referenced in `scripts/database/build-live-inventory.py`
(`capture-staging-schema-via-api.sh` / `capture-staging-schema.sh`) are not in
this repository. If you refresh this directory, update the dates above and in
`meta.capture_status`, and note that the one thing the 2026-08-15 capture got
right — three pg_cron jobs frozen on `<PROJECT_REF>` placeholders — is exactly
the kind of finding the weekly live check now catches automatically.
