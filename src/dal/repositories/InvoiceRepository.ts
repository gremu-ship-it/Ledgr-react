// ... existing code ...

import { triggerWebhook } from '@/services/webhook/webhook-triggers';

// After creating an invoice
export async function createInvoice(...) {
  const invoice = await ...create...

  // Fire webhook
  await triggerWebhook(businessId, 'invoice.created', invoice);

  return invoice;
}

// After marking invoice as paid
export async function recordPayment(...) {
  const payment = await ...record...

  if (invoice.status === 'paid') {
    await triggerWebhook(businessId, 'invoice.paid', invoice);
  }

  return payment;
}