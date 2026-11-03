-- 20261103000000_manufacturing_foundation.sql
--
-- Manufacturing Phase A — foundation. Second vertical after Construction.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds 'MANUFACTURING' to the operating-model vocabulary (the CHECK on
--      public.businesses and the validation inside create_business_with_owner
--      and update_business_operating_models, which would otherwise reject the
--      new value with 22023).
--   2. Constrains public.products.product_type to the four canonical
--      manufacturing values *plus* the legacy vocabulary the shipped UI still
--      writes (see §2 — this is deliberately additive, not a replacement).
--   3. Adds public.inventory_locations.location_type, constrained to the four
--      manufacturing store types.
--   4. Creates the manufacturing capability vocabulary and grants tables, and
--      registers the Phase-A capability `manufacturing.bom.manage`.
--   5. Creates public.provision_manufacturing_coa_accounts(business) — the
--      idempotent "WIP Inventory" Chart-of-Accounts account, first free code
--      in 1200–1299 — and backfills it for existing manufacturing businesses.
--   6. Creates public.provision_manufacturing_defaults(business, owner) — the
--      idempotent registration/settings bootstrap that creates the production
--      branch, its three typed stores (Raw Materials / Production Floor /
--      Finished Goods) and the manufacturing.bom.manage grant held by the
--      nominated owner.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No RLS policy, grant-to-table or privilege change on any existing table.
--     Both new functions are SECURITY DEFINER with explicit membership checks.
--   * public.grant_construction_procurement_capability and every other
--     construction function, table and policy is untouched. Manufacturing gets
--     its own vocabulary/grants tables rather than borrowing construction's,
--     so the two verticals cannot borrow each other's authority.
--   * capability_org_layer is not flipped. The Manufacturing workspace is gated
--     by the Enterprise plan requirement plus the organisation profile, and
--     `manufacturing` joins ALWAYS_PROFILE_GATED so it is profile-gated on both
--     switch states.
--   * No product is reclassified. The products.product_type backfill in §2
--     touches ONLY rows that already hold an unrecognised value; the
--     product/service vocabulary the shipped UI depends on is preserved.
--   * PROJECT_BASED stays inert.
--
-- Layer: schema + command migration, applied by the normal migration replay.

-- ============================================================================
-- 1. OPERATING-MODEL VOCABULARY
-- ============================================================================

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_operating_models_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_operating_models_check
  CHECK (operating_models <@ ARRAY[
    'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
    'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING'
  ]::text[]);

COMMENT ON COLUMN public.businesses.operating_models IS
  'Multi-select operating model profile; values: RETAIL, WHOLESALE, PRODUCT_SALES, SERVICE_SALES, PROJECT_BASED, GRANT_FUNDED, CONSTRUCTION, MANUFACTURING. PROJECT_BASED is reserved and inert.';

-- create_business_with_owner and update_business_operating_models validate the
-- vocabulary themselves so a bad value is reported as an actionable 22023
-- rather than as a constraint violation. Signatures are unchanged, so CREATE OR
-- REPLACE keeps the existing ACLs.

CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text,
  p_trading_name text,
  p_registration_number text,
  p_tpin text,
  p_vat_number text,
  p_vat_registered boolean,
  p_base_currency text,
  p_financial_year_start text,
  p_timezone text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_phone text,
  p_email text,
  p_brand_color text,
  p_invoice_prefix text,
  p_expense_prefix text,
  p_payroll_prefix text,
  p_organisation_type text DEFAULT 'FOR_PROFIT',
  p_operating_models text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business_id uuid;
  v_operating_models text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_distinct_models integer;
