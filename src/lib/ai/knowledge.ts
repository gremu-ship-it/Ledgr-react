import type { KnowledgeArticle } from './types';

/**
 * Support Assistant knowledge base.
 *
 * Every article is written against Ledgr's ACTUAL navigation
 * (src/components/layout/navConfig.ts) and the real field names used by the
 * pages, so a user can follow the steps literally:
 *
 *   Dashboard /dashboard          Income /income            Expenses /expenses
 *   Invoices /invoices            Payroll /payroll          Products /products
 *   Warehouse /warehouse          Transfers /transfers      Accounts /accounts
 *   Tax /tax                      Assets /assets            Capital /capital
 *   Reports /reports              Journals /journals        Bank /bank-reconcile
 *   Periods /periods              Audit log /audit          Contacts /contacts
 *   Branches /branches            Departments /departments  Ledgr AI /ai
 *   Support /support              Settings /settings        Data import /import
 *
 * Free, offline, no LLM required: `rulesProvider` scores a question against
 * `topic` (+5) and each matched `keyword` (+2).
 */
export const KNOWLEDGE_BASE: KnowledgeArticle[] = [
  {
    id: 'kb-invoice-create',
    topic: 'Creating and sending invoices',
    keywords: [
      'invoice', 'invoices', 'bill a customer', 'send invoice', 'quote',
      'proforma', 'credit note', 'invoice number', 'due date', 'email invoice',
    ],
    body: [
      '**Create an invoice** — go to **Invoices** (`/invoices`) → **New Invoice**.',
      '',
      '1. Pick the **Customer** (a contact of type *customer*; add one on the fly, or in **Contacts** → *Customers*).',
      '2. **Issue date** and **Due date** drive ageing and the overdue list. Leaving the due date blank means the invoice never counts as overdue.',
      '3. Add **lines**: description, quantity, unit price, optional discount and a **tax code** (`vat_standard` 17.5%, `vat_zero`, `vat_exempt`, or a WHT code).',
      '4. Choose a **template** (professional, minimal, ngo, government) and save.',
      '',
      'The invoice number comes from your **prefix + next number** in **Settings → Business Profile**. Saving posts the double entry (Debit Accounts Receivable, Credit Revenue + VAT control).',
      '',
      '**Send it**: open the invoice → **Send**. Ledgr emails the PDF and stamps `sent_at`; opens are tracked so you can see `viewed_at`.',
      '',
      '**Record a payment**: open the invoice → **Record payment** (amount, date, method — cash, bank transfer, cheque, Airtel Money, TNM Mpamba, card). The status moves `sent → partially_paid → paid` automatically and the receipt hits the bank/cash account you select.',
      '',
      'Quotes and proformas are *not* revenue — they are excluded from all income figures until converted to an invoice.',
    ].join('\n'),
  },
  {
    id: 'kb-expenses',
    topic: 'Recording expenses and supplier bills',
    keywords: [
      'expense', 'expenses', 'bill', 'supplier', 'receipt', 'purchase',
      'record spending', 'petty cash', 'vendor', 'payables',
    ],
    body: [
      '**Expenses** (`/expenses`) handles both kinds of spend:',
      '',
      '- **Receipt** — already paid. Status is `paid`; it reduces cash immediately.',
      '- **Bill** — a supplier invoice you still owe. Status starts `draft`, becomes `approved`, then `paid` once you record payment. Unpaid bills sit in Accounts Payable and appear in your cash-flow forecast.',
      '',
      'Fields that matter: **Expense date**, **Supplier** (a contact of type *supplier*), **Due date** (bills only), line **account** (this is what makes a category appear in reports and in "top expenses"), **tax code** and any **discount**.',
      '',
      'Attach the receipt image/PDF on the expense — it is stored with the record for MRA evidence.',
      '',
      'Draft and void expenses are excluded from every total, so a half-captured bill never distorts your profit.',
      '',
      'For a quick capture on the phone, use the **Quick expense** action on the mobile dashboard.',
    ].join('\n'),
  },
  {
    id: 'kb-bank-reconciliation',
    topic: 'Bank and mobile money reconciliation',
    keywords: [
      'reconcile', 'reconciliation', 'bank', 'statement', 'csv', 'ofx', 'mt940',
      'airtel money', 'mpamba', 'momo', 'mobile money', 'match transactions', 'unmatched',
    ],
    body: [
      '**Bank Reconciliation** lives at `/bank-reconcile` (Accounting section; requires the Growth plan or above).',
      '',
      '1. Choose the **bank / mobile money account** (any account flagged *is bank account*, plus petty cash `1110`, `1115` and mobile money `1125` / `1126`).',
      '2. **Import CSV / OFX / MT940** — Ledgr parses date, description, debit/credit and running balance.',
      '3. Match each statement line to a ledger entry: drag a line onto an entry, press **Match** on the line, or run **AI matching** to auto-suggest pairs by amount and date proximity.',
      '4. When every line is matched, **Save & lock**. The statement, its opening/closing balance and the matched lines are stored, and locked lines can no longer be edited.',
      '',
      'Airtel Money and TNM Mpamba are ordinary cash-equivalent accounts: set the *mobile money type* and number on the account in **Accounts** (`/accounts`) and reconcile them the same way.',
      '',
      'If a statement line has no ledger entry, create the missing income or expense first (or a journal in `/journals`), then re-run matching.',
    ].join('\n'),
  },
  {
    id: 'kb-reports',
    topic: 'Financial reports — P&L, balance sheet, cash flow',
    keywords: [
      'report', 'reports', 'profit and loss', 'p&l', 'income statement',
      'balance sheet', 'statement of financial position', 'cash flow',
      'trial balance', 'equity', 'export pdf', 'excel', 'csv',
    ],
    body: [
      '**Reports** (`/reports`) is IFRS-for-SMEs presentation, built from posted journals only:',
      '',
      '- **Statement of Profit or Loss** — revenue, cost of sales, gross profit, other income, operating expenses, depreciation, finance costs, tax, net profit, with a comparative period.',
      '- **Statement of Financial Position** — current/non-current assets, liabilities and equity, with a balance check.',
      '- **Cash Flow Statement** — IAS 7 indirect method: operating (net profit + depreciation ± working capital), investing (asset purchases/disposals), financing (loans, share capital, drawings).',
      '- **Statement of Changes in Equity**, **Trial Balance**, **Revenue breakdown** and **Branch performance**.',
      '',
      'Pick a period with the date range or a preset (This Month / This Quarter / This Year / Last Year). Every report exports to **PDF** and **CSV** from the header.',
      '',
      'If a figure looks wrong, check three things: the journal is **posted** (not draft), the transaction date falls inside the period, and the account is mapped to the right **subtype** in `/accounts`.',
    ].join('\n'),
  },
  {
    id: 'kb-payroll',
    topic: 'Running payroll and PAYE',
    keywords: [
      'payroll', 'salary', 'employee', 'paye', 'pension', 'tpr',
      'payslip', 'net pay', 'gross', 'deduction', 'allowance', 'pay run',
    ],
    body: [
      '**Payroll** (`/payroll`) has two tabs: **Employees** and **Payroll runs**.',
      '',
      '1. Add employees with basic salary, bank details, allowances and deductions.',
      '2. **Run payroll**: set **payroll period** (YYYY-MM), **period start/end** and **pay date**. Ledgr computes gross, PAYE from the current **PAYE bands**, TPR pension (10% employer / 5% employee) and other deductions, giving total gross, total PAYE and total net.',
      '3. The run is created as a **draft** — nothing is posted yet, so you can correct it.',
      '4. **Approve & Post** posts the payroll journal and creates the PAYE liability, which then shows up under **Tax** (`/tax`) with its filing deadline.',
      '',
      'PAYE is filed and paid by the **14th** of the following month. Approved-but-unpaid runs are treated as committed cash outflows in the Ledgr AI cash-flow forecast.',
      '',
      'Only users with the **owner**, **admin**, **accountant** or **payroll_manager** role can see or run payroll.',
    ].join('\n'),
  },
  {
    id: 'kb-team-roles',
    topic: 'Team members, roles and permissions',
    keywords: [
      'team', 'invite', 'user', 'role', 'permission', 'access', 'staff',
      'owner', 'admin', 'accountant', 'viewer', 'auditor', 'remove user',
    ],
    body: [
      'Manage people in **Settings → Team Members** (`/settings?tab=team`).',
      '',
      '**Invite** by email (they receive a link) or generate an **invite link** you can share. Choose the role at invite time — owners can assign any role; admins cannot create another admin.',
      '',
      'Common roles: **owner** (everything, including billing and deletion), **admin**, **accountant** (full books), **payroll_manager** (payroll only), **data_entry** / **sales_clerk** / **purchasing_officer** (capture only), **auditor** and **viewer** (read-only), plus specialist roles such as *inventory_manager*, *treasury_manager*, *tax_compliance_officer* and *branch_manager*.',
      '',
      'Permissions are enforced twice — in the UI and in the database with row-level security — so a viewer cannot write data even through the API.',
      '',
      'To revoke access, open the member row and **Remove**; pending invitations can be cancelled from the same screen.',
    ].join('\n'),
  },
  {
    id: 'kb-tax-compliance',
    topic: 'Tax, VAT, TPIN and MRA compliance',
    keywords: [
      'tax', 'vat', 'mra', 'tpin', 'withholding', 'wht', 'return', 'filing',
      'deadline', 'vat return', 'compliance', 'penalty', 'input tax', 'output tax',
    ],
    body: [
      '**Tax** (`/tax`) holds your tax configuration, returns and payments.',
      '',
      '- **TPIN / VAT number** and *VAT registered* live in **Settings → Business Profile**. They print on every invoice.',
      '- **Rates**: VAT standard is **17.5%**; zero-rated and exempt codes are available per line. Withholding tax codes: 10%, 15%, 20%.',
      '- **VAT returns** are generated per period: output tax (sales) minus input tax (purchases) = amount due. Filing and payment are due by the **25th** of the following month.',
      '- **PAYE** and **withholding tax** are due by the **14th** of the following month.',
      '',
      'Record the MRA acknowledgement in **filed reference** when you submit, and capture the payment against the return so the liability clears.',
      '',
      'The dashboard shows a **tax remittance** panel with what is due and when; Ledgr AI will also flag an unpaid return in your cash-flow forecast.',
    ].join('\n'),
  },
  {
    id: 'kb-data-privacy',
    topic: 'Data export, privacy, security and account deletion',
    keywords: [
      'export', 'download my data', 'gdpr', 'privacy', 'delete account',
      'security', 'mfa', '2fa', 'backup', 'audit log', 'cookies', 'session timeout',
    ],
    body: [
      '**Export everything**: **Settings → Privacy** → *Export my data*. You get a ZIP of your businesses and personal data; the link expires after one hour.',
      '',
      '**Delete your account**: **Settings → Privacy** → *Delete account*. Deletion runs after a grace period, during which you can cancel it from the same screen.',
      '',
      '**Security**: enable **MFA** in **Settings → Security**, set an **inactivity timeout** (auto sign-out), and review **Audit log** (`/audit`) for a tamper-evident, hash-chained history of who changed what.',
      '',
      '**Cookies**: managed by the consent banner and **Settings → Privacy**. Ledgr stores no advertising cookies.',
      '',
      'Your data is isolated per business by row-level security — another tenant literally cannot read your rows, and neither can the AI assistant.',
    ].join('\n'),
  },
  {
    id: 'kb-connect-accounts',
    topic: 'Connecting accounts, imports, API and integrations',
    keywords: [
      'connect', 'import', 'migrate', 'api', 'api key', 'webhook', 'zapier',
      'chart of accounts', 'opening balance', 'csv import', 'integration',
    ],
    body: [
      '**Chart of accounts**: `/accounts`. New businesses get a seeded chart; add accounts with a **code**, **type** (asset/liability/equity/income/expense), **subtype**, and tick *is bank account* for banks. Set an **opening balance** and its date so historical balances are right from day one.',
      '',
      '**Bring in existing data**: **Data import** (`/import`) accepts CSV for contacts, products, invoices and expenses. Map your columns, preview, then commit.',
      '',
      '**API**: create a key in **Settings → API & Webhooks** (`/settings?tab=api`), read the reference at `/api-docs`. Keys are scoped to one business and rate-limited.',
      '',
      '**Webhooks**: subscribe to invoice/expense/payment events in the same tab; failed deliveries are retried automatically.',
      '',
      '**Zapier**: `/zapier` walks through connecting Ledgr to 5,000+ apps using an API key.',
    ].join('\n'),
  },
  {
    id: 'kb-dashboard-ai',
    topic: 'Dashboard, Ledgr AI and getting started',
    keywords: [
      'dashboard', 'getting started', 'setup', 'onboarding', 'ledgr ai',
      'assistant', 'insights', 'forecast', 'what can you do', 'help',
    ],
    body: [
      '**Dashboard** (`/dashboard`) shows month-to-date revenue, expenses, net profit, cash position, outstanding receivables and recent transactions, plus quick actions for income, expenses and invoices.',
      '',
      '**Ledgr AI** (`/ai`) answers questions against your live books: performance, overdue invoices, top expenses and customers, anomalies, cash-flow forecasts and specific improvement advice. Every number it quotes comes from your own data.',
      '',
      'A sensible setup order for a new business:',
      '1. **Settings → Business Profile** — name, TPIN, VAT registration, financial year start, invoice prefix.',
      '2. **Accounts** — check the seeded chart and set opening balances.',
      '3. **Contacts** — customers and suppliers.',
      '4. **Products** — if you sell stock.',
      '5. Start capturing **Income**, **Expenses** and **Invoices**.',
      '',
      'The onboarding checklist on the dashboard tracks the same steps.',
    ].join('\n'),
  },
  {
    id: 'kb-troubleshooting',
    topic: 'Troubleshooting errors and problems',
    keywords: [
      'error', 'broken', 'not working', 'bug', 'crash', 'blank screen',
      'cannot save', 'failed', 'stuck', 'slow', 'offline', 'sync', 'report a problem',
    ],
    body: [
      'Quick fixes that solve most issues:',
      '',
      '1. **Reload** the page — after a deployment the browser may hold an old bundle.',
      '2. **Check the offline banner**. Ledgr queues work offline and syncs when you reconnect; open the queue from the banner to see pending items.',
      '3. **"Period is locked"** — the date falls inside a closed period. Reopen it in **Periods** (`/periods`) or use a date outside it.',
      '4. **"Not authorised"** — your role lacks that permission. Ask an owner or admin (**Settings → Team Members**).',
      '5. **A report shows zero** — the journal is probably still a draft; post it in `/journals`.',
      '',
      'Still stuck? Use **Settings → Report a problem** (or the support widget in the corner) with *Report a problem* selected: recent, sanitised browser errors are attached automatically so we can diagnose it.',
    ].join('\n'),
  },
];

/** Fast lookup by id. */
export const KNOWLEDGE_BY_ID: ReadonlyMap<string, KnowledgeArticle> = new Map(
  KNOWLEDGE_BASE.map((a) => [a.id, a]),
);

/** Default suggestion chips for the support assistant (top KB topics). */
export const SUPPORT_SUGGESTIONS: string[] = [
  'How do I create and send an invoice?',
  'How do I record an expense?',
  'How do I reconcile my bank statement?',
  'How do I run payroll?',
];
