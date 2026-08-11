-- Land and other indefinite-life assets must be capitalised, but they must not
-- create depreciation journals. Keep the existing depreciation_method enum for
-- backwards compatibility and persist the policy separately instead of using a
-- fake useful life or a zero depreciation rate.

alter table public.asset_categories
  add column if not exists is_depreciable boolean not null default true;

alter table public.fixed_assets
  add column if not exists is_depreciable boolean not null default true;

-- Existing Land categories were created before the policy flag existed. Link
-- them to the standard Land cost account when the business has the seeded COA
-- row, and make them non-depreciable. The account update is deliberately
-- conditional so a custom COA is never overwritten.
update public.asset_categories as category
set
  is_depreciable = false,
  asset_account_id = coalesce(category.asset_account_id, account.id),
  accumulated_dep_account_id = null,
  dep_expense_account_id = null
from public.accounts as account
where category.business_id = account.business_id
  and lower(trim(category.name)) = 'land'
  and account.code = '1511';

-- Still mark a Land category non-depreciable when its business has not seeded
-- account 1511. The Categories tab will then ask only for the cost account.
update public.asset_categories
set
  is_depreciable = false,
  accumulated_dep_account_id = null,
  dep_expense_account_id = null
where lower(trim(name)) = 'land';

-- Preserve an asset-level cost override, otherwise inherit the category's
-- standard Land account where one is available. Existing depreciation fields
-- are left intact so any historical accumulated amount can still be disposed
-- of correctly; the posting service will not add new depreciation.
update public.fixed_assets as asset
set
  is_depreciable = false,
  asset_account_id = coalesce(asset.asset_account_id, category.asset_account_id)
from public.asset_categories as category
where asset.category_id = category.id
  and lower(trim(category.name)) = 'land';

comment on column public.asset_categories.is_depreciable is
  'Whether assets in this category receive depreciation. Land is false.';
comment on column public.fixed_assets.is_depreciable is
  'Whether this asset receives depreciation. Inherited from its category by the Assets form.';
