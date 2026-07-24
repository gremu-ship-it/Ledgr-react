-- Migration: Expanded team roles + shareable invitation links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'data_entry' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'data_entry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'supervisor' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'supervisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'inventory_manager' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'inventory_manager';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sales_clerk' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'sales_clerk';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS business_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email text,
  role user_role NOT NULL,
  token text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_invitations_token ON business_invitations(token);
CREATE INDEX IF NOT EXISTS idx_business_invitations_business ON business_invitations(business_id);
ALTER TABLE business_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_invitations_business_access ON business_invitations;
CREATE POLICY business_invitations_business_access ON business_invitations
FOR ALL USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND is_active = true))
WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND is_active = true));
