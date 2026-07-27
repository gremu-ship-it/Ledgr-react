CREATE TABLE IF NOT EXISTS partner_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) DEFAULT 0,
  currency TEXT DEFAULT 'MWK',
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_invoices_partner ON partner_invoices(partner_id);
