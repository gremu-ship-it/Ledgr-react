import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ChevronRight, ArrowLeft, Search, Package, Tag } from 'lucide-react';
import { MwkNumberPad } from './MwkNumberPad';
import { BottomSheet } from './BottomSheet';
import { repos } from '@/lib/repositories';
import { createInvoiceJournalEntry } from '@/services/journalService';
import type { InsertDto, Row } from '@/dal/types/database';

type Step = 'amount' | 'category' | 'product' | 'description' | 'costCenter' | 'confirm' | 'success';

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
  const [selectedProduct, setSelectedProduct] = useState<Row<'products'> | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  // Fetch Chart of Accounts - strictly income accounts only for income recording
  const { data: incomeAccounts = [] } = useQuery({
    queryKey: ['accounts_income_mobile', businessId],
    queryFn: async () => {
      // Specifically filter for income accounts only - no fallback to other types
      return await repos.account.findByType(businessId, 'income', false);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });

  // Fetch products/services for dropdown - what is being sold
  const { data: products = [] } = useQuery({
    queryKey: ['products_all_mobile_income', businessId],
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

  const filteredAccounts = incomeAccounts.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(productSearchQuery.toLowerCase())) ||
      (p.description && p.description.toLowerCase().includes(productSearchQuery.toLowerCase())),
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
      const desc = description.trim() || selectedProduct?.name || categoryName;

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
          product_id: selectedProduct?.id || null,
        } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>],
      );

      const allInvoices = await repos.invoice.findByBusiness(businessId);
      const created = allInvoices.find((inv) => inv.invoice_number === invoiceNumber);
      if (created) {
        try {
          await createInvoiceJournalEntry(
            businessId, created, rawAmount, 0, branchId || null, departmentId || null,
          );

          // Optional: deduct stock if product is inventory-tracked
          if (selectedProduct && selectedProduct.track_inventory) {
            try {
              const locations = await repos.inventory.findLocations(businessId);
              let targetLocation = branchId ? locations.find((l) => l.branch_id === branchId) : null;
              if (!targetLocation) {
                targetLocation = locations.find((l) => l.is_default) ?? locations[0] ?? null;
              }
              if (targetLocation) {
                const balance = await repos.inventory.findBalance(businessId, selectedProduct.id, targetLocation.id);
                await repos.inventory.recordMovements([{
                  business_id: businessId,
                  product_id: selectedProduct.id,
                  location_id: targetLocation.id,
                  movement_type: 'sale' as const,
                  movement_date: today,
                  quantity: -1,
                  unit_cost: balance ? Number(balance.average_cost) : 0,
                  source_type: 'invoice',
                  source_id: created.id,
                  reference: invoiceNumber,
                  created_by: null,
                } as InsertDto<'stock_movements'>]);
              }
            } catch (stockErr) {
              console.warn('Stock deduction failed (non-critical):', stockErr);
            }
          }
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
      case 'category': return 'Income Account (Income Only)';
      case 'product': return 'What was sold? (Product/Service)';
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
          <p className="text-sm text-gray-500 text-center">
            MK {rawAmount.toLocaleString('en-MW')} · {selectedAccount?.name}
            {selectedProduct && <span> · {selectedProduct.name}</span>}
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

      {/* Step: Category (Chart of Accounts - Income Only) */}
      {step === 'category' && (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setStep('amount')}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Amount
          </button>

          <div className="rounded-xl bg-brand-50 px-3 py-2 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200">
            Showing only <span className="font-black">Income</span> accounts from your Chart of Accounts
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search income accounts (code or name)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
            {filteredAccounts.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-500">
                No income accounts found in Chart of Accounts. Please create income accounts in your CoA.
              </p>
            ) : (
              filteredAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setSelectedAccount(acc);
                    setStep('product');
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

      {/* Step: Product/Service Selection */}
      {step === 'product' && (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setStep('category')}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Category
          </button>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
            {' · '}
            <span className="font-mono font-bold">{selectedAccount?.code}</span>
            {' '}
            <span>{selectedAccount?.name}</span>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-black uppercase tracking-wider text-gray-700 flex items-center gap-2">
              <Tag className="h-4 w-4" /> Product / Service Sold
            </label>
            <span className="text-[10px] font-bold uppercase text-gray-400">Optional</span>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search products/services (name, SKU)..."
              value={productSearchQuery}
              onChange={(e) => setProductSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto pr-1">
            <button
              onClick={() => {
                setSelectedProduct(null);
                setStep('description');
              }}
              className={`flex items-center justify-between rounded-2xl border p-3.5 text-left transition-all active:scale-98 ${
                !selectedProduct
                  ? 'border-brand-500 bg-brand-50 shadow-sm'
                  : 'border-gray-100 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
                  <Package className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">No specific product</p>
                  <p className="text-[11px] text-gray-500">General income without product link</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>

            {filteredProducts.length === 0 && productSearchQuery ? (
              <p className="py-4 text-center text-xs text-gray-500">
                No matching products found. Try a different search or skip.
              </p>
            ) : filteredProducts.length === 0 && !productSearchQuery && products.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-500">
                No products/services configured. You can add them in Inventory and they will appear here.
              </p>
            ) : (
              filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    setSelectedProduct(product);
                    // Auto-suggest sales account if available
                    if (product.sales_account_id) {
                      const matchedAccount = incomeAccounts.find((a) => a.id === product.sales_account_id);
                      if (matchedAccount) {
                        setSelectedAccount(matchedAccount);
                      }
                    }
                    setStep('description');
                  }}
                  className={`flex items-center justify-between rounded-2xl border p-3.5 text-left transition-all active:scale-98 ${
                    selectedProduct?.id === product.id
                      ? 'border-brand-500 bg-brand-50 shadow-sm'
                      : 'border-gray-100 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                      <Package className="h-4 w-4 text-brand-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{product.name}</p>
                      <div className="flex gap-2 mt-0.5">
                        {product.sku && (
                          <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                            {product.sku}
                          </span>
                        )}
                        <span className="text-[11px] text-gray-500">
                          {product.product_type} · MK {Number(product.sale_price).toLocaleString('en-MW')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </button>
              ))
            )}
          </div>

          <button
            onClick={() => setStep('description')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 transition-all active:scale-95"
          >
            Skip — Continue without product
          </button>
        </div>
      )}

      {/* Step: Description */}
      {step === 'description' && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setStep('product')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500 space-y-1">
            <div>
              <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
              {' · '}
              <span className="font-mono font-bold">{selectedAccount?.code}</span>
              {' '}
              <span>{selectedAccount?.name}</span>
            </div>
            {selectedProduct && (
              <div className="flex items-center gap-2 text-xs">
                <Package className="h-3 w-3" />
                <span className="font-medium text-gray-700">{selectedProduct.name}</span>
                {selectedProduct.sku && <span className="text-gray-400">({selectedProduct.sku})</span>}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={selectedProduct ? `e.g. Sale of ${selectedProduct.name}...` : `e.g. ${selectedAccount?.name} payment...`}
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
          <button onClick={() => setStep('product')} className="flex items-center gap-1 text-sm text-gray-500">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500 space-y-1">
            <div>
              <span className="font-medium text-gray-900">MK {rawAmount.toLocaleString('en-MW')}</span>
              {' · '}
              <span>{selectedAccount?.name}</span>
            </div>
            {selectedProduct && (
              <div className="text-xs flex items-center gap-1">
                <Package className="h-3 w-3" /> {selectedProduct.name}
              </div>
            )}
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
              <span className="text-gray-900 font-medium text-right max-w-[60%]">
                <span className="font-mono text-xs text-gray-500">[{selectedAccount?.code}]</span> {selectedAccount?.name}
              </span>
            </div>
            {selectedProduct && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Product / Service</span>
                <span className="text-gray-900 font-medium text-right max-w-[60%]">
                  {selectedProduct.name} {selectedProduct.sku ? `(${selectedProduct.sku})` : ''}
                </span>
              </div>
            )}
            {description && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Description</span>
                <span className="text-gray-700 text-right max-w-[60%]">{description}</span>
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
