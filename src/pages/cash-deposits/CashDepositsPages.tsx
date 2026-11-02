import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CashDepositRepository, type CashDepositAccountChoice, type CashDepositLineInput, type CashDepositStatus } from '@/dal/repositories/CashDepositRepository';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

const repository = new CashDepositRepository(supabase);
const money = (amount: number, currency = 'MWK') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);

function useCashDepositScope() {
  const business = useAppStore((state) => state.currentBusiness?.business);
  return { businessId: business?.id ?? '', baseCurrency: business?.base_currency ?? 'MWK' };
}

function PageTitle({ title, backTo = '/cash-deposits' }: { title: string; backTo?: string }) {
  const { t } = useTranslation();
  return <div className="mb-6 flex items-center gap-3"><Link to={backTo} aria-label={t('common.back')} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"><ArrowLeft size={18} /></Link><h1 className="text-2xl font-bold text-gray-900">{title}</h1></div>;
}

interface DraftFormProps {
  accounts: CashDepositAccountChoice[];
  currency: string;
  initial?: { deposit_date: string; bank_account_id: string; reference: string | null; notes: string | null; lines: CashDepositLineInput[] };
  submitLabel: string;
  failed: boolean;
  pending: boolean;
  onSubmit: (input: { deposit_date: string; bank_account_id: string; reference: string; notes: string; lines: CashDepositLineInput[] }) => Promise<void>;
}

function DraftForm({ accounts, currency, initial, submitLabel, failed, pending, onSubmit }: DraftFormProps) {
  const { t } = useTranslation();
  const [depositDate, setDepositDate] = useState(initial?.deposit_date ?? new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState(initial?.bank_account_id ?? '');
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<CashDepositLineInput[]>(initial?.lines.length ? initial.lines : [{ source_account_id: '', amount: 0, description: '' }]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.is_bank_account), [accounts]);
  const sourceAccounts = useMemo(() => accounts.filter((account) => !account.is_bank_account), [accounts]);
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  const updateLine = (index: number, patch: Partial<CashDepositLineInput>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({ deposit_date: depositDate, bank_account_id: bankAccountId, reference: reference.trim(), notes: notes.trim(), lines });
  };

  return <form onSubmit={(event) => void submit(event)} className="space-y-6">
    <section className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-2">
      <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.depositDate')}<input type="date" required value={depositDate} onChange={(event) => setDepositDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.bankAccount')}<select required value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="">{t('cashDeposits.fields.selectBank')}</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
      <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.reference')}<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
      <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.notes')}<input maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-gray-900">{t('cashDeposits.sourceLines')}</h2><button type="button" onClick={() => setLines((current) => [...current, { source_account_id: '', amount: 0, description: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"><Plus size={16} />{t('cashDeposits.addSource')}</button></div>
      <div className="space-y-3">{lines.map((line, index) => <div key={index} className="grid items-end gap-3 border-b border-gray-100 pb-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(8rem,1fr)_minmax(0,1fr)_auto]">
        <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.sourceAccount')}<select required value={line.source_account_id} onChange={(event) => updateLine(index, { source_account_id: event.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="">{t('cashDeposits.fields.selectSource')}</option>{sourceAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
        <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.amount')}<input type="number" min="0.01" step="0.01" required value={line.amount || ''} onChange={(event) => updateLine(index, { amount: Number(event.target.value) })} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-gray-700">{t('cashDeposits.fields.lineDescription')}<input maxLength={160} value={line.description ?? ''} onChange={(event) => updateLine(index, { description: event.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))} aria-label={t('cashDeposits.removeSource')} className="mb-1 rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 size={18} /></button>
      </div>)}</div>
      <div className="mt-4 flex justify-end text-base font-semibold text-gray-900">{t('cashDeposits.total')}: <span className="ms-2">{money(total, currency)}</span></div>
    </section>
    {failed && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{t('cashDeposits.saveFailed')}</p>}
    <div className="flex justify-end"><button type="submit" disabled={pending} className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{pending ? t('cashDeposits.saving') : submitLabel}</button></div>
  </form>;
}

