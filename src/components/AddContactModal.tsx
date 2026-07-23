import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { repos } from '@/lib/repositories';

type ContactType = 'customer' | 'supplier';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  tpin: string;
}

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-danger/10 text-danger'
    }`}>
      {type === 'success'
        ? <CheckCircle className="h-4 w-4 shrink-0" />
        : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

export function AddContactModal({
  contactType,
  businessId,
  onClose,
  onCreated,
}: {
  contactType: ContactType;
  businessId: string;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ContactForm>({ name: '', email: '', phone: '', tpin: '' });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof ContactForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const data = await repos.contact.createContact({
        business_id: businessId,
        contact_type: contactType,
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        tpin: form.tpin || null,
        wht_exempt: false,
        is_active: true,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setAlert({ type: 'success', message: `${contactType === 'customer' ? 'Customer' : 'Supplier'} added.` });
      setTimeout(() => {
        onCreated(data.id, data.name);
        onClose();
      }, 800);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const label = contactType === 'customer' ? 'Customer' : 'Supplier';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Add {label}</h2>
          <button onClick={onClose} className="text-muted hover:text-sub">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={contactType === 'customer' ? 'e.g. John Banda' : 'e.g. Apex Suppliers Ltd'}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Email (optional)</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="email@example.com"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Phone (optional)</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+265 99 000 0000"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">TPIN (optional)</label>
            <input
              type="text"
              value={form.tpin}
              onChange={(e) => set('tpin', e.target.value)}
              placeholder="e.g. 100000000"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-brand-500/8 hover:text-ink transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : `Add ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
