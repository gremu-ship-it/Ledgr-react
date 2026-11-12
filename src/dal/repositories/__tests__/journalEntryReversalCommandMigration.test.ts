import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  'supabase/migrations/20261224000001_journal_entry_reversal_command.sql',
  'utf8',
).toLowerCase();
const UUID_FIX = readFileSync(
  'supabase/migrations/20261224000002_fix_journal_reversal_actor_uuid.sql',
  'utf8',
).toLowerCase();
const REPOSITORY = readFileSync('src/dal/repositories/JournalRepository.ts', 'utf8');
const RLS = readFileSync(
  'supabase/migrations/20261218000000_role_aware_financial_rls.sql',
  'utf8',
).toLowerCase();

describe('journal entry reversal command', () => {
  it('uses an authenticated, branch-scoped, write-authorized security-definer command', () => {
    expect(MIGRATION).toContain('function public.reverse_journal_entry(');
    expect(MIGRATION).toContain('security definer');
    expect(MIGRATION).toContain('auth.uid()');
    expect(MIGRATION).toContain('can_write_financial_data(v_original.business_id)');
    expect(MIGRATION).toContain('can_access_branch(v_original.business_id, v_original.branch_id)');
    expect(MIGRATION).toContain("revoke all on function public.reverse_journal_entry(uuid, text, date, text) from public, anon");
    expect(MIGRATION).toContain('grant execute on function public.reverse_journal_entry(uuid, text, date, text) to authenticated, service_role');
  });

  it('creates a balanced mirror and posts it atomically with the original reversal link', () => {
    expect(MIGRATION).toContain('for update');
    expect(MIGRATION).toContain('not v_line.is_debit');
    expect(MIGRATION).toContain('abs(v_total_debits - v_total_credits) > 0.005');
    expect(MIGRATION).toContain("set status = 'posted', posted_by = v_user_id::text, posted_at = now()");
    expect(MIGRATION).toContain("set status = 'reversed', reversed_by = v_reversal_id");
    expect(MIGRATION).toContain("return jsonb_build_object('reversaljournalentryid', v_reversal_id)");
  });

  it('uses UUID actor values for created_by and posted_by in the forward repair', () => {
    expect(UUID_FIX).toContain('create or replace function public.reverse_journal_entry(');
    expect(UUID_FIX).toContain("'draft', v_original.id, v_user_id, v_period_id");
    expect(UUID_FIX).toContain('posted_by = v_user_id, posted_at = now()');
    expect(UUID_FIX).not.toContain('v_user_id::text');
  });

  it('routes the repository through the command instead of direct journal DML', () => {
    const reverseStart = REPOSITORY.indexOf('  async reverse(');
    const reverseEnd = REPOSITORY.indexOf('  /**\n   * Back out a single recorded payment', reverseStart);
    const reverseMethod = REPOSITORY.slice(reverseStart, reverseEnd);

    expect(reverseMethod).toContain("rpc('reverse_journal_entry'");
    expect(reverseMethod).toContain('findByIdWithLines(reversalEntryId)');
    expect(reverseMethod).not.toContain('createBalancedEntry(');
    expect(reverseMethod).not.toContain('.update(originalId');
    expect(reverseMethod).not.toContain(".from('journal_entries').insert");

    // This is intentionally denied for authenticated direct DML; the RPC is
    // the authorized path, not a permissive policy added to the table.
    expect(RLS).toContain('create policy journal_entries_command_insert');
    expect(RLS).toContain('with check (false)');
    expect(RLS).toContain('create policy journal_entries_command_update');
  });
});