BEGIN
  IF p_organisation_type IS NULL OR p_organisation_type NOT IN (
    'FOR_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'OTHER'
  ) THEN
    RAISE EXCEPTION 'Invalid organisation_type %', p_organisation_type
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_operating_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer
    INTO v_distinct_models
    FROM unnest(v_operating_models) AS model(value);
  IF cardinality(v_operating_models) <> v_distinct_models THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.'
      USING ERRCODE = '22023';
  END IF;

  v_business_id := public._ledgr_create_business_with_owner_core(
    p_name,
    p_trading_name,
    p_registration_number,
    p_tpin,
    p_vat_number,
    p_vat_registered,
    p_base_currency,
    p_financial_year_start,
    p_timezone,
    p_address_line1,
    p_city,
    p_country,
    p_phone,
    p_email,
    p_brand_color,
    p_invoice_prefix,
    p_expense_prefix,
    p_payroll_prefix
  );

  UPDATE public.businesses
     SET organisation_type = p_organisation_type,
         operating_models = v_operating_models,
         capability_overrides = '{}'::jsonb
   WHERE id = v_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Created business % could not be updated with its profile.', v_business_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_business_operating_models(
  p_business_id      uuid,
  p_operating_models text[]
)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           text;
  v_models         text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_old            text[];
  v_distinct       integer;
  v_now            timestamptz := now();
  v_prev           text;
  v_hash           text;
  v_email          text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can change the operating models.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer INTO v_distinct FROM unnest(v_models) AS model(value);
  IF cardinality(v_models) <> v_distinct THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models
    INTO v_old
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  -- A no-op save writes nothing and audits nothing.
  IF COALESCE(v_old, ARRAY[]::text[]) = v_models THEN
    RETURN v_models;
  END IF;

  UPDATE public.businesses
     SET operating_models = v_models,
         updated_at = now()
   WHERE id = p_business_id;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT entry_hash INTO v_prev
    FROM public.audit_log
   WHERE business_id = p_business_id
   ORDER BY id DESC
   LIMIT 1;

  v_hash := public.audit_chain_hash(
    v_prev, p_business_id, v_actor, v_now,
    'business_operating_models_updated', 'businesses', p_business_id::text, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings'
  );

  -- resource_id is written as the NATIVE uuid, per 20261029000000: deployments
  -- whose audit_log.resource_id is UUID rather than the reconstructed base
  -- schema's TEXT accept it directly, and the TEXT shape still accepts the
  -- UUID value implicitly. audit_chain_hash above still takes it as text.
  INSERT INTO public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) VALUES (
    p_business_id, v_actor, v_email, 'business_operating_models_updated',
    'businesses', p_business_id, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings',
    v_now, '0.0.0.0'::inet, v_prev, v_hash
  );

  RETURN v_models;
END;
$function$;

-- ============================================================================
-- 2. products.product_type — CANONICAL MANUFACTURING VOCABULARY (ADDITIVE)
-- ============================================================================
-- The column already exists as `product_type text NOT NULL` with no default and
-- no CHECK, so it is altered in place — never re-added.
--
-- IMPORTANT — why the constraint is additive.
--   The shipped UI already uses this column as the product-vs-service
--   discriminator: ProductsPage writes 'product' and 'service'; IncomePage,
--   PosPage and QuickIncomeMobile filter on `product_type !== 'service'`; the
--   CSV import template writes 'inventory'; the demo dataset writes 'goods'.
--   Constraining the column to the four manufacturing values alone would
--   therefore (a) rewrite every existing row, silently turning every service
--   into a trading good, and (b) make ProductsPage fail with 23514 on every
--   save.
--
--   So the CHECK admits the four canonical manufacturing values AND the legacy
--   vocabulary the product still writes, and the backfill below only repairs
--   rows that hold something unrecognised. The manufacturing vocabulary is
--   authoritative for new manufacturing data; nothing that already works is
--   reclassified or locked out. Collapsing the legacy values is a deliberate,
--   separate change that belongs to the phase that migrates the products UI.

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_product_type_check;

-- Default for new rows: a good that is bought and sold without conversion.
ALTER TABLE public.products
  ALTER COLUMN product_type SET DEFAULT 'trading_good';

-- Repair only genuinely unrecognised values. Every legacy value the app writes
-- is preserved exactly as stored.
UPDATE public.products
   SET product_type = 'trading_good'
 WHERE product_type IS NULL
    OR btrim(product_type) NOT IN (
         'raw_material', 'wip', 'finished_good', 'trading_good',
         'product', 'service', 'goods', 'inventory'
       );

ALTER TABLE public.products
  ADD CONSTRAINT products_product_type_check
  CHECK (product_type IN (
    'raw_material', 'wip', 'finished_good', 'trading_good',
    'product', 'service', 'goods', 'inventory'
  ));

