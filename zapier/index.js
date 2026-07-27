const API_BASE = process.env.LEDGR_API_BASE || 'https://hsuhuvuxfuufrlejsatw.supabase.co/functions/v1/api/api/v1';

const authHeader = (bundle) => ({ Authorization: `Bearer ${bundle.authData.apiKey}` });
const unwrap = (response) => response.json.data;
const attrs = (resource) => ({ id: resource.id, ...(resource.attributes || {}) });

const listResource = (resource) => async (z, bundle) => {
  const response = await z.request({
    url: `${API_BASE}/${resource}`,
    headers: authHeader(bundle),
  });
  return unwrap(response).map(attrs);
};

const createResource = (resource) => async (z, bundle) => {
  const response = await z.request({
    method: 'POST',
    url: `${API_BASE}/${resource}`,
    headers: { ...authHeader(bundle), 'Content-Type': 'application/vnd.api+json' },
    body: {
      data: {
        type: resource,
        attributes: bundle.inputData,
      },
    },
  });
  return attrs(unwrap(response));
};

module.exports = {
  version: '1.0.0',
  platformVersion: require('zapier-platform-core').version,
  authentication: {
    type: 'custom',
    fields: [{ key: 'apiKey', label: 'Ledgr API Key', required: true, helpText: 'Starts with ledgr_sk_' }],
    test: async (z, bundle) => {
      const response = await z.request({ url: `${API_BASE}/accounts`, headers: authHeader(bundle) });
      return { ok: Array.isArray(response.json.data) };
    },
  },
  triggers: {
    new_invoice: {
      key: 'new_invoice',
      noun: 'Invoice',
      display: { label: 'New Invoice', description: 'Triggers when a new invoice exists in Ledgr.' },
      operation: { perform: listResource('invoices'), sample: { id: 'invoice-id', invoice_number: 'INV-0001', total_amount: 1000 } },
    },
    new_expense: {
      key: 'new_expense',
      noun: 'Expense',
      display: { label: 'New Expense', description: 'Triggers when a new expense exists in Ledgr.' },
      operation: { perform: listResource('expenses'), sample: { id: 'expense-id', expense_number: 'EXP-0001', total_amount: 500 } },
    },
    invoice_paid: {
      key: 'invoice_paid',
      noun: 'Paid Invoice',
      display: { label: 'Invoice Paid', description: 'Triggers when an invoice status is paid.' },
      operation: {
        perform: async (z, bundle) => (await listResource('invoices')(z, bundle)).filter((invoice) => invoice.status === 'paid'),
        sample: { id: 'invoice-id', invoice_number: 'INV-0001', status: 'paid' },
      },
    },
  },
  creates: {
    create_invoice: {
      key: 'create_invoice',
      noun: 'Invoice',
      display: { label: 'Create Invoice', description: 'Creates a Ledgr invoice.' },
      operation: {
        inputFields: [
          { key: 'invoice_number', required: true },
          { key: 'contact_id', required: true },
          { key: 'total_amount', required: true, type: 'number' },
          { key: 'issue_date', required: false, type: 'string' },
        ],
        perform: createResource('invoices'),
      },
    },
    record_expense: {
      key: 'record_expense',
      noun: 'Expense',
      display: { label: 'Record Expense', description: 'Creates a Ledgr expense.' },
      operation: {
        inputFields: [
          { key: 'expense_number', required: true },
          { key: 'total_amount', required: true, type: 'number' },
          { key: 'expense_date', required: false, type: 'string' },
          { key: 'notes', required: false },
        ],
        perform: createResource('expenses'),
      },
    },
  },
};
