# Brand Color & Logo Setup Guide

## Overview
This implementation adds dynamic brand colors and logo upload functionality to Ledgr. Users can now:
1. Set their brand color in Settings → Business Profile
2. Upload a business logo that appears in invoices and the app sidebar
3. See their brand colors applied throughout the app (buttons, accents, reports, etc.)

## What's Been Implemented

### 1. Dynamic Brand Color System
- **File**: `src/lib/brandColors.ts`
- Generates a full color scale (50-950 shades) from a single hex color
- Uses HSL manipulation to create perceptually balanced light/dark variations
- Automatically applies colors as CSS custom properties

### 2. Brand Theme Hook
- **File**: `src/hooks/useBrandTheme.ts`
- Fetches business data and applies brand colors globally
- Exposes `logoUrl`, `businessName`, `tradingName` for components to use
- Automatically updates when business data changes

### 3. App Layout Integration
- **File**: `src/components/layout/AppLayout.tsx`
- Calls `useBrandTheme()` to apply brand colors throughout the app
- Colors update dynamically when user switches businesses

### 4. Sidebar Logo Display
- **File**: `src/components/layout/Sidebar.tsx`
- Shows uploaded logo in the sidebar header
- Falls back to first letter of business name if no logo uploaded
- Logo appears in the colored badge area

### 5. Settings Page Enhancements
- **File**: `src/pages/SettingsPage.tsx`
- Added logo upload UI with:
  - File picker (accepts PNG, JPEG, SVG, WebP)
  - 2MB file size limit
  - Preview of current logo
  - Remove logo button
  - Brand color preview showing the full color scale
- Logo uploads to Supabase Storage bucket: `business-logos`

### 6. Invoice Branding
- **File**: `src/pages/InvoicesPage.tsx`
- Invoice detail view now shows:
  - Business logo (or first letter fallback)
  - Business name (trading name if available)
  - Business address, phone, email, TPIN
  - Brand-colored business name heading
  - Professional invoice layout with logo and business info

## Supabase Setup Required

### Create Storage Bucket
You need to create a `business-logos` bucket in your Supabase project:

1. Go to your Supabase project dashboard
2. Navigate to **Storage** in the left sidebar
3. Click **New Bucket**
4. Name it: `business-logos`
5. Set it to **Public** (so logos can be displayed without auth)
6. Add these storage policies:

#### Policy 1: Allow authenticated users to upload
```sql
CREATE POLICY "Allow authenticated users to upload logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'business-logos');
```

#### Policy 2: Allow public read access
```sql
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'business-logos');
```

#### Policy 3: Allow users to update their own logos
```sql
CREATE POLICY "Allow users to update their logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'business-logos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'business-logos');
```

#### Policy 4: Allow users to delete their own logos
```sql
CREATE POLICY "Allow users to delete their logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'business-logos' AND (storage.foldername(name))[1] = auth.uid()::text);
```

**Note**: The storage path structure is `{business_id}/logo-{timestamp}.{ext}`, so you may want to adjust the policies to check business ownership instead of user ID. You can modify the policies to check if the user has access to the business via the `business_users` table.

## How It Works

### Brand Color Flow
1. User picks a color in Settings → Business Profile
2. Color is saved to `businesses.brand_color` in the database
3. `useBrandTheme()` hook fetches the business data
4. Hook calls `applyBrandColors()` which:
   - Converts hex to HSL
   - Generates a full 50-950 shade scale
   - Sets CSS custom properties on `:root`
5. Tailwind utility classes (e.g., `bg-brand-500`) automatically pick up the new values
6. All components using brand classes update immediately

### Logo Flow
1. User uploads logo in Settings → Business Profile
2. File is uploaded to Supabase Storage at `business-logos/{business_id}/logo-{timestamp}.{ext}`
3. Public URL is retrieved and saved to `businesses.logo_url`
4. `useBrandTheme()` hook exposes the logo URL
5. Components (Sidebar, InvoiceDetail) display the logo
6. Logo appears throughout the app where branding is shown

## Files Changed
- `src/lib/brandColors.ts` (new) — hex → full color scale generator
- `src/hooks/useBrandTheme.ts` (new) — applies brand colors globally
- `src/components/reports/ReportHeader.tsx` (new) — reusable branded header for all reports
- `src/components/layout/AppLayout.tsx` (modified) — calls `useBrandTheme()`
- `src/components/layout/Sidebar.tsx` (modified) — shows logo / brand initial
- `src/pages/SettingsPage.tsx` (modified) — logo upload UI + brand color preview
- `src/pages/InvoicesPage.tsx` (modified) — branded invoice header with logo
- `src/pages/ReportsPage.tsx` (modified) — Trial Balance uses branded header
- `src/components/reports/StatementOfFinancialPosition.tsx` (modified) — uses ReportHeader
- `src/components/reports/StatementOfProfitOrLoss.tsx` (modified) — uses ReportHeader
- `src/components/reports/CashFlowStatement.tsx` (modified) — uses ReportHeader
- `src/components/reports/StatementOfChangesInEquity.tsx` (modified) — uses ReportHeader

## Testing
1. Go to Settings → Business Profile
2. Pick a brand color and click "Save Changes"
3. Verify the color updates throughout the app (buttons, accents, sidebar)
4. Upload a logo image
5. Verify the logo appears in the sidebar
6. Create/view an invoice to see the logo and business info displayed
7. Switch businesses (if you have multiple) to verify colors/logos update per business

## Future Enhancements
- Add logo to reports (Statement of Financial Position, Profit & Loss, etc.)
- Add logo to expense receipts
- Add logo to payroll payslips
- Add email template customization with logo and brand colors
- Add favicon customization based on uploaded logo
