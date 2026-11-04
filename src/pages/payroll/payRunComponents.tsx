import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { employeeDisplayName, asRow, asRows, numeric, text } from './employeeUtils';
import { formatPayRunMoney } from './payRunUtils';

type Row = Record<string, unknown>;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700',
  calculated: 'bg-blue-50 text-blue-700',
  approved: 'bg-violet-50 text-violet-700',
  posted: 'bg-emerald-50 text-emerald-700',
  reversed: 'bg-gray-100 text-gray-700',
};

export function PayRunStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      {t(`payroll.${status}`, { defaultValue: status })}
    </span>
  );
}

export function PayRunSummaryCards({ payRun, currency, locale }: { payRun: Row; currency: string; locale: string }) {
  const { t } = useTranslation();
  const items = [
    { label: t('payroll.totalEmployees'), value: String(numeric(payRun.employee_count) || asRows(payRun.lines).length) },
    { label: t('payroll.totalGross'), value: formatPayRunMoney(payRun.total_gross, currency, locale) },
    { label: t('payroll.totalDeductions'), value: formatPayRunMoney(payRun.total_deductions, currency, locale) },
    { label: t('payroll.totalNetPay'), value: formatPayRunMoney(payRun.total_net, currency, locale) },
    { label: t('payroll.totalEmployerCost'), value: formatPayRunMoney(payRun.total_employer_cost, currency, locale) },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">{item.label}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-gray-900">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function PayRunLinesTable({ lines, currency, locale }: { lines: Row[]; currency: string; locale: string }) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (lines.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{t('payroll.noPayRunEmployees')}</p>;
  }
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3">{t('payroll.employee')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.grossPay')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.taxablePay')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.payeAmount')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.otherDeductions')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.netPay')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.daysWorked')}</th>
              <th scope="col" className="px-4 py-3">{t('payroll.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((line, index) => {
              const id = text(line.id, `${text(line.employee_id, 'employee')}-${index}`);
              const employee = asRow(line.employee);
              const name = employeeDisplayName(employee) || text(employee.employee_number, text(line.employee_id, '—'));
              const paye = numeric(line.paye_amount);
              const otherDeductions = Math.max(0, numeric(line.total_deductions) - paye);
              const components = asRows(line.components);
              const isExpanded = expandedId === id;
              return (
                <Fragment key={id}>
                  <tr className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : id)}
                        aria-expanded={isExpanded}
                        aria-label={t('payroll.toggleComponentDetails', { name })}
                        className="flex items-center gap-2 text-left font-medium text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden="true" />}
                        <span>{name}</span>
                      </button>
                      <span className="ml-6 block text-xs text-gray-500">{text(employee.employee_number, '—')}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatPayRunMoney(line.gross_pay, currency, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatPayRunMoney(line.taxable_pay, currency, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatPayRunMoney(paye, currency, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatPayRunMoney(otherDeductions, currency, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">{formatPayRunMoney(line.net_pay, currency, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{numeric(line.days_worked)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${text(line.status) === 'excluded' ? 'bg-gray-100 text-gray-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {t(text(line.status) === 'excluded' ? 'payroll.excluded' : 'payroll.included')}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50/80">
                      <td colSpan={8} className="px-8 py-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('payroll.componentBreakdown')}</p>
                        {components.length ? (
                          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                            {components.map((component, componentIndex) => {
                              const payComponent = asRow(component.pay_component);
                              return (
                                <li key={text(component.id, `${id}-component-${componentIndex}`)} className="flex items-center justify-between gap-3 text-sm">
                                  <span className="flex min-w-0 items-center gap-2 text-gray-700">
                                    <span>{text(payComponent.name, text(payComponent.code, t('payroll.unnamedComponent')))}</span>
                                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                      {t(component.is_earning === true ? 'payroll.componentTypeEarning' : 'payroll.componentTypeDeduction')}
                                    </span>
                                  </span>
                                  <span className="font-medium tabular-nums text-gray-900">{formatPayRunMoney(component.amount, currency, locale)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : <p className="text-sm text-gray-500">{t('payroll.noComponentDetails')}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
