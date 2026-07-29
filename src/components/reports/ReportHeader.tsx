import { Calendar, User, FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { DocumentDownloadButton } from '@/components/documents/DocumentDownloadButton';

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
  const { logoUrl, businessName: brandBusinessName, tradingName } = useBrandTheme();

  const displayBusinessName = businessName || brandBusinessName;

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: Branding + Title */}
        <div className="flex gap-3">
          {/* Logo */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={displayBusinessName}
              className="h-12 w-12 rounded-xl border border-gray-200 object-contain bg-white p-1 shadow-sm shrink-0"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-sm font-bold text-white shadow-sm">
              {(displayBusinessName || 'L').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-tight text-gray-900 leading-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-gray-600 leading-snug max-w-prose">{subtitle}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
              {displayBusinessName && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-0.5 text-[11px] font-medium text-white">
                  {displayBusinessName}
                </span>
              )}
              {tradingName && <span>Trading as {tradingName}</span>}
              {asOf && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> {t('reports.asAt', { date: asOf })}
                </span>
              )}
              {period && <span>{t('reports.periodLabel', { period })}</span>}
              {preparedBy && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" /> {preparedBy}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Download actions */}
        {(onExportPDF || onExportXBRL) && (
          <div className="flex flex-wrap items-center gap-2">
            <DocumentDownloadButton
              label="Download"
              variant="secondary"
              options={[
                ...(onExportPDF
                  ? [
                      {
                        id: 'pdf',
                        label: 'Professional PDF',
                        description: 'Branded, print-ready with logo',
                        icon: <FileText className="h-4 w-4" />,
                        onClick: onExportPDF,
                      },
                    ]
                  : []),
                ...(onExportXBRL
                  ? [
                      {
                        id: 'xbrl',
                        label: 'XBRL Export',
                        description: 'IFRS taxonomy for regulators',
                        icon: <FileText className="h-4 w-4" />,
                        onClick: onExportXBRL,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>

      {onNotesChange && (
        <div className="mt-4 border-t border-gray-200/70 pt-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1.5"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showNotes ? 'bg-brand-500' : 'bg-gray-300'}`} />
              {showNotes ? t('reports.hideNotes') : t('reports.addNotes')}
              {!showNotes && notes && <span className="ml-1 text-[10px] text-gray-400">• {notes.length} chars</span>}
            </button>
            {notes && <span className="text-[10px] text-gray-400">Included in PDF export</span>}
          </div>
          {showNotes && (
            <textarea
              value={notes || ''}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={t('reports.notesPlaceholder')}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-sm"
              rows={3}
            />
          )}
        </div>
      )}
    </div>
  );
}
