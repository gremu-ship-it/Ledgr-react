import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { buildDoctorPayoutVoucherHtml, printHtmlDocument } from '@/lib/healthcare/print';
import { formatCurrency } from '@/lib/formatters';
import { doctorDisplayName } from '@/services/doctorFeeService';
import type {
  DoctorEarningStatus,
  DoctorFeeEarning,
  DoctorPayoutVoucherLabels,
} from '@/types/healthcare';

interface DoctorPayoutVoucherModalProps {
  open: boolean;
  onClose: () => void;
  earnings: DoctorFeeEarning[];
  currency: string;
  onMarkPaid?: () => void;
}

const STATUS_KEYS: Record<DoctorEarningStatus, string> = {
  pending: 'healthcare.doctorFees.status.pending',
  approved: 'healthcare.doctorFees.status.approved',
  posted: 'healthcare.doctorFees.status.posted',
  paid: 'healthcare.doctorFees.status.paid',
};

function dateKey(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export function DoctorPayoutVoucherModal(props: DoctorPayoutVoucherModalProps) {
  const { open, earnings } = props;
  if (!open || earnings.length === 0) return null;
  return <VoucherBody key={earnings[0]?.id} {...props} />;
}

function VoucherBody({
  onClose,
  earnings,
  currency,
  onMarkPaid,
}: Omit<DoctorPayoutVoucherModalProps, 'open'>) {
  const { t } = useTranslation();
  const { businessName, logoUrl } = useBrandTheme();
  const doctorId = earnings[0]?.doctor_id ?? '';
  const doctorName =
    doctorDisplayName(earnings[0]?.doctor, doctorId.slice(0, 8).toUpperCase()) ||
    t('healthcare.doctorFees.unknownDoctor');
  const total = earnings.reduce((sum, earning) => sum + Number(earning.earned_commission || 0), 0);
  const totalLabel = formatCurrency(total, currency);
  const dates = earnings
    .map((earning) => dateKey(earning.created_at))
    .filter(Boolean)
    .sort();
  const periodFrom = dates[0] ?? '';
  const periodTo = dates[dates.length - 1] ?? '';
  const voucherNumber = `PAY-${(earnings[0]?.id ?? '').slice(0, 8).toUpperCase()}`;
  const generatedAt = new Date().toLocaleString();
  const canMarkPaid = Boolean(onMarkPaid) && earnings.every((earning) => earning.status === 'posted');

  const html = useMemo(() => {
    const labels: DoctorPayoutVoucherLabels = {
      title: t('healthcare.doctorFees.voucher.title'),
      voucherNumber: t('healthcare.doctorFees.voucher.voucherNumber'),
      doctor: t('healthcare.doctorFees.doctorName'),
      period: t('healthcare.doctorFees.voucher.period'),
      generated: t('healthcare.doctorFees.voucher.generated'),
      visit: t('healthcare.doctorFees.voucher.visit'),
      patient: t('healthcare.doctorFees.voucher.patient'),
      consultation: t('healthcare.doctorFees.voucher.consultation'),
      laboratory: t('healthcare.doctorFees.voucher.laboratory'),
      pharmacy: t('healthcare.doctorFees.voucher.pharmacy'),
      earned: t('healthcare.doctorFees.voucher.earned'),
      status: t('healthcare.doctorFees.voucher.status'),
      total: t('healthcare.doctorFees.voucher.total'),
      currency: t('healthcare.doctorFees.voucher.currency'),
      preparedBy: t('healthcare.doctorFees.voucher.preparedBy'),
      signature: t('healthcare.doctorFees.voucher.signature'),
      footer: t('healthcare.doctorFees.voucher.footer'),
      statuses: {
        pending: t('healthcare.doctorFees.status.pending'),
        approved: t('healthcare.doctorFees.status.approved'),
        posted: t('healthcare.doctorFees.status.posted'),
        paid: t('healthcare.doctorFees.status.paid'),
      },
    };

    return buildDoctorPayoutVoucherHtml({
      businessName,
      logoUrl,
      voucherNumber,
      doctorName,
      periodFrom,
      periodTo,
      generatedAt,
      currency,
      labels,
      lines: earnings.map((earning) => ({
        visitNumber: earning.visit?.visit_number ?? earning.visit_id.slice(0, 8).toUpperCase(),
        patientName: earning.visit?.patient
          ? `${earning.visit.patient.first_name} ${earning.visit.patient.last_name}`.trim()
          : '',
        consultationAmount: Number(earning.consultation_amount || 0),
        labAmount: Number(earning.lab_amount || 0),
        pharmacyAmount: Number(earning.pharmacy_amount || 0),
        earnedCommission: Number(earning.earned_commission || 0),
        status: earning.status,
      })),
      total,
    });
  }, [
    businessName,
    currency,
    doctorName,
    earnings,
    generatedAt,
    logoUrl,
    periodFrom,
    periodTo,
    t,
    total,
    voucherNumber,
  ]);

  return (
    <HealthcareModal
      open
      titleId="doctor-payout-title"
      title={t('healthcare.doctorFees.voucher.title')}
      subtitle={t('healthcare.doctorFees.voucher.subtitle')}
      closeLabel={t('healthcare.doctorFees.close')}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.doctorFees.close')}
          </Button>
          {canMarkPaid ? (
            <Button type="button" variant="secondary" onClick={onMarkPaid}>
              <HandCoins className="h-4 w-4" aria-hidden />
              {t('healthcare.doctorFees.voucher.markPaid')}
            </Button>
          ) : null}
          <Button type="button" onClick={() => printHtmlDocument(html, 'doctor-payout-frame')}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('healthcare.doctorFees.voucher.print')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <span className="font-semibold">
            {doctorName} · {voucherNumber}
          </span>
          <span>{totalLabel}</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <iframe
            title={t('healthcare.doctorFees.voucher.preview')}
            srcDoc={html}
            sandbox="allow-same-origin"
            className="h-[520px] w-full bg-white"
          />
        </div>
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-xs">
          {earnings.map((earning) => (
            <li key={earning.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-mono text-[11px] text-gray-500">
                {earning.visit?.visit_number ?? earning.visit_id.slice(0, 8).toUpperCase()}
              </span>
              <span className="text-gray-600">{t(STATUS_KEYS[earning.status])}</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(Number(earning.earned_commission || 0), currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </HealthcareModal>
  );
}
