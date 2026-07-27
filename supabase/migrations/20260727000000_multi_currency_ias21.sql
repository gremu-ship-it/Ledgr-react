-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-currency accounting engine (IAS 21)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a currency master, historical exchange-rate cache, immutable transaction
-- currency snapshots, functional-currency locking, and an audit table for manual
-- period-end FX revaluations.

create extension if not exists pgcrypto;

create table if not exists public.currencies (
  code text primary key check (code = upper(code) and char_length(code) = 3),
  name text not null,
  symbol text not null default '',
  decimal_places integer not null default 2,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  is_frankfurter_supported boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.currencies is
  'ISO 4217 currency master. Primary African currencies are pinned for Ledgr; Frankfurter-supported currencies can be fetched automatically.';

insert into public.currencies (code, name, symbol, decimal_places, is_primary, is_frankfurter_supported)
values
  ('AED','UAE Dirham','د.إ',2,false,false),('AFN','Afghan Afghani','؋',2,false,false),('ALL','Albanian Lek','L',2,false,false),('AMD','Armenian Dram','֏',2,false,false),('ANG','Netherlands Antillean Guilder','ƒ',2,false,false),('AOA','Angolan Kwanza','Kz',2,false,false),('ARS','Argentine Peso','$',2,false,false),('AUD','Australian Dollar','$',2,false,true),('AWG','Aruban Florin','ƒ',2,false,false),('AZN','Azerbaijani Manat','₼',2,false,false),
  ('BAM','Bosnia and Herzegovina Convertible Mark','KM',2,false,false),('BBD','Barbadian Dollar','$',2,false,false),('BDT','Bangladeshi Taka','৳',2,false,false),('BGN','Bulgarian Lev','лв',2,false,true),('BHD','Bahraini Dinar','.د.ب',3,false,false),('BIF','Burundian Franc','FBu',0,false,false),('BMD','Bermudian Dollar','$',2,false,false),('BND','Brunei Dollar','$',2,false,false),('BOB','Bolivian Boliviano','Bs',2,false,false),('BRL','Brazilian Real','R$',2,false,true),
  ('BSD','Bahamian Dollar','$',2,false,false),('BTN','Bhutanese Ngultrum','Nu.',2,false,false),('BWP','Botswana Pula','P',2,false,false),('BYN','Belarusian Ruble','Br',2,false,false),('BZD','Belize Dollar','$',2,false,false),('CAD','Canadian Dollar','$',2,false,true),('CDF','Congolese Franc','FC',2,false,false),('CHF','Swiss Franc','CHF',2,false,true),('CLP','Chilean Peso','$',0,false,false),('CNY','Chinese Yuan','¥',2,false,true),
  ('COP','Colombian Peso','$',2,false,false),('CRC','Costa Rican Colón','₡',2,false,false),('CUP','Cuban Peso','$',2,false,false),('CVE','Cape Verdean Escudo','$',2,false,false),('CZK','Czech Koruna','Kč',2,false,true),('DJF','Djiboutian Franc','Fdj',0,false,false),('DKK','Danish Krone','kr',2,false,true),('DOP','Dominican Peso','$',2,false,false),('DZD','Algerian Dinar','د.ج',2,false,false),('EGP','Egyptian Pound','£',2,false,false),
  ('ERN','Eritrean Nakfa','Nfk',2,false,false),('ETB','Ethiopian Birr','Br',2,false,false),('EUR','Euro','€',2,true,true),('FJD','Fijian Dollar','$',2,false,false),('FKP','Falkland Islands Pound','£',2,false,false),('GBP','British Pound','£',2,true,true),('GEL','Georgian Lari','₾',2,false,false),('GHS','Ghanaian Cedi','₵',2,false,false),('GIP','Gibraltar Pound','£',2,false,false),('GMD','Gambian Dalasi','D',2,false,false),
  ('GNF','Guinean Franc','FG',0,false,false),('GTQ','Guatemalan Quetzal','Q',2,false,false),('GYD','Guyanese Dollar','$',2,false,false),('HKD','Hong Kong Dollar','$',2,false,true),('HNL','Honduran Lempira','L',2,false,false),('HRK','Croatian Kuna','kn',2,false,false),('HTG','Haitian Gourde','G',2,false,false),('HUF','Hungarian Forint','Ft',2,false,true),('IDR','Indonesian Rupiah','Rp',2,false,true),('ILS','Israeli New Shekel','₪',2,false,true),
  ('INR','Indian Rupee','₹',2,false,true),('IQD','Iraqi Dinar','ع.د',3,false,false),('IRR','Iranian Rial','﷼',2,false,false),('ISK','Icelandic Króna','kr',0,false,true),('JMD','Jamaican Dollar','$',2,false,false),('JOD','Jordanian Dinar','د.ا',3,false,false),('JPY','Japanese Yen','¥',0,false,true),('KES','Kenyan Shilling','KSh',2,false,false),('KGS','Kyrgyzstani Som','с',2,false,false),('KHR','Cambodian Riel','៛',2,false,false),
  ('KMF','Comorian Franc','CF',0,false,false),('KPW','North Korean Won','₩',2,false,false),('KRW','South Korean Won','₩',0,false,true),('KWD','Kuwaiti Dinar','د.ك',3,false,false),('KYD','Cayman Islands Dollar','$',2,false,false),('KZT','Kazakhstani Tenge','₸',2,false,false),('LAK','Lao Kip','₭',2,false,false),('LBP','Lebanese Pound','ل.ل',2,false,false),('LKR','Sri Lankan Rupee','Rs',2,false,false),('LRD','Liberian Dollar','$',2,false,false),
  ('LSL','Lesotho Loti','L',2,false,false),('LYD','Libyan Dinar','ل.د',3,false,false),('MAD','Moroccan Dirham','د.م.',2,false,false),('MDL','Moldovan Leu','L',2,false,false),('MGA','Malagasy Ariary','Ar',2,false,false),('MKD','Macedonian Denar','ден',2,false,false),('MMK','Myanmar Kyat','K',2,false,false),('MNT','Mongolian Tögrög','₮',2,false,false),('MOP','Macanese Pataca','P',2,false,false),('MRU','Mauritanian Ouguiya','UM',2,false,false),
  ('MUR','Mauritian Rupee','₨',2,false,false),('MVR','Maldivian Rufiyaa','Rf',2,false,false),('MWK','Malawian Kwacha','MK',2,true,false),('MXN','Mexican Peso','$',2,false,true),('MYR','Malaysian Ringgit','RM',2,false,true),('MZN','Mozambican Metical','MT',2,true,false),('NAD','Namibian Dollar','$',2,false,false),('NGN','Nigerian Naira','₦',2,false,false),('NIO','Nicaraguan Córdoba','C$',2,false,false),('NOK','Norwegian Krone','kr',2,false,true),
  ('NPR','Nepalese Rupee','₨',2,false,false),('NZD','New Zealand Dollar','$',2,false,true),('OMR','Omani Rial','ر.ع.',3,false,false),('PAB','Panamanian Balboa','B/.',2,false,false),('PEN','Peruvian Sol','S/',2,false,false),('PGK','Papua New Guinean Kina','K',2,false,false),('PHP','Philippine Peso','₱',2,false,true),('PKR','Pakistani Rupee','₨',2,false,false),('PLN','Polish Złoty','zł',2,false,true),('PYG','Paraguayan Guaraní','₲',0,false,false),
  ('QAR','Qatari Riyal','ر.ق',2,false,false),('RON','Romanian Leu','lei',2,false,true),('RSD','Serbian Dinar','дин',2,false,false),('RUB','Russian Ruble','₽',2,false,false),('RWF','Rwandan Franc','FRw',0,false,false),('SAR','Saudi Riyal','ر.س',2,false,false),('SBD','Solomon Islands Dollar','$',2,false,false),('SCR','Seychellois Rupee','₨',2,false,false),('SDG','Sudanese Pound','ج.س.',2,false,false),('SEK','Swedish Krona','kr',2,false,true),
  ('SGD','Singapore Dollar','$',2,false,true),('SHP','Saint Helena Pound','£',2,false,false),('SLE','Sierra Leonean Leone','Le',2,false,false),('SOS','Somali Shilling','Sh',2,false,false),('SRD','Surinamese Dollar','$',2,false,false),('SSP','South Sudanese Pound','£',2,false,false),('STN','São Tomé and Príncipe Dobra','Db',2,false,false),('SYP','Syrian Pound','£',2,false,false),('SZL','Eswatini Lilangeni','L',2,false,false),('THB','Thai Baht','฿',2,false,true),
  ('TJS','Tajikistani Somoni','ЅМ',2,false,false),('TMT','Turkmenistan Manat','m',2,false,false),('TND','Tunisian Dinar','د.ت',3,false,false),('TOP','Tongan Paʻanga','T$',2,false,false),('TRY','Turkish Lira','₺',2,false,true),('TTD','Trinidad and Tobago Dollar','$',2,false,false),('TWD','New Taiwan Dollar','$',2,false,false),('TZS','Tanzanian Shilling','TSh',2,true,false),('UAH','Ukrainian Hryvnia','₴',2,false,false),('UGX','Ugandan Shilling','USh',0,false,false),
  ('USD','US Dollar','$',2,true,true),('UYU','Uruguayan Peso','$',2,false,false),('UZS','Uzbekistani Som','soʻm',2,false,false),('VES','Venezuelan Bolívar','Bs',2,false,false),('VND','Vietnamese Đồng','₫',0,false,false),('VUV','Vanuatu Vatu','VT',0,false,false),('WST','Samoan Tala','T',2,false,false),('XAF','Central African CFA Franc','FCFA',0,false,false),('XCD','East Caribbean Dollar','$',2,false,false),('XOF','West African CFA Franc','CFA',0,false,false),
  ('XPF','CFP Franc','₣',0,false,false),('YER','Yemeni Rial','﷼',2,false,false),('ZAR','South African Rand','R',2,true,true),('ZMW','Zambian Kwacha','ZK',2,true,false),('ZWL','Zimbabwean Dollar','$',2,false,false)
on conflict (code) do update set
  name = excluded.name,
  symbol = excluded.symbol,
  decimal_places = excluded.decimal_places,
  is_primary = excluded.is_primary,
  is_frankfurter_supported = excluded.is_frankfurter_supported,
  is_active = true;

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_currency text not null references public.currencies(code),
  to_currency text not null references public.currencies(code),
  rate numeric(20, 10) not null check (rate > 0),
  rate_date date not null,
  source text not null default 'manual' check (source in ('manual', 'frankfurter')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, from_currency, to_currency, rate_date)
);

