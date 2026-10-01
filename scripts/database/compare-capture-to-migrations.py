#!/usr/bin/env python3
"""Report schema drift between a Ledgr database and supabase/migrations.

Two sources, and the difference between them matters a great deal:

  --source capture   (default, offline)
      Reads artifacts/database/capture/*.json. That capture is a read-only
      Management API snapshot of ledgr-staging taken 2026-08-15T19:26Z.
      It is a FROZEN HISTORICAL ARTEFACT, not the current state of any
      database: 61 migrations in this repository were authored after it,
      including the same-day Phase 8B batch (20260815000000-3) whose
      version labels sort BEFORE the capture timestamp but were applied
      after it. Anything "missing" here may simply be newer than the
      snapshot, so this mode only reports, never concludes.

  --source live      (needs credentials)
      Queries the project itself through the Management API SQL endpoint
      (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF). This is the only
      mode that can prove drift, because it also compares
      supabase_migrations.schema_migrations against the migration files
      in this checkout.

Checks performed (live mode does all of them, capture mode skips #1):
  1. Migration history: versions applied remotely vs. files here.
  2. pg_cron jobs still holding <PROJECT_REF>/<CRON_SECRET> placeholders —
     they never fire, and pg_net hides the failure.
  3. Tables with RLS enabled and no policy (deny-all to every client).
  4. Tables/functions/triggers/indexes declared by migrations but absent.

Usage:
    python3 scripts/database/compare-capture-to-migrations.py
    SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \\
        python3 scripts/database/compare-capture-to-migrations.py --source live

Exit code: 0 when no definite problem is found, 1 when live mode proves
drift or a placeholder cron job (so it can gate CI). Capture mode always
exits 0 — it cannot prove anything about today.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAP = os.path.join(REPO, 'artifacts', 'database', 'capture')
MIG = os.path.join(REPO, 'supabase', 'migrations')

# meta.generated_at of the committed capture.
CAPTURE_TAKEN = '20260815192613'
# Same-day migrations whose version label sorts before the capture but which
# were written/applied after it. Treating them as "should already be there"
# produces ~45 phantom findings (the entire Phase 8B reconstruction).
CAPTURE_EXCLUDE_PREFIXES = ('202608150000',)


# ── migration parsing ───────────────────────────────────────────────────────

def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.S)
    return re.sub(r'--[^\n]*', '', sql)


def migration_files() -> list[tuple[str, str, str]]:
    """(version, filename, sql) for every migration in the checkout."""
    out = []
    for path in sorted(glob.glob(os.path.join(MIG, '*.sql'))):
        name = os.path.basename(path)
        version = name.split('_')[0]
        if not version.isdigit():
            continue
        with open(path, encoding='utf-8') as fh:
            out.append((version, name, strip_sql_comments(fh.read())))
    return out


def declared_objects(sql: str) -> dict[str, set[str]]:
    return {
        'tables': set(re.findall(r'create table (?:if not exists )?(?:public\.)?"?([a-z0-9_]+)"?', sql)),
        'functions': set(re.findall(r'create (?:or replace )?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(', sql)),
        'triggers': set(re.findall(r'create trigger\s+"?([a-z0-9_]+)"?', sql)),
        # `if not exists` must not be captured as an index name.
        'indexes': set(re.findall(
            r'create (?:unique )?index (?:concurrently )?(?:if not exists\s+)?"?([a-z0-9_]+)"?\s+on', sql)),
    }


# ── sources ─────────────────────────────────────────────────────────────────

class CaptureSource:
    label = 'capture (artifacts/database/capture, 2026-08-15)'
    can_prove = False

    def _load(self, name):
        with open(os.path.join(CAP, name), encoding='utf-8') as fh:
            return json.load(fh)

    def tables(self):
        return {r['relname'] for r in self._load('tables.json') if r.get('relname')}

    def functions(self):
        names = set()
        for row in self._load('functions.json'):
            sig = row.get('?column?') or ''
            m = re.match(r'([a-z0-9_]+)\(', sig)
            if m:
                names.add(m.group(1))
        return names

    def triggers(self):
        return {r['tgname'] for r in self._load('triggers.json') if r.get('tgname')}

    def indexes(self):
        return {r['relname'] for r in self._load('indexes.json') if r.get('relname')}

    def cron_jobs(self):
        return [{'jobname': j.get('jobname') or str(j.get('jobid')),
                 'schedule': j.get('schedule'),
                 'active': j.get('active'),
                 'command': j.get('command') or ''} for j in self._load('cron_jobs.json')]

    def rls_without_policy(self):
        policied = {p.get('tablename') for p in self._load('policies.json')}
        enabled = {r['relname'] for r in self._load('rls.json') if r.get('relrowsecurity')}
        return sorted(enabled - policied)

    def applied_versions(self):
        return None  # not captured


class LiveSource:
    can_prove = True

    def __init__(self, ref: str, token: str):
        self.ref, self.token = ref, token
        self.label = f'live project {ref}'

    def query(self, sql: str):
        req = urllib.request.Request(
            f'https://api.supabase.com/v1/projects/{self.ref}/database/query',
            data=json.dumps({'query': sql}).encode(),
            headers={'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'},
            method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as err:
            sys.exit(f'Management API query failed ({err.code}): {err.read().decode()[:300]}')

    def tables(self):
        rows = self.query("select tablename from pg_tables where schemaname='public'")
        return {r['tablename'] for r in rows}

    def functions(self):
        rows = self.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")
        return {r['proname'] for r in rows}

    def triggers(self):
        rows = self.query("select tgname from pg_trigger where not tgisinternal")
        return {r['tgname'] for r in rows}

    def indexes(self):
        rows = self.query("select indexname from pg_indexes where schemaname='public'")
        return {r['indexname'] for r in rows}

    def cron_jobs(self):
        rows = self.query("select jobname, schedule, active, command from cron.job")
        return rows

    def rls_without_policy(self):
        rows = self.query("""
            select c.relname from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
               and not exists (select 1 from pg_policies p
                                where p.schemaname='public' and p.tablename = c.relname)
             order by 1""")
        return [r['relname'] for r in rows]

    def applied_versions(self):
        rows = self.query('select version from supabase_migrations.schema_migrations order by version')
        return {r['version'] for r in rows}


# ── report ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=('capture', 'live'), default='capture')
    args = ap.parse_args()

    if args.source == 'live':
        ref = os.environ.get('SUPABASE_PROJECT_REF')
        token = os.environ.get('SUPABASE_ACCESS_TOKEN')
        if not ref or not token:
            sys.exit('live mode needs SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN')
        src: CaptureSource | LiveSource = LiveSource(ref, token)
        relevant = migration_files()
    else:
        src = CaptureSource()
        relevant = [m for m in migration_files()
                    if m[0] <= CAPTURE_TAKEN and not m[0].startswith(CAPTURE_EXCLUDE_PREFIXES)]

    print(f'Source: {src.label}')
    print(f'Migrations considered: {len(relevant)} of {len(migration_files())}')
    if args.source == 'capture':
        print('NOTE: the capture is a frozen 2026-08-15 snapshot. Findings below are\n'
              '      hypotheses about that moment, not evidence about production.\n'
              '      Run with --source live to prove anything.')
    print()

    problems = 0

    # 1. Migration history -------------------------------------------------
    applied = src.applied_versions()
    if applied is None:
        print('1. MIGRATION HISTORY: not available from a capture.\n')
    else:
        local = {v for v, _, _ in migration_files()}
        missing = sorted(local - applied)
        extra = sorted(applied - local)
        print(f'1. MIGRATION HISTORY: {len(applied)} applied, {len(local)} in checkout')
        print(f'   in checkout but NOT applied: {missing or "none"}')
        print(f'   applied but NOT in checkout: {extra or "none"}')
        problems += len(missing)
        print()

    # 2. Cron placeholders --------------------------------------------------
    print('2. CRON JOBS:')
    for job in src.cron_jobs():
        cmd = (job.get('command') or '').replace('\n', ' ')
        broken = '<PROJECT_REF>' in cmd or '<CRON_SECRET>' in cmd
        mark = '  <-- PLACEHOLDER: never fires' if broken else ''
        problems += 1 if (broken and job.get('active')) else 0
        print(f"   {job.get('jobname')}: {job.get('schedule')} active={job.get('active')}{mark}")
    print()

    # 3. RLS without policy -------------------------------------------------
    orphans = src.rls_without_policy()
    print(f'3. RLS ENABLED, NO POLICY (deny-all to clients): {len(orphans)}')
    if orphans:
        print(f'   {", ".join(orphans)}')
        if args.source == 'capture':
            print('   (Phase 8B migrations 20260815000000-3 create most of these policies\n'
                  '    dynamically in DO blocks — expected to be absent from this snapshot.)')
    print()

    # 4. Declared-but-absent objects ---------------------------------------
    declared: dict[str, set[str]] = {'tables': set(), 'functions': set(), 'triggers': set(), 'indexes': set()}
    for _, _, sql in relevant:
        for key, names in declared_objects(sql).items():
            declared[key] |= names
    all_sql = '\n'.join(sql for _, _, sql in relevant)
    dropped = {
        'tables': set(re.findall(r'drop table (?:if exists )?(?:public\.)?"?([a-z0-9_]+)"?', all_sql)),
        'functions': set(re.findall(r'drop function (?:if exists )?(?:public\.)?"?([a-z0-9_]+)"?', all_sql)),
        'triggers': set(re.findall(r'drop trigger (?:if exists )?"?([a-z0-9_]+)"?', all_sql)),
        'indexes': set(re.findall(r'drop index (?:if exists )?(?:public\.)?"?([a-z0-9_]+)"?', all_sql)),
    }
    actual = {'tables': src.tables(), 'functions': src.functions(),
              'triggers': src.triggers(), 'indexes': src.indexes()}

    print('4. OBJECTS DECLARED BY MIGRATIONS BUT ABSENT:')
    for key in ('tables', 'functions', 'triggers', 'indexes'):
        missing = sorted(declared[key] - dropped[key] - actual[key])
        print(f'   {key}: {len(missing)} missing of {len(declared[key])} declared')
        if missing:
            print(f'      {", ".join(missing)}')
            if src.can_prove:
                problems += len(missing)
    print()

    if src.can_prove:
        print(f'RESULT: {problems} definite problem(s).')
        sys.exit(1 if problems else 0)
    print('RESULT: capture mode — informational only, exit 0.')


if __name__ == '__main__':
    main()
