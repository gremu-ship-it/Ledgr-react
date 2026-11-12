-- POS returns: auditable line-level reasons/restock choices layered over R07.
-- The existing refund_pos_sale_command remains the only financial/inventory
-- correction path; this command validates POS-specific return policy and then
-- delegates to it in the same transaction.

create sequence if not exists public.pos_return_number_seq;

create table if not exists public.pos_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shift_id uuid not null references public.pos_shifts(id),
  invoice_id uuid not null references public.invoices(id),
  correction_id uuid references public.pos_corrections(id),
  command_key text not null,
  return_number text not null,
  refund_method text not null check (refund_method in ('cash', 'original', 'credit')),
  amount numeric not null check (amount > 0),
  currency text not null,
  reason text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, command_key),
  unique (business_id, return_number)
);

create table if not exists public.pos_return_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  return_id uuid not null references public.pos_returns(id) on delete cascade,
  invoice_line_id uuid not null references public.invoice_lines(id),
  product_id uuid references public.products(id),
  product_name text not null,
  quantity numeric not null check (quantity > 0),
  refund_amount numeric not null check (refund_amount > 0),
  reason text not null,
  restock boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists pos_returns_shift_idx on public.pos_returns (business_id, shift_id, created_at desc);
create index if not exists pos_returns_invoice_idx on public.pos_returns (business_id, invoice_id, created_at desc);
create index if not exists pos_return_lines_invoice_line_idx on public.pos_return_lines (invoice_line_id);

alter table public.pos_returns enable row level security;
alter table public.pos_return_lines enable row level security;
revoke all on public.pos_returns, public.pos_return_lines from public, anon, authenticated;
drop policy if exists pos_returns_select on public.pos_returns;
drop policy if exists pos_return_lines_select on public.pos_return_lines;
create policy pos_returns_select on public.pos_returns
  for select to authenticated using (public.is_business_member(business_id));
create policy pos_return_lines_select on public.pos_return_lines
  for select to authenticated using (
    exists (select 1 from public.pos_returns r
             where r.id = return_id and public.is_business_member(r.business_id))
  );
grant select on public.pos_returns, public.pos_return_lines to authenticated;
