// supabase/functions/export-my-data/index.ts
//
// GDPR Right to Portability — "Download my data".
//
// Scope: the requesting user's own personal data (auth + profile), plus
// FULL business data for every business where they hold the 'owner' role.
// Businesses where the user is only a member (accountant/viewer/etc.) are
// deliberately excluded — exporting another business's full financials
// just because you have read access there isn't what this feature is for.
//
// Flow:
//   1. Verify the caller's JWT, get their user id.
//   2. Fetch their auth + profile info.
//   3. Find every business they own (business_users.role = 'owner').
//   4. For each owned business, pull every business-scoped table. Any table
//      that errors (e.g. no business_id column, or doesn't apply) is
//      skipped and logged in errors.json — one bad assumption about the
//      schema should never break the whole export.
//   5. Zip it all up (JSON + CSV per table), upload to a private Storage
//      bucket, return a short-lived signed URL.
//
// Requires a private Storage bucket named "user-exports" to already exist
// (create it once in the Supabase dashboard: Storage -> New bucket ->
// name "user-exports", Public = OFF).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Every table that is scoped by business_id and should be included in a
// full export of a business the user owns. If a table listed here turns
// out not to have a business_id column (or doesn't apply), the fetch for
// it will fail gracefully and be recorded in errors.json rather than
// aborting the whole export.
const BUSINESS_TABLES = [
  'accounting_periods',
  'accounts',
  'asset_categories',
  'audit_log',
  'bank_statements',
  'bank_statement_lines',
  'branches',
  'budgets',
  'budget_lines',
  'contacts',
  'departments',
  'depreciation_schedules',
  'employees',
  'employee_allowances',
  'employee_deductions',
  'expenses',
  'expense_lines',
  'expense_payments',
  'fixed_assets',
  'inventory_balances',
  'inventory_locations',
  'invoices',
  'invoice_lines',
  'invoice_payments',
  'journal_entries',
  'journal_lines',
  'payroll_runs',
  'payroll_employee_lines',
  'product_categories',
  'products',
  'stock_movements',
  'stock_transfers',
  'stock_transfer_lines',
  'tax_configurations',
];

// ── CSV helper ────────────────────────────────────────────────────────────────

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headerSet = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) headerSet.add(key);
  const headers = Array.from(headerSet);

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Client scoped to the caller's own JWT — used only to verify identity.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    // Service-role client for the actual data pulls — safe here because
    // every query below is explicitly filtered to this user's own id or
    // to businesses they own, verified above.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const zip = new JSZip();
    const errors: { table: string; message: string }[] = [];

    // ── 1. Personal data ────────────────────────────────────────────────────

    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const { data: userProfile } = await admin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    const { data: legacyProfile } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    const personalData = {
      exported_at: new Date().toISOString(),
      account: {
        id: userId,
        email: authUser?.user?.email ?? null,
        phone: authUser?.user?.phone ?? null,
        created_at: authUser?.user?.created_at ?? null,
        last_sign_in_at: authUser?.user?.last_sign_in_at ?? null,
      },
      user_profile: userProfile ?? null,
      legacy_profile: legacyProfile ?? null,
    };
    zip.file('personal_data.json', JSON.stringify(personalData, null, 2));

    // ── 2. Businesses owned by this user ───────────────────────────────────

    const { data: ownerLinks, error: ownerErr } = await admin
      .from('business_users')
      .select('business_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .eq('is_active', true);

    if (ownerErr) {
      errors.push({ table: 'business_users', message: ownerErr.message });
    }

    const ownedBusinessIds = (ownerLinks ?? []).map((r: any) => r.business_id as string);

    const businessSummaries: { id: string; name: string; folder: string }[] = [];

    for (const businessId of ownedBusinessIds) {
      const { data: business, error: bizErr } = await admin
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .maybeSingle();

      if (bizErr || !business) {
        errors.push({ table: `businesses (${businessId})`, message: bizErr?.message ?? 'not found' });
        continue;
      }

      const safeName = String(business.name ?? businessId)
        .replace(/[^a-z0-9\-_ ]/gi, '')
        .trim()
        .replace(/\s+/g, '_') || businessId;
      const folder = `${safeName}_${businessId.slice(0, 8)}`;
      businessSummaries.push({ id: businessId, name: business.name ?? '', folder });

      zip.file(`${folder}/business.json`, JSON.stringify(business, null, 2));

      for (const table of BUSINESS_TABLES) {
        try {
          const { data: rows, error } = await admin
            .from(table)
            .select('*')
            .eq('business_id', businessId);

          if (error) {
            errors.push({ table: `${table} (${businessId})`, message: error.message });
            continue;
          }

          const safeRows = rows ?? [];
          zip.file(`${folder}/${table}.json`, JSON.stringify(safeRows, null, 2));
          zip.file(`${folder}/${table}.csv`, toCsv(safeRows));
        } catch (err) {
          errors.push({ table: `${table} (${businessId})`, message: (err as Error).message });
        }
      }
    }

    // ── 3. Manifest + errors ────────────────────────────────────────────────

    zip.file('manifest.json', JSON.stringify({
      exported_at: new Date().toISOString(),
      user_id: userId,
      businesses_included: businessSummaries,
      note: 'Only businesses where this account holds the owner role are included. ' +
            'Businesses where this account is a member (accountant/viewer/etc.) are excluded.',
    }, null, 2));

    if (errors.length > 0) {
      zip.file('errors.json', JSON.stringify(errors, null, 2));
    }

    // ── 4. Upload + signed URL ──────────────────────────────────────────────

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const path = `${userId}/${Date.now()}_ledgr_export.zip`;

    const { error: uploadErr } = await admin.storage
      .from('user-exports')
      .upload(path, zipBytes, { contentType: 'application/zip', upsert: false });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: `Upload failed: ${uploadErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('user-exports')
      .createSignedUrl(path, 3600); // 1 hour

    if (signErr || !signed) {
      return new Response(JSON.stringify({ error: `Could not create download link: ${signErr?.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      url: signed.signedUrl,
      expires_in_seconds: 3600,
      businesses_included: businessSummaries.length,
      warnings: errors.length,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});