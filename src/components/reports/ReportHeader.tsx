import { Calendar, User, Download, FileText } from 'lucide-react';
import { useState } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  asOf?: string;
  period?: string;
  preparer?: string;
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
  businessName,
  notes,
  onNotesChange,
  onExportPDF,
  onExportXBRL,
}: Props) {
  const [showNotes, setShowNotes] = useState(false);

  return (
    <div className="mb-6 border-b border-gray-200 pb-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
          {businessName && <p className="text-xs text-gray-400">{businessName}</p>}
        </div>

        <div className="flex items-center gap-4 text-right text-xs text-gray-500">
          <div className="space-y-0.5">
            {asOf && <div className="flex items-center justify-end gap-1"><Calendar className="h-3 w-3" /> As at {asOf}</div>}
            {period && <div>Period: {period}</div>}
            {preparer && <div className="flex items-center justify-end gap-1"><User className="h-3 w-3" /> {preparer}</div>}
          </div>

          {(onExportPDF || onExportXBRL) && (
            <div className="flex gap-1 border-l pl-3">
              {onExportPDF && (
                <button
                  onClick={onExportPDF}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  title="Export PDF"
                >
                  <Download className="h-3 w-3" /> PDF
                </button>
              )}
              {onExportXBRL && (
                <button
                  onClick={onExportXBRL}
                  className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  title="Export XBRL"
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
            {showNotes ? 'Hide' : 'Show'} Notes & Disclosures
          </button>
          {showNotes && (
            <textarea
              value={notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Add accounting policies, contingent liabilities, events after reporting period…"
              className="mt-2 w-full rounded border p-2 text-sm"
              rows={4}
            />
          )}
        </div>
      )}
    </div>
  );
}