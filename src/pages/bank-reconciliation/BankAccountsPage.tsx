import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Pencil, Plus, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BankReconciliationRepository, type BankAccount, type CashBankCoaAccount, type CreateBankAccountInput, type UpdateBankAccountInput } from '@/dal/repositories/BankReconciliationRepository';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';

interface AccountFormModalProps {
  businessId: string;
  accounts: BankAccount[];
  coaAccounts: CashBankCoaAccount[];
  editing: BankAccount | null;
  onClose: () => void;
  onSave: (input: CreateBankAccountInput | UpdateBankAccountInput, editing: BankAccount | null) => Promise<void>;
}

function AccountFormModal({ businessId, accounts, coaAccounts, editing, onClose, onSave }: AccountFormModalProps) {
  const { t } = useTranslation();
  const [bankName, setBankName] = useState(editing?.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState(editing?.account_number ?? '');
  const [branchName, setBranchName] = useState(editing?.branch_name ?? '');
  const [accountId, setAccountId] = useState(editing?.account_id ?? '');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const availableAccounts = useMemo(() => {
    const selected = editing
      ? [{ id: editing.account_id, code: editing.account_code, name: editing.account_name, is_bank_account: false }]
      : [];
    const combined = [...coaAccounts, ...selected];
    const unique = new Map(combined.map((account) => [account.id, account]));
    return [...unique.values()].filter((account) =>
      !accounts.some((configured) => configured.account_id === account.id && configured.id !== editing?.id),
    );
  }, [accounts, coaAccounts, editing]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveFailed(false);
    setSaving(true);
    try {
      await onSave({
        ...(editing ? {} : { business_id: businessId }),
        account_id: accountId,
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
        branch_name: branchName.trim() || null,
        ...(!editing ? { currency: 'MWK' as const } : {}),
      } as CreateBankAccountInput | UpdateBankAccountInput, editing);
      onClose();
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="bank-account-modal-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="bank-account-modal-title" className="text-lg font-semibold text-gray-900">
          {t(editing ? 'bankReconciliation.accounts.editAccount' : 'bankReconciliation.accounts.addAccount')}
        </h2>
        <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block text-sm font-medium text-gray-700">
            {t('bankReconciliation.accounts.bankName')}
            <input value={bankName} onChange={(event) => setBankName(event.target.value)} required maxLength={120} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('bankReconciliation.accounts.accountNumber')}
            <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} required maxLength={120} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('bankReconciliation.accounts.branchName')}
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} maxLength={120} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('bankReconciliation.accounts.linkedAccount')}
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">{t('bankReconciliation.accounts.selectLinkedAccount')}</option>
              {availableAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </select>
          </label>
          {availableAccounts.length === 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('bankReconciliation.accounts.noEligibleCoaAccounts')}</p>
          )}
          <div className="text-sm text-gray-700">
            <span className="font-medium">{t('bankReconciliation.accounts.currency')}</span>
            <span className="ms-2">MWK</span>
          </div>
          {saveFailed && <p role="alert" className="text-sm text-red-700">{t('bankReconciliation.shared.saveFailed')}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">{t('common.cancel')}</button>
            <button type="submit" disabled={saving || !accountId} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function BankAccountsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const { canWrite } = usePermissions();
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const accountsQuery = useQuery({
    queryKey: ['bank-reconciliation', 'accounts', businessId],
    queryFn: () => BankReconciliationRepository.getBankAccounts(supabase, businessId),
    enabled: Boolean(businessId),
  });
  const coaQuery = useQuery({
    queryKey: ['bank-reconciliation', 'cash-bank-coa', businessId],
    queryFn: () => BankReconciliationRepository.getEligibleCoaAccounts(supabase, businessId),
    enabled: Boolean(businessId),
  });
  const accounts = accountsQuery.data ?? [];
  const coaAccounts = coaQuery.data ?? [];

  const saveAccount = async (input: CreateBankAccountInput | UpdateBankAccountInput, target: BankAccount | null) => {
    setSaveFailed(false);
    if (target) {
      await BankReconciliationRepository.updateBankAccount(supabase, businessId, target.id, input as UpdateBankAccountInput);
    } else {
      await BankReconciliationRepository.createBankAccount(supabase, input as CreateBankAccountInput);
    }
    await queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'accounts', businessId] });
  };

  const deactivate = async (account: BankAccount) => {
    if (!window.confirm(t('bankReconciliation.accounts.deactivateConfirm'))) return;
    setSaveFailed(false);
    try {
      await BankReconciliationRepository.deactivateBankAccount(supabase, businessId, account.id);
      await queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'accounts', businessId] });
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('bankReconciliation.accounts.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('bankReconciliation.accounts.description')}</p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => { setEditing(null); setShowForm(true); }} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.accounts.addAccount')}
          </button>
        )}
      </header>

      {(saveFailed || accountsQuery.isError || coaQuery.isError) && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t('bankReconciliation.shared.loadOrSaveFailed')}</p>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('bankReconciliation.accounts.title')}>
        {accountsQuery.isPending ? (
          <div role="status" className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
        ) : accounts.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
            <Landmark className="mb-3 h-9 w-9 text-gray-400" aria-hidden="true" />
            <p className="max-w-lg text-sm text-gray-600">{t('bankReconciliation.accounts.noAccounts')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.bankName')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.accountNumber')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.branchName')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.linkedAccount')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.currency')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.accounts.status')}</th>
                  {canWrite && <th className="px-4 py-3">{t('bankReconciliation.shared.actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{account.bank_name}</td>
                    <td className="px-4 py-3 text-gray-700">{account.account_number}</td>
                    <td className="px-4 py-3 text-gray-700">{account.branch_name || t('bankReconciliation.shared.notSet')}</td>
                    <td className="px-4 py-3 text-gray-700">{account.account_code} — {account.account_name}</td>
                    <td className="px-4 py-3 text-gray-700">{account.currency}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${account.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {t(account.is_active ? 'bankReconciliation.accounts.active' : 'bankReconciliation.accounts.inactive')}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setEditing(account); setShowForm(true); }} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700">
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('common.edit')}
                          </button>
                          {account.is_active && (
                            <button type="button" onClick={() => void deactivate(account)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700">
                              <Power className="h-3.5 w-3.5" aria-hidden="true" />{t('bankReconciliation.accounts.deactivate')}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {showForm && (
        <AccountFormModal
          businessId={businessId}
          accounts={accounts}
          coaAccounts={coaAccounts}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSave={saveAccount}
        />
      )}
    </main>
  );
}
