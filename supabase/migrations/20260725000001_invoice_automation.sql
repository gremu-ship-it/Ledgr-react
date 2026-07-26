-- Full invoicing metadata and delivery audit.
alter table public.invoices add column if not exists template text not null default 'professional' check (template in ('professional','minimal','ngo','government'));
alter table public.invoices add column if not exists project_code text;
alter table public.invoices add column if not exists lpo_number text;
alter table public.invoices add column if not exists accent_colour text;
alter table public.invoices add column if not exists payment_provider text check (payment_provider in ('airtel_money','tnm_mpamba'));
alter table public.invoices add column if not exists payment_reference text;
alter table public.invoice_lines add column if not exists discount_amount numeric not null default 0;
create table if not exists public.invoice_delivery_events (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), invoice_id uuid not null references public.invoices(id) on delete cascade,
 event_type text not null check(event_type in ('sent','opened','viewed','reminder')), reminder_stage text, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.recurring_invoices (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), template_invoice_id uuid not null references public.invoices(id), frequency text not null check(frequency in ('monthly','quarterly')), next_run_date date not null, auto_send boolean not null default true, active boolean not null default true, created_at timestamptz not null default now()
);
create index if not exists invoice_delivery_events_invoice_idx on public.invoice_delivery_events(invoice_id, occurred_at);
create index if not exists recurring_invoices_due_idx on public.recurring_invoices(next_run_date) where active;