create index if not exists idx_exchange_rates_lookup on public.exchange_rates(business_id, from_currency, to_currency, rate_date desc);
alter table public.exchange_rates enable row level security;

drop policy if exists exchange_rates_business_read on public.exchange_rates;
create policy exchange_rates_business_read on public.exchange_rates
for select using (
  business_id in (select business_id from public.business_users where user_id = auth.uid() and is_active = true)
);

drop policy if exists exchange_rates_business_write on public.exchange_rates;
create policy exchange_rates_business_write on public.exchange_rates
for insert with check (
  business_id in (select business_id from public.business_users where user_id = auth.uid() and is_active = true)
);

-- Add immutable currency snapshot columns to transactional tables. Existing
-- `currency` / `exchange_rate` columns are retained as backward-compatible
-- aliases for original currency and the rate used.
alter table if exists public.invoices
  add column if not exists exchange_rate_used numeric(20,10) generated always as (exchange_rate) stored,
  add column if not exists original_currency text references public.currencies(code),
  add column if not exists original_amount numeric(18,2),
  add column if not exists functional_currency text references public.currencies(code),
  add column if not exists functional_amount numeric(18,2),
  add column if not exists rate_date date,
  add column if not exists rate_is_stale boolean not null default false;

alter table if exists public.invoice_payments
  add column if not exists exchange_rate_used numeric(20,10) generated always as (exchange_rate) stored,
  add column if not exists original_currency text references public.currencies(code),
  add column if not exists original_amount numeric(18,2),
  add column if not exists functional_currency text references public.currencies(code),
  add column if not exists functional_amount numeric(18,2),
  add column if not exists rate_date date,
  add column if not exists rate_is_stale boolean not null default false;

