import { useState } from 'react';
import {
  Settings,
  X,
  Shield,
  Receipt,
  CreditCard,
  Check,
  AlertCircle,
  Save,
  Sliders,
} from 'lucide-react';
import type { PosSettings } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: PosSettings;
  onSaveSettings: (newSettings: Partial<PosSettings>) => Promise<void>;
  isOwnerOrManager: boolean;
}

export function PosSettingsModal({
  open,
  onClose,
  settings,
  onSaveSettings,
  isOwnerOrManager,
}: PosSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'discounts' | 'receipt' | 'payments' | 'security'>('discounts');
  const [formData, setFormData] = useState<PosSettings>({ ...settings });
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerOrManager) {
      alert('Only store owners and managers can update POS settings.');
      return;
    }

    setIsSaving(true);
    try {
      await onSaveSettings(formData);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const togglePaymentMethod = (method: string) => {
    const current = formData.enabled_payment_methods || [];
    if (current.includes(method)) {
      if (current.length === 1) {
        alert('You must leave at least one payment method enabled.');
        return;
      }
      setFormData({
        ...formData,
        enabled_payment_methods: current.filter((m) => m !== method),
      });
    } else {
      setFormData({
        ...formData,
        enabled_payment_methods: [...current, method],
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">POS System Configuration</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-100 mt-2">
          {[
            { id: 'discounts' as const, label: 'Discounts & Limits', icon: Sliders },
            { id: 'receipt' as const, label: 'Receipt Template', icon: Receipt },
            { id: 'payments' as const, label: 'Payment Methods', icon: CreditCard },
            { id: 'security' as const, label: 'Security & Approvals', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors border-b-2 ${
                  isActive
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 pr-1 space-y-4">
          {!isOwnerOrManager && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Read-only view. Store Owner or Manager credentials are required to modify settings.</span>
            </div>
          )}

          {/* TAB 1: DISCOUNTS & LIMITS */}
          {activeTab === 'discounts' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    Cashier Max Discount (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!isOwnerOrManager}
                    value={formData.max_cashier_discount_percent}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        max_cashier_discount_percent: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Discounts above this will require manager PIN</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    Manager Max Discount (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!isOwnerOrManager}
                    value={formData.max_manager_discount_percent}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        max_manager_discount_percent: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Maximum authorization threshold for managers</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    Cash Variance Threshold (MWK)
                  </label>
                  <input
                    type="number"
                    min={0}
                    disabled={!isOwnerOrManager}
                    value={formData.cash_variance_threshold}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cash_variance_threshold: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Variances exceeding {formatMwkDetailed(formData.cash_variance_threshold)} require mandatory explanation on shift close
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    Default VAT / Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!isOwnerOrManager}
                    value={formData.default_tax_rate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        default_tax_rate: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Standard Malawi MRA VAT (typically 16.5% or 0%)</p>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isOwnerOrManager}
                    checked={formData.allow_negative_stock_sales}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        allow_negative_stock_sales: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-gray-900">Allow Negative Stock Sales</span>
                    <p className="text-[11px] text-gray-500">
                      When enabled, sales will proceed even if recorded stock is 0 (warns cashier).
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* TAB 2: RECEIPT TEMPLATE */}
          {activeTab === 'receipt' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                  Receipt Header Title
                </label>
                <input
                  type="text"
                  disabled={!isOwnerOrManager}
                  value={formData.receipt_header || ''}
                  onChange={(e) => setFormData({ ...formData, receipt_header: e.target.value })}
                  placeholder="e.g. Ledgr Wholesale & Retail Ltd"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    TPIN / Tax Reg #
                  </label>
                  <input
                    type="text"
                    disabled={!isOwnerOrManager}
                    value={formData.receipt_tax_number || ''}
                    onChange={(e) => setFormData({ ...formData, receipt_tax_number: e.target.value })}
                    placeholder="e.g. TPIN: 10098472"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                    Support / WhatsApp Phone
                  </label>
                  <input
                    type="text"
                    disabled={!isOwnerOrManager}
                    value={formData.receipt_phone || ''}
                    onChange={(e) => setFormData({ ...formData, receipt_phone: e.target.value })}
                    placeholder="e.g. +265 999 123 456"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">
                  Receipt Footer Message
                </label>
                <input
                  type="text"
                  disabled={!isOwnerOrManager}
                  value={formData.receipt_footer || ''}
                  onChange={(e) => setFormData({ ...formData, receipt_footer: e.target.value })}
                  placeholder="e.g. Zikomo kwambiri! Goods once sold cannot be returned without receipt."
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                />
              </div>
            </div>
          )}

          {/* TAB 3: PAYMENT METHODS */}
          {activeTab === 'payments' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Select the payment methods supported at your POS checkout counters.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { id: 'cash', label: 'Cash (MWK Notes)', desc: 'Malawi Kwacha physical tender' },
                  { id: 'airtel_money', label: 'Airtel Money', desc: 'Mobile money push / QR' },
                  { id: 'tnm_mpamba', label: 'TNM Mpamba', desc: 'Mobile money push / QR' },
                  { id: 'bank_transfer', label: 'Bank Transfer / POS Card', desc: 'National Bank, Standard Bank, POS' },
                  { id: 'credit_sale', label: 'Store Credit Sales', desc: 'Pay later with customer ledger account' },
                ].map((item) => {
                  const isChecked = (formData.enabled_payment_methods || []).includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => isOwnerOrManager && togglePaymentMethod(item.id)}
                      className={`flex items-start gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                        isChecked
                          ? 'border-brand-500 bg-brand-50/40 text-brand-900'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                          isChecked ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3" />}
                      </div>
                      <div>
                        <p className="font-bold text-xs text-gray-900">{item.label}</p>
                        <p className="text-[11px] text-gray-500">{item.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: SECURITY & APPROVALS */}
          {activeTab === 'security' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Configure manager override requirements for high-risk cashier operations.
              </p>

              <div className="space-y-2">
                {[
                  {
                    key: 'require_manager_approval_discount',
                    label: 'Require Manager Approval for Discounts',
                    desc: 'Required when cashier applies discount above the max limit',
                  },
                  {
                    key: 'require_manager_approval_void',
                    label: 'Require Manager Approval to Void Sale',
                    desc: 'Cashier cannot void a completed sale without manager PIN',
                  },
                  {
                    key: 'require_manager_approval_refund',
                    label: 'Require Manager Approval for Returns / Refunds',
                    desc: 'Issuing cash refunds or credit notes requires manager PIN',
                  },
                  {
                    key: 'require_manager_approval_price_override',
                    label: 'Require Manager Approval for Price Override',
                    desc: 'Changing catalog item price directly in cart',
                  },
                ].map((item) => {
                  const isChecked = Boolean(formData[item.key as keyof PosSettings]);
                  return (
                    <label
                      key={item.key}
                      className="flex items-start gap-3 p-3 rounded-2xl border border-gray-200 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        disabled={!isOwnerOrManager}
                        checked={isChecked}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            [item.key]: e.target.checked,
                          })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div>
                        <p className="font-bold text-xs text-gray-900">{item.label}</p>
                        <p className="text-[11px] text-gray-500">{item.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Save */}
          {isOwnerOrManager && (
            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
              {savedSuccess ? (
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 animate-in fade-in">
                  <Check className="h-4 w-4" /> Settings updated successfully!
                </span>
              ) : (
                <span className="text-[11px] text-gray-400">All changes take effect immediately across all POS terminals.</span>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 text-xs font-black shadow-md disabled:opacity-50 active:scale-95 transition-all"
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save POS Settings'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
