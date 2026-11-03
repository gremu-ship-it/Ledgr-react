import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

/**
 * Create/edit modal for contacts — extracted from ContactsPage (P2-3) so the
 * construction ClientPicker can open it for inline "Add new client" without
 * importing the whole page.
 *
 * P2-3 additions:
 *  - a contact-type selector exposing 'both' ("Customer & Supplier") — the
 *    DB CHECK always accepted it; the UI previously could not express it;
 *  - `defaultName` to prefill the inline-create flow;
 *  - `onCreated` so an opener (ClientPicker) can select the new contact.
 * Existing copy on this page is intentionally untouched (no i18n retrofit).
 */

export type ContactTypeValue = 'customer' | 'supplier' | 'both';

interface ContactForm {
  name: string;
  trading_name: string;
  email: string;
  phone: string;
  tpin: string;
  address_line1: string;
  address_line2: string;
  city: string;
  country: string;
  notes: string;
  wht_exempt: boolean;
}

const EMPTY_FORM: ContactForm = {
  name: '', trading_name: '', email: '', phone: '', tpin: '',
  address_line1: '', address_line2: '', city: '', country: 'Malawi',
  notes: '', wht_exempt: false,
};

export function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

export function ContactModal({
  contactType, existing, businessId, onClose, defaultName, onCreated,
}: {
  contactType: ContactTypeValue;
  existing?: Row<'contacts'>;
  businessId: string;
  onClose: () => void;
  /** Prefills the name field (ClientPicker inline-create passes the search term). */
  defaultName?: string;
  /** Called with the persisted row after a successful CREATE (not on edit). */
  onCreated?: (contact: Row<'contacts'>) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typeValue, setTypeValue] = useState<ContactTypeValue>(
    existing ? ((existing.contact_type as ContactTypeValue) ?? contactType) : contactType,
  );
  const [form, setForm] = useState<ContactForm>(
    existing ? {
      name: existing.name ?? '',
      trading_name: existing.trading_name ?? '',
      email: existing.email ?? '',
      phone: existing.phone ?? '',
      tpin: existing.tpin ?? '',
      address_line1: existing.address_line1 ?? '',
      address_line2: existing.address_line2 ?? '',
      city: existing.city ?? '',
      country: existing.country ?? 'Malawi',
      notes: existing.notes ?? '',
      wht_exempt: existing.wht_exempt ?? false,
    } : { ...EMPTY_FORM, name: defaultName ?? '' },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof ContactForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async (): Promise<Row<'contacts'> | null> => {
      if (!form.name.trim()) throw new Error('Name is required');
      const payload = {
        business_id: businessId,
        contact_type: typeValue,
        name: form.name.trim(),
        trading_name: form.trading_name || null,
        email: form.email || null,
        phone: form.phone || null,
        tpin: form.tpin || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        country: form.country || null,
        notes: form.notes || null,
        wht_exempt: form.wht_exempt,
        is_active: true,
      };

      if (existing) {
        await repos.contact.updateContact(existing.id, payload);
        return null;
      }
      return await repos.contact.createContact(payload);
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      if (created) onCreated?.(created);
      setAlert({ type: 'success', message: existing ? 'Contact updated.' : 'Contact added.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const label =
    typeValue === 'customer'
      ? 'Customer'
      : typeValue === 'supplier'
        ? 'Supplier'
        : t('contacts.typeBoth');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="contact-modal">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? `Edit ${label}` : `Add ${label}`}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="contact-modal-type">
                {t('contacts.typeLabel')}
              </label>
              <select
                id="contact-modal-type"
                data-testid="contact-modal-type"
                value={typeValue}
                onChange={(e) => setTypeValue(e.target.value as ContactTypeValue)}
                className={INPUT_CLASS}
              >
                <option value="customer">{t('contacts.typeCustomer')}</option>
                <option value="supplier">{t('contacts.typeSupplier')}</option>
                <option value="both">{t('contacts.typeBoth')}</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                data-testid="contact-modal-name"
                placeholder={typeValue === 'supplier' ? 'e.g. Apex Suppliers Ltd' : 'e.g. John Banda'}
                className={INPUT_CLASS} />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Trading Name (optional)</label>
              <input type="text" value={form.trading_name} onChange={(e) => set('trading_name', e.target.value)}
                placeholder="e.g. Apex"
                className={INPUT_CLASS} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                placeholder="email@example.com"
                className={INPUT_CLASS} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)}
                placeholder="+265 99 000 0000"
                className={INPUT_CLASS} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Tax PIN (TPIN)</label>
              <input type="text" value={form.tpin} onChange={(e) => set('tpin', e.target.value)}
                placeholder="e.g. 100000000"
                className={INPUT_CLASS} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">City</label>
              <input type="text" value={form.city} onChange={(e) => set('city', e.target.value)}
                placeholder="e.g. Lilongwe"
                className={INPUT_CLASS} />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Address Line 1</label>
              <input type="text" value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)}
                placeholder="Street / PO Box"
                className={INPUT_CLASS} />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Address Line 2</label>
              <input type="text" value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)}
                placeholder="Area / PO Box"
                className={INPUT_CLASS} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Country</label>
              <input type="text" value={form.country} onChange={(e) => set('country', e.target.value)}
                className={INPUT_CLASS} />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="wht_exempt" checked={form.wht_exempt}
                onChange={(e) => set('wht_exempt', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              <label htmlFor="wht_exempt" className="text-sm text-gray-700">WHT Exempt</label>
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)}
                className={INPUT_CLASS} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            data-testid="contact-modal-save"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : `Add ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
