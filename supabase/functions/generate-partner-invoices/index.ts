// supabase/functions/generate-partner-invoices/index.ts
//
// Run monthly (see schedule_generate_partner_invoices.sql — pg_cron, 1st of
// the month) to raise the partner-level invoice for every active bank/MFI
// partner. Billing in the white-label model is at the partner level: Ledgr
// invoices the bank for the number of SME clients it has on the platform,
// and the bank sets its own pricing for those clients. The SMEs themselves
// are never billed by Ledgr, so this is the only recurring billing run in
// the partner layer.
//
// Amount = partners.price_per_client × (billable clients in the period).
// A client counts for a period if it was onboarded on or before the period
// end and hasn't been unlinked — i.e. the roster as at the close of the
// period being billed.
//
// Idempotent: the unique index partner_invoices_period_key (partner_id,
// period_start) means a re-run — or a cron that fires twice — is a no-op
// rather than a double-charge, matching the de-dupe approach
// send-renewal-reminders uses via subscription_reminders_sent.
//
// Optionally emails the partner's billing contact via SendGrid (the same
// provider send-invoice and send-renewal-reminders use). Email failure
// never rolls back the invoice — the invoice existing is the source of
// truth; the email is a courtesy.
//
// Protected by a shared secret (same pattern as expire-subscriptions /
// send-renewal-reminders) since it's meant to be invoked by pg_cron, not
// by end users.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { noStoreJson } from '../_shared/response.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDGRID_FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'billing@ledgr.app';
const ADMIN_URL = Deno.env.get('PARTNER_ADMIN_URL') || '';

/** Days after the period end that payment is due. */
const PAYMENT_TERMS_DAYS = 14;

