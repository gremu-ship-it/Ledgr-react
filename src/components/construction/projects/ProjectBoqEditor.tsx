import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import type { BoqLineInput, Project, ProjectBoqLine } from '@/dal/repositories/ProjectRepository';
import { ErrorBanner } from '../constructionUi';

const k = 'construction.projects.boq';
type Draft = BoqLineInput;
const blank = (sort_order: number): Draft => ({ id: null, line_number: '', description: '', quantity: 0, unit: '', rate: 0, sort_order });
const value = (line: Draft) => Number(line.quantity || 0) * Number(line.rate || 0);

export function ProjectBoqEditor({ project, canManage, onNotice }: { project: Project; canManage: boolean; onNotice: (message: string) => void }) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const linesQuery = useQuery({ queryKey: ['construction', 'boq', project.id], queryFn: () => repos.projects.getBoqLines(project.id) });
  const summaryQuery = useQuery({ queryKey: ['construction', 'boq-summary', project.id], queryFn: () => repos.projects.getBoqSummary(project.id) });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  useEffect(() => {
    if (linesQuery.data) {
      // Hydrate the editable draft from the remote project BOQ after each fetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate local editable state from the server query result.
      setDrafts([...linesQuery.data].sort((a: ProjectBoqLine, b: ProjectBoqLine) => a.sort_order - b.sort_order).map((line: ProjectBoqLine) => ({ id: line.id, line_number: line.line_number, description: line.description, quantity: Number(line.quantity), unit: line.unit, rate: Number(line.rate), sort_order: line.sort_order })));
      setDeleted([]);
    }
  }, [linesQuery.data]);
  const locked = Boolean(summaryQuery.data?.is_locked || project.boq_locked_at);
  const total = useMemo(() => drafts.reduce((sum, line) => sum + value(line), 0), [drafts]);
  const contractSum = Number(summaryQuery.data?.contract_sum ?? project.contract_sum);
  const variance = contractSum - total;
  const save = useMutation({
    mutationFn: () => {
      if (drafts.some((line) => !Number.isFinite(Number(line.quantity)) || !Number.isFinite(Number(line.rate)) || Number(line.quantity) < 0 || Number(line.rate) < 0)) throw new Error(t(`${k}.invalidAmounts`));
      return repos.projects.bulkUpsertBoqLines(project.id, [...drafts.map((line, index) => ({ ...line, sort_order: index })), ...deleted.map((id) => ({ ...blank(0), id, _deleted: true }))]);
    },
    onSuccess: () => {
      onNotice(t(`${k}.saved`));
      void cache.invalidateQueries({ queryKey: ['construction', 'boq', project.id] });
      void cache.invalidateQueries({ queryKey: ['construction', 'boq-summary', project.id] });
    },
  });
  const update = (index: number, key: keyof Draft, v: string) => setDrafts((old) => old.map((line, i) => i === index ? { ...line, [key]: key === 'quantity' || key === 'rate' ? (v === '' ? 0 : Number(v)) : v } : line));
  const reorder = (index: number, step: number) => setDrafts((old) => { const next = [...old]; const target = index + step; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; });
  if (linesQuery.isLoading || summaryQuery.isLoading) return <p>{t(`${k}.loading`)}</p>;
  if (linesQuery.isError) return <ErrorBanner message={linesQuery.error.message} />;
  if (summaryQuery.isError) return <ErrorBanner message={summaryQuery.error.message} />;
  const currency = (amount: number) => amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="space-y-4">
    {locked && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">{t(`${k}.lockBanner`)}</div>}
    <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
      <Summary label={t(`${k}.contractSum`)} amount={contractSum} format={currency} />
      <Summary label={t(`${k}.boqTotal`)} amount={total} format={currency} />
      <div className={`rounded-md p-2 ${Math.abs(variance) < 0.005 ? 'bg-green-50 text-green-800' : variance > 0 ? 'bg-yellow-50 text-yellow-800' : 'bg-red-50 text-red-800'}`}><span className="block text-xs">{t(`${k}.variance`)}</span><strong>{currency(variance)}</strong></div>
      <div className="p-2"><span className="block text-xs">{t(`${k}.status`)}</span><strong>{locked ? t(`${k}.locked`) : t(`${k}.editable`)}</strong></div>
    </div>
    {Math.abs(variance) >= 0.005 && <p role="status" className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">{t(`${k}.mismatch`, { total: currency(total), contract: currency(contractSum), variance: currency(variance) })}</p>}
    {drafts.length === 0 && deleted.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center"><p>{t(`${k}.empty`)}</p>{canManage && !locked && <button className="mt-3 rounded-lg bg-brand-700 px-4 py-2 text-white" onClick={() => setDrafts([blank(0)])}>{t(`${k}.addLine`)}</button>}</div>}
    {(drafts.length > 0 || deleted.length > 0) && <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><thead><tr className="border-b text-left">{['lineNumber','description','quantity','unit','rate','total'].map((col) => <th key={col} className="p-2">{t(`${k}.columns.${col}`)}</th>)}{canManage && !locked && <th className="p-2">{t(`${k}.actions`)}</th>}</tr></thead><tbody>{drafts.map((line, index) => <tr key={line.id ?? `new-${index}`} className="border-b">
      <Cell disabled={!canManage || locked} value={line.line_number} label={t(`${k}.columns.lineNumber`)} onChange={(v) => update(index,'line_number',v)} />
      <Cell disabled={!canManage || locked} value={line.description} label={t(`${k}.columns.description`)} onChange={(v) => update(index,'description',v)} />
      <Cell disabled={!canManage || locked} type="number" min="0" value={String(line.quantity)} label={t(`${k}.columns.quantity`)} onChange={(v) => update(index,'quantity',v)} />
      <Cell disabled={!canManage || locked} value={line.unit} label={t(`${k}.columns.unit`)} onChange={(v) => update(index,'unit',v)} />
      <Cell disabled={!canManage || locked} type="number" min="0" step="0.0001" value={String(line.rate)} label={t(`${k}.columns.rate`)} onChange={(v) => update(index,'rate',v)} />
      <td className="p-2 text-right">{currency(value(line))}</td>
      {canManage && !locked && <td className="whitespace-nowrap p-2"><button aria-label={t(`${k}.moveUp`)} disabled={index===0} onClick={() => reorder(index,-1)}>↑</button> <button aria-label={t(`${k}.moveDown`)} disabled={index===drafts.length-1} onClick={() => reorder(index,1)}>↓</button> <button className="ml-2 text-red-700" onClick={() => { if (window.confirm(t(`${k}.confirmDelete`))) { if (line.id) setDeleted((old) => [...old,line.id!]); setDrafts((old) => old.filter((_,i) => i!==index)); } }}>{t(`${k}.delete`)}</button></td>}
    </tr>)}</tbody><tfoot><tr className="font-semibold"><td colSpan={5} className="p-2 text-right">{t(`${k}.boqTotal`)}</td><td className="p-2 text-right">{currency(total)}</td></tr></tfoot></table></div>}
    {canManage && !locked && drafts.length > 0 && <div className="flex flex-wrap gap-3"><button className="rounded-lg border px-4 py-2" onClick={() => setDrafts((old) => [...old,blank(old.length)])}>{t(`${k}.addLine`)}</button><button className="rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>{t(`${k}.save`)}</button></div>}
    {save.isError && <ErrorBanner message={save.error.message} />}
  </div>;
}
function Summary({ label, amount, format }: { label: string; amount: number; format: (n: number) => string }) { return <div className="p-2"><span className="block text-xs text-gray-500">{label}</span><strong>{format(amount)}</strong></div>; }
function Cell({ value, onChange, disabled, label, type='text', min, step }: { value: string; onChange: (value: string) => void; disabled: boolean; label: string; type?: string; min?: string; step?: string }) { return <td className="p-1"><input aria-label={label} className="w-full rounded border px-2 py-1 disabled:border-transparent disabled:bg-transparent" disabled={disabled} type={type} min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.closest('td')?.nextElementSibling?.querySelector<HTMLElement>('input,button')?.focus(); } }} /></td>; }
