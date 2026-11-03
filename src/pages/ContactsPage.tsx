import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil,
  Users, Building2, Phone, Mail, MapPin, Search,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ContactModal } from '@/components/contacts/ContactModal';
import { formatMwkDetailed } from '@/lib/formatters';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { ImportTemplateMenu } from '@/components/data/ImportTemplateMenu';
import type { Row } from '@/dal/types/database';


type Tab = 'customer' | 'supplier';

function DeleteConfirm({ contact, onConfirm, onCancel, isPending }: {
  contact: Row<'contacts'>; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Delete contact?</h3>
        <p className="mt-2 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{contact.name}</span> will be removed. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors">
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
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 font-semibold text-sm">
            {contact.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{contact.name}</p>
            {contact.trading_name && <p className="text-xs text-gray-600 truncate">{contact.trading_name}</p>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {contact.email && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{contact.email}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Phone className="h-3.5 w-3.5 shrink-0" /><span>{contact.phone}</span>
          </div>
        )}
        {(contact.city || contact.address_line1) && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[contact.address_line1, contact.city].filter(Boolean).join(', ')}</span>
          </div>
        )}
        {contact.tpin && <div className="text-xs text-gray-600">TPIN: {contact.tpin}</div>}
      </div>

      <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 flex justify-between items-center">
        <span className="text-xs text-gray-500">{totalLabel}</span>
        <span className="text-sm font-semibold text-gray-900">{formatMwkDetailed(total)}</span>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('customer');
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'contacts'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'contacts'> | undefined>();

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', businessId, tab],
    queryFn: () => repos.contact.findByBusinessIncludingBoth(businessId!, tab),
    enabled: Boolean(businessId),
    staleTime: 2 * 60_000,
  });

  // Totals sidebar on each contact card only needs recent transactions —
  // pulling ALL invoices/expenses for the business here was one of the
  // biggest contributors to ContactsPage slowdown on larger datasets.
  // Cap to the most recent year of activity (covers the vast majority of
  // lookups without forcing a full-table transfer).
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', businessId, 'recent_totals'],
    queryFn: () => repos.invoice.findByBusiness(businessId!, undefined, 200),
    enabled: Boolean(businessId) && tab === 'customer',
    staleTime: 2 * 60_000,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', businessId, 'recent_totals'],
    queryFn: () => repos.expense.findByBusiness(businessId!, undefined, 200),
    enabled: Boolean(businessId) && tab === 'supplier',
    staleTime: 2 * 60_000,
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
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
          <p className="mt-1 text-sm text-gray-500">Customers and suppliers for {currentBusiness.business.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportTemplateMenu entityTypes={['contacts']} />
          <button
            onClick={() => { setEditing(undefined); setShowModal(true); }}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add {tab === 'customer' ? 'Customer' : 'Supplier'}
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
          <button onClick={() => setTab('customer')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'customer' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Users className="h-4 w-4" />Customers
          </button>
          <button onClick={() => setTab('supplier')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'supplier' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Building2 className="h-4 w-4" />Suppliers
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, email, phone…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:w-72" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            {tab === 'customer' ? <Users className="h-7 w-7 text-brand-400" /> : <Building2 className="h-7 w-7 text-brand-400" />}
          </div>
          <h2 className="text-base font-semibold text-gray-900">
            {search ? 'No contacts match your search' : `No ${tab}s yet`}
          </h2>
          {!search && (
            <button onClick={() => { setEditing(undefined); setShowModal(true); }}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
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
