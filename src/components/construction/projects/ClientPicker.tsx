import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Link2, Plus, UserPlus, X } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { ContactModal } from '@/components/contacts/ContactModal';
import type { Row } from '@/dal/types/database';

const k = 'construction.clients';

export interface ClientPickerProps {
  businessId: string;
  /** Linked contact id, or null when the project only carries the text name. */
  value: string | null;
  /** client_name display cache — kept in sync through onChange. */
  clientName: string;
  onChange: (clientId: string | null, clientName: string) => void;
  disabled?: boolean;
}

/**
 * Searchable client combobox for construction projects (P2-3).
 *
 * Lists billing-eligible contacts (`customer` or `both`, not deleted) via
 * ContactRepository.findClientContacts with a debounced ILIKE search. Two
 * creation paths: "Add new client" opens the shared ContactModal (full
 * detail), and an unmatched search offers inline "Create client '<term>'"
 * (quick customer contact). Unlinking (×) asks for confirmation and hands
 * control back to the caller with the display-cache text preserved — the
 * prompt's tender-stage fallback.
 */
export function ClientPicker({
  businessId,
  value,
  clientName,
  onChange,
  disabled = false,
}: ClientPickerProps) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the search term (min 2 chars reaches the server as ILIKE).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  // Close the dropdown on outside clicks.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const contactsQuery = useQuery({
    queryKey: ['construction', 'client-contacts', businessId, debouncedTerm],
    queryFn: () => repos.contact.findClientContacts(businessId, debouncedTerm),
    staleTime: 30_000,
  });

  const quickCreate = useMutation({
    mutationFn: (name: string) =>
      repos.contact.createContact({
        business_id: businessId,
        name,
        contact_type: 'customer',
        is_active: true,
        wht_exempt: false,
      }),
    onSuccess: (contact: Row<'contacts'>) => {
      void cache.invalidateQueries({ queryKey: ['construction', 'client-contacts'] });
      void cache.invalidateQueries({ queryKey: ['contacts'] });
      onChange(contact.id, contact.name);
      setTerm('');
      setDebouncedTerm('');
      setOpen(false);
    },
  });

  const contacts = contactsQuery.data ?? [];
  const typedName = term.trim();
  const exactMatch = contacts.some(
    (contact) => contact.name.toLowerCase() === typedName.toLowerCase(),
  );
  const showCreate = typedName.length >= 2 && !exactMatch;

  const unlink = () => {
    if (disabled) return;
    // Same confirm-before-destructive pattern as the site unlink warning.
    if (!window.confirm(t(`${k}.unlinkConfirm`))) return;
    onChange(null, clientName);
  };

  return (
    <div className="relative" ref={containerRef} data-testid="client-picker">
      <div
        className={`flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm ${
          disabled ? 'bg-gray-100 text-gray-500' : 'cursor-pointer hover:border-gray-400'
        }`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="client-picker-toggle"
        onClick={() => {
          if (!disabled) setOpen((previous) => !previous);
        }}
      >
        {value ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            <span className="truncate font-medium text-gray-900" data-testid="client-picker-linked-name">
              {clientName}
            </span>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-brand-600">
              {t(`${k}.linkedClient`)}
            </span>
          </span>
        ) : (
          <span className="truncate text-gray-500">
            {clientName || t(`${k}.pickerPlaceholder`)}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {value && !disabled ? (
            <button
              type="button"
              aria-label={t(`${k}.unlinkClient`)}
              title={t(`${k}.unlinkClient`)}
              data-testid="client-picker-unlink"
              className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                unlink();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
        </span>
      </div>

      {open ? (
        <div
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          data-testid="client-picker-dropdown"
        >
          <div className="border-b border-gray-100 p-2">
            <input
              autoFocus
              type="text"
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={t(`${k}.pickerPlaceholder`)}
              aria-label={t(`${k}.pickerPlaceholder`)}
              data-testid="client-picker-search"
              value={term}
              disabled={disabled}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>

          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {contactsQuery.isLoading ? (
              <li className="px-3 py-2 text-sm text-gray-500" data-testid="client-picker-loading">
                {t('common.loading')}
              </li>
            ) : contacts.length === 0 && !showCreate ? (
              <li className="px-3 py-2 text-sm text-gray-500" data-testid="client-picker-empty">
                {t(`${k}.noClientsFound`)}
              </li>
            ) : (
              contacts.map((contact) => (
                <li key={contact.id} role="option" aria-selected={contact.id === value}>
                  <button
                    type="button"
                    data-testid={`client-picker-option-${contact.id}`}
                    disabled={disabled || quickCreate.isPending}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:opacity-60 ${
                      contact.id === value ? 'bg-brand-50/60' : ''
                    }`}
                    onClick={() => {
                      onChange(contact.id, contact.name);
                      setTerm('');
                      setDebouncedTerm('');
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">{contact.name}</span>
                      {contact.tpin ? (
                        <span className="block truncate text-xs text-gray-500">
                          TPIN {contact.tpin}
                        </span>
                      ) : null}
                    </span>
                    {contact.contact_type === 'both' ? (
                      <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                        {t('contacts.typeBoth')}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}

            {showCreate ? (
              <li>
                <button
                  type="button"
                  data-testid="client-picker-create"
                  disabled={disabled || quickCreate.isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 disabled:opacity-60"
                  onClick={() => quickCreate.mutate(typedName)}
                >
                  <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
                  {quickCreate.isPending
                    ? t('common.saving')
                    : t(`${k}.createClient`, { name: typedName })}
                </button>
              </li>
            ) : null}
          </ul>

          <div className="border-t border-gray-100 p-1">
            <button
              type="button"
              data-testid="client-picker-add-new"
              disabled={disabled}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              onClick={() => {
                setOpen(false);
                setModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden />
              {t(`${k}.addNewClient`)}
            </button>
          </div>

          {quickCreate.isError ? (
            <p className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">
              {quickCreate.error.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {modalOpen ? (
        <ContactModal
          contactType="customer"
          businessId={businessId}
          defaultName={typedName}
          onClose={() => setModalOpen(false)}
          onCreated={(contact) => {
            onChange(contact.id, contact.name);
            setTerm('');
            setDebouncedTerm('');
          }}
        />
      ) : null}
    </div>
  );
}
