-- Construction retention receivables use a distinct Chart of Accounts subtype.
ALTER TYPE public.account_subtype ADD VALUE IF NOT EXISTS 'contra_ar';
