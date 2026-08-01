import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight, ArrowLeft, Search, Package, ShoppingCart, Building2, Users2 } from 'lucide-react';
import { MwkNumberPad } from './MwkNumberPad';
import { BottomSheet } from './BottomSheet';
import { createLogger } from '@/lib/logger';
import { repos } from '@/lib/repositories';
import { createExpenseJournalEntry, type ExpenseAccountAllocation } from '@/services/journalService';
import { resolveExpenseLineAccountId } from '@/services/inventoryJournalService';
import type { InsertDto, Row } from '@/dal/types/database';
import { enqueue, generateOfflineNumber, isOfflineError } from '@/offline/queueApi';
import { invalidateAfterExpense } from '@/lib/queryInvalidation';

const log = createLogger('QuickExpenseMobile');

type Step = 'amount' | 'details' | 'confirm' | 'success';

interface QuickExpenseMobileProps {
  businessId: string;
  open: boolean;
  onClose: () => void;
}

export function QuickExpenseMobile({ businessId, open, onClose }: QuickExpenseMobileProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<Row<'accounts'> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [description, setDescription] = useState('');
  const [includeVat, setIncludeVat] = useState(false);
  const [branchId, setBranchId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Row<'products'> | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const { data: expenseAccounts = [] } = useQuery({
    queryKey: ['accounts_expense_mobile', businessId],
    queryFn: () => repos.account.findByType(businessId, 'expense', false),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products_all_mobile_expense', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
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
    setIncludeVat(false);
    setBranchId('');
    setDepartmentId('');
    setSelectedProduct(null);
    setProductSearchQuery('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  const today = new Date().toISOString().slice(0, 10);
  const rawAmount = parseFloat(amount) || 0;
  const netAmount = includeVat ? rawAmount / 1.175 : rawAmount;
  const vatAmount = includeVat ? rawAmount - netAmount : 0;

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return expenseAccounts.slice(0, 20);
    return expenseAccounts.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)).slice(0, 20);
  }, [expenseAccounts, searchQuery]);

  const filteredProducts = useMemo(() => {
    const q = productSearchQuery.toLowerCase();
    if (!q) return products.slice(0, 30);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q)),
      )
      .slice(0, 30);
  }, [products, productSearchQuery]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccount) throw new Error('Please select an expense account.');
      const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      const desc = description.trim() || selectedProduct?.name || selectedAccount.name;
      const resolvedAccountId = isOfflineNow
        ? selectedAccount.id
        : await resolveExpenseLineAccountId(businessId, selectedProduct ?? null, selectedAccount.id);

      const buildPayload = (num: string) => ({
        expense: {
          business_id: businessId,
          expense_number: num,
          expense_type: 'receipt' as const,
          status: 'paid' as const,
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
          branch_id: branchId || null,
          department_id: departmentId || null,
        } as InsertDto<'expenses'>,
        lines: [
          {
            line_number: 1,
            description: desc,
            quantity: 1,
            unit_price: netAmount,
            tax_code: includeVat ? 'vat_standard' : 'none',
            tax_rate: includeVat ? 0.175 : 0,
            tax_amount: vatAmount,
            line_total: rawAmount,
            account_id: resolvedAccountId,
            product_id: selectedProduct?.id || null,
          } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>,
        ],
      });

      if (isOfflineNow) {
        const offlineNum = generateOfflineNumber('EXP');
        await enqueue('expense', businessId, buildPayload(offlineNum));
        return { offline: true };
      }

      try {
        const expenseNumber = await repos.business.reserveNextExpenseNumber(businessId);
        const { expense: created } = await repos.expense.createWithLines(buildPayload(expenseNumber).expense, buildPayload(expenseNumber).lines);
        if (created) {
          try {
            const allocations: ExpenseAccountAllocation[] = [{ accountId: resolvedAccountId, amount: netAmount, description: desc }];
            const journalEntryId = await createExpenseJournalEntry(businessId, created, allocations, vatAmount, branchId || null, departmentId || null);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (repos.expense as any).update(created.id, { journal_entry_id: journalEntryId });
            if (selectedProduct && selectedProduct.track_inventory) {
              try {
                const locations = await repos.inventory.findLocations(businessId);
                let targetLocation = branchId ? locations.find((l) => l.branch_id === branchId) : null;
                if (!targetLocation) targetLocation = locations.find((l) => l.is_default) ?? locations[0] ?? null;
                if (targetLocation) {
                  await repos.inventory.recordMovements([
                    {
                      business_id: businessId,
                      product_id: selectedProduct.id,
                      location_id: targetLocation.id,
                      movement_type: 'purchase' as const,
                      movement_date: today,
                      quantity: 1,
                      unit_cost: netAmount,
                      source_type: 'expense',
                      source_id: created.id,
                      reference: expenseNumber,
                      created_by: null,
                    } as InsertDto<'stock_movements'>,
                  ]);
                }
              } catch (stockErr) {
                log.warn('Stock addition failed', { error: stockErr });
              }
            }
          } catch (err) {
            log.error('Journal failed', err as Error);
            throw new Error('Expense saved but ledger posting failed. Will show as Needs Posting.', { cause: err });
          }
        }
        return { offline: false };
      } catch (err) {
        if (isOfflineError(err)) {
          const offlineNum = generateOfflineNumber('EXP');
          await enqueue('expense', businessId, buildPayload(offlineNum));
          return { offline: true };
        }
        throw err;
      }
    },
    onSuccess: () => {
      invalidateAfterExpense(queryClient, { touchedInventory: Boolean(selectedProduct?.track_inventory) });
      setStep('success');
      setTimeout(() => handleClose(), 1500);
    },
  });

  function getTitle() {
    switch (step) {
      case 'amount':
        return `How much? — Step 1 of 3`;
      case 'details':
        return `Details — Step 2 of 3`;
      case 'confirm':
        return `Confirm — Step 3 of 3`;
      default:
        return 'Record Expense';
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title={getTitle()}>
      {step === 'success' && (
        <div className="flex flex-col items-center py-8 gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle className="h-8 w-8 text-brand-500" />
          </div>
          <p className="text-lg font-semibold text-gray-900">Expense Recorded!</p>
          <p className="text-sm text-gray-500 text-center">
            MK {rawAmount.toLocaleString('en-MW')} · {selectedAccount?.name}
            {selectedProduct && <span> · {selectedProduct.name}</span>}
          </p>
        </div>
      )}

      {step === 'amount' && (
        <div className="flex flex-col gap-6">
          <MwkNumberPad value={amount} onChange={setAmount} />

          <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-5 py-4 ring-1 ring-gray-100">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-700">Include VAT (17.5%)</p>
              {amount && includeVat && (
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">
                  Net MK {(parseFloat(amount) / 1.175).toFixed(0)} · VAT MK {(parseFloat(amount) - parseFloat(amount) / 1.175).toFixed(0)}
                </p>
              )}
            </div>
            <button
              onClick={() => setIncludeVat((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-all ${includeVat ? 'bg-brand-500 shadow-lg' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${includeVat ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <button
            onClick={() => setStep('details')}
            disabled={!amount || parseFloat(amount) <= 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-sm font-black uppercase tracking-[0.15em] text-white shadow-xl shadow-brand-500/20 disabled:opacity-40 active:scale-95"
          >
            Continue — Details <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {step === 'details' && (
        <div className="flex flex-col gap-5">
          <button onClick={() => setStep('amount')} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">
            <ArrowLeft className="h-4 w-4" /> Back to Amount
          </button>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
            <span className="font-bold text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            {includeVat && <span className="ml-2 text-xs text-gray-500">inc VAT</span>}
          </div>

          {/* Account */}
          <div>
            <label className="mb-1.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-700">
              <ShoppingCart className="h-3.5 w-3.5" /> Expense Account <span className="text-red-500">*</span>
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search expense accounts..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="max-h-[160px] overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
              {selectedAccount && (
                <div className="flex items-center justify-between bg-brand-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-brand-500 px-2 py-0.5 text-[10px] font-mono font-bold text-white">{selectedAccount.code}</span>
                    <span className="text-sm font-semibold text-brand-800">{selectedAccount.name}</span>
                  </div>
                  <button onClick={() => setSelectedAccount(null)} className="text-xs text-brand-600 underline">
                    Change
                  </button>
                </div>
              )}
              {!selectedAccount &&
                filteredAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedAccount(acc)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-mono font-bold text-gray-600">{acc.code}</span>
                      <span className="text-sm text-gray-900">{acc.name}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </button>
                ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <label className="mb-1.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-700">
              <Package className="h-3.5 w-3.5" /> Product / Service <span className="font-normal normal-case text-gray-400">(optional)</span>
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                placeholder="Search products, SKU..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="max-h-[160px] overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
              {selectedProduct ? (
                <div className="flex items-center justify-between bg-gray-50 px-3 py-2.5">
                  <span className="text-sm font-medium text-gray-800">{selectedProduct.name}</span>
                  <button onClick={() => setSelectedProduct(null)} className="text-xs text-gray-500 underline">
                    Clear
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => setSelectedProduct(null)} className="w-full px-3 py-2 text-left text-xs text-gray-500 hover:bg-gray-50">
                    No product — general expense
                  </button>
                  {filteredProducts.slice(0, 20).map((p) => (
                    <button key={p.id} onClick={() => setSelectedProduct(p)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50">
                      <span className="truncate text-sm text-gray-900">{p.name}</span>
                      {p.sku && <span className="ml-2 text-[10px] font-mono text-gray-400">{p.sku}</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={selectedProduct ? `Purchase of ${selectedProduct.name}` : 'e.g. Office supplies for Blantyre branch'}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {branches.length > 0 && (
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-700">
                <Building2 className="h-3.5 w-3.5" /> Branch (optional)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {branches.slice(0, 6).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBranchId(branchId === b.id ? '' : b.id)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-medium ${branchId === b.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span className="block truncate font-bold">{b.name}</span>
                    {b.code && <span className="text-[10px] text-gray-500">{b.code}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {departments.length > 0 && (
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-700">
                <Users2 className="h-3.5 w-3.5" /> Department (optional)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {departments.slice(0, 6).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDepartmentId(departmentId === d.id ? '' : d.id)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-medium ${departmentId === d.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span className="block truncate font-bold">{d.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setStep('confirm')}
            disabled={!selectedAccount}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-sm font-bold text-white shadow-lg disabled:opacity-40 active:scale-95"
          >
            Review — Step 3 <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('details')} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            <ArrowLeft className="h-4 w-4" /> Back to Details
          </button>

          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount</span>
              <span className="font-bold text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            </div>
            {includeVat && (
              <div className="flex justify-between text-xs text-gray-600">
                <span>Net {netAmount.toFixed(2)} + VAT {vatAmount.toFixed(2)}</span>
                <span>inc VAT</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Account</span>
              <span className="font-medium text-gray-900 text-right max-w-[60%]">
                [{selectedAccount?.code}] {selectedAccount?.name}
              </span>
            </div>
            {selectedProduct && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Product</span>
                <span className="font-medium text-gray-900">{selectedProduct.name}</span>
              </div>
            )}
            {description && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Description</span>
                <span className="text-gray-700 text-right max-w-[60%] truncate">{description}</span>
              </div>
            )}
            {branchId && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Branch</span>
                <span className="text-gray-700">{branches.find((b) => b.id === branchId)?.name}</span>
              </div>
            )}
            {departmentId && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Department</span>
                <span className="text-gray-700">{departments.find((d) => d.id === departmentId)?.name}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-base font-bold text-white disabled:opacity-60 active:scale-95"
          >
            {mutation.isPending ? 'Saving…' : 'Record Expense ✓'}
          </button>
          {mutation.isError && <p className="text-center text-sm text-red-600">{(mutation.error as Error).message}</p>}
        </div>
      )}
    </BottomSheet>
  );
}
