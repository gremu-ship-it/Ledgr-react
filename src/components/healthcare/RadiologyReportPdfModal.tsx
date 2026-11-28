import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { buildRadiologyReportHtml, printHtmlDocument } from '@/lib/healthcare/print';
import type { RadiologyReportData } from '@/types/healthcare';

/** A4 imaging report preview. The printed document is the exact preview. */
export function RadiologyReportPdfModal({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: RadiologyReportData | null;
}) {
  const { t } = useTranslation();
  const html = useMemo(() => (data ? buildRadiologyReportHtml(data) : ''), [data]);

  if (!data) return null;

  return (
    <HealthcareModal
      open={open}
      titleId="radiology-report-title"
      title={t('healthcare.radiology.reportTitle')}
      subtitle={t('healthcare.radiology.reportSubtitle')}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.close')}
          </Button>
          <Button onClick={() => printHtmlDocument(html, 'ledgr-radiology-report-frame')}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('healthcare.radiology.print')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t('healthcare.radiology.printHint')}</span>
        </div>
        <iframe
          title={t('healthcare.radiology.previewTitle')}
          srcDoc={html}
          sandbox="allow-same-origin"
          className="h-[60vh] w-full rounded-xl border border-gray-200 bg-white"
        />
      </div>
    </HealthcareModal>
  );
}
