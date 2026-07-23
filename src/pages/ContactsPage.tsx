import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  Users, Building2, Phone, Mail, MapPin, X, Search,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ContactType = 'customer' | 'supplier';
type Tab = 'customer' | 'supplier';

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

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-danger/10 text-danger'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

function ContactModal({
  contactType, existing, businessId, onClose,
}: {
  contactType: ContactType;
  existing?: Row<'contacts'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
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
    } : { ...EMPTY_FORM },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof ContactForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const payload = {
        business_id: businessId,
        contact_type: contactType,
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
      } else {
        await repos.contact.createContact(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setAlert({ type: 'success', message: existing ? 'Contact updated.' : 'Contact added.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const label = contactType === 'customer' ? 'Customer' : 'Supplier';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">{existing ? `Edit ${label}` : `Add ${label}`}</h2>
          <button onClick={onClose} className="text-muted hover:text-sub"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder={contactType === 'customer' ? 'e.g. John Banda' : 'e.g. Apex Suppliers Ltd'}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Trading Name (optional)</label>
              <input type="text" value={form.trading_name} onChange={(e) => set('trading_name', e.target.value)}
                placeholder="e.g. Apex"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)}
                placeholder="+265 99 000 0000"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Tax PIN (TPIN)</label>
              <input type="text" value={form.tpin} onChange={(e) => set('tpin', e.target.value)}
                placeholder="e.g. 100000000"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">City</label>
              <input type="text" value={form.city} onChange={(e) => set('city', e.target.value)}
                placeholder="e.g. Lilongwe"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Address Line 1</label>
              <input type="text" value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)}
                placeholder="Street / PO Box"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Address Line 2</label>
              <input type="text" value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)}
                placeholder="Area / District"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Country</label>
              <input type="text" value={form.country} onChange={(e) => set('country', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="wht_exempt" checked={form.wht_exempt}
                onChange={(e) => set('wht_exempt', e.target.checked)}
                className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400 focus:ring-brand-500" />
              <label htmlFor="wht_exempt" className="text-sm text-sub">WHT Exempt</label>
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Notes (optional)</label>
              <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : `Add ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({ contact, onConfirm, onCancel, isPending }: {
  contact: Row<'contacts'>; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">Delete contact?</h3>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-sub">{contact.name}</span> will be removed. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger disabled:opacity-60 transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactCard({ contact, totalLabel, total, onEdit, onDelete }: {
  contact: Row<'contacts'>; totalLabel: string; total: number;
  onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-300 font-semibold text-sm">
            {contact.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{contact.name}</p>
            {contact.trading_name && <p className="text-xs text-muted truncate">{contact.trading_name}</p>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit}
            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-sub transition-colors">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete}
            className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {contact.email && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{contact.email}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Phone className="h-3.5 w-3.5 shrink-0" /><span>{contact.phone}</span>
          </div>
        )}
        {(contact.city || contact.address_line1) && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[contact.address_line1, contact.city].filter(Boolean).join(', ')}</span>
          </div>
        )}
        {contact.tpin && <div className="text-xs text-muted">TPIN: {contact.tpin}</div>}
      </div>

      <div className="mt-3 rounded-lg bg-bg px-3 py-2 flex justify-between items-center">
        <span className="text-xs text-muted">{totalLabel}</span>
        <span className="text-sm font-semibold text-ink">{formatMwk(total)}</span>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('customer');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'contacts'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'contacts'> | undefined>();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', businessId, tab],
    queryFn: () => repos.contact.findByBusiness(businessId!, tab),
    enabled: Boolean(businessId),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', businessId],
    queryFn: () => repos.invoice.findByBusiness(businessId!),
    enabled: Boolean(businessId) && tab === 'customer',
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', businessId],
    queryFn: () => repos.expense.findByBusiness(businessId!),
    enabled: Boolean(businessId) && tab === 'supplier',
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repos.contact.deleteContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setDeleting(undefined);
    },
  });

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search),
  );

  function getTotal(contactId: string): number {
    if (tab === 'customer') {
      return (invoices as Array<{ contact_id: string | null; total_amount: number }>)
        .filter((inv) => inv.contact_id === contactId)
        .reduce((s, inv) => s + (inv.total_amount ?? 0), 0);
    } else {
      return (expenses as Array<{ contact_id: string | null; total_amount: number }>)
        .filter((exp) => exp.contact_id === contactId)
        .reduce((s, exp) => s + (exp.total_amount ?? 0), 0);
    }
  }

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Contacts</h1>
          <p className="mt-1 text-sm text-muted">Customers and suppliers for {currentBusiness.business.name}</p>
        </div>
        <button
          onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add {tab === 'customer' ? 'Customer' : 'Supplier'}
        </button>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit gap-1 rounded-xl border border-line bg-bg p-1">
          <button onClick={() => setTab('customer')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'customer' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'
            }`}>
            <Users className="h-4 w-4" />Customers
          </button>
          <button onClick={() => setTab('supplier')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'supplier' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'
            }`}>
            <Building2 className="h-4 w-4" />Suppliers
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search by name, email, phone…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:w-72" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-surface" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
            {tab === 'customer' ? <Users className="h-7 w-7 text-brand-600 dark:text-brand-400" /> : <Building2 className="h-7 w-7 text-brand-600 dark:text-brand-400" />}
          </div>
          <h2 className="text-base font-semibold text-ink">
            {search ? 'No contacts match your search' : `No ${tab}s yet`}
          </h2>
          {!search && (
            <button onClick={() => { setEditing(undefined); setShowModal(true); }}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
              <Plus className="h-4 w-4" />Add {tab === 'customer' ? 'Customer' : 'Supplier'}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              totalLabel={tab === 'customer' ? 'Total Invoiced' : 'Total Spent'}
              total={getTotal(contact.id)}
              onEdit={() => { setEditing(contact); setShowModal(true); }}
              onDelete={() => setDeleting(contact)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ContactModal
          contactType={tab}
          existing={editing}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}

      {deleting && (
        <DeleteConfirm
          contact={deleting}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
