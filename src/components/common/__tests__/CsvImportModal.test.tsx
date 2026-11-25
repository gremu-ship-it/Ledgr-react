// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { CsvImportModal } from '../CsvImportModal';

afterEach(cleanup);

const csv = [
  'name,sku,price',
  'Maize flour,MF-50,25000',
  'Missing SKU,,18000',
].join('\n');

describe('CsvImportModal', () => {
  it('parses an uploaded CSV, separates errors, and imports only valid rows', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(
      <CsvImportModal
        isOpen
        onClose={vi.fn()}
        entityType="products"
        title="Import Products from CSV"
        onImport={onImport}
      />,
    );

    const importButton = screen.getByRole('button', { name: /Import 0 Records/ });
    expect((importButton as HTMLButtonElement).disabled).toBe(true);

    const file = new File([csv], 'products.csv', { type: 'text/csv' });
    fireEvent.change(document.querySelector('#csv-import-file')!, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/1 valid records ready for import/)).toBeTruthy());
    expect(screen.getByText(/1 rows have validation errors/)).toBeTruthy();
    expect(screen.getByText(/Selected file: products.csv/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Errors \(1\)/ }));
    expect(screen.getAllByText('Missing SKU').length).toBeGreaterThan(0);

    const readyButton = screen.getByRole('button', { name: /Import 1 Records/ });
    expect((readyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(readyButton);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toMatchObject([
      { name: 'Maize flour', sku: 'MF-50', unit_price: 25000 },
    ]);
    expect(screen.getByText(/Successfully imported 1 records/)).toBeTruthy();
  });

  it('accepts a dropped CSV file and maps accounts', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(
      <CsvImportModal
        isOpen
        onClose={vi.fn()}
        entityType="accounts"
        title="Import Chart of Accounts from CSV"
        onImport={onImport}
      />,
    );

    const dropzone = screen.getByText(/Click to upload or drag & drop CSV file/).closest('div')!;
    const file = new File(['code,name,type\n1110,Cash,asset'], 'accounts.csv', { type: 'text/csv' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/1 valid records ready for import/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Import 1 Records/ }));
    await waitFor(() => expect(onImport.mock.calls[0][0][0]).toMatchObject({
      code: '1110', name: 'Cash', type: 'asset',
    }));
  });
});
