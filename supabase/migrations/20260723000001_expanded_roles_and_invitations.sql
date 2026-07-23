-- ============================================================================
-- Migration: Expanded Roles & Shareable Invite Links
-- Adds: new roles to user_role enum and creates business_invitations table with RLS
-- ============================================================================

-- 1. Add enum values to user_role if not exists
-- PostgreSQL allows adding values to existing enums with ADD VALUE.
-- Since ALTER TYPE ... ADD VALUE cannot be executed inside a transaction block in some Postgres versions,
-- we execute them individually.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'data_entry';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'inventory_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sales_clerk';

-- 2. Create business_invitations table
CREATE TABLE business_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email        TEXT,
  role         user_role NOT NULL,
  token        TEXT NOT NULL UNIQUE,
  invited_by   UUID,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at  TIMESTAMPTZ,
  accepted_by  UUID
);

-- 3. Create indexes for performance
CREATE INDEX idx_business_invitations_token ON business_invitations(token);
CREATE INDEX idx_business_invitations_business ON business_invitations(business_id);
CREATE INDEX idx_business_invitations_email ON business_invitations(lower(email));

-- 4. Enable RLS and define access policies
ALTER TABLE business_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_invitations_business_access ON business_invitations
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM business_users
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
