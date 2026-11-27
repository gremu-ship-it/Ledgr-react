import { describe, expect, it } from 'vitest';
import {
  buildLabReportHtml,
  buildMedicationLabelHtml,
  buildSpecimenLabelHtml,
  escapeHtml,
} from '../print';
import type { LabReportData, LabReportLabels } from '@/types/healthcare';

const medicationLabels = {
  title: 'Medication Label',
  patient: 'Patient',
  mrn: 'File No.',
  dosage: 'Dose',
  frequency: 'Frequency',
  duration: 'Duration',
  durationValue: '{{count}} days',
  quantity: 'Quantity',
  batch: 'Batch',
  expiry: 'Expiry',
  dispensed: 'Dispensed',
  instructions: 'Instructions',
  warning: 'Warning',
  preparedBy: 'Dispensed by',
};

const reportLabels: LabReportLabels = {
  title: 'Laboratory Report',
  patient: 'Patient',
  mrn: 'File No.',
  age: 'Age',
  sex: 'Sex',
  visit: 'Visit',
  orderedBy: 'Ordered by',
  specimen: 'Specimen',
  barcode: 'Barcode',
  collected: 'Collected',
  clinicalIndication: 'Clinical indication',
  test: 'Test',
  result: 'Result',
  unit: 'Unit',
  reference: 'Reference',
  status: 'Status',
  verifiedBy: 'Verified by',
  verifiedAt: 'Verified at',
  pendingVerification: 'Awaiting verification',
  noResults: 'No results',
  printed: 'Printed',
  statusNormal: 'Normal',
  statusAbnormal: 'Abnormal',
  statusCritical: 'Critical',
  statusPending: 'Pending',
};

describe('escapeHtml', () => {
  it('escapes every HTML metacharacter', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });
});

describe('medication labels', () => {
  const data = {
    businessName: 'Blantyre Clinic',
    patientName: 'Jane Banda',
    mrn: 'PAT-2026-0001',
    medicationName: 'Amoxicillin 500mg',
    dosage: '500mg',
    frequency: 'TDS',
    durationDays: 5,
    quantity: 15,
    instructions: 'Take after food',
    batchNumber: 'AMX-01',
    expiryDate: '2027-01-31',
    dispensedAt: '15 Jun 2026',
    pharmacist: 'A. Phiri',
    warnings: ['Penicillin allergy'],
    labels: medicationLabels,
  };

  it('prints an 80mm page with the full label', () => {
    const html = buildMedicationLabelHtml(data, '80mm');
    expect(html).toContain('size: 80mm auto');
    expect(html).toContain('width: 72mm');
    expect(html).toContain('Amoxicillin 500mg');
    expect(html).toContain('5 days');
    expect(html).toContain('AMX-01');
    expect(html).toContain('Take after food');
    expect(html).toContain('Warning: Penicillin allergy');
    expect(html).toContain('Dispensed by: A. Phiri');
  });

  it('prints a narrower 58mm page', () => {
    const html = buildMedicationLabelHtml(data, '58mm');
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('width: 50mm');
  });

  it('escapes patient and drug text', () => {
    const html = buildMedicationLabelHtml({
      ...data,
      patientName: '<script>alert(1)</script>',
      medicationName: 'A & B',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
  });
});

describe('specimen labels', () => {
  it('embeds the barcode and every ordered test', () => {
    const html = buildSpecimenLabelHtml({
      businessName: 'Blantyre Clinic',
      patientName: 'Jane Banda',
      mrn: 'PAT-2026-0001',
      specimenType: 'Blood',
      testNames: ['Random Blood Sugar', 'Full Blood Count'],
      barcode: 'SMP-2026-0001',
      collectedAt: '15 Jun 2026 09:10',
      labels: {
        title: 'Specimen Label',
        patient: 'Patient',
        mrn: 'File No.',
        specimenType: 'Specimen',
        tests: 'Tests',
        collected: 'Collected',
        barcode: 'Barcode',
      },
    });
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('<svg');
    expect(html).toContain('SMP-2026-0001');
    expect(html).toContain('Random Blood Sugar');
    expect(html).toContain('Full Blood Count');
  });
});

describe('A4 laboratory report', () => {
  const data: LabReportData = {
    businessName: 'Blantyre Clinic',
    logoUrl: null,
    orderNumber: 'LAB-2026-0007',
    orderDate: '15 Jun 2026',
    patientName: 'Jane Banda',
    mrn: 'PAT-2026-0001',
    age: '34',
    sex: 'Female',
    visitNumber: 'VST-2026-0001',
    orderedBy: 'Dr Mwale',
    clinicalIndication: 'Fever workup',
    specimenBarcode: 'SMP-2026-0001',
    specimenType: 'Blood',
    collectedAt: '15 Jun 2026 09:10',
    verifiedBy: '',
    verifiedAt: '',
    isVerified: false,
    labels: reportLabels,
    items: [
      {
        testName: 'Random Blood Sugar',
        result: '1.9',
        unit: 'mmol/L',
        reference: '3.9 - 7.8 mmol/L',
        status: 'critical',
      },
      {
        testName: 'Malaria RDT',
        result: 'Negative',
        unit: '',
        reference: '',
        status: 'normal',
      },
    ],
  };

  it('uses A4 page rules and a status for every row', () => {
    const html = buildLabReportHtml(data);
    expect(html).toContain('size: A4');
    expect(html).toContain('LAB-2026-0007');
    expect(html).toContain('Random Blood Sugar');
    expect(html).toContain('status-critical');
    expect(html).toContain('>Critical<');
    expect(html).toContain('status-normal');
    expect(html).toContain('Awaiting verification');
  });

  it('omits the pending note once verified and includes the logo', () => {
    const html = buildLabReportHtml({
      ...data,
      isVerified: true,
      verifiedBy: 'T. Phiri',
      verifiedAt: '15 Jun 2026 10:00',
      logoUrl: 'https://cdn.example.test/logo.png',
    });
    expect(html).not.toContain('Awaiting verification');
    expect(html).toContain('T. Phiri');
    expect(html).toContain('https://cdn.example.test/logo.png');
  });
});
