import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Repository invariants for supabase/migrations/.
 *
 * These are the two defects that took CI and the deploy pipeline red on
 * 2026-09-24, and neither was visible to typecheck, lint, unit tests or build —
 * they only surfaced against a database:
 *
 *   1. Two files shared a version prefix — 20260926000001 and 20261003000000
 *      in the PR #164 merge, then 20261009000000 when PR #177 and PR #178 were
 *      merged minutes apart. supabase_migrations.schema_migrations is keyed by
 *      that prefix, so the second file can never be recorded: `supabase db push`
 *      failed with SQLSTATE 23505 "duplicate key value violates unique
 *      constraint schema_migrations_pkey" on every attempt, which took down the
 *      staging deploy (Deploy #225) and was misread as an unresponsive database.
 *
 *   2. A migration installed a second balance-maintaining trigger on
 *      public.stock_movements next to the canonical one from 20260925000001.
 *      Two additive writers on one INSERT apply every movement twice — the
 *      exact double-count (10 received, 20 on hand) that 20260925000001 was
 *      written to end. It showed up as 18 FAIL records (observed 98 vs expected
 *      99) in the R13 release evidence.
 *
 * Rule A and B are enforced here in the fast suite (`npm test`). Rule C is a
 * static guard against re-creating the second writer, and rule D keeps the
 * single-writer assertion present somewhere in the chain; the in-band assertion
 * in 20260928000001_r06_stock_balance_authority.sql is the authoritative check,
 * because only the database can see the real trigger set.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');
const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const version = (file: string) => file.split('_')[0];

describe('supabase/migrations invariants', () => {
  it('A. every migration version prefix is unique', () => {
    const byVersion = new Map<string, string[]>();
    for (const file of files) {
      byVersion.set(version(file), [...(byVersion.get(version(file)) ?? []), file]);
    }
    const duplicates = [...byVersion.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([v, names]) => `${v}: ${names.join(', ')}`);
    // A collision makes `supabase db push` fail deterministically (23505).
    expect(duplicates).toEqual([]);
  });

  it('B. every migration file name is a digit version plus a lower-case slug', () => {
    // 20250724_api_usage.sql predates the timestamp convention (it is recorded
    // remotely under that name, so it is not renamed here) — hence a digit
    // prefix of 8 to 14 characters rather than exactly 14.
    const malformed = files.filter(f => !/^\d{8,14}_[a-z0-9][a-z0-9_]*\.sql$/.test(f));
    expect(malformed).toEqual([]);
  });

  it('C. a migration that installs a balance writer on stock_movements also removes competing ones', () => {
    // A file that creates a *balance* trigger on public.stock_movements is
    // installing (or replacing) THE balance writer. Adding one next to an
    // existing writer double-counts every movement, so such a file must also
    // purge the others — the predicate 20260925000001 and 20260928000001 share.
    const offenders: string[] = [];
    for (const file of files) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      const createsBalanceWriter = [...sql.matchAll(/create\s+trigger\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)[\s\S]{0,400}?on\s+public\.stock_movements/gi)]
        .some(m => /balance/i.test(m[1]));
      if (!createsBalanceWriter) continue;
      const purgesCompetingWriters = /tgname\s+ilike\s+'%balance%'/i.test(sql)
        && /drop\s+trigger\s+if\s+exists\s+%I\s+on\s+public\.stock_movements/i.test(sql);
      if (!purgesCompetingWriters) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('E. the construction project chain re-applies safely on a database that already has its objects', () => {
    // 2026-10-18, production (Deploy #224, run 39118959766): `supabase db push`
    // died on the FIRST statement of 20261028000000_construction_projects.sql —
    //   ERROR: relation "projects" already exists (SQLSTATE 42P07)
    // — and then died twice more, identically, because the retry loop treated a
    // permanent schema collision as a transport failure. public.projects was
    // live on production while version 20261028000000 was absent from
    // supabase_migrations.schema_migrations: the objects had been applied by
    // hand (the SQL editor / psql commits every statement it runs and records no
    // version), so `db push` still had the file to apply and re-applied it.
    //
    // The rule for everything from Phase A onwards is therefore that a file must
    // survive meeting its own objects: guarded DDL, or a paired DROP ... IF
    // EXISTS where Postgres offers no IF NOT EXISTS (policies, triggers). A
    // migration that cannot be re-applied turns one hand-applied object into a
    // blocked production deploy. Verified against a real database by
    // tests/database/construction_projects_convergence.test.js.
    const FROM = '20261028000000';
    const offenders: string[] = [];
    for (const file of files) {
      if (version(file) < FROM) continue;
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      const problems: string[] = [];
      const bare: [RegExp, string][] = [
        [/^CREATE TABLE (?!IF NOT EXISTS)public\./m, 'CREATE TABLE without IF NOT EXISTS'],
        [/^CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/m, 'CREATE INDEX without IF NOT EXISTS'],
        [/^CREATE FUNCTION public\./m, 'CREATE FUNCTION without OR REPLACE'],
        [/^ALTER TABLE public\.[a-z_]+ ADD COLUMN (?!IF NOT EXISTS)/m, 'ADD COLUMN without IF NOT EXISTS'],
        [/^ALTER TABLE public\.[a-z_]+ ADD CONSTRAINT /m, 'ADD CONSTRAINT outside a guarded DO block'],
        [/^ALTER TYPE [\w.]+ ADD VALUE (?!IF NOT EXISTS)/m, 'ALTER TYPE ADD VALUE without IF NOT EXISTS'],
      ];
      for (const [pattern, label] of bare) if (pattern.test(sql)) problems.push(label);
      // CREATE POLICY / CREATE TRIGGER have no IF NOT EXISTS: each one must be
      // preceded by a DROP ... IF EXISTS naming the same object.
      const paired: [string, RegExp, RegExp][] = [
        ['policy', /^CREATE POLICY (\w+)\s*\n?\s*ON public\.(\w+)/gm, /^DROP POLICY IF EXISTS (\w+) ON public\.(\w+);/gm],
        ['trigger', /^CREATE TRIGGER (\w+)[\s\S]{0,200}?\bON public\.(\w+)/gm, /^DROP TRIGGER IF EXISTS (\w+) ON public\.(\w+);/gm],
        ['temp table', /^CREATE TEMP TABLE (\w+)/gm, /^DROP TABLE IF EXISTS (\w+);/gm],
      ];
      const key = (m: RegExpMatchArray) => [m[1], m[2]].filter(Boolean).join('.');
      for (const [label, create, drop] of paired) {
        const dropped = [...sql.matchAll(drop)].map(key);
        for (const m of sql.matchAll(create)) {
          if (!dropped.includes(key(m))) {
            problems.push(`CREATE ${label.toUpperCase()} ${m[1]} without a paired DROP ... IF EXISTS`);
          }
        }
      }
      if (problems.length) offenders.push(`${file}: ${problems.join('; ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('D. the chain asserts the single-writer invariant on stock_movements', () => {
    // The deploy must fail loudly if a second balance writer ever exists,
    // rather than silently double-counting stock. Cross-file and
    // wording-tolerant: an assertion may live in any migration, but at least
    // one has to survive.
    const assertsSingleWriter = files.filter(file => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      return /stock_movements'::regclass/.test(sql)
        && /raise\s+exception[\s\S]{0,400}?exactly\s+one[\s\S]{0,200}?balance/i.test(sql);
    });
    expect(assertsSingleWriter.length).toBeGreaterThan(0);
  });
});
