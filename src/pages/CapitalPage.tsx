import { useState, useMemo, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Search, AlertCircle, CheckCircle, Loader2,
  Landmark, Coins, TrendingUp, ArrowDownCircle, ArrowUpCircle,
  Wallet, Receipt, Printer, FileDown,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, AccountSubtype, LoanStatus, ShareTransactionType } from '@/dal/types/database';
import {
  createLoan, recordLoanRepayment, recordShareTransaction,
  type CreateLoanInput, type RecordRepaymentInput, type RecordShareInput,
} from '@/services/CapitalJournalService';

// ── Constants ─────────────────────────────────────────────────────────────────

const LOAN_SUBTYPES = new Set<AccountSubtype>(['non_current_liability', 'current_liability']);
const BANK_SUBTYPES = new Set<AccountSubtype>(['current_asset']);
const SHARE_SUBTYPES = new Set<AccountSubtype>(['share_capital']);
const INTEREST_SUBTYPES = new Set<AccountSubtype>(['finance_cost', 'operating_expense']);

function hasSubtype(a: Row<'accounts'>, set: Set<AccountSubtype>): boolean {
  return a.account_subtype != null && set.has(a.account_subtype);
}

const LOAN_STATUSES: { value: LoanStatus; label: string; color: string }[] = [
  { value: 'active',    label: 'Active',    color: 'bg-brand-50 text-brand-700' },
  { value: 'paid_off',  label: 'Paid Off',  color: 'bg-emerald-50 text-emerald-700' },
  { value: 'defaulted', label: 'Defaulted', color: 'bg-red-50 text-red-600' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
];

function loanStatusColor(s: string) {
  return LOAN_STATUSES.find((x) => x.value === s)?.color ?? 'bg-gray-100 text-gray-500';
}
function loanStatusLabel(s: string) {
  return LOAN_STATUSES.find((x) => x.value === s)?.label ?? s;
}

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── CSV Export helpers ──────────────────────────────────────────────────────────

function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportLoansCsv(
  loans: Row<'loans'>[],
  repayments: Row<'loan_repayments'>[],
) {
  const repaidByLoan = new Map<string, number>();
  repayments.forEach((r) => repaidByLoan.set(r.loan_id, (repaidByLoan.get(r.loan_id) ?? 0) + Number(r.principal_portion)));

  const headers = ['Lender', 'Principal (MK)', 'Repaid (MK)', 'Outstanding (MK)', 'Rate (%)', 'Term (months)', 'Start Date', 'Status'];
  const rows = loans.map((l) => {
    const repaid = repaidByLoan.get(l.id) ?? 0;
    const outstanding = Number(l.principal_amount) - repaid;
    return [
      l.lender_name,
      String(Number(l.principal_amount).toFixed(2)),
      String(repaid.toFixed(2)),
      String(outstanding.toFixed(2)),
      l.interest_rate_pct != null ? String(l.interest_rate_pct) : '',
      l.term_months != null ? String(l.term_months) : '',
      l.start_date,
      loanStatusLabel(l.status),
    ];
  });
  downloadCsv(headers, rows, `loans_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportSharesCsv(shares: Row<'share_transactions'>[]) {
  const headers = ['Shareholder', 'Type', 'Shares', 'Amount (MK)', 'Date', 'Reference'];
  const rows = shares.map((s) => [
    s.shareholder_name,
    s.transaction_type === 'issue' ? 'Shares In' : 'Shares Out',
    s.shares_count != null ? String(Number(s.shares_count)) : '',
    String(Number(s.amount).toFixed(2)),
    s.created_at.slice(0, 10),
    s.reference ?? '',
  ]);
  downloadCsv(headers, rows, `share_capital_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Repayment Schedule (printable, opens in new tab) ───────────────────────────

function openRepaymentSchedule(
  loan: Row<'loans'>,
  repayments: Row<'loan_repayments'>[],
) {
  const principal = Number(loan.principal_amount);
  const ratePct = loan.interest_rate_pct != null ? Number(loan.interest_rate_pct) : null;
  const term = loan.term_months != null ? Number(loan.term_months) : null;

  // Build amortisation rows
  interface ScheduleRow {
    date: string;
    type: 'actual' | 'projected';
    principal: number;
    interest: number;
    total: number;
    balance: number;
  }

  const schedule: ScheduleRow[] = [];
  let remaining = principal;

  // Determine monthly payment if we have rate + term
  let monthlyPayment: number | null = null;
  if (ratePct != null && term != null && term > 0 && ratePct > 0) {
    const monthlyRate = ratePct / 100 / 12;
    monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, term)) / (Math.pow(1 + monthlyRate, term) - 1);
  }

  // Collect actual repayment dates that have been recorded
  const recordedDates = new Set(repayments.map((r) => r.repayment_date));
  let runningBalance = principal;

  // Show actual repayments first
  const sortedActual = [...repayments].sort((a, b) => a.repayment_date.localeCompare(b.repayment_date));
  for (const r of sortedActual) {
    const p = Number(r.principal_portion);
    const i = Number(r.interest_portion);
    runningBalance -= p;
    schedule.push({
      date: r.repayment_date,
      type: 'actual',
      principal: p,
      interest: i,
      total: Number(r.amount),
      balance: Math.max(0, runningBalance),
    });
    remaining = runningBalance;
  }

  // Project future payments if we have terms and remaining balance
  if (monthlyPayment != null && term != null && remaining > 0.01) {
    const doneCount = schedule.length;
    const remainingMonths = term - doneCount;
    let projectedBalance = remaining;

    // Start from the next month after the last actual repayment, or first payment date, or start date
    let cursor = new Date(loan.first_payment_date || loan.start_date);
    // Advance cursor by doneCount months from first payment date
    if (doneCount > 0) {
      cursor = new Date(cursor);
      cursor.setMonth(cursor.getMonth() + doneCount);
    }

    // Normalise to first of month for projection
    for (let m = 0; m < Math.max(remainingMonths, 0); m++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      // Skip if this month already has an actual repayment
      if (recordedDates.has(dateStr)) {
        cursor.setMonth(cursor.getMonth() + 1);
        continue;
      }

      const interestPart = projectedBalance * (ratePct! / 100 / 12);
      const principalPart = Math.min(monthlyPayment - interestPart, projectedBalance);
      projectedBalance -= principalPart;

      schedule.push({
        date: dateStr,
        type: 'projected',
        principal: Math.max(0, principalPart),
        interest: Math.max(0, interestPart),
        total: principalPart + interestPart,
        balance: Math.max(0, projectedBalance),
      });

      if (projectedBalance < 0.01) break;
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Compute totals
  const totals = schedule.reduce(
    (acc, r) => ({
      principal: acc.principal + r.principal,
      interest: acc.interest + r.interest,
      total: acc.total + r.total,
    }),
    { principal: 0, interest: 0, total: 0 },
  );

  // Open a new tab with the printable schedule
  const win = window.open('', '_blank');
  if (!win) return; // popup blocked

  const rowsHtml = schedule
    .map(
      (r, i) => `<tr${i % 2 === 0 ? '' : ' class="alt"'}>
        <td>${r.date}</td>
        <td class="${r.type}">${r.type === 'actual' ? 'Actual' : 'Projected'}</td>
        <td class="num">${formatMwk(r.principal)}</td>
        <td class="num">${formatMwk(r.interest)}</td>
        <td class="num">${formatMwk(r.total)}</td>
        <td class="num">${formatMwk(r.balance)}</td>
      </tr>`,
    )
    .join('\n');

  const rateDisplay = ratePct != null ? `${ratePct}% p.a.` : '—';
  const termDisplay = term != null ? `${term} months` : '—';

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repayment Schedule — ${loan.lender_name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 40px; color: #111; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header .meta { margin-top: 8px; font-size: 13px; color: #555; }
    .header .meta span { display: inline-block; margin-right: 24px; }
    .header .actions button { padding: 8px 20px; font-size: 13px; font-weight: 600; border: 1px solid #bbb; border-radius: 6px; background: #f5f5f5; cursor: pointer; }
    .header .actions button:hover { background: #e8e8e8; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f0f4f8; text-align: left; padding: 10px 12px; font-weight: 600; color: #333; border-bottom: 2px solid #ddd; }
    td { padding: 9px 12px; border-bottom: 1px solid #eee; }
    tr.alt td { background: #fafafa; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.actual { font-size: 11px; color: #059669; font-weight: 500; }
    td.projected { font-size: 11px; color: #888; }
    .summary { margin-top: 20px; display: flex; gap: 40px; font-size: 13px; }
    .summary div { padding: 12px 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }
    .summary .label { font-size: 11px; color: #666; margin-bottom: 2px; }
    .summary .value { font-size: 16px; font-weight: 700; }
    .footer { margin-top: 32px; font-size: 11px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 16px; text-align: center; }
    @media print {
      .actions { display: none !important; }
      body { padding: 20px; }
      th { background: #eef2f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr.alt td { background: #f8f8f8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${loan.lender_name} — Repayment Schedule</h1>
      <div class="meta">
        <span><strong>Principal:</strong> ${formatMwk(principal)}</span>
        <span><strong>Interest Rate:</strong> ${rateDisplay}</span>
        <span><strong>Term:</strong> ${termDisplay}</span>
        <span><strong>Start Date:</strong> ${loan.start_date}</span>
        <span><strong>Status:</strong> ${loanStatusLabel(loan.status)}</span>
      </div>
    </div>
    <div class="actions">
      <button onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Type</th>
        <th class="num">Principal</th>
        <th class="num">Interest</th>
        <th class="num">Total</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="summary">
    <div><div class="label">Total Principal</div><div class="value">${formatMwk(totals.principal)}</div></div>
    <div><div class="label">Total Interest</div><div class="value">${formatMwk(totals.interest)}</div></div>
    <div><div class="label">Total Paid</div><div class="value">${formatMwk(totals.total)}</div></div>
  </div>

  <div class="footer">
    Generated by Ledgr on ${new Date().toLocaleDateString('en-MW', { year: 'numeric', month: 'long', day: 'numeric' })}
  </div>

  <script>
    // Auto-focus the print button for keyboard accessibility
    document.querySelector('button')?.focus();
  <\/script>
</body>
</html>`);
  win.document.close();
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

function AccountPicker({
  label, value, onChange, accounts, required, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Row<'accounts'>[];
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}{required ? ' *' : ''}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
        <option value="">{placeholder ?? 'Select account…'}</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
      </select>
    </div>
  );
}

function ModalShell({
  title, icon, onClose, children, footer,
}: {
  title: string; icon?: ReactNode; onClose: () => void;
  children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            {icon}{title}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto px-6 py-5 space-y-4">{children}</div>
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}{required ? ' *' : ''}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

// ── New Loan modal ─────────────────────────────────────────────────────────────

function LoanModal({
  businessId, userId, onClose,
  loanAccounts, bankAccounts, interestAccounts,
}: {
  businessId: string; userId: string; onClose: () => void;
  loanAccounts: Row<'accounts'>[];
  bankAccounts: Row<'accounts'>[];
  interestAccounts: Row<'accounts'>[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    lenderName: '', description: '', principalAmount: '', interestRatePct: '',
    termMonths: '', startDate: today(), firstPaymentDate: '',
    loanAccountId: '', bankAccountId: '', interestAccountId: '',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const principal = num(form.principalAmount);
      if (!form.lenderName.trim()) throw new Error('Lender name is required.');
      if (!form.loanAccountId) throw new Error('Select the Loan Payable (liability) account.');
      if (!form.bankAccountId) throw new Error('Select the Bank/Cash account that receives the funds.');
      if (principal <= 0) throw new Error('Enter a valid principal amount.');
      const input: CreateLoanInput = {
        businessId, createdBy: userId, lenderName: form.lenderName.trim(),
        description: form.description.trim() || undefined,
        principalAmount: principal,
        interestRatePct: form.interestRatePct ? num(form.interestRatePct) : null,
        termMonths: form.termMonths ? parseInt(form.termMonths) : null,
        startDate: form.startDate,
        firstPaymentDate: form.firstPaymentDate || null,
        loanAccountId: form.loanAccountId,
        bankAccountId: form.bankAccountId,
        interestExpenseAccountId: form.interestAccountId || null,
      };
      return createLoan(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans', businessId] });
      setAlert({ type: 'success', message: 'Loan recorded and drawdown journal posted.' });
      setTimeout(onClose, 900);
    },
    onError: (e: Error) => setAlert({ type: 'error', message: e.message }),
  });

  return (
    <ModalShell
      title="New Loan" icon={<Landmark className="h-5 w-5 text-brand-600" />} onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record Loan
          </button>
        </>
      }
    >
      {alert && <Alert type={alert.type} message={alert.message} />}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Field label="Lender" required>
          <input className={inputCls} value={form.lenderName} onChange={(e) => setForm({ ...form, lenderName: e.target.value })} placeholder="e.g. NBM Bank" />
        </Field></div>
        <div className="col-span-2"><Field label="Description">
          <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Purpose of the loan" />
        </Field></div>
        <Field label="Principal (MK)" required>
          <input type="number" step="0.01" className={inputCls} value={form.principalAmount} onChange={(e) => setForm({ ...form, principalAmount: e.target.value })} />
        </Field>
        <Field label="Interest rate (% p.a.)">
          <input type="number" step="0.01" className={inputCls} value={form.interestRatePct} onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })} />
        </Field>
        <Field label="Term (months)">
          <input type="number" className={inputCls} value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} />
        </Field>
        <Field label="Start date" required>
          <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <div className="col-span-2"><Field label="First repayment date">
          <input type="date" className={inputCls} value={form.firstPaymentDate} onChange={(e) => setForm({ ...form, firstPaymentDate: e.target.value })} />
        </Field></div>
        <div className="col-span-2"><AccountPicker label="Loan Payable account (liability)" required value={form.loanAccountId}
          onChange={(v) => setForm({ ...form, loanAccountId: v })} accounts={loanAccounts} placeholder="Select liability account…" /></div>
        <AccountPicker label="Bank/Cash received" required value={form.bankAccountId}
          onChange={(v) => setForm({ ...form, bankAccountId: v })} accounts={bankAccounts} placeholder="Select bank/cash…" />
        <AccountPicker label="Interest expense account" value={form.interestAccountId}
          onChange={(v) => setForm({ ...form, interestAccountId: v })} accounts={interestAccounts} placeholder="Select expense…" />
      </div>
      <p className="text-xs text-gray-500">Recording posts: Dr Bank/Cash · Cr Loan Payable.</p>
    </ModalShell>
  );
}

// ── Record repayment modal ──────────────────────────────────────────────────────

function RepaymentModal({
  businessId, userId, loans, bankAccounts, onClose, preselectedLoanId,
}: {
  businessId: string; userId: string; loans: Row<'loans'>[];
  bankAccounts: Row<'accounts'>[]; onClose: () => void; preselectedLoanId?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    loanId: preselectedLoanId ?? (loans[0]?.id ?? ''),
    repaymentDate: today(), amount: '', principalPortion: '', bankAccountId: '',
    reference: '', notes: '',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const amount = num(form.amount);
  const principal = num(form.principalPortion);
  const interest = Math.max(0, amount - principal);

  const mutation = useMutation({
    mutationFn: () => {
      if (!form.loanId) throw new Error('Select a loan.');
      if (!form.bankAccountId) throw new Error('Select the Bank/Cash account paid from.');
      if (amount <= 0) throw new Error('Enter a valid total repayment amount.');
      if (principal < 0 || principal > amount + 0.005) throw new Error('Principal portion must be between 0 and the total amount.');
      const input: RecordRepaymentInput = {
        businessId, createdBy: userId, loanId: form.loanId,
        repaymentDate: form.repaymentDate, amount, principalPortion: principal,
        interestPortion: interest, bankAccountId: form.bankAccountId,
        reference: form.reference.trim() || undefined, notes: form.notes.trim() || undefined,
      };
      return recordLoanRepayment(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans', businessId] });
      queryClient.invalidateQueries({ queryKey: ['loan_repayments', businessId] });
      setAlert({ type: 'success', message: 'Repayment posted.' });
      setTimeout(onClose, 900);
    },
    onError: (e: Error) => setAlert({ type: 'error', message: e.message }),
  });

  return (
    <ModalShell
      title="Record Loan Repayment" icon={<ArrowDownCircle className="h-5 w-5 text-brand-600" />} onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Post Repayment
          </button>
        </>
      }
    >
      {alert && <Alert type={alert.type} message={alert.message} />}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Field label="Loan" required>
          <select className={inputCls} value={form.loanId} onChange={(e) => setForm({ ...form, loanId: e.target.value })}>
            <option value="">Select loan…</option>
            {loans.map((l) => <option key={l.id} value={l.id}>{l.lender_name} — {formatMwk(Number(l.principal_amount))}</option>)}
          </select>
        </Field></div>
        <Field label="Repayment date" required>
          <input type="date" className={inputCls} value={form.repaymentDate} onChange={(e) => setForm({ ...form, repaymentDate: e.target.value })} />
        </Field>
        <Field label="Total amount (MK)" required>
          <input type="number" step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Principal portion (MK)" required>
          <input type="number" step="0.01" className={inputCls} value={form.principalPortion} onChange={(e) => setForm({ ...form, principalPortion: e.target.value })} />
        </Field>
        <Field label="Interest portion (MK)">
          <input className={inputCls + ' bg-gray-50'} value={formatMwk(interest)} readOnly />
        </Field>
        <div className="col-span-2"><AccountPicker label="Bank/Cash paid from" required value={form.bankAccountId}
          onChange={(v) => setForm({ ...form, bankAccountId: v })} accounts={bankAccounts} placeholder="Select bank/cash…" /></div>
        <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-gray-500">Posts: Dr Loan Payable (principal) · Dr Interest Expense · Cr Bank/Cash.</p>
    </ModalShell>
  );
}

// ── Share capital modal ─────────────────────────────────────────────────────────

function ShareModal({
  businessId, userId, onClose, shareAccounts, bankAccounts,
}: {
  businessId: string; userId: string; onClose: () => void;
  shareAccounts: Row<'accounts'>[]; bankAccounts: Row<'accounts'>[];
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ShareTransactionType>('issue');
  const [form, setForm] = useState({
    shareholderName: '', sharesCount: '', amount: '', shareAccountId: '', bankAccountId: '', reference: '', notes: '',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const amount = num(form.amount);
      if (!form.shareholderName.trim()) throw new Error('Shareholder name is required.');
      if (!form.shareAccountId) throw new Error('Select the Share Capital (equity) account.');
      if (!form.bankAccountId) throw new Error('Select the Bank/Cash account.');
      if (amount <= 0) throw new Error('Enter a valid amount.');
      const input: RecordShareInput = {
        businessId, createdBy: userId, shareholderName: form.shareholderName.trim(),
        transactionType: type, sharesCount: form.sharesCount ? num(form.sharesCount) : null,
        amount, shareAccountId: form.shareAccountId, bankAccountId: form.bankAccountId,
        reference: form.reference.trim() || undefined, notes: form.notes.trim() || undefined,
      };
      return recordShareTransaction(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share_transactions', businessId] });
      setAlert({ type: 'success', message: type === 'issue' ? 'Shares issued and journal posted.' : 'Shares bought back and journal posted.' });
      setTimeout(onClose, 900);
    },
    onError: (e: Error) => setAlert({ type: 'error', message: e.message }),
  });

  return (
    <ModalShell
      title={type === 'issue' ? 'Issue Shares (In)' : 'Buy Back Shares (Out)'} icon={<Coins className="h-5 w-5 text-brand-600" />} onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{type === 'issue' ? 'Issue Shares' : 'Buy Back'}
          </button>
        </>
      }
    >
      {alert && <Alert type={alert.type} message={alert.message} />}
      <div className="mb-2 flex gap-2">
        <button onClick={() => setType('issue')}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${type === 'issue' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-600'}`}>
          <ArrowUpCircle className="mr-1 inline h-4 w-4" />Shares In
        </button>
        <button onClick={() => setType('buyback')}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${type === 'buyback' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-300 text-gray-600'}`}>
          <ArrowDownCircle className="mr-1 inline h-4 w-4" />Shares Out
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Field label="Shareholder" required>
          <input className={inputCls} value={form.shareholderName} onChange={(e) => setForm({ ...form, shareholderName: e.target.value })} placeholder="e.g. Jane Banda" />
        </Field></div>
        <Field label="Shares (qty)"><input type="number" step="0.0001" className={inputCls} value={form.sharesCount} onChange={(e) => setForm({ ...form, sharesCount: e.target.value })} /></Field>
        <Field label={`Amount (MK) — ${type === 'issue' ? 'received' : 'paid'}`} required>
          <input type="number" step="0.01" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <div className="col-span-2"><AccountPicker label="Share Capital account (equity)" required value={form.shareAccountId}
          onChange={(v) => setForm({ ...form, shareAccountId: v })} accounts={shareAccounts} placeholder="Select equity account…" /></div>
        <AccountPicker label="Bank/Cash" required value={form.bankAccountId}
          onChange={(v) => setForm({ ...form, bankAccountId: v })} accounts={bankAccounts} placeholder="Select bank/cash…" />
        <Field label="Reference"><input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Notes"><input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
      <p className="text-xs text-gray-500">
        {type === 'issue' ? 'Posts: Dr Bank/Cash · Cr Share Capital.' : 'Posts: Dr Share Capital · Cr Bank/Cash.'}
      </p>
    </ModalShell>
  );
}

// ── Loans tab ───────────────────────────────────────────────────────────────────

function LoansTab({ businessId, userId }: { businessId: string; userId: string }) {
  const [showLoan, setShowLoan] = useState(false);
  const [showRepay, setShowRepay] = useState(false);
  const [repayLoanId, setRepayLoanId] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans', businessId], queryFn: () => repos.loan.findByBusiness(businessId),
  });
  const { data: repayments = [] } = useQuery({
    queryKey: ['loan_repayments', businessId], queryFn: () => repos.loanRepayment.findByBusiness(businessId),
  });
  const { data: liabilityAccounts = [] } = useQuery({
    queryKey: ['accounts_by_type', businessId, 'liability'], queryFn: () => repos.account.findByType(businessId, 'liability'),
  });
  const { data: assetAccounts = [] } = useQuery({
    queryKey: ['accounts_by_type', businessId, 'asset'], queryFn: () => repos.account.findByType(businessId, 'asset'),
  });
  const { data: expenseAccounts = [] } = useQuery({
    queryKey: ['accounts_by_type', businessId, 'expense'], queryFn: () => repos.account.findByType(businessId, 'expense'),
  });

  const loanAccounts = liabilityAccounts.filter((a) => hasSubtype(a, LOAN_SUBTYPES));
  const bankAccounts = assetAccounts.filter((a) => hasSubtype(a, BANK_SUBTYPES));
  const interestAccounts = expenseAccounts.filter((a) => hasSubtype(a, INTEREST_SUBTYPES));

  const repaidByLoan = useMemo(() => {
    const m = new Map<string, number>();
    repayments.forEach((r) => m.set(r.loan_id, (m.get(r.loan_id) ?? 0) + Number(r.principal_portion)));
    return m;
  }, [repayments]);

  const totalBorrowed = loans.reduce((s, l) => s + Number(l.principal_amount), 0);
  const totalRepaid = repayments.reduce((s, r) => s + Number(r.principal_portion), 0);
  const outstanding = totalBorrowed - totalRepaid;
  const interestPaid = repayments.reduce((s, r) => s + Number(r.interest_portion), 0);

  const filtered = loans.filter((l) => l.lender_name.toLowerCase().includes(search.toLowerCase()));

  function openRepay(loanId?: string) { setRepayLoanId(loanId); setShowRepay(true); }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Borrowed" value={formatMwk(totalBorrowed)} icon={<Landmark className="h-4 w-4" />} />
        <SummaryCard label="Outstanding" value={formatMwk(outstanding)} icon={<Wallet className="h-4 w-4" />} accent />
        <SummaryCard label="Principal Repaid" value={formatMwk(totalRepaid)} icon={<TrendingUp className="h-4 w-4" />} />
        <SummaryCard label="Interest Paid" value={formatMwk(interestPaid)} icon={<Receipt className="h-4 w-4" />} />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lender…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportLoansCsv(loans, repayments)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <FileDown className="h-4 w-4" />Export CSV
          </button>
          <button onClick={() => openRepay()} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ArrowDownCircle className="h-4 w-4" />Record Repayment
          </button>
          <button onClick={() => setShowLoan(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus className="h-4 w-4" />New Loan
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Lender</th>
              <th className="px-4 py-3 text-right">Principal</th>
              <th className="px-4 py-3 text-right">Repaid</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No loans yet. Click “New Loan” to record one.</td></tr>
            )}
            {filtered.map((l) => {
              const repaid = repaidByLoan.get(l.id) ?? 0;
              const out = Number(l.principal_amount) - repaid;
              return (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{l.lender_name}</td>
                  <td className="px-4 py-3 text-right">{formatMwk(Number(l.principal_amount))}</td>
                  <td className="px-4 py-3 text-right">{formatMwk(repaid)}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMwk(out)}</td>
                  <td className="px-4 py-3">{l.interest_rate_pct != null ? `${l.interest_rate_pct}%` : '—'}</td>
                  <td className="px-4 py-3">{l.start_date}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${loanStatusColor(l.status)}`}>{loanStatusLabel(l.status)}</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          const loanRepayments = repayments.filter((r) => r.loan_id === l.id);
                          openRepaymentSchedule(l, loanRepayments);
                        }}
                        title="View repayment schedule"
                        className="rounded-lg border border-gray-300 p-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openRepay(l.id)} disabled={l.status === 'paid_off' || l.status === 'cancelled'}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40">
                        Repay
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {repayments.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Recent Repayments</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Loan</th><th className="px-4 py-3 text-right">Principal</th><th className="px-4 py-3 text-right">Interest</th><th className="px-4 py-3 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {repayments.slice(0, 10).map((r) => {
                  const loan = loans.find((l) => l.id === r.loan_id);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">{r.repayment_date}</td>
                      <td className="px-4 py-2.5">{loan?.lender_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">{formatMwk(Number(r.principal_portion))}</td>
                      <td className="px-4 py-2.5 text-right">{formatMwk(Number(r.interest_portion))}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{formatMwk(Number(r.amount))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showLoan && (
        <LoanModal businessId={businessId} userId={userId} onClose={() => setShowLoan(false)}
          loanAccounts={loanAccounts.length ? loanAccounts : liabilityAccounts}
          bankAccounts={bankAccounts.length ? bankAccounts : assetAccounts}
          interestAccounts={interestAccounts.length ? interestAccounts : expenseAccounts} />
      )}
      {showRepay && (
        <RepaymentModal businessId={businessId} userId={userId} loans={loans} bankAccounts={bankAccounts.length ? bankAccounts : assetAccounts}
          onClose={() => setShowRepay(false)} preselectedLoanId={repayLoanId} />
      )}
    </div>
  );
}

// ── Share capital tab ───────────────────────────────────────────────────────────

function ShareTab({ businessId, userId }: { businessId: string; userId: string }) {
  const [show, setShow] = useState(false);
  const [search, setSearch] = useState('');

  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['share_transactions', businessId], queryFn: () => repos.share.findByBusiness(businessId),
  });
  const { data: equityAccounts = [] } = useQuery({
    queryKey: ['accounts_by_type', businessId, 'equity'], queryFn: () => repos.account.findByType(businessId, 'equity'),
  });
  const { data: assetAccounts = [] } = useQuery({
    queryKey: ['accounts_by_type', businessId, 'asset'], queryFn: () => repos.account.findByType(businessId, 'asset'),
  });

  const shareAccounts = equityAccounts.filter((a) => hasSubtype(a, SHARE_SUBTYPES));
  const bankAccounts = assetAccounts.filter((a) => hasSubtype(a, BANK_SUBTYPES));

  const issued = shares.filter((s) => s.transaction_type === 'issue').reduce((sum, s) => sum + Number(s.amount), 0);
  const boughtBack = shares.filter((s) => s.transaction_type === 'buyback').reduce((sum, s) => sum + Number(s.amount), 0);
  const net = issued - boughtBack;

  const filtered = shares.filter((s) => s.shareholder_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <SummaryCard label="Shares In (issued)" value={formatMwk(issued)} icon={<ArrowUpCircle className="h-4 w-4" />} />
        <SummaryCard label="Shares Out (bought back)" value={formatMwk(boughtBack)} icon={<ArrowDownCircle className="h-4 w-4" />} />
        <SummaryCard label="Net Share Capital" value={formatMwk(net)} icon={<Coins className="h-4 w-4" />} accent />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shareholder…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportSharesCsv(shares)} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <FileDown className="h-4 w-4" />Export CSV
          </button>
          <button onClick={() => setShow(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus className="h-4 w-4" />Record Share Movement
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Shareholder</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Shares</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No share movements yet.</td></tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{s.shareholder_name}</td>
                <td className="px-4 py-3">
                  {s.transaction_type === 'issue'
                    ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Shares In</span>
                    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Shares Out</span>}
                </td>
                <td className="px-4 py-3 text-right">{s.shares_count != null ? Number(s.shares_count).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-right font-medium">{formatMwk(Number(s.amount))}</td>
                <td className="px-4 py-3">{s.created_at.slice(0, 10)}</td>
                <td className="px-4 py-3 text-gray-500">{s.reference ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <ShareModal businessId={businessId} userId={userId} onClose={() => setShow(false)}
          shareAccounts={shareAccounts.length ? shareAccounts : equityAccounts}
          bankAccounts={bankAccounts.length ? bankAccounts : assetAccounts} />
      )}
    </div>
  );
}

// ── Summary card ────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon: ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-brand-200 bg-brand-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function CapitalPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const userId = useAppStore((s) => s.currentUser?.id);
  const businessId = currentBusiness?.business?.id;
  const [tab, setTab] = useState<'loans' | 'shares'>('loans');

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Capital & Financing</h1>
        <p className="mt-1 text-sm text-gray-500">Record loans, repayments and share capital movements. Each entry posts a double-entry journal.</p>
      </div>

      <div className="mb-6 flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        <button onClick={() => setTab('loans')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'loans' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Landmark className="h-4 w-4" />Loans
        </button>
        <button onClick={() => setTab('shares')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'shares' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Coins className="h-4 w-4" />Share Capital
        </button>
      </div>

      {tab === 'loans' && userId && <LoansTab businessId={businessId} userId={userId} />}
      {tab === 'shares' && userId && <ShareTab businessId={businessId} userId={userId} />}
    </div>
  );
}
