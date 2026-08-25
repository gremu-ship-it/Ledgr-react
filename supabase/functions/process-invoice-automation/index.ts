import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { noStoreJson } from '../_shared/response.ts';

// Invoke daily from Supabase Cron with x-cron-secret. CRON_SECRET is the
// deployment-standard name; retain the legacy fallback during rollout.
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? Deno.env.get('INVOICE_CRON_SECRET');

serve(async (req) => {
  if (req.method !== 'POST') return noStoreJson({ error: 'Method not allowed' }, 405);
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return noStoreJson({ error: 'Unauthorised' }, 401);
  }

  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );
    const today = new Date().toISOString().slice(0, 10);
    const { data: invoices, error: invoiceError } = await db
      .from('invoices')
      .select('id,business_id,due_date,invoice_number,total_amount,amount_paid,contacts(email,name)')
      .in('status', ['sent', 'viewed', 'overdue', 'partially_paid'])
      .not('due_date', 'is', null);
    if (invoiceError) throw invoiceError;

    let reminders = 0;
    for (const invoice of invoices ?? []) {
      const days = Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / 86_400_000);
      const stage = days === 0
        ? 'due'
        : days === 3
          ? '3_days'
          : days === 7
            ? '7_days'
            : days === 14
              ? '14_days'
              : null;
      if (!stage) continue;

      const { data: sent } = await db
        .from('invoice_delivery_events')
        .select('id')
        .eq('invoice_id', invoice.id)
        .eq('event_type', 'reminder')
        .eq('reminder_stage', stage)
        .limit(1);
      if (sent?.length) continue;

      const { error: eventError } = await db.from('invoice_delivery_events').insert({
        business_id: invoice.business_id,
        invoice_id: invoice.id,
        event_type: 'reminder',
        reminder_stage: stage,
        metadata: {
          scheduled_for: today,
          tone: days >= 14 ? 'final' : days >= 7 ? 'urgent' : days >= 3 ? 'firm' : 'friendly',
        },
      });
      if (eventError) throw eventError;

      const { error: overdueError } = await db
        .from('invoices')
        .update({ status: days > 0 ? 'overdue' : invoice.status } as never)
        .eq('id', invoice.id)
        .eq('business_id', invoice.business_id);
      if (overdueError) throw overdueError;
      reminders += 1;
    }

    // Recurring rows are materialised as copies; a worker/admin completes
    // delivery where a recipient is available.
    const { data: recurring, error: recurringError } = await db
      .from('recurring_invoices')
      .select('*')
      .eq('active', true)
      .lte('next_run_date', today);
    if (recurringError) throw recurringError;

    for (const recurringInvoice of recurring ?? []) {
      const { data: template, error: templateError } = await db
        .from('invoices')
        .select('*')
        .eq('id', recurringInvoice.template_invoice_id)
        .eq('business_id', recurringInvoice.business_id)
        .maybeSingle();
      if (templateError) throw templateError;
      if (!template) continue;

      const next = new Date(`${recurringInvoice.next_run_date}T00:00:00Z`);
      next.setMonth(next.getMonth() + (recurringInvoice.frequency === 'quarterly' ? 3 : 1));
      const { invoice_number: templateNumber, ...templateFields } = template;
      const copy: Record<string, unknown> = { ...templateFields };
      for (const key of [
        'id',
        'created_at',
        'updated_at',
        'sent_at',
        'viewed_at',
        'amount_paid',
        'journal_entry_id',
        'credit_note_for',
        'amount_due',
      ]) delete copy[key];

      const { error: createError } = await db.from('invoices').insert({
        ...copy,
        business_id: recurringInvoice.business_id,
        invoice_number: `${templateNumber}-R${today.replaceAll('-', '')}`,
        issue_date: today,
        due_date: today,
        status: 'draft',
        amount_paid: 0,
      } as never);
      if (createError) throw createError;

      const { error: scheduleError } = await db
        .from('recurring_invoices')
        .update({ next_run_date: next.toISOString().slice(0, 10) })
        .eq('id', recurringInvoice.id)
        .eq('business_id', recurringInvoice.business_id);
      if (scheduleError) throw scheduleError;
    }

    return noStoreJson({ reminders });
  } catch (error) {
    console.error('process-invoice-automation failed', error);
    return noStoreJson({ error: 'Invoice automation failed' }, 500);
  }
});
