import { useTranslation } from 'react-i18next';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';

interface BranchFilterProps {
  businessId: string;
  value: string | null;
  onChange: (branchId: string | null) => void;
}

export function BranchFilter({ businessId, value, onChange }: BranchFilterProps) {
  const { t } = useTranslation();
  const { data: branches = [], isLoading, isError } = useAccessibleReportBranches(businessId);

  return (
    <div className="min-w-[12rem]">
      <label htmlFor="trial-balance-branch" className="mb-2 block text-sm font-semibold text-gray-800">
        {t('reports.shared.branch')}
      </label>
      <select
        id="trial-balance-branch"
        value={value ?? ''}
        disabled={isLoading || !businessId}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50"
      >
        <option value="">{t('reports.shared.allBranches')}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>{branch.name}</option>
        ))}
      </select>
      {isError && <p role="status" className="mt-1 text-xs text-amber-700">{t('reports.shared.branchLoadError')}</p>}
    </div>
  );
}
