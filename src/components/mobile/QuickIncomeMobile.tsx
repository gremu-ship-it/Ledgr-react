import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight, ArrowLeft } from 'lucide-react';
import { MwkNumberPad } from './MwkNumberPad';
import { BottomSheet } from './BottomSheet';
import { repos } from '@/lib/repositories';
import { createInvoiceJournalEntry } from '@/services/journalService';
import type { InsertDto } from '@/dal/types/database';

const CATEGORIES = [
  { label: 'Sales', emoji: '🛍️' },
  { label: 'Service', emoji: '🔧' },
  { label: 'Consulting', emoji: '💼' },
  { label: 'Rent', emoji: '🏠' },
  { label: 'Commission', emoji: '🤝' },
  { label: 'Interest', emoji: '🏦' },
  { label: 'Refund', emoji: '↩️' },
  { label: 'Grant', emoji: '🎁' },
  { label: 'Other', emoji: '💰' },
];

type Step = 'amount' | 'category' | 'description' | 'confirm' | 'success';

interface QuickIncomeMobileProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickIncomeMobile({ businessId, open, onClose }: QuickIncomeMobileProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  function reset() {
    setStep('amount');
    setAmount('');
    setCategory('');
    setDescription('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  const today = new Date().toISOString().slice(0, 10);
  const rawAmount = parseFloat(amount) || 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const contacts = await repos.contact.findByBusiness(businessId, 'customer');
      const walkIn = contacts.find((c) => c.name === 'Walk-in Customer') ?? contacts[0];
      if (!walkIn) throw new Error('No customer contact found. Add a Walk-in Customer contact first.');

      const invoiceNumber = await repos.business.reserveNextInvoiceNumber(businessId);
      const desc = description.trim() || category;

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
          notes: desc,
          created_by: null,
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
        } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>],
      );

      const allInvoices = await repos.invoice.findByBusiness(businessId);
      const created = allInvoices.find((inv) => inv.invoice_number === invoiceNumber);
      if (created) {
        try {
          await createInvoiceJournalEntry(
            businessId, invoiceNumber, today,
            rawAmount, rawAmount, 0, created.id,
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
      case 'category': return 'What for?';
      case 'description': return 'Add details';
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
            MK {rawAmount.toLocaleString('en-MW')} · {category}
          </p>
        </div>
      )}

      {/* Step: Amount */}
      {step === 'amount' && (
        <div className="flex flex-col gap-6">
          <MwkNumberPad value={amount} onChange={setAmount} />
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
          <button onClick={() => setStep('amount')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="grid grid-cols-3 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.label}
                onClick={() => { setCategory(cat.label); setStep('description'); }}
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
          <button onClick={() => setStep('category')} className="flex items-center gap-1 text-sm text-gray-500">
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
              placeholder={`e.g. ${category} payment...`}
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
          <button onClick={() => setStep('description')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-semibold text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            </div>
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