COMMENT ON COLUMN public.products.product_type IS
  'Manufacturing vocabulary: raw_material, wip, finished_good, trading_good. The legacy product/service/goods/inventory values are still accepted until the products UI is migrated; new manufacturing data must use the canonical four.';

-- ============================================================================
-- 3. inventory_locations.location_type — NEW COLUMN
-- ============================================================================
-- This column does not exist yet, so ADD COLUMN is correct here.

ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'warehouse'
  CONSTRAINT inventory_locations_location_type_check
  CHECK (location_type IN (
    'warehouse', 'raw_materials_store', 'production_floor', 'finished_goods_store'
  ));

-- Guard for a pre-existing column installed without the constraint.
DO $location_type$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.inventory_locations'::regclass
       AND conname = 'inventory_locations_location_type_check'
  ) THEN
    ALTER TABLE public.inventory_locations
      ADD CONSTRAINT inventory_locations_location_type_check
      CHECK (location_type IN (
        'warehouse', 'raw_materials_store', 'production_floor', 'finished_goods_store'
      ));
  END IF;
END
$location_type$;

COMMENT ON COLUMN public.inventory_locations.location_type IS
  'Store role: warehouse (default), raw_materials_store, production_floor or finished_goods_store. Manufacturing provisioning creates one of each of the last three.';

-- ============================================================================
-- 4. MANUFACTURING CAPABILITY VOCABULARY AND GRANTS
-- ============================================================================
-- Mirrors the construction pair (construction_procurement_capabilities /
-- construction_procurement_grants) rather than sharing it: authority in one
-- vertical must never be inferred from a grant in the other.

create table if not exists public.manufacturing_capabilities (
  code        text primary key,
  description text not null
);

insert into public.manufacturing_capabilities (code, description) values
  ('manufacturing.bom.manage', 'Create and maintain bills of materials: the component list and quantities that convert raw materials into a finished good.')
on conflict (code) do update set description = excluded.description;

create table if not exists public.manufacturing_capability_grants (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  user_id          uuid not null,
  capability       text not null references public.manufacturing_capabilities(code),
  granted_by       uuid not null,
  granted_at       timestamptz not null default now(),
  grant_reason     text not null,
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoked_reason   text,
  constraint chk_mfg_reason   check (length(btrim(grant_reason)) > 0),
  constraint chk_mfg_revoked  check (
    (revoked_at is null and revoked_by is null and revoked_reason is null)
    or (revoked_at is not null and revoked_reason is not null and length(btrim(revoked_reason)) > 0)
  )
);

create unique index if not exists uq_mfg_live
  on public.manufacturing_capability_grants (business_id, user_id, capability)
  where revoked_at is null;

create index if not exists idx_mfg_grants_business
  on public.manufacturing_capability_grants (business_id);

comment on table public.manufacturing_capability_grants is
  'Explicit per-business operation capability grants for manufacturing. Authority is never inferred from a role name; the holder must also be an active business member. Append-only: revocation stamps revoked_at.';

-- ── Row level security ──────────────────────────────────────────────────────
-- Static vocabulary: non-tenant reference data, readable by any signed-in
-- caller. It contains no business data.
alter table public.manufacturing_capabilities enable row level security;
do $rls$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'manufacturing_capabilities'
  loop
    execute format('drop policy if exists %I on public.manufacturing_capabilities', v_policy.policyname);
  end loop;
end
$rls$;
revoke all on public.manufacturing_capabilities from anon, authenticated;
grant select on public.manufacturing_capabilities to authenticated;
create policy manufacturing_capabilities_read
  on public.manufacturing_capabilities for select to authenticated using (true);

-- Grants are tenant data: a member may read their own business's rows only.
alter table public.manufacturing_capability_grants enable row level security;
do $rls$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'manufacturing_capability_grants'
       and policyname in ('manufacturing_capability_grants_member_read')
  loop
    execute format('drop policy if exists %I on public.manufacturing_capability_grants', v_policy.policyname);
  end loop;
end
$rls$;
revoke all on public.manufacturing_capability_grants from anon, authenticated;
grant select on public.manufacturing_capability_grants to authenticated;
create policy manufacturing_capability_grants_member_read
  on public.manufacturing_capability_grants for select to authenticated
  using (public.is_business_member(business_id));

