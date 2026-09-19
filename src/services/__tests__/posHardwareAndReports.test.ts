import { describe, it, expect } from 'vitest';
import { EscPosBuilder } from '@/lib/pos/escpos';
import { encodeCode128B, generateBarcodeSvg } from '@/lib/pos/barcodeGenerator';
import { generateZReportSummary, formatZReportEmailBody } from '@/services/posReportService';
import type { PosShift, PosSale } from '@/types/pos';

describe('POS Hardware & Advanced Features', () => {
  describe('ESC/POS Protocol Builder', () => {
    it('initializes and formats receipt with header, totals and cut command', () => {
      const builder = new EscPosBuilder({ paperWidth: '58mm', openCashDrawer: true });

      builder
        .align('center')
        .bold(true)
        .line('LEDGR RETAIL')
        .bold(false)
        .align('left')
        .twoColumn('Item 1 x2', 'MWK 5,000')
        .twoColumn('Item 2 x1', 'MWK 3,500')
        .divider()
        .bold(true)
        .twoColumn('TOTAL', 'MWK 8,500')
        .bold(false)
        .cut(true);

      const bytes = builder.build();

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(20);
      // ESC @ is [0x1B, 0x40]
      expect(bytes[0]).toBe(0x1b);
      expect(bytes[1]).toBe(0x40);
    });

    it('generates cash drawer kick pulse bytes', () => {
      const builder = new EscPosBuilder();
      builder.pulseCashDrawer(0);
      const bytes = builder.build();

      // Contains ESC p [0x1B, 0x70, 0x00, 0x19, 0xFA]
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      expect(hex).toContain('1b 70 00 19 fa');
    });
  });

  describe('Barcode Code 128 Generator', () => {
    it('encodes ASCII text into binary barcode sequence', () => {
      const binary = encodeCode128B('LEDGR-001');
      expect(binary).toMatch(/^[01]+$/);
      expect(binary.length).toBeGreaterThan(30);
    });

    it('generates standalone valid SVG markup', () => {
      const svg = generateBarcodeSvg('BARCODE-12345', {
        height: 40,
        barWidth: 2,
        showText: true,
      });

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('BARCODE-12345');
      expect(svg).toContain('<rect');
    });
  });

  describe('End-of-Day Z-Report Generation', () => {
    const mockShift: PosShift = {
      id: 'shift-100',
      business_id: 'biz-01',
      branch_id: 'branch-01',
      opened_at: '2026-09-19T08:00:00Z',
      closed_at: '2026-09-19T18:00:00Z',
      opening_cash: 25000,
      opening_float: 25000,
      expected_cash: 125000,
      actual_cash: 125000,
      cash_variance: 0,
      variance_reason: null,
      total_sales_amount: 100000,
      cash_sales_amount: 100000,
      other_sales_amount: 0,
      refunds_amount: 0,
      cash_in_amount: 0,
      cash_out_amount: 0,
      status: 'closed',
      notes: 'Clean shift',
      cashier_name: 'Grace Phiri',
    };

    const mockSales: PosSale[] = [
      {
        id: 'sale-1',
        gross_amount: 60000,
        discount_amount: 5000,
        net_amount: 55000,
        tax_amount: 0,
        status: 'completed',
      },
      {
        id: 'sale-2',
        gross_amount: 45000,
        discount_amount: 0,
        net_amount: 45000,
        tax_amount: 0,
        status: 'completed',
      },
    ];

    it('calculates accurate financial and drawer totals for Z-Report', () => {
      const summary = generateZReportSummary(mockShift, mockSales, 'Chikondi Store', 'Lilongwe Branch');

      expect(summary.grossSales).toBe(105000);
      expect(summary.discountsTotal).toBe(5000);
      expect(summary.netSales).toBe(100000);
      expect(summary.openingFloat).toBe(25000);
      expect(summary.actualCountedCash).toBe(125000);
      expect(summary.cashVariance).toBe(0);
      expect(summary.varianceStatus).toBe('balanced');
    });

    it('formats plain text email body for owner notification', () => {
      const summary = generateZReportSummary(mockShift, mockSales, 'Chikondi Store', 'Lilongwe Branch');
      const emailText = formatZReportEmailBody(summary);

      expect(emailText).toContain('END-OF-DAY POS Z-REPORT');
      expect(emailText).toContain('Chikondi Store');
      expect(emailText).toContain('Grace Phiri');
      expect(emailText).toContain('Net Sales Revenue:');
      expect(emailText).toContain('BALANCED');
    });
  });
});
