import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight, ArrowLeft } from 'lucide-react';
import { MwkNumberPad } from './MwkNumberPad';
import { BottomSheet } from './BottomSheet';
import { repos } from '@/lib/repositories';
import { createExpenseJournalEntry } from '@/services/journalService';
import type { InsertDto } from '@/dal/types/database';

const CATEGORIES = [
  { label: 'Fuel', emoji: '⛽' },
  { label: 'Food', emoji: '🍽️' },
  { label: 'Rent', emoji: '🏠' },
  { label: 'Supplies', emoji: '📦' },
  { label: 'Airtime', emoji: '📱' },
  { label: 'Transport', emoji: '🚗' },
  { label: 'Utilities', emoji: '💡' },
  { label: 'Salary', emoji: '👤' },
  { label: 'Other', emoji: '💰' },
];

type Step = 'amount' | 'category' | 'description' | 'confirm' | 'success';

interface QuickExpenseMobileProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickExpenseMobile({ businessId, open, onClose }: QuickExpenseMobileProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [includeVat, setIncludeVat] = useState(false);

  function reset() {
    setStep('amount');
    setAmount('');
    setCategory('');
    setDescription('');
    setIncludeVat(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const today = new Date().toISOString().slice(0, 10);

  const rawAmount = parseFloat(amount) || 0;
  const netAmount = includeVat ? rawAmount / 1.175 : rawAmount;
  const vatAmount = includeVat ? rawAmount - netAmount : 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const expenseNumber = await repos.business.reserveNextExpenseNumber(businessId);
      const desc = description.trim() || category;

      await repos.expense.createWithLines(
        {
          business_id: businessId,
          expense_number: expenseNumber,
          expense_type: 'receipt',
          status: 'paid',
          expense_date: today,
          currency: 'MWK',
          exchange_rate: 1,
          subtotal: netAmount,
          vat_amount: vatAmount,
          wht_amount: 0,
          total_amount: rawAmount,
          amount_paid: rawAmount,
          notes: desc,
          created_by: null,
        } as InsertDto<'expenses'>,
        [{
          line_number: 1,
          description: desc,
          quantity: 1,
          unit_price: netAmount,
          tax_code: includeVat ? 'vat_standard' : 'none',
          tax_rate: includeVat ? 0.175 : 0,
          tax_amount: vatAmount,
          line_total: rawAmount,
        } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>],
      );

      const allExpenses = await repos.expense.findByBusiness(businessId);
      const created = allExpenses.find((e) => e.expense_number === expenseNumber);
      if (created) {
        try {
          await createExpenseJournalEntry(
            businessId, expenseNumber, today,
            rawAmount, netAmount, vatAmount, 'receipt', created.id,
          );
        } catch (err) {
          console.warn('Journal entry failed:', err);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setStep('success');
      setTimeout(() => {
        handleClose();
      }, 1500);
    },
  });

  function getTitle() {
    switch (step) {
      case 'amount': return 'How much?';
      case 'category': return 'What for?';
      case 'description': return 'Add details';
      case 'confirm': return 'Confirm';
      default: return 'Record Expense';
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
          <p className="text-lg font-semibold text-gray-900">Expense Recorded!</p>
          <p className="text-sm text-gray-500">
            MK {rawAmount.toLocaleString('en-MW')} · {category}
          </p>
        </div>
      )}

      {/* Step: Amount */}
      {step === 'amount' && (
        <div className="flex flex-col gap-6">
          <MwkNumberPad value={amount} onChange={setAmount} />

          {/* VAT toggle */}
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Amount includes VAT</p>
              {amount && includeVat && (
                <p className="text-xs text-gray-400">
                  Net: MK {(parseFloat(amount) / 1.175).toFixed(2)} · VAT: MK {(parseFloat(amount) - parseFloat(amount) / 1.175).toFixed(2)}
                </p>
              )}
            </div>
            <button
              onClick={() => setIncludeVat((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${includeVat ? 'bg-brand-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${includeVat ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <button
            onClick={() => setStep('category')}
            disabled={!amount || parseFloat(amount) <= 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-base font-semibold text-white disabled:opacity-40 transition-all active:scale-95"
          >
            Next <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Step: Category */}
      {step === 'category' && (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setStep('amount')}
            className="flex items-center gap-1 text-sm text-gray-500"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="grid grid-cols-3 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.label}
                onClick={() => {
                  setCategory(cat.label);
                  setStep('description');
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition-all active:scale-95 ${
                  category === cat.label
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                }`}
              >
                <span className="text-2xl">{cat.emoji}</span>
                <span className="text-xs font-medium text-gray-700">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: Description */}
      {step === 'description' && (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setStep('category')}
            className="flex items-center gap-1 text-sm text-gray-500"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            {' · '}
            <span>{category}</span>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`e.g. ${category} for office...`}
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

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
          <button
            onClick={() => setStep('description')}
            className="flex items-center gap-1 text-sm text-gray-500"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-semibold text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            </div>
            {includeVat && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Net</span>
                  <span className="text-gray-700">MK {netAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">VAT (17.5%)</span>
                  <span className="text-gray-700">MK {vatAmount.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Category</span>
              <span className="text-gray-700">{category}</span>
            </div>
            {description && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Description</span>
                <span className="text-gray-700">{description}</span>
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
            {mutation.isPending ? 'Saving…' : 'Record Expense ✓'}
          </button>

          {mutation.isError && (
            <p className="text-center text-sm text-red-600">
              Something went wrong. Please try again.
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}