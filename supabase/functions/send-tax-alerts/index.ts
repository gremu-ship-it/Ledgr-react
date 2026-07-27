// supabase/functions/send-tax-alerts/index.ts
//
// Run daily (see 20260727000011_schedule_send_tax_alerts.sql — pg_cron) to
// deliver the tax deadline alerts that TaxReturnRepository.scheduleAlerts()
// writes into tax_alerts at 14 / 7 / 1 days before, and on, each due date.
//
// Before this function existed, tax_alerts rows accumulated forever and
// nothing ever read them — the alerting requirement was scheduled but never
// delivered.
//
// Channels:
//   email — SendGrid, the same provider send-invoice / send-renewal-reminders
//           already use.
//   sms   — Africa's Talking, which covers Airtel Malawi and TNM. Only
//           attempted when AT credentials are configured; otherwise the row
//           is left pending rather than being marked failed, so enabling SMS
//           later picks up where it left off.
//
// Protected by a shared secret (same pattern as send-renewal-reminders)
// since it's invoked by pg_cron, not end users.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDGRID_FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'tax@ledgr.app';
const APP_URL = Deno.env.get('APP_URL') || '';
const AT_API_KEY = Deno.env.get('AFRICASTALKING_API_KEY');
const AT_USERNAME = Deno.env.get('AFRICASTALKING_USERNAME');
const AT_SENDER_ID = Deno.env.get('AFRICASTALKING_SENDER_ID') || 'Ledgr';

interface TaxAlertRow {
  id: string;
  business_id: string;
  tax_return_id: string;
  alert_type: '14_day' | '7_day' | '1_day' | 'due_date';
  channel: 'email' | 'sms';
  scheduled_for: string;
}

interface TaxReturnRow {
  id: string;
  tax_code: string;
  period_label: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  status: string;
}

const TAX_LABELS: Record<string, string> = {
  vat_standard: 'VAT',
  paye: 'PAYE',
  tpr_pension: 'Pension (TPR)',
  wht_10: 'Withholding Tax',
  wht_15: 'Withholding Tax',
  wht_20: 'Withholding Tax',
  cit: 'Corporate Income Tax',
  fbt: 'Fringe Benefits Tax',
};

const URGENCY: Record<TaxAlertRow['alert_type'], string> = {
  '14_day': 'in 14 days',
  '7_day': 'in 7 days',
  '1_day': 'tomorrow',
  due_date: 'today',
};

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function sendEmail(
  to: string,
  businessName: string,
  taxLabel: string,
  authority: string,
  alertType: TaxAlertRow['alert_type'],
  taxReturn: TaxReturnRow,
  currency: string,
): Promise<{ sent: boolean; skipped?: boolean }> {
  if (!SENDGRID_API_KEY) {
    console.warn('send-tax-alerts: SENDGRID_API_KEY not set — skipping email.');
    return { sent: false, skipped: true };
  }

  const outstanding = Number(taxReturn.amount_due) - Number(taxReturn.amount_paid);
  const when = URGENCY[alertType];
  const isDueToday = alertType === 'due_date';

  const subject = isDueToday
    ? `${taxLabel} return for ${taxReturn.period_label} is due TODAY`
    : `${taxLabel} return for ${taxReturn.period_label} is due ${when}`;

  const taxUrl = APP_URL ? `${APP_URL}/tax` : '#';
  const accent = isDueToday || alertType === '1_day' ? '#dc2626' : '#b45309';

  const html = `
    <p>Hi ${businessName} team,</p>
    <p>Your <strong>${taxLabel}</strong> return for <strong>${taxReturn.period_label}</strong>
    is due <strong style="color:${accent}">${when}</strong>, on
    <strong>${formatDate(taxReturn.due_date)}</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Amount outstanding</td>
        <td style="padding:6px 0;font-weight:600;">${formatMoney(outstanding, currency)}</td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Authority</td>
        <td style="padding:6px 0;">${authority}</td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;">Period</td>
        <td style="padding:6px 0;">${taxReturn.period_label}</td>
      </tr>
    </table>
    <p><a href="${taxUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">View in Ledgr</a></p>
    <p style="color:#6b7280;font-size:12px;">Late filing attracts penalties and interest. If you've already
    paid, mark the return as paid in Ledgr to stop these reminders.</p>
  `;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL, name: 'Ledgr Tax' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!res.ok) {
    throw new Error(`SendGrid rejected tax alert email (${res.status})`);
  }
  return { sent: true };
}

async function sendSms(
  to: string,
  taxLabel: string,
  alertType: TaxAlertRow['alert_type'],
  taxReturn: TaxReturnRow,
  currency: string,
): Promise<{ sent: boolean; skipped?: boolean }> {
  if (!AT_API_KEY || !AT_USERNAME) {
    // Leave the row pending so enabling SMS later delivers it.
    return { sent: false, skipped: true };
  }

  const outstanding = Number(taxReturn.amount_due) - Number(taxReturn.amount_paid);
  const message =
    `Ledgr: ${taxLabel} for ${taxReturn.period_label} is due ${URGENCY[alertType]} ` +
    `(${formatDate(taxReturn.due_date)}). Outstanding ${formatMoney(outstanding, currency)}.`;

  const body = new URLSearchParams({
    username: AT_USERNAME,
    to,
    message,
    from: AT_SENDER_ID,
  });

  const res = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Africa's Talking rejected SMS (${res.status})`);
  }
  return { sent: true };
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);

  // Everything due to go out today or earlier that hasn't been sent.
  // Catching up on missed days matters more than suppressing a late alert.
  const { data: alerts, error: alertErr } = await admin
    .from('tax_alerts')
    .select('id, business_id, tax_return_id, alert_type, channel, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', today);

  if (alertErr) {
    return new Response(JSON.stringify({ error: alertErr.message }), { status: 500 });
  }

  const results: { alert_id: string; success: boolean; detail?: string }[] = [];

  for (const alert of (alerts ?? []) as TaxAlertRow[]) {
    try {
      const { data: taxReturn } = await admin
        .from('tax_returns')
        .select('id, tax_code, period_label, due_date, amount_due, amount_paid, status')
        .eq('id', alert.tax_return_id)
        .maybeSingle();

      if (!taxReturn) {
        await admin.from('tax_alerts')
          .update({ status: 'failed', sent_at: new Date().toISOString() })
          .eq('id', alert.id);
        results.push({ alert_id: alert.id, success: false, detail: 'Tax return not found' });
        continue;
      }

      const tr = taxReturn as TaxReturnRow;

      // Already settled — no point nagging. Mark sent so it stops recurring.
      if (tr.status === 'paid' || tr.status === 'void') {
        await admin.from('tax_alerts')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', alert.id);
        results.push({ alert_id: alert.id, success: true, detail: `Skipped — return is ${tr.status}` });
        continue;
      }

      const { data: business } = await admin
        .from('businesses')
        .select('id, name, email, phone, country, base_currency')
        .eq('id', alert.business_id)
        .maybeSingle();

      if (!business) {
        await admin.from('tax_alerts')
          .update({ status: 'failed', sent_at: new Date().toISOString() })
          .eq('id', alert.id);
        results.push({ alert_id: alert.id, success: false, detail: 'Business not found' });
        continue;
      }

      const country = (business.country ?? '').toUpperCase();
      const authority = country === 'ZM' || country === 'ZAMBIA'
        ? 'Zambia Revenue Authority (ZRA)'
        : 'Malawi Revenue Authority (MRA)';
      const currency = business.base_currency ?? 'MWK';
      const taxLabel = TAX_LABELS[tr.tax_code] ?? tr.tax_code;

      let outcome: { sent: boolean; skipped?: boolean };

      if (alert.channel === 'sms') {
        if (!business.phone) {
          await admin.from('tax_alerts')
            .update({ status: 'failed', sent_at: new Date().toISOString() })
            .eq('id', alert.id);
          results.push({ alert_id: alert.id, success: false, detail: 'No phone number on business' });
          continue;
        }
        outcome = await sendSms(business.phone, taxLabel, alert.alert_type, tr, currency);
      } else {
        // Prefer the business contact address, fall back to the owner's login.
        let recipient: string | null = business.email || null;
        if (!recipient) {
          const { data: ownerRow } = await admin
            .from('business_users')
            .select('user_id')
            .eq('business_id', business.id)
            .eq('role', 'owner')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          if (ownerRow?.user_id) {
            const { data: authUser } = await admin.auth.admin.getUserById(ownerRow.user_id);
            recipient = authUser?.user?.email ?? null;
          }
        }
        if (!recipient) {
          await admin.from('tax_alerts')
            .update({ status: 'failed', sent_at: new Date().toISOString() })
            .eq('id', alert.id);
          results.push({ alert_id: alert.id, success: false, detail: 'No recipient email found' });
          continue;
        }
        outcome = await sendEmail(
          recipient, business.name, taxLabel, authority, alert.alert_type, tr, currency,
        );
      }

      if (outcome.skipped) {
        // Provider not configured — leave pending for a later run.
        results.push({ alert_id: alert.id, success: true, detail: `${alert.channel} provider not configured — left pending` });
        continue;
      }

      await admin.from('tax_alerts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', alert.id);
      results.push({ alert_id: alert.id, success: true });
    } catch (err) {
      await admin.from('tax_alerts')
        .update({ status: 'failed', sent_at: new Date().toISOString() })
        .eq('id', alert.id);
      results.push({ alert_id: alert.id, success: false, detail: (err as Error).message });
    }
  }

  return new Response(
    JSON.stringify({ date: today, processed: results.length, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
