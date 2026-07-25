import { Calendar, User, Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  subtitle?: string;
  asOf?: string;
  period?: string;
  preparer?: string;
  preparerName?: string;
  businessName?: string;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  onExportPDF?: () => void;
  onExportXBRL?: () => void;
}

export function ReportHeader({
  title,
  subtitle,
  asOf,
  period,
  preparer,
  preparerName,
  businessName,
  notes,
  onNotesChange,
  onExportPDF,
  onExportXBRL,
}: Props) {
  const { t } = useTranslation();
  const [showNotes, setShowNotes] = useState(false);
  const preparedBy = preparer ?? preparerName;

  return (
    <div className="mb-6 border-b border-gray-200 pb-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
          {businessName && <p className="text-xs text-gray-400">{businessName}</p>}
        </div>

        <div className="flex items-center gap-4 text-end text-xs text-gray-500">
          <div className="space-y-0.5">
            {asOf && (
              <div className="flex items-center justify-end gap-1">
                <Calendar className="h-3 w-3" /> {t('reports.asAt', { date: asOf })}
              </div>
            )}
            {period && <div>{t('reports.periodLabel', { period })}</div>}
            {preparedBy && <div className="flex items-center justify-end gap-1"><User className="h-3 w-3" /> {preparedBy}</div>}
          </div>

          {(onExportPDF || onExportXBRL) && (
            <div className="flex gap-1 border-s ps-3">
              {onExportPDF && (
                <button
                  onClick={onExportPDF}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  title={t('reports.exportPdf')}
                >
                  <Download className="h-3 w-3" /> PDF
                </button>
              )}
              {onExportXBRL && (
                <button
                  onClick={onExportXBRL}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  title={t('reports.exportXbrl')}
                >
                  <FileText className="h-3 w-3" /> XBRL
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {onNotesChange && (
        <div className="mt-3">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="text-xs text-brand-600 hover:underline"
          >
            {showNotes ? t('reports.hideNotes') : t('reports.showNotes')}
          </button>
          {showNotes && (
            <textarea
              value={notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={t('reports.notesPlaceholder')}
              className="mt-2 w-full rounded border p-2 text-sm"
              rows={4}
            />
          )}
        </div>
      )}
    </div>
  );
}
