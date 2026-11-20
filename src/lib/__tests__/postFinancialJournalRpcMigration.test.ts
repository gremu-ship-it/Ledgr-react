import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION_PATH = 'supabase/migrations/20261225000001_post_financial_journal_rpc.sql';
const SQL = readFileSync(MIGRATION_PATH, 'utf8');
// Documentation must never satisfy a contract: assert on statements, not prose.
const CODE = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const body = (functionName: string) => {
  const start = CODE.indexOf(`create or replace function public.${functionName}`);
  expect(start, `${functionName} must be defined`).toBeGreaterThan(-1);
  const end = CODE.indexOf('$$ ;', start);
  const tail = CODE.indexOf('$$;', start);
  return CODE.slice(start, tail === -1 ? end : tail);
};

const postJournal = body('post_financial_journal');
const postDraft = body('post_draft_financial_journal');

describe('post_financial_journal command migration', () => {
  it('exposes a SECURITY DEFINER command pinned to the public search_path', () => {
    expect(postJournal).toContain('returns uuid');
    expect(postJournal).toContain('security definer');
    expect(postJournal).toContain('volatile');
    expect(postJournal).toContain('set search_path = public');
  });

  it('derives the caller from the JWT and enforces the financial write tier', () => {
    expect(postJournal).toContain('v_user uuid := auth.uid()');
    expect(postJournal).toContain('if v_user is null then');
    expect(postJournal).toContain('if not public.can_write_financial_data(p_business_id) then');
    expect(postJournal).toContain("errcode = '42501'");
  });

  it('balances on the functional-currency amount and refuses a broken entry', () => {
    // amount_base is the MWK-equivalent column; balancing on it is the only
    // correct comparison for multi-currency lines.
    expect(postJournal).toContain('v_debits := v_debits + v_amount_base');
    expect(postJournal).toContain('v_credits := v_credits + v_amount_base');
    expect(postJournal).toContain('round(v_debits, 2) <> round(v_credits, 2)');
    expect(postJournal).toContain('unbalanced journal entry');
    expect(postJournal).toContain("errcode = '22023'");
    expect(postJournal).toContain('jsonb_array_length(p_lines) < 2');
  });

  it('writes the schema this database has, never the specification sketch', () => {
    expect(postJournal).toContain('insert into public.journal_entries');
    expect(postJournal).toContain('insert into public.journal_lines');
    expect(CODE).not.toContain('journal_entry_lines');
    expect(CODE).not.toContain('shares_register');
    expect(CODE).not.toContain('shareholder_transactions');
    expect(CODE).not.toContain('equity_transactions');
    // journal_lines has is_debit/amount/amount_base and no debit/credit columns.
    expect(postJournal).toContain('is_debit, amount, amount_base');
    expect(postJournal).not.toMatch(/insert into public\.journal_lines \([^)]*\bdebit numeric\b/);
  });

  it('reserves the entry number server-side and reuses the existing guards', () => {
    expect(postJournal).toContain('public.next_journal_entry_number(p_business_id)');
    // Account ownership + group-account rejection stay in one helper.
    expect(postJournal).toContain('public._ledgr_assert_account');
    // Closed periods are a trigger, so they apply to the command as well.
    expect(SQL).toContain('trg_aa_period_lock');
  });

  it('keeps the ledger command-only: no policy is added or relaxed here', () => {
    expect(CODE).not.toContain('create policy journal_entries');
    expect(CODE).not.toContain('create policy journal_lines');
    // Only share_transactions policies are (re)declared by this migration.
    const policies = CODE.match(/create policy "?[a-z_]+"? on public\.[a-z_]+/g) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toContain('on public.share_transactions');
  });

  it('re-assigns a cost centre through a command too, scoped to the business', () => {
    const assign = body('assign_financial_journal_cost_centre');
    expect(assign).toContain('security definer');
    expect(assign).toContain('for update');
    expect(assign).toContain('if not public.can_write_financial_data(v_entry.business_id) then');
    expect(assign).toContain('update public.journal_entries');
    expect(assign).toContain('update public.journal_lines');
    expect(assign).toContain('and business_id = v_entry.business_id');
  });

  it('is idempotent under a posting key so a retried save cannot double-post', () => {
    expect(postJournal).toContain('where business_id = p_business_id');
    expect(postJournal).toContain('and posting_key = p_posting_key');
    expect(postJournal).toContain('return v_existing');
  });

  it('only creates drafts or posted entries, never a reversal', () => {
    expect(postJournal).toContain("v_status not in ('draft', 'posted')");
  });

  it('grants execute to authenticated only', () => {
    expect(CODE).toContain('revoke all on function public.post_financial_journal');
    expect(CODE).toContain('from public, anon');
    expect(CODE).toContain('grant execute on function public.post_financial_journal');
    expect(CODE).toContain('to authenticated, service_role');
  });

  it('provides the draft→posted transition as a command with the same authority', () => {
    expect(postDraft).toContain('security definer');
    expect(postDraft).toContain('for update');
    expect(postDraft).toContain('if not public.can_write_financial_data(v_entry.business_id) then');
    expect(postDraft).toContain("if v_entry.status::text <> 'draft' then");
    expect(postDraft).toContain("only ''draft'' entries may be posted");
  });

  it('tightens share_transactions to the financial tier and drops the member-wide policy', () => {
    expect(CODE).toContain('alter table public.share_transactions enable row level security');
    expect(CODE).toContain('drop policy if exists "share_transactions_business_access" on public.share_transactions');
    expect(CODE).toContain('create policy "share_transactions_select" on public.share_transactions');
    expect(CODE).toContain('create policy "share_transactions_insert" on public.share_transactions');
    expect(CODE).toContain('create policy "share_transactions_update" on public.share_transactions');
    expect(CODE).toContain('with check (public.can_write_financial_data(business_id))');
    expect(CODE).toContain('using (public.can_read_financial_data(business_id))');
  });
});