-- ============================================================================
-- 5. WIP INVENTORY CHART-OF-ACCOUNTS ACCOUNT
-- ============================================================================
-- One account per manufacturing business. Code 1200 is the first available
-- code in the WIP range (the shipped chart ends at 1160, so 1200–1299 is
-- free); an existing chart collision is handled by choosing the next free code.
-- The account is an asset with the inventory subtype convention the shipped
-- chart already uses for stock accounts ('current_asset'), parented to the
-- 1140 Inventory group with a 1100 Current Assets fallback.

CREATE OR REPLACE FUNCTION public.provision_manufacturing_coa_accounts(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_models text[];
  v_currency text;
  v_code text;
  v_parent_id uuid;
  v_account_id uuid;
  v_existing_type text;
  v_existing_group boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models, b.base_currency
    INTO v_models, v_currency
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can provision manufacturing accounts.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT ('MANUFACTURING' = ANY (COALESCE(v_models, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'This business is not configured for manufacturing work.'
      USING ERRCODE = '22023';
  END IF;

  -- Account codes have no database uniqueness constraint. Serialize account
  -- writers while checking/inserting so a concurrent manual COA edit cannot
  -- take the same first-free manufacturing code between those steps.
  LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE;

  SELECT a.id, a.account_type::text, a.is_group
    INTO v_account_id, v_existing_type, v_existing_group
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND lower(btrim(a.name)) = lower('WIP Inventory')
     AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_account_id IS NOT NULL THEN
    IF v_existing_type <> 'asset' OR v_existing_group THEN
      RAISE EXCEPTION 'WIP Inventory must be a posting asset account.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.accounts
       SET account_subtype = 'current_asset', normal_balance = 'debit', is_active = true,
           updated_at = now()
     WHERE id = v_account_id;
    RETURN v_account_id;
  END IF;

  SELECT codes.code::text INTO v_code
    FROM generate_series(1200, 1299) AS codes(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.accounts a
      WHERE a.business_id = p_business_id
        AND btrim(a.code) = codes.code::text
        AND a.deleted_at IS NULL
   )
   ORDER BY codes.code
   LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'No available account code in the manufacturing WIP range.'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_parent_id
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND a.code = '1140'
     AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_parent_id IS NULL THEN
    SELECT a.id INTO v_parent_id
      FROM public.accounts a
     WHERE a.business_id = p_business_id
       AND a.code = '1100'
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
  END IF;

  INSERT INTO public.accounts (
    business_id, code, name, description, account_type, account_subtype,
    normal_balance, is_group, is_system, is_bank_account, currency,
    opening_balance, is_active, parent_id
  ) VALUES (
    p_business_id, v_code, 'WIP Inventory',
    'Work in progress: raw materials issued to production that have not yet been completed into finished goods.',
    'asset', 'current_asset', 'debit', false, true, false,
    COALESCE(v_currency, 'MWK'), 0, true, v_parent_id
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;
COMMENT ON FUNCTION public.provision_manufacturing_coa_accounts(uuid) IS
  'Idempotently provisions the manufacturing WIP Inventory account without changing provision_construction_defaults.';
REVOKE ALL ON FUNCTION public.provision_manufacturing_coa_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_manufacturing_coa_accounts(uuid) TO authenticated;

-- Backfill manufacturing businesses that predate this migration. This is a
-- migration-owned insert, not a change to the registration bootstrap.
DO $$
DECLARE
  v_business record;
  v_code text;
  v_parent_id uuid;
  v_existing_id uuid;
  v_existing_type text;
  v_existing_group boolean;
BEGIN
  LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE;

  FOR v_business IN
    SELECT b.id, b.base_currency
      FROM public.businesses b
     WHERE b.deleted_at IS NULL
       AND 'MANUFACTURING' = ANY (COALESCE(b.operating_models, ARRAY[]::text[]))
  LOOP
    SELECT a.id, a.account_type::text, a.is_group
      INTO v_existing_id, v_existing_type, v_existing_group
      FROM public.accounts a
     WHERE a.business_id = v_business.id
       AND lower(btrim(a.name)) = lower('WIP Inventory')
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      IF v_existing_type <> 'asset' OR v_existing_group THEN
        RAISE EXCEPTION 'WIP Inventory must be a posting asset account for manufacturing business %.', v_business.id;
      END IF;
      UPDATE public.accounts
         SET account_subtype = 'current_asset', normal_balance = 'debit', is_active = true,
             updated_at = now()
       WHERE id = v_existing_id;
      CONTINUE;
    END IF;

    SELECT codes.code::text INTO v_code
      FROM generate_series(1200, 1299) AS codes(code)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.accounts a
        WHERE a.business_id = v_business.id
          AND btrim(a.code) = codes.code::text
          AND a.deleted_at IS NULL
     )
     ORDER BY codes.code
     LIMIT 1;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'No available WIP inventory account code for manufacturing business %.', v_business.id;
    END IF;

    SELECT a.id INTO v_parent_id
      FROM public.accounts a
     WHERE a.business_id = v_business.id
       AND a.code = '1140'
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
    IF v_parent_id IS NULL THEN
      SELECT a.id INTO v_parent_id
        FROM public.accounts a
       WHERE a.business_id = v_business.id
         AND a.code = '1100'
         AND a.deleted_at IS NULL
       ORDER BY a.created_at, a.id
       LIMIT 1;
    END IF;

    INSERT INTO public.accounts (
      business_id, code, name, description, account_type, account_subtype,
      normal_balance, is_group, is_system, is_bank_account, currency,
      opening_balance, is_active, parent_id
    ) VALUES (
      v_business.id, v_code, 'WIP Inventory',
      'Work in progress: raw materials issued to production that have not yet been completed into finished goods.',
      'asset', 'current_asset', 'debit', false, true, false,
      COALESCE(v_business.base_currency, 'MWK'), 0, true, v_parent_id
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- 6. IDEMPOTENT MANUFACTURING BOOTSTRAP
-- ============================================================================
-- Called by the registration flow immediately after create_business_with_owner
-- returns, and by Settings when an existing business adds MANUFACTURING. It is
-- deliberately separate from the creation transaction: a provisioning failure
-- must not roll back the new business.
--
-- Checks (fail closed):
--   * the caller is signed in and is an active owner/admin member of the business;
--   * the nominated owner is also an active owner/admin member of that business;
--   * the business actually has MANUFACTURING selected — so this function can
--     never become a general-purpose grant injector for a retail business.
--
-- Idempotency:
--   * the branch is reused by name within the business;
--   * each store is reused by branch + name;
--   * grants rely on the live-grant unique index (uq_mfg_live), so a second
--     call inserts nothing and leaves the first bootstrap intact.
--
-- Removed operating models never revoke anything: the stores and the grant
-- created here stay in force until a human revokes them.

CREATE OR REPLACE FUNCTION public.provision_manufacturing_defaults(
  p_business_id   uuid,
  p_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor            uuid := auth.uid();
  v_role             text;
  v_owner_role       text;
  v_models           text[];
  v_branch_id        uuid;
  v_branch_created   boolean := false;
  v_locations_created integer := 0;
  v_grants_created   integer := 0;
  v_is_default       boolean;
  v_store            record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'A business and an owner are required.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models
    INTO v_models
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can provision a manufacturing workspace.'
      USING ERRCODE = '42501';
  END IF;

  v_owner_role := public._ledgr_member_role(p_business_id, p_owner_user_id);
  IF v_owner_role IS NULL OR v_owner_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Manufacturing provisioning must nominate an active owner or administrator.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT ('MANUFACTURING' = ANY (COALESCE(v_models, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'This business is not configured for manufacturing work.'
      USING ERRCODE = '22023';
  END IF;

  -- ── Main Factory branch ───────────────────────────────────────────────────
  SELECT b.id
    INTO v_branch_id
    FROM public.branches b
   WHERE b.business_id = p_business_id
     AND b.deleted_at IS NULL
     AND b.name = 'Main Factory'
   ORDER BY b.created_at
   LIMIT 1;

  IF v_branch_id IS NULL THEN
    INSERT INTO public.branches (business_id, name, code, is_active)
    VALUES (p_business_id, 'Main Factory', 'FACTORY', true)
    RETURNING id INTO v_branch_id;
    v_branch_created := true;
  END IF;

  -- ── The three typed stores ────────────────────────────────────────────────
  -- One store per stage of the production flow. Only the first store ever
  -- created for the business claims the default flag, so provisioning can never
  -- produce two default locations.
  FOR v_store IN
    SELECT * FROM (VALUES
      ('Raw Materials Store',   'raw_materials_store'),
      ('Production Floor',      'production_floor'),
      ('Finished Goods Store',  'finished_goods_store')
    ) AS t(store_name, store_type)
  LOOP
    IF EXISTS (
      SELECT 1
        FROM public.inventory_locations l
       WHERE l.business_id = p_business_id
         AND l.branch_id = v_branch_id
         AND l.name = v_store.store_name
    ) THEN
      CONTINUE;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM public.inventory_locations
       WHERE business_id = p_business_id AND is_default
    ) INTO v_is_default;

    INSERT INTO public.inventory_locations
      (business_id, branch_id, name, is_default, is_active, location_type)
    VALUES
      (p_business_id, v_branch_id, v_store.store_name, v_is_default, true, v_store.store_type);

    v_locations_created := v_locations_created + 1;
  END LOOP;

  -- ── The manufacturing.bom.manage grant ────────────────────────────────────
  -- Inserted directly, mirroring the construction bootstrap: this is a
  -- one-time system event for the owner who just created the business, not a
  -- grant administration decision.
  INSERT INTO public.manufacturing_capability_grants
    (business_id, user_id, capability, granted_by, granted_at, grant_reason)
  VALUES (
    p_business_id,
    p_owner_user_id,
    'manufacturing.bom.manage',
    p_owner_user_id,
    now(),
    'Automatic provisioning for manufacturing business at registration'
  )
  ON CONFLICT (business_id, user_id, capability) WHERE revoked_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_grants_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'branch_id', v_branch_id,
    'branch_created', v_branch_created,
    'locations_created', v_locations_created,
    'grants_created', v_grants_created,
    'locations_in_force', (
      SELECT count(*)
        FROM public.inventory_locations l
       WHERE l.business_id = p_business_id
         AND l.location_type IN ('raw_materials_store', 'production_floor', 'finished_goods_store')
    ),
    'grants_in_force', (
      SELECT count(*)
        FROM public.manufacturing_capability_grants g
       WHERE g.business_id = p_business_id
         AND g.user_id = p_owner_user_id
         AND g.revoked_at IS NULL
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_manufacturing_defaults(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_manufacturing_defaults(uuid, uuid) TO authenticated;

-- ============================================================================
-- 7. SELF-VERIFICATION
-- ============================================================================
-- Fails the migration (and therefore the replay) if a later edit weakens the
-- vocabulary, drops a constraint, exposes a new write path, or leaves the
-- bootstrap non-idempotent.

DO $verify$
DECLARE
  v_missing text := '';
  v_def     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.businesses'::regclass
       AND conname = 'businesses_operating_models_check'
       AND pg_get_constraintdef(oid) LIKE '%MANUFACTURING%'
  ) THEN
    v_missing := v_missing || 'businesses_operating_models_check does not allow MANUFACTURING; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_product_type_check'
       AND pg_get_constraintdef(oid) LIKE '%raw_material%'
       AND pg_get_constraintdef(oid) LIKE '%finished_good%'
  ) THEN
    v_missing := v_missing || 'products_product_type_check is missing or incomplete; ';
  END IF;

  -- The legacy vocabulary must survive: constraining the column to the four
  -- manufacturing values alone breaks the shipped products UI.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_product_type_check'
       AND pg_get_constraintdef(oid) LIKE '%''service''%'
  ) THEN
    v_missing := v_missing || 'products_product_type_check no longer accepts the legacy service value; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'inventory_locations'
       AND column_name = 'location_type'
       AND is_nullable = 'NO'
  ) THEN
    v_missing := v_missing || 'inventory_locations.location_type is missing or nullable; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.inventory_locations'::regclass
       AND conname = 'inventory_locations_location_type_check'
       AND pg_get_constraintdef(oid) LIKE '%production_floor%'
  ) THEN
    v_missing := v_missing || 'inventory_locations_location_type_check is missing or incomplete; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_mfg_live'
  ) THEN
    v_missing := v_missing || 'the live-grant unique index is missing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_capabilities WHERE code = 'manufacturing.bom.manage'
  ) THEN
    v_missing := v_missing || 'manufacturing.bom.manage is not registered; ';
  END IF;

  IF to_regprocedure('public.provision_manufacturing_defaults(uuid,uuid)') IS NULL THEN
    v_missing := v_missing || 'provision_manufacturing_defaults(uuid,uuid) is missing; ';
  ELSE
    SELECT p.prosecdef::text || '|' || pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.provision_manufacturing_defaults(uuid,uuid)');
    IF v_def NOT LIKE 'true|%' THEN
      v_missing := v_missing || 'provision_manufacturing_defaults is not SECURITY DEFINER; ';
    END IF;
    IF v_def NOT LIKE '%''MANUFACTURING'' = ANY%' THEN
      v_missing := v_missing || 'provision_manufacturing_defaults does not require the MANUFACTURING model; ';
    END IF;
    IF v_def NOT ILIKE '%where revoked_at is null%' THEN
      v_missing := v_missing || 'provision_manufacturing_defaults has no partial-index conflict target; ';
    END IF;
    IF v_def NOT LIKE '%raw_materials_store%' OR v_def NOT LIKE '%production_floor%'
       OR v_def NOT LIKE '%finished_goods_store%' THEN
      v_missing := v_missing || 'provision_manufacturing_defaults does not create all three typed stores; ';
    END IF;
  END IF;

  IF to_regprocedure('public.provision_manufacturing_coa_accounts(uuid)') IS NULL
     OR NOT (SELECT p.prosecdef FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.provision_manufacturing_coa_accounts(uuid)')) THEN
    v_missing := v_missing || 'provision_manufacturing_coa_accounts(uuid) is missing or not SECURITY DEFINER; ';
  END IF;

  -- No new write path: authenticated keeps SELECT-only access to the grants table.
  IF has_table_privilege('authenticated', 'public.manufacturing_capability_grants', 'insert')
     OR has_table_privilege('authenticated', 'public.manufacturing_capability_grants', 'update')
     OR has_table_privilege('authenticated', 'public.manufacturing_capability_grants', 'delete') THEN
    v_missing := v_missing || 'authenticated gained a write privilege on manufacturing_capability_grants; ';
  END IF;

  -- The new functions are callable by authenticated only.
  IF has_function_privilege('anon', 'public.provision_manufacturing_defaults(uuid,uuid)', 'execute')
     OR has_function_privilege('anon', 'public.provision_manufacturing_coa_accounts(uuid)', 'execute') THEN
    v_missing := v_missing || 'anon can execute a manufacturing provisioning function; ';
  END IF;

  -- Rewriting update_business_operating_models must preserve the 20261029000000
  -- forward fix: the audit row's resource_id stays the NATIVE uuid, because
  -- deployments whose audit_log.resource_id is UUID (not the reconstructed base
  -- schema's TEXT) reject the ::text cast with 42804. Superseding that form here
  -- would break operating-model auditing on exactly those deployments.
  IF to_regprocedure('public.update_business_operating_models(uuid,text[])') IS NULL THEN
    v_missing := v_missing || 'update_business_operating_models(uuid,text[]) is missing; ';
  ELSE
    SELECT pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.update_business_operating_models(uuid,text[])');
    IF position('''businesses'', p_business_id, NULL' IN v_def) = 0 THEN
      v_missing := v_missing || 'update_business_operating_models no longer writes the native-uuid audit resource_id; ';
    END IF;
    IF position('''MANUFACTURING''' IN v_def) = 0 THEN
      v_missing := v_missing || 'update_business_operating_models does not accept MANUFACTURING; ';
    END IF;
  END IF;

  -- Construction is untouched: its vocabulary and bootstrap survive unchanged.
  IF to_regprocedure('public.provision_construction_defaults(uuid,uuid)') IS NULL THEN
    v_missing := v_missing || 'provision_construction_defaults was removed; ';
  END IF;
  IF to_regprocedure('public.grant_construction_procurement_capability(uuid,uuid,text,text)') IS NULL THEN
    v_missing := v_missing || 'grant_construction_procurement_capability was removed; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Manufacturing foundation not applied correctly: %', v_missing
      USING ERRCODE = '42501';
  END IF;
END
$verify$;
