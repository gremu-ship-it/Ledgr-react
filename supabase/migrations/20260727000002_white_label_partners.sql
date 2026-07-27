CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  logo_url TEXT,
  primary_colour TEXT DEFAULT '#1a3a5c',
  support_email TEXT,
  app_name TEXT DEFAULT 'Ledgr',
  client_limit INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  billing_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_feature_flags (
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  PRIMARY KEY (partner_id, feature_key)
);

CREATE TABLE IF NOT EXISTS partner_clients (
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (partner_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_clients_partner ON partner_clients(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_feature_flags_partner ON partner_feature_flags(partner_id);
