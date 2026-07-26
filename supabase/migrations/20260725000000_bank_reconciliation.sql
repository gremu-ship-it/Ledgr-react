-- Bank reconciliation audit and period lock support.
alter table public.bank_statements add column if not exists reconciled_at timestamptz;
alter table public.bank_statements add column if not exists reconciled_by uuid references auth.users(id);
alter table public.bank_statements add column if not exists is_locked boolean not null default false;
alter table public.bank_statements add column if not exists locked_at timestamptz;
alter table public.bank_statement_lines add column if not exists match_method text check (match_method in ('manual','ai','created'));
alter table public.bank_statement_lines add column if not exists match_confidence numeric(5,4);
alter table public.bank_statement_lines add column if not exists locked_at timestamptz;

-- A locked line cannot be edited or removed. Service-role migration/reversal tools may
-- explicitly unlock its parent statement first.
create or replace function public.prevent_locked_bank_line_change() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.bank_statements s where s.id = coalesce(old.statement_id, new.statement_id) and s.is_locked) then
    raise exception 'This bank reconciliation period is locked';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists bank_line_locked_guard on public.bank_statement_lines;
create trigger bank_line_locked_guard before update or delete on public.bank_statement_lines for each row execute function public.prevent_locked_bank_line_change();
