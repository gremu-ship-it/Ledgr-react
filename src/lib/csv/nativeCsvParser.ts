/**
 * Zero-dependency CSV ingestion for the in-feature upload buttons.
 *
 * The app already has a heavier Papa-based migration workspace at /import;
 * this parser is deliberately small and local so a clerk can drop a template
 * straight into the page they are working in without loading that workspace.
 */

export interface CsvInvalidRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
}

export interface CsvParseResult<T> {
  validRows: T[];
  invalidRows: CsvInvalidRow[];
  totalRows: number;
}

export type EntityImportType = 'products' | 'fixed_assets' | 'contacts' | 'accounts';

/**
 * Fast zero-dependency CSV string parser handling quotes, escaped quotes, and
 * newlines inside quoted fields.
 */
export function parseRawCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  // Spreadsheet exports (and UTF-8 BOMs) must not become part of header 1.
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        // ignore carriage return
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((field) => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Validates parsed CSV rows against the target entity schema. Error messages
 * are translation keys handled by the preview modal, keeping the parser pure.
 */
export function validateAndMapCsvRows(
  headers: string[],
  dataRows: string[][],
  entityType: EntityImportType,
): CsvParseResult<Record<string, unknown>> {
  const normalizedHeaders = headers.map((header) =>
    header.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
  );
  const validRows: Record<string, unknown>[] = [];
  const invalidRows: CsvInvalidRow[] = [];

  dataRows.forEach((row, index) => {
    const rowObj: Record<string, string> = {};
    normalizedHeaders.forEach((header, i) => {
      rowObj[header] = row[i] || '';
    });

    const errors: string[] = [];
    const mapped: Record<string, unknown> = {};

    if (entityType === 'products') {
      const name = rowObj['name'] || rowObj['product_name'];
      const sku = rowObj['sku'] || rowObj['product_code'];
      const price = parseFloat(rowObj['selling_price'] || rowObj['price'] || rowObj['unit_price'] || '0');
      const cost = parseFloat(rowObj['cost_price'] || rowObj['cost'] || '0');
      const stock = parseInt(rowObj['stock_quantity'] || rowObj['stock'] || rowObj['quantity'] || '0', 10);

      if (!name) errors.push('Missing product name');
      if (!sku) errors.push('Missing SKU');

      mapped.name = name;
      mapped.sku = sku;
      mapped.barcode = rowObj['barcode'] || sku;
      mapped.category = rowObj['category'] || 'General';
      mapped.unit_price = isNaN(price) ? 0 : price;
      mapped.cost_price = isNaN(cost) ? 0 : cost;
      mapped.stock_quantity = isNaN(stock) ? 0 : stock;
      mapped.unit_of_measure = rowObj['unit_of_measure'] || rowObj['unit'] || 'pcs';
    } else if (entityType === 'fixed_assets') {
      const name = rowObj['asset_name'] || rowObj['name'];
      const cost = parseFloat(rowObj['purchase_cost'] || rowObj['cost'] || '0');
      const date = rowObj['purchase_date'] || new Date().toISOString().slice(0, 10);

      if (!name) errors.push('Missing asset name');
      if (isNaN(cost) || cost <= 0) errors.push('Invalid purchase cost');

      mapped.name = name;
      mapped.asset_code = rowObj['asset_code'] || rowObj['tag_number'] || `FA-${Date.now().toString().slice(-4)}`;
      mapped.category = rowObj['category'] || 'Equipment';
      mapped.purchase_cost = cost;
      mapped.purchase_date = date;
      mapped.useful_life_years = parseInt(rowObj['useful_life_years'] || rowObj['useful_life'] || '5', 10);
      mapped.salvage_value = parseFloat(rowObj['salvage_value'] || '0') || 0;
      mapped.depreciation_method = rowObj['depreciation_method'] || 'straight_line';
    } else if (entityType === 'contacts') {
      const name = rowObj['name'] || rowObj['company_name'] || rowObj['contact_name'];
      const type = (rowObj['type'] || 'customer').toLowerCase();

      if (!name) errors.push('Missing contact / company name');

      mapped.name = name;
      mapped.type = ['customer', 'supplier', 'both'].includes(type) ? type : 'customer';
      mapped.email = rowObj['email'] || null;
      mapped.phone = rowObj['phone'] || null;
      mapped.tax_id = rowObj['tax_id'] || rowObj['tpin'] || rowObj['vat_number'] || null;
      mapped.address = rowObj['address'] || null;
      mapped.credit_limit = parseFloat(rowObj['credit_limit'] || '0') || 0;
    } else if (entityType === 'accounts') {
      const code = rowObj['code'] || rowObj['account_code'];
      const name = rowObj['name'] || rowObj['account_name'];
      const type = (rowObj['type'] || rowObj['account_type'] || '').toLowerCase();

      if (!code) errors.push('Missing account code');
      if (!name) errors.push('Missing account name');
      if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)) {
        errors.push('Type must be asset, liability, equity, revenue, or expense');
      }

      mapped.code = code;
      mapped.name = name;
      mapped.type = type;
      mapped.subtype = rowObj['subtype'] || rowObj['account_subtype'] || 'general';
    }

    if (errors.length > 0) {
      invalidRows.push({ rowNumber: index + 2, data: rowObj, errors });
    } else {
      validRows.push(mapped);
    }
  });

  return {
    validRows,
    invalidRows,
    totalRows: dataRows.length,
  };
}