alter table if exists public.expenses
  add column if not exists exchange_rate_used numeric(20,10) generated always as (exchange_rate) stored,
  add column if not exists original_currency text references public.currencies(code),
  add column if not exists original_amount numeric(18,2),
  add column if not exists functional_currency text references public.currencies(code),
  add column if not exists functional_amount numeric(18,2),
  add column if not exists rate_date date,
  add column if not exists rate_is_stale boolean not null default false;

alter table if exists public.expense_payments
  add column if not exists exchange_rate_used numeric(20,10) generated always as (exchange_rate) stored,
  add column if not exists original_currency text references public.currencies(code),
  add column if not exists original_amount numeric(18,2),
  add column if not exists functional_currency text references public.currencies(code),
  add column if not exists functional_amount numeric(18,2),
  add column if not exists rate_date date,
  add column if not exists rate_is_stale boolean not null default false;

alter table if exists public.journal_lines
  add column if not exists exchange_rate_used numeric(20,10) generated always as (exchange_rate) stored,
  add column if not exists original_currency text references public.currencies(code),
  add column if not exists original_amount numeric(18,2),
  add column if not exists functional_currency text references public.currencies(code),
  add column if not exists functional_amount numeric(18,2),
  add column if not exists rate_date date,
  add column if not exists rate_is_stale boolean not null default false;

