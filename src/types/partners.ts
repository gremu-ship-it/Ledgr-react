export interface Partner {
  id: string;
  name: string;
  domain?: string | null;
  logo_url?: string | null;
  primary_colour: string;
  support_email?: string | null;
  app_name: string;
  client_limit: number;
  is_active: boolean;
  billing_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerFeatureFlag {
  partner_id: string;
  feature_key: string;
  enabled: boolean;
}

export interface CreatePartnerDto {
  name: string;
  domain?: string;
  logo_url?: string;
  primary_colour?: string;
  support_email?: string;
  app_name?: string;
  client_limit?: number;
  billing_email?: string;
  is_active?: boolean;
}

export interface UpdatePartnerDto extends Partial<CreatePartnerDto> {}
