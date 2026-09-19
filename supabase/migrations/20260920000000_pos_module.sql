-- ============================================================================
-- 20260920000000_pos_module.sql
--
-- Migration: Ledgr POS Module Tables & Permissions
-- Adds: pos_shifts, pos_cash_movements, pos_settings
-- Expands: user_role enum with 'cashier', 'manager', 'stock_clerk'
-- ============================================================================

-- 1. Add enum values to user_role if not exists
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'stock_clerk';

-- 2. Create pos_shifts table
CREATE TABLE IF NOT EXISTS public.pos_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    cashier_id UUID,
    cashier_name TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    opening_cash NUMERIC NOT NULL DEFAULT 0,
    expected_cash NUMERIC NOT NULL DEFAULT 0,
    actual_cash NUMERIC,
    cash_variance NUMERIC,
    variance_reason TEXT,
    total_sales_amount NUMERIC NOT NULL DEFAULT 0,
    cash_sales_amount NUMERIC NOT NULL DEFAULT 0,
    other_sales_amount NUMERIC NOT NULL DEFAULT 0,
    refunds_amount NUMERIC NOT NULL DEFAULT 0,
    cash_in_amount NUMERIC NOT NULL DEFAULT 0,
    cash_out_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create pos_cash_movements table
CREATE TABLE IF NOT EXISTS public.pos_cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES public.pos_shifts(id) ON DELETE CASCADE,
    user_id UUID,
    user_name TEXT,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('cash_in', 'cash_out', 'petty_cash', 'safe_deposit')),
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create pos_settings table
CREATE TABLE IF NOT EXISTS public.pos_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE UNIQUE,
    enabled_payment_methods JSONB NOT NULL DEFAULT '["cash", "airtel_money", "tnm_mpamba", "bank_transfer", "card", "credit", "other"]'::jsonb,
    cashier_max_discount_percent NUMERIC NOT NULL DEFAULT 5,
    manager_max_discount_percent NUMERIC NOT NULL DEFAULT 15,
    require_approval_for_void BOOLEAN NOT NULL DEFAULT true,
    require_approval_for_refund BOOLEAN NOT NULL DEFAULT true,
    require_explanation_variance_threshold NUMERIC NOT NULL DEFAULT 1000,
    receipt_header TEXT,
    receipt_footer TEXT NOT NULL DEFAULT 'Thank you for your business!',
    show_tax_on_receipt BOOLEAN NOT NULL DEFAULT true,
    custom_role_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Enable RLS
ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_settings ENABLE ROW LEVEL SECURITY;

-- 6. Policies for pos_shifts
DROP POLICY IF EXISTS pos_shifts_select ON public.pos_shifts;
CREATE POLICY pos_shifts_select ON public.pos_shifts
    FOR SELECT USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS pos_shifts_insert ON public.pos_shifts;
CREATE POLICY pos_shifts_insert ON public.pos_shifts
    FOR INSERT WITH CHECK (public.can_write_business_data(business_id));

DROP POLICY IF EXISTS pos_shifts_update ON public.pos_shifts;
CREATE POLICY pos_shifts_update ON public.pos_shifts
    FOR UPDATE USING (public.can_write_business_data(business_id));

DROP POLICY IF EXISTS pos_shifts_delete ON public.pos_shifts;
CREATE POLICY pos_shifts_delete ON public.pos_shifts
    FOR DELETE USING (public.can_admin_business_data(business_id));

-- 7. Policies for pos_cash_movements
DROP POLICY IF EXISTS pos_cash_movements_select ON public.pos_cash_movements;
CREATE POLICY pos_cash_movements_select ON public.pos_cash_movements
    FOR SELECT USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS pos_cash_movements_insert ON public.pos_cash_movements;
CREATE POLICY pos_cash_movements_insert ON public.pos_cash_movements
    FOR INSERT WITH CHECK (public.can_write_business_data(business_id));

DROP POLICY IF EXISTS pos_cash_movements_delete ON public.pos_cash_movements;
CREATE POLICY pos_cash_movements_delete ON public.pos_cash_movements
    FOR DELETE USING (public.can_admin_business_data(business_id));

-- 8. Policies for pos_settings
DROP POLICY IF EXISTS pos_settings_select ON public.pos_settings;
CREATE POLICY pos_settings_select ON public.pos_settings
    FOR SELECT USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS pos_settings_insert ON public.pos_settings;
CREATE POLICY pos_settings_insert ON public.pos_settings
    FOR INSERT WITH CHECK (public.can_write_business_data(business_id));

DROP POLICY IF EXISTS pos_settings_update ON public.pos_settings;
CREATE POLICY pos_settings_update ON public.pos_settings
    FOR UPDATE USING (public.can_write_business_data(business_id));

DROP POLICY IF EXISTS pos_settings_delete ON public.pos_settings;
CREATE POLICY pos_settings_delete ON public.pos_settings
    FOR DELETE USING (public.can_admin_business_data(business_id));

-- 9. Grants
GRANT ALL ON TABLE public.pos_shifts TO authenticated, service_role;
GRANT ALL ON TABLE public.pos_cash_movements TO authenticated, service_role;
GRANT ALL ON TABLE public.pos_settings TO authenticated, service_role;
