import type { Row } from '@/dal/types/database';

export interface BusinessBranding {
  id?: string;
  name: string;
  tradingName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tpin?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  baseCurrency?: string;
}

export function businessRowToBranding(b: Row<'businesses'>): BusinessBranding {
  return {
    id: b.id,
    name: b.name,
    tradingName: b.trading_name,
    logoUrl: b.logo_url,
    brandColor: b.brand_color,
    addressLine1: b.address_line1,
    addressLine2: b.address_line2,
    city: b.city,
    country: b.country,
    phone: b.phone,
    email: b.email,
    website: b.website,
    tpin: b.tpin,
    vatNumber: b.vat_number,
    registrationNumber: b.registration_number,
    baseCurrency: b.base_currency,
  };
}

export interface InvoiceLike {
  invoice_number: string;
  issue_date: string;
  due_date?: string | null;
  status: string;
  subtotal?: number | string;
  vat_amount?: number | string;
  wht_amount?: number | string;
  discount_amount?: number | string;
  total_amount: number | string;
  amount_paid?: number | string;
  currency?: string | null;
  notes?: string | null;
  terms?: string | null;
  po_number?: string | null;
}

export interface InvoiceLineLike {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  tax_amount?: number | string;
  line_total: number | string;
  product_name?: string;
  sku?: string | null;
}

export interface ContactLike {
  name: string;
  trading_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  country?: string | null;
  tpin?: string | null;
  vat_number?: string | null;
}
