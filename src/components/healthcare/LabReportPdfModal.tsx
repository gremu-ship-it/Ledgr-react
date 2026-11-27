import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { buildLabReportHtml, printHtmlDocument } from '@/lib/healthcare/print';
import type { LabReportData } from '@/types/healthcare';

/**
 * A4 report preview and print surface. The preview is the exact document that
 * is printed/saved as PDF, rendered in a sandboxed iframe so report styles can
 * never leak into the clinic UI.
 */
export function LabReportPdfModal({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: LabReportData | null;
}) {
  const { t } = useTranslation();
  const html = useMemo(() => (data ? buildLabReportHtml(data) : ''), [data]);

  if (!data) return null;

  return (
    <HealthcareModal
      open={open}
      titleId="lab-report-title"
      title={t('healthcare.lab.report.modalTitle')}
      subtitle={t('healthcare.lab.report.modalSubtitle')}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.close')}
          </Button>
          <Button onClick={() => printHtmlDocument(html, 'ledgr-lab-report-frame')}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('healthcare.lab.report.print')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('healthcare.lab.report.printHint')}</span>
        </div>
        <iframe
          title={t('healthcare.lab.report.previewTitle')}
          srcDoc={html}
          sandbox="allow-same-origin"
          className="h-[60vh] w-full rounded-xl border border-gray-200 bg-white"
        />
      </div>
    </HealthcareModal>
  );
}
