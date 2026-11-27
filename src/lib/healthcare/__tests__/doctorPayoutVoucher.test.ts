import { describe, expect, it } from 'vitest';
import { buildDoctorPayoutVoucherHtml } from '../print';
import type { DoctorPayoutVoucherData, DoctorPayoutVoucherLabels } from '@/types/healthcare';

const labels: DoctorPayoutVoucherLabels = {
  title: 'Doctor Payout Voucher',
  voucherNumber: 'Voucher #',
  doctor: 'Doctor',
  period: 'Period',
  generated: 'Generated',
  visit: 'Visit',
  patient: 'Patient',
  consultation: 'Consultation',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
  earned: 'Commission',
  status: 'Status',
  total: 'Total payable',
  currency: 'Currency',
  preparedBy: 'Prepared by',
  signature: 'Doctor signature',
  footer: 'Generated from Ledgr',
  statuses: {
    pending: 'Pending',
    approved: 'Approved',
    posted: 'Posted',
    paid: 'Paid',
  },
};

function voucher(overrides: Partial<DoctorPayoutVoucherData> = {}): DoctorPayoutVoucherData {
  return {
    businessName: 'Blantyre Clinic',
    logoUrl: null,
    voucherNumber: 'PAY-1234ABCD',
    doctorName: 'Dr. Tadala Banda',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-30',
    generatedAt: '27 Nov 2026, 10:00',
    currency: 'MWK',
    labels,
    lines: [
      {
        visitNumber: 'VST-2026-0001',
        patientName: 'Jane Banda',
        consultationAmount: 20_000,
        labAmount: 8_000,
        pharmacyAmount: 4_000,
        earnedCommission: 9_000,
        status: 'posted',
      },
    ],
    total: 9_000,
    ...overrides,
  };
}

describe('doctor payout voucher', () => {
  it('renders the doctor, period and commission lines', () => {
    const html = buildDoctorPayoutVoucherHtml(voucher());
    expect(html).toContain('Doctor Payout Voucher');
    expect(html).toContain('Dr. Tadala Banda');
    expect(html).toContain('VST-2026-0001');
    expect(html).toContain('MWK 9,000.00');
    expect(html).toContain('Posted');
    expect(html).toContain('2026-11-01');
  });

  it('escapes every user-supplied field and renders the empty state', () => {
    const html = buildDoctorPayoutVoucherHtml(
      voucher({
        doctorName: '<script>alert(1)</script>',
        businessName: 'A & B',
        lines: [],
        total: 0,
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('Generated from Ledgr');
    expect(html).toContain('MWK 0.00');
  });
});