// ── 20261225000002: source_id / created_by / posted_by are uuid on the live
//    database and text in this repository's base schema ───────────────────────
const UUID_MIGRATION_PATH = 'supabase/migrations/20261225000002_fix_journal_source_id_uuid_cast.sql';
const UUID_SQL = readFileSync(UUID_MIGRATION_PATH, 'utf8');
const UUID_CODE = UUID_SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const uuidBody = (functionName: string) => {
  const start = UUID_CODE.indexOf(`create or replace function public.${functionName}`);
  expect(start, `${functionName} must be redefined`).toBeGreaterThan(-1);
  const end = UUID_CODE.indexOf('$$;', start);
  expect(end, `${functionName} must be terminated`).toBeGreaterThan(start);
  return UUID_CODE.slice(start, end);
};

const uuidPostJournal = uuidBody('post_financial_journal');
const uuidPostDraft = uuidBody('post_draft_financial_journal');
const uuidAssignCentre = uuidBody('assign_financial_journal_cost_centre');

describe('post_financial_journal source_id uuid cast migration', () => {
  it('resolves the physical type of journal_entries.source_id at run time', () => {
    expect(uuidPostJournal).toContain('from information_schema.columns c');
    expect(uuidPostJournal).toContain("c.table_name = 'journal_entries'");
    expect(uuidPostJournal).toContain("c.column_name = 'source_id'");
    expect(uuidPostJournal).toContain("if coalesce(v_source_id_type, 'text') = 'uuid' then");
  });

  it('casts only uuid-shaped text into the uuid column', () => {
    // A blind `p_source_id::uuid` would turn the 42804 into a 22P02 the moment a
    // composite key ("GRN-…") reached the command, so the cast is guarded.
    expect(uuidPostJournal).toContain(
      "v_source_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
    );
    expect(uuidPostJournal).toContain('v_source_uuid := v_source_text::uuid');
    // Non-uuid keys still post; the key survives in posting_key.
    expect(uuidPostJournal).toContain('raise warning');
    expect(uuidPostJournal).toContain('v_source_text := null');
  });

  it('never hands the text parameter straight to the insert', () => {
    // One branch per column shape: uuid expression, or the raw text.
    expect(uuidPostJournal).toContain('insert into public.journal_entries');
    expect(uuidPostJournal).toContain('v_source_uuid,');
    expect(uuidPostJournal).toContain('v_source_text,');
    expect(uuidPostJournal).not.toMatch(/values \([^)]*\bp_source_id\b/);
  });

  it('writes created_by / posted_by as uuid expressions, accepted by both shapes', () => {
    // uuid → text is an assignment cast; text → uuid is not, which is what broke.
    expect(uuidPostJournal).not.toContain('v_user::text');
    expect(uuidPostJournal).toContain('v_user,');
    expect(uuidPostDraft).not.toContain('v_user::text');
    expect(uuidPostDraft).toContain('then btrim(p_posted_by)::uuid');
    expect(uuidPostDraft).toContain('else v_user');
  });

  it('compares the uuid-shaped source_id as text in the cost-centre command', () => {
    // `uuid ~ text` is 42883 on the live shape.
    expect(uuidAssignCentre).toContain("v_entry.source_id::text ~ '^[0-9a-f");
    expect(uuidAssignCentre).not.toContain('where id = v_entry.source_id::uuid');
    expect(uuidAssignCentre).toContain('where id = (v_entry.source_id::text)::uuid');
  });

  it('replaces functions only — no table, policy or data change — and keeps the grants', () => {
    expect(UUID_CODE).not.toContain('alter table public.journal_entries');
    expect(UUID_CODE).not.toContain('create policy');
    expect(UUID_CODE).not.toContain('drop policy');
    // The only UPDATEs are the commands' own transitions (draft→posted, cost
    // centre) — nothing rewrites a column definition or a policy.
    expect(UUID_CODE).not.toContain('alter column');
    expect(UUID_CODE).not.toContain('set source_id');
    for (const fn of ['post_financial_journal', 'post_draft_financial_journal', 'assign_financial_journal_cost_centre']) {
      expect(UUID_CODE).toContain(`grant execute on function public.${fn}`);
    }
    expect(UUID_CODE).toContain('from public, anon');
  });
});
