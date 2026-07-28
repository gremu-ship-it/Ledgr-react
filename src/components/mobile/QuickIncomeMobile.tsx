import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight, ArrowLeft, Search } from 'lucide-react';
import { MwkNumberPad } from './MwkNumberPad';
import { BottomSheet } from './BottomSheet';
import { repos } from '@/lib/repositories';
import { createInvoiceJournalEntry } from '@/services/journalService';
import type { InsertDto, Row } from '@/dal/types/database';

type Step = 'amount' | 'category' | 'description' | 'costCenter' | 'confirm' | 'success';

interface QuickIncomeMobileProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickIncomeMobile({ businessId, open, onClose }: QuickIncomeMobileProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<Row<'accounts'> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');

  // Fetch Chart of Accounts for income/revenue
  const { data: incomeAccounts = [] } = useQuery({
    queryKey: ['accounts_income_mobile', businessId],
    queryFn: async () => {
      const all = await repos.account.findByBusiness(businessId);
      const filtered = all.filter(
        (a: Row<'accounts'>) => a.account_type === 'income' && !a.is_group && a.is_active,
      );
      if (filtered.length > 0) return filtered;
      // Fallback: all active posting accounts
      return all.filter((a: Row<'accounts'>) => !a.is_group && a.is_active);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });

  function reset() {
    setStep('amount');
    setAmount('');
    setSelectedAccount(null);
    setSearchQuery('');
    setDescription('');
    setBranchId('');
    setDepartmentId('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  const today = new Date().toISOString().slice(0, 10);
  const rawAmount = parseFloat(amount) || 0;

  const filteredAccounts = incomeAccounts.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount) {
        throw new Error('Please select an income account from the Chart of Accounts.');
      }

      const contacts = await repos.contact.findByBusiness(businessId, 'customer');
      const walkIn = contacts.find((c) => c.name === 'Walk-in Customer') ?? contacts[0];
      if (!walkIn) throw new Error('No customer contact found. Add a Walk-in Customer contact first.');

      const invoiceNumber = await repos.business.reserveNextInvoiceNumber(businessId);
      const categoryName = selectedAccount.name;
      const desc = description.trim() || categoryName;

      await repos.invoice.createWithLines(
        {
          business_id: businessId,
          invoice_number: invoiceNumber,
          invoice_type: 'invoice',
          status: 'paid',
          contact_id: walkIn.id,
          issue_date: today,
          due_date: today,
          currency: 'MWK',
          exchange_rate: 1,
          subtotal: rawAmount,
          discount_amount: 0,
          discount_percent: 0,
          taxable_amount: rawAmount,
          vat_amount: 0,
          wht_amount: 0,
          total_amount: rawAmount,
          amount_paid: rawAmount,
          revenue_account_id: selectedAccount.id,
          notes: desc,
          created_by: null,
          branch_id: branchId || null,
          department_id: departmentId || null,
        } as InsertDto<'invoices'>,
        [{
          line_number: 1,
          description: desc,
          quantity: 1,
          unit_price: rawAmount,
          discount_percent: 0,
          tax_code: 'none',
          tax_rate: 0,
          tax_amount: 0,
          line_total: rawAmount,
          account_id: selectedAccount.id,
        } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>],
      );

      const allInvoices = await repos.invoice.findByBusiness(businessId);
      const created = allInvoices.find((inv) => inv.invoice_number === invoiceNumber);
      if (created) {
        try {
          await createInvoiceJournalEntry(
            businessId, created, rawAmount, 0, branchId || null, departmentId || null,
          );
        } catch (err) {
          console.warn('Journal entry failed:', err);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setStep('success');
      setTimeout(() => handleClose(), 1500);
    },
  });

  function getTitle() {
    switch (step) {
      case 'amount': return 'How much received?';
      case 'category': return 'Income Category (Chart of Accounts)';
      case 'description': return 'Add details';
      case 'costCenter': return 'Revenue Center';
      case 'confirm': return 'Confirm';
      default: return 'Record Income';
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title={getTitle()}>
      {/* Success */}
      {step === 'success' && (
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle className="h-8 w-8 text-brand-500" />
          </div>
          <p className="text-lg font-semibold text-gray-900">Income Recorded!</p>
          <p className="text-sm text-gray-500">
            MK {rawAmount.toLocaleString('en-MW')} · {selectedAccount?.name}
          </p>
        </div>
      )}

      {/* Step: Amount */}
      {step === 'amount' && (
        <div className="flex flex-col gap-8">
          <MwkNumberPad value={amount} onChange={setAmount} />
          <button
            onClick={() => setStep('category')}
            disabled={!amount || parseFloat(amount) <= 0}
            className="flex w-full items-center justify-center gap-2 rounded-[2rem] bg-brand-500 py-5 text-sm font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-brand-500/20 disabled:opacity-40 transition-all active:scale-95"
          >
            Select Income Account <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Step: Category (Chart of Accounts) */}
      {step === 'category' && (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setStep('amount')}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Amount
          </button>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search Chart of Accounts (code or name)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
            {filteredAccounts.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-500">
                No matching accounts found in Chart of Accounts.
              </p>
            ) : (
              filteredAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setSelectedAccount(acc);
                    setStep('description');
                  }}
                  className={`flex items-center justify-between rounded-2xl border p-3.5 text-left transition-all active:scale-98 ${
                    selectedAccount?.id === acc.id
                      ? 'border-brand-500 bg-brand-50 shadow-sm'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-mono font-bold text-gray-700">
                      {acc.code}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{acc.name}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Step: Description */}
      {step === 'description' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('category')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            {' · '}
            <span className="font-mono font-bold">{selectedAccount?.code}</span>
            {' '}
            <span>{selectedAccount?.name}</span>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`e.g. ${selectedAccount?.name} payment...`}
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            onClick={() => setStep('costCenter')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-base font-semibold text-white transition-all active:scale-95"
          >
            Next <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Step: Cost Center */}
      {step === 'costCenter' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('description')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            {' · '}
            <span>{selectedAccount?.name}</span>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Assign to Branch / Revenue Center
              <span className="text-gray-400"> (optional)</span>
            </label>
            {branches.length === 0 ? (
              <p className="text-xs text-gray-600">No branches configured. You can assign later.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBranchId(branchId === b.id ? '' : b.id)}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                      branchId === b.id
                        ? 'border-brand-500 bg-brand-50 shadow-sm'
                        : 'border-gray-100 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-xs font-bold text-gray-800 truncate">{b.name}</p>
                    {b.code && <p className="text-[10px] text-gray-700">{b.code}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {departments.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Assign to Department
                <span className="text-gray-400"> (optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {departments.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDepartmentId(departmentId === d.id ? '' : d.id)}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                      departmentId === d.id
                        ? 'border-brand-500 bg-brand-50 shadow-sm'
                        : 'border-gray-100 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-xs font-bold text-gray-800 truncate">{d.name}</p>
                    {d.code && <p className="text-[10px] text-gray-700">{d.code}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setStep('confirm')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-base font-semibold text-white transition-all active:scale-95"
          >
            Next <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('costCenter')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-semibold text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Income Account</span>
              <span className="text-gray-900 font-medium">
                <span className="font-mono text-xs text-gray-500">[{selectedAccount?.code}]</span> {selectedAccount?.name}
              </span>
            </div>
            {description && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Description</span>
                <span className="text-gray-700">{description}</span>
              </div>
            )}
            {branchId && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Branch / Revenue Center</span>
                <span className="text-gray-700">{branches.find((b) => b.id === branchId)?.name ?? '—'}</span>
              </div>
            )}
            {departmentId && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Department</span>
                <span className="text-gray-700">{departments.find((d) => d.id === departmentId)?.name ?? '—'}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Date</span>
              <span className="text-gray-700">{today}</span>
            </div>
          </div>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-base font-semibold text-white disabled:opacity-60 transition-all active:scale-95"
          >
            {mutation.isPending ? 'Saving…' : 'Record Income ✓'}
          </button>
          {mutation.isError && (
            <p className="text-center text-sm text-red-600">
              {(mutation.error as Error)?.message ?? 'Something went wrong.'}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}