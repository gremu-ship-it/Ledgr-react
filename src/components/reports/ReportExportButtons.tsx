import { Download, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ReportExportButtonsProps {
  onExportCSV: () => void;
  onExportPDF: () => void;
  disabled?: boolean;
}

const buttonClassName = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

export function ReportExportButtons({ onExportCSV, onExportPDF, disabled = false }: ReportExportButtonsProps) {
  const { t } = useTranslation();

  return (
    <div className="report-export-buttons flex flex-wrap items-center gap-2">
      <button type="button" onClick={onExportCSV} disabled={disabled} className={buttonClassName}>
        <Download className="h-4 w-4" aria-hidden="true" />
        {t('reports.shared.exportCSV')}
      </button>
      <button type="button" onClick={onExportPDF} disabled={disabled} className={buttonClassName}>
        <Printer className="h-4 w-4" aria-hidden="true" />
        {t('reports.shared.exportPDF')}
      </button>
    </div>
  );
}
