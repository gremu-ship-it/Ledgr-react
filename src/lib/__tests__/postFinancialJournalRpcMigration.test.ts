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