interface PartnerRow {
  id: string;
  name: string;
  price_per_client: number | string | null;
  billing_currency: string | null;
  billing_email: string | null;
  billing_contact_name: string | null;
  support_email: string | null;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The month being billed — the one that just closed. Running on 1 March
 * bills 1–28 February. An explicit `period` (YYYY-MM) in the request body
 * overrides this, for backfills and manual re-runs.
 */
function resolvePeriod(explicit?: string): { start: Date; end: Date; due: Date } {
  const now = new Date();
  let year: number;
  let monthIndex: number;

  if (explicit && /^\d{4}-\d{2}$/.test(explicit)) {
    const [y, m] = explicit.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  } else {
    // Previous calendar month, in UTC.
    year = now.getUTCFullYear();
    monthIndex = now.getUTCMonth() - 1;
  }

  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0)); // last day of month
  const due = new Date(end.getTime() + PAYMENT_TERMS_DAYS * 24 * 60 * 60 * 1000);
  return { start, end, due };
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function sendInvoiceEmail(
  partner: PartnerRow,
  to: string,
  invoiceNumber: string,
  clientCount: number,
  unitPrice: number,
  amount: number,
  currency: string,
  periodStart: string,
  periodEnd: string,
  dueDate: string,
) {
  if (!SENDGRID_API_KEY) {
    console.warn('generate-partner-invoices: SENDGRID_API_KEY not set — invoice raised, email skipped.');
    return { skipped: true };
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-MW', { year: 'numeric', month: 'long', day: 'numeric' });

  const portalUrl = ADMIN_URL ? `${ADMIN_URL}/partner-admin/partners/${partner.id}/billing` : '';

  const html = `
    <p>Hi ${partner.billing_contact_name || partner.name} team,</p>
    <p>Here is your Ledgr partner invoice <strong>${invoiceNumber}</strong> for
    ${fmt(periodStart)} – ${fmt(periodEnd)}.</p>
    <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Active client businesses</td>
        <td style="padding:6px 0;font-weight:600;">${clientCount}</td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Price per client</td>
        <td style="padding:6px 0;font-weight:600;">${money(unitPrice, currency)}</td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Total due</td>
        <td style="padding:6px 0;font-weight:700;font-size:16px;">${money(amount, currency)}</td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Payment due by</td>
        <td style="padding:6px 0;font-weight:600;">${fmt(dueDate)}</td>
      </tr>
    </table>
    ${
      portalUrl
        ? `<p><a href="${portalUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">View in partner portal</a></p>`
        : ''
    }
    <p style="color:#6b7280;font-size:12px;">Your SME clients are not billed by Ledgr — this invoice covers
    all ${clientCount} business${clientCount === 1 ? '' : 'es'} on your ${partner.name} tenant.</p>
  `;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL, name: 'Ledgr Billing' },
      subject: `Ledgr partner invoice ${invoiceNumber} — ${money(amount, currency)}`,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!res.ok) {
    throw new Error(`SendGrid rejected partner invoice email (${res.status})`);
  }
  return { sent: true };
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return noStoreJson({ error: 'Unauthorized' }, 401);
  }

  // Optional body: { period: "2026-06", dryRun: true }
  let body: { period?: string; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is the normal cron case */
  }

  const { start, end, due } = resolvePeriod(body.period);
  const periodStart = dateOnly(start);
  const periodEnd = dateOnly(end);
  const dueDate = dateOnly(due);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: partners, error: findErr } = await admin
    .from('partners')
    .select('id, name, price_per_client, billing_currency, billing_email, billing_contact_name, support_email')
    .eq('is_active', true);

  if (findErr) {
    return noStoreJson({ error: findErr.message }, 500);
  }

  const results: {
    partner_id: string;
    partner_name: string;
    success: boolean;
    invoice_number?: string;
    amount?: number;
    client_count?: number;
    detail?: string;
  }[] = [];

  for (const partner of (partners ?? []) as PartnerRow[]) {
    try {
      const unitPrice = Number(partner.price_per_client ?? 0);
      const currency = partner.billing_currency || 'MWK';

      // Roster as at the close of the billed period.
      const { count, error: countErr } = await admin
        .from('partner_clients')
        .select('business_id', { count: 'exact', head: true })
        .eq('partner_id', partner.id)
        .lte('created_at', `${periodEnd}T23:59:59.999Z`);

      if (countErr) throw new Error(countErr.message);
      const clientCount = count ?? 0;

      // Nothing to bill: no clients yet, or the partner is on a bespoke /
      // zero-rated arrangement. Skip rather than raise a zero invoice.
      if (clientCount === 0 || unitPrice <= 0) {
        results.push({
          partner_id: partner.id,
          partner_name: partner.name,
          success: true,
          client_count: clientCount,
          detail: clientCount === 0 ? 'No billable clients' : 'No price per client set',
        });
        continue;
      }

      const amount = Number((unitPrice * clientCount).toFixed(2));

      if (body.dryRun) {
        results.push({
          partner_id: partner.id,
          partner_name: partner.name,
          success: true,
          amount,
          client_count: clientCount,
          detail: 'Dry run — no invoice written',
        });
        continue;
      }

      const { data: invoice, error: insertErr } = await admin
        .from('partner_invoices')
        .insert({
          partner_id: partner.id,
          amount,
          currency,
          status: 'sent',
          period_start: periodStart,
          period_end: periodEnd,
          due_date: dueDate,
          client_count: clientCount,
          notes: `${clientCount} client${clientCount === 1 ? '' : 's'} @ ${money(unitPrice, currency)} per month`,
        })
        .select('id, invoice_number')
        .single();

      if (insertErr) {
        // Unique violation on (partner_id, period_start) — already invoiced
        // for this period, so this run is a safe no-op.
        if ((insertErr as { code?: string }).code === '23505') {
          results.push({
            partner_id: partner.id,
            partner_name: partner.name,
            success: true,
            detail: 'Already invoiced for this period',
          });
          continue;
        }
        throw new Error(insertErr.message);
      }

      // Courtesy email — a failure here must not undo the invoice.
      const recipient = partner.billing_email || partner.support_email;
      let emailDetail: string | undefined;
      if (recipient) {
        try {
          await sendInvoiceEmail(
            partner,
            recipient,
            invoice.invoice_number,
            clientCount,
            unitPrice,
            amount,
            currency,
            periodStart,
            periodEnd,
            dueDate,
          );
        } catch (mailErr) {
          emailDetail = `Invoice raised but email failed: ${(mailErr as Error).message}`;
          console.error(`generate-partner-invoices: ${emailDetail}`);
        }
      } else {
        emailDetail = 'Invoice raised; no billing email on file';
      }

      results.push({
        partner_id: partner.id,
        partner_name: partner.name,
        success: true,
        invoice_number: invoice.invoice_number,
        amount,
        client_count: clientCount,
        detail: emailDetail,
      });
    } catch (err) {
      results.push({
        partner_id: partner.id,
        partner_name: partner.name,
        success: false,
        detail: (err as Error).message,
      });
    }
  }

  return noStoreJson({
    period: { start: periodStart, end: periodEnd, due: dueDate },
    dry_run: Boolean(body.dryRun),
    processed: results.length,
    invoiced: results.filter((r) => r.invoice_number).length,
    failed: results.filter((r) => !r.success).length,
    results,
  });
});