comment on column public.invoices.exchange_rate is 'IAS 21 exchange rate used at transaction recognition (original_currency -> functional_currency). Historical transactions must never be recalculated with later rates.';
comment on column public.expenses.exchange_rate is 'IAS 21 exchange rate used at transaction recognition (original_currency -> functional_currency). Historical transactions must never be recalculated with later rates.';
comment on column public.journal_lines.exchange_rate is 'IAS 21 exchange rate used for this journal line; amount_base/functional_amount stores the functional-currency equivalent.';

create table if not exists public.fx_revaluations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  revaluation_date date not null,
  journal_entry_id uuid references public.journal_entries(id),
  reversal_entry_id uuid references public.journal_entries(id),
  total_unrealised_gain numeric(18,2) not null default 0,
  total_unrealised_loss numeric(18,2) not null default 0,
  line_count integer not null default 0,
  closing_rate_source text not null default 'manual/cache',
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, revaluation_date)
);

alter table public.fx_revaluations enable row level security;
drop policy if exists fx_revaluations_business_read on public.fx_revaluations;
create policy fx_revaluations_business_read on public.fx_revaluations
for select using (
  business_id in (select business_id from public.business_users where user_id = auth.uid() and is_active = true)
);

-- Functional currency is an IAS 21 policy choice. Ledgr sets it at onboarding
-- and locks it afterwards so old transactions remain comparable.
create or replace function public.prevent_functional_currency_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.base_currency is distinct from old.base_currency then
    raise exception 'Functional currency cannot be changed after business creation (IAS 21). Create a new business if the functional currency changes.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_functional_currency_change on public.businesses;
create trigger trg_prevent_functional_currency_change
before update of base_currency on public.businesses
for each row execute function public.prevent_functional_currency_change();

-- Backfill existing rows as functional-currency transactions at rate 1.
update public.invoices i
set original_currency = coalesce(i.original_currency, i.currency, b.base_currency),
    original_amount = coalesce(i.original_amount, i.total_amount),
    functional_currency = coalesce(i.functional_currency, b.base_currency),
    functional_amount = coalesce(i.functional_amount, i.total_amount),
    rate_date = coalesce(i.rate_date, i.issue_date),
    exchange_rate = coalesce(nullif(i.exchange_rate, 0), 1)
from public.businesses b
where i.business_id = b.id;

update public.expenses e
set original_currency = coalesce(e.original_currency, e.currency, b.base_currency),
    original_amount = coalesce(e.original_amount, e.total_amount),
    functional_currency = coalesce(e.functional_currency, b.base_currency),
    functional_amount = coalesce(e.functional_amount, e.total_amount),
    rate_date = coalesce(e.rate_date, e.expense_date),
    exchange_rate = coalesce(nullif(e.exchange_rate, 0), 1)
from public.businesses b
where e.business_id = b.id;

update public.invoice_payments p
set original_currency = coalesce(p.original_currency, p.currency, b.base_currency),
    original_amount = coalesce(p.original_amount, p.amount),
    functional_currency = coalesce(p.functional_currency, b.base_currency),
    functional_amount = coalesce(p.functional_amount, p.amount),
    rate_date = coalesce(p.rate_date, p.payment_date),
    exchange_rate = coalesce(nullif(p.exchange_rate, 0), 1)
from public.businesses b
where p.business_id = b.id;

update public.expense_payments p
set original_currency = coalesce(p.original_currency, p.currency, b.base_currency),
    original_amount = coalesce(p.original_amount, p.amount),
    functional_currency = coalesce(p.functional_currency, b.base_currency),
    functional_amount = coalesce(p.functional_amount, p.amount),
    rate_date = coalesce(p.rate_date, p.payment_date),
    exchange_rate = coalesce(nullif(p.exchange_rate, 0), 1)
from public.businesses b
where p.business_id = b.id;

-- Posted journal lines are immutable in Ledgr. Backfill only draft/unposted
-- lines; posted historical lines remain unchanged and reports coalesce their
-- existing currency/amount_base fields.
update public.journal_lines jl
set original_currency = coalesce(jl.original_currency, jl.currency, b.base_currency),
    original_amount = coalesce(jl.original_amount, jl.amount),
    functional_currency = coalesce(jl.functional_currency, b.base_currency),
    functional_amount = coalesce(jl.functional_amount, jl.amount_base),
    exchange_rate = coalesce(nullif(jl.exchange_rate, 0), 1)
from public.businesses b
where jl.business_id = b.id
  and not exists (
    select 1
    from public.journal_entries je
    where je.id = jl.journal_entry_id
      and je.status = 'posted'
  );
