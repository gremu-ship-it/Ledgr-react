import { describe, expect, it } from 'vitest';
import { parseRawCsv, validateAndMapCsvRows } from '../nativeCsvParser';

describe('parseRawCsv', () => {
  it('splits simple comma-separated rows and ignores blank lines', () => {
    const rows = parseRawCsv('name,sku,price\nMaize flour,MF-50,25000\n\nBeans,BN-1,18000');
    expect(rows).toEqual([
      ['name', 'sku', 'price'],
      ['Maize flour', 'MF-50', '25000'],
      ['Beans', 'BN-1', '18000'],
    ]);
  });

  it('keeps commas, escaped quotes and newlines inside quoted fields', () => {
    const csv = [
      'name,description,price',
      '"Maize, 50kg","Says ""best brand"" in Blantyre",25000',
      '"Two line\nname","Line one\nLine two",100',
    ].join('\n');
    const rows = parseRawCsv(csv);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['Maize, 50kg', 'Says "best brand" in Blantyre', '25000']);
    expect(rows[2][0]).toBe('Two line\nname');
    expect(rows[2][1]).toBe('Line one\nLine two');
  });

  it('handles CRLF files, trailing commas and a UTF-8 BOM header', () => {
    const rows = parseRawCsv('\uFEFFname,sku,\r\nMaize,MF-50,\r\n');
    expect(rows[0]).toEqual(['name', 'sku', '']);
    expect(rows[1]).toEqual(['Maize', 'MF-50', '']);
  });
});

describe('validateAndMapCsvRows', () => {
  it('maps and validates product rows including aliases and numeric defaults', () => {
    const rows = parseRawCsv([
      'product_name,product_code,selling_price,cost_price,stock,unit',
      'Maize flour,MF-50,25000,20000,12,bag',
      'Beans,BN-1,18000,n/a,bad,',
    ].join('\n'));
    const result = validateAndMapCsvRows(rows[0], rows.slice(1), 'products');

    expect(result.totalRows).toBe(2);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.validRows[0]).toMatchObject({
      name: 'Maize flour',
      sku: 'MF-50',
      barcode: 'MF-50',
      category: 'General',
      unit_price: 25000,
      cost_price: 20000,
      stock_quantity: 12,
      unit_of_measure: 'bag',
    });
    expect(result.validRows[1]).toMatchObject({
      name: 'Beans',
      unit_price: 18000,
      cost_price: 0,
      stock_quantity: 0,
      unit_of_measure: 'pcs',
    });
  });

  it('flags product rows missing a name or SKU with field-level errors', () => {
    const result = validateAndMapCsvRows(
      ['name', 'sku', 'price'],
      [['', '', '100'], ['Only name', '', '100']],
      'products',
    );

    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(2);
    expect(result.invalidRows[0].rowNumber).toBe(2);
    expect(result.invalidRows[0].errors).toEqual(['Missing product name', 'Missing SKU']);
    expect(result.invalidRows[1].errors).toEqual(['Missing SKU']);
  });

  it('maps fixed asset rows and rejects zero or invalid purchase costs', () => {
    const result = validateAndMapCsvRows(
      ['asset_name', 'asset_code', 'purchase_cost', 'purchase_date', 'useful_life', 'salvage_value'],
      [
        ['Delivery van', 'FA-001', '15000000', '2025-04-01', '5', '1000000'],
        ['Invalid cost', 'FA-002', '0', '2025-04-01', '5', '0'],
      ],
      'fixed_assets',
    );

    expect(result.validRows[0]).toMatchObject({
      name: 'Delivery van',
      asset_code: 'FA-001',
      purchase_cost: 15000000,
      purchase_date: '2025-04-01',
      useful_life_years: 5,
      salvage_value: 1000000,
      depreciation_method: 'straight_line',
    });
    expect(result.invalidRows[0].rowNumber).toBe(3);
    expect(result.invalidRows[0].errors).toEqual(['Invalid purchase cost']);
  });

  it('maps contacts with aliases and falls back invalid types to customer', () => {
    const result = validateAndMapCsvRows(
      ['company_name', 'type', 'email', 'phone', 'tpin', 'address', 'credit_limit'],
      [
        ['Acme Corp', 'supplier', 'info@acme.com', '+265999', 'TPIN1', 'Blantyre', '500000'],
        ['Mary Tembo', 'unknown', 'mary@example.com', '', '', '', ''],
      ],
      'contacts',
    );

    expect(result.validRows[0]).toMatchObject({
      name: 'Acme Corp',
      type: 'supplier',
      email: 'info@acme.com',
      phone: '+265999',
      tax_id: 'TPIN1',
      address: 'Blantyre',
      credit_limit: 500000,
    });
    expect(result.validRows[1].type).toBe('customer');
  });

  it('maps accounts and rejects unsupported account types', () => {
    const result = validateAndMapCsvRows(
      ['account_code', 'account_name', 'type', 'account_subtype'],
      [
        ['1110', 'Cash on Hand', 'asset', 'current_asset'],
        ['4110', 'Sales', 'revenue', 'revenue'],
        ['9999', 'Bad type', 'equityx', 'general'],
      ],
      'accounts',
    );

    expect(result.validRows).toMatchObject([
      { code: '1110', name: 'Cash on Hand', type: 'asset', subtype: 'current_asset' },
      { code: '4110', name: 'Sales', type: 'revenue', subtype: 'revenue' },
    ]);
    expect(result.invalidRows[0].rowNumber).toBe(4);
    expect(result.invalidRows[0].errors).toEqual([
      'Type must be asset, liability, equity, revenue, or expense',
    ]);
  });

  it('reports every missing required field for a blank accounts row', () => {
    const result = validateAndMapCsvRows(
      ['code', 'name', 'type'],
      [['', '', '']],
      'accounts',
    );

    expect(result.invalidRows[0].errors).toEqual([
      'Missing account code',
      'Missing account name',
      'Type must be asset, liability, equity, revenue, or expense',
    ]);
  });
});