export function CashDepositsPage() {
  const { t } = useTranslation();
  const { businessId, baseCurrency } = useCashDepositScope();
  const [status, setStatus] = useState<CashDepositStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const deposits = useQuery({ queryKey: ['cash-deposits', businessId, status, search, fromDate, toDate], queryFn: () => repository.list(businessId, { status, search, fromDate: fromDate || undefined, toDate: toDate || undefined }), enabled: !!businessId });
  return <main className="mx-auto max-w-6xl p-4 sm:p-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-gray-900">{t('cashDeposits.title')}</h1><p className="mt-1 text-sm text-gray-600">{t('cashDeposits.subtitle')}</p></div><Link to="/cash-deposits/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17} />{t('cashDeposits.newDeposit')}</Link></div>
    <div className="mb-4 flex flex-wrap gap-3"><input aria-label={t('cashDeposits.search')} placeholder={t('cashDeposits.search')} value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"/><label className="sr-only" htmlFor="cash-deposits-from">{t('cashDeposits.dateFrom')}</label><input id="cash-deposits-from" type="date" aria-label={t('cashDeposits.dateFrom')} value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"/><label className="sr-only" htmlFor="cash-deposits-to">{t('cashDeposits.dateTo')}</label><input id="cash-deposits-to" type="date" aria-label={t('cashDeposits.dateTo')} value={toDate} onChange={(event) => setToDate(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"/><select aria-label={t('cashDeposits.status')} value={status} onChange={(event) => setStatus(event.target.value as CashDepositStatus | 'all')} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="all">{t('cashDeposits.statuses.all')}</option>{(['draft', 'posted', 'voided'] as const).map((value) => <option key={value} value={value}>{t(`cashDeposits.statuses.${value}`)}</option>)}</select></div>
    {deposits.isLoading ? <p className="py-12 text-center text-gray-500">{t('common.loading')}</p> : deposits.isError ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{t('cashDeposits.loadFailed')}</p> : deposits.data?.length ? <div className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-left text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3">{t('cashDeposits.fields.depositDate')}</th><th className="px-4 py-3">{t('cashDeposits.fields.reference')}</th><th className="px-4 py-3">{t('cashDeposits.fields.bankAccount')}</th><th className="px-4 py-3 text-right">{t('cashDeposits.total')}</th><th className="px-4 py-3">{t('cashDeposits.status')}</th></tr></thead><tbody className="divide-y divide-gray-100">{deposits.data.map((deposit) => <tr key={deposit.id} className="hover:bg-gray-50"><td className="px-4 py-3"><Link className="font-semibold text-brand-700 hover:underline" to={`/cash-deposits/${deposit.id}`}>{deposit.deposit_date}</Link></td><td className="px-4 py-3">{deposit.reference || '—'}</td><td className="px-4 py-3">{deposit.bank_account_name}</td><td className="px-4 py-3 text-right tabular-nums">{money(deposit.total_amount, baseCurrency)}</td><td className="px-4 py-3"><StatusBadge status={deposit.status as CashDepositStatus} /></td></tr>)}</tbody></table></div></div> : <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center"><p className="font-semibold text-gray-900">{t('cashDeposits.emptyTitle')}</p><p className="mt-1 text-sm text-gray-600">{t('cashDeposits.emptyDescription')}</p></div>}
  </main>;
}

function StatusBadge({ status }: { status: CashDepositStatus }) {
  const { t } = useTranslation();
  const colors = { draft: 'bg-gray-100 text-gray-700', posted: 'bg-emerald-100 text-emerald-800', voided: 'bg-red-100 text-red-800' };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status]}`}>{t(`cashDeposits.statuses.${status}`)}</span>;
}

export function NewCashDepositPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { businessId, baseCurrency } = useCashDepositScope();
  const accounts = useQuery({ queryKey: ['cash-deposit-accounts', businessId], queryFn: () => repository.getAccountChoices(businessId), enabled: !!businessId });
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({ mutationFn: async (input: { deposit_date: string; bank_account_id: string; reference: string; notes: string; lines: CashDepositLineInput[] }) => { const { lines, ...depositInput } = input; return repository.createDraft({ business_id: businessId, ...depositInput }, lines); }, onSuccess: async (deposit) => { await queryClient.invalidateQueries({ queryKey: ['cash-deposits', businessId] }); navigate(`/cash-deposits/${deposit.id}`); }, onError: () => setFailed(true) });
  return <main className="mx-auto max-w-5xl p-4 sm:p-6"><PageTitle title={t('cashDeposits.newDeposit')} /><p className="mb-5 text-sm text-gray-600">{t('cashDeposits.transferExplanation')}</p>{accounts.isLoading ? <p>{t('common.loading')}</p> : accounts.isError ? <p role="alert">{t('cashDeposits.loadFailed')}</p> : <DraftForm accounts={accounts.data ?? []} currency={baseCurrency} submitLabel={t('cashDeposits.saveDraft')} failed={failed} pending={mutation.isPending} onSubmit={async (input) => { setFailed(false); await mutation.mutateAsync(input); }} />}</main>;
}

export function CashDepositDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { businessId, baseCurrency } = useCashDepositScope();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const detail = useQuery({ queryKey: ['cash-deposit', businessId, id], queryFn: () => repository.getDetail(businessId, id), enabled: !!businessId && !!id });
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['cash-deposit', businessId, id] }); await queryClient.invalidateQueries({ queryKey: ['cash-deposits', businessId] }); };
  const edit = useMutation({ mutationFn: (input: { deposit_date: string; bank_account_id: string; reference: string; notes: string; lines: CashDepositLineInput[] }) => { const { lines, ...depositInput } = input; return repository.updateDraft(businessId, id, depositInput, lines); }, onSuccess: refresh, onError: () => setFailed(true) });
  const post = useMutation({ mutationFn: () => repository.post(id), onSuccess: refresh, onError: () => setFailed(true) });
  const voidDeposit = useMutation({ mutationFn: () => repository.voidAndReverse(id, reason), onSuccess: refresh, onError: () => setFailed(true) });
  const accountNames = useMemo(() => new Map((detail.data?.accounts ?? []).map((account) => [account.id, `${account.code} — ${account.name}`])), [detail.data?.accounts]);
  if (detail.isLoading) return <main className="mx-auto max-w-5xl p-6">{t('common.loading')}</main>;
  if (detail.isError || !detail.data) return <main className="mx-auto max-w-5xl p-6"><PageTitle title={t('cashDeposits.title')} /><p role="alert">{t('cashDeposits.loadFailed')}</p></main>;
  const { deposit, lines, accounts } = detail.data;
  const total = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  const bank = accounts.find((account) => account.id === deposit.bank_account_id);
  return <main className="mx-auto max-w-5xl p-4 sm:p-6"><PageTitle title={t('cashDeposits.detailTitle')} />
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5"><div><div className="flex items-center gap-3"><h2 className="text-lg font-semibold text-gray-900">{deposit.reference || t('cashDeposits.noReference')}</h2><StatusBadge status={deposit.status as CashDepositStatus} /></div><p className="mt-2 text-sm text-gray-600">{t('cashDeposits.fields.depositDate')}: {deposit.deposit_date} · {bank?.name ?? '—'}</p>{deposit.notes && <p className="mt-2 text-sm text-gray-600">{deposit.notes}</p>}</div><div className="text-right"><div className="text-xs font-medium uppercase tracking-wide text-gray-500">{t('cashDeposits.total')}</div><div className="text-xl font-bold text-gray-900">{money(total, baseCurrency)}</div></div></div>
    {deposit.status === 'draft' ? <><DraftForm accounts={accounts} currency={baseCurrency} initial={{ deposit_date: deposit.deposit_date, bank_account_id: deposit.bank_account_id, reference: deposit.reference, notes: deposit.notes, lines: lines.map((line) => ({ source_account_id: line.source_account_id, amount: Number(line.amount), description: line.description })) }} submitLabel={t('cashDeposits.updateDraft')} failed={failed} pending={edit.isPending} onSubmit={async (input) => { setFailed(false); await edit.mutateAsync(input); }} /><div className="mt-5 flex justify-end"><button disabled={post.isPending} onClick={() => { setFailed(false); post.mutate(); }} className="rounded-lg bg-emerald-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50">{t('cashDeposits.post')}</button></div></> : <section className="rounded-xl border border-gray-200 bg-white p-5"><h2 className="mb-4 font-semibold text-gray-900">{t('cashDeposits.sourceLines')}</h2><div className="divide-y divide-gray-100">{lines.map((line) => <div key={line.id} className="flex justify-between gap-4 py-3 text-sm"><span><span className="block font-medium text-gray-900">{accountNames.get(line.source_account_id) ?? '—'}</span>{line.description && <span className="text-gray-500">{line.description}</span>}</span><span className="font-semibold tabular-nums">{money(Number(line.amount), baseCurrency)}</span></div>)}</div>{deposit.status === 'posted' && <div className="mt-5 border-t border-gray-200 pt-5"><label className="block text-sm font-medium text-gray-700">{t('cashDeposits.voidReason')}<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label><button disabled={voidDeposit.isPending || !reason.trim()} onClick={() => { setFailed(false); voidDeposit.mutate(); }} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">{t('cashDeposits.void')}</button></div>}{deposit.status === 'voided' && deposit.void_reason && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('cashDeposits.voidReason')}: {deposit.void_reason}</p>}</section>}
    {failed && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{t('cashDeposits.actionFailed')}</p>}
  </main>;
}
