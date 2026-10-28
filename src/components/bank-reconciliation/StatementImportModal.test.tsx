// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StatementImportModal } from './StatementImportModal';
import type { BankAccount } from '@/dal/repositories/BankReconciliationRepository';

const mocks = vi.hoisted(() => ({ importStatement: vi.fn() }));
vi.mock('@/dal/repositories/BankReconciliationRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/dal/repositories/BankReconciliationRepository')>();
  return { ...actual, BankReconciliationRepository: { ...actual.BankReconciliationRepository, importStatement: mocks.importStatement } };
});
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-MW' } }) }));

const account: BankAccount = {
  id: 'bank-1', business_id: 'business-1', account_id: 'coa-1', bank_name: 'NBS Bank',
  account_number: '012345', branch_name: 'Blantyre', currency: 'MWK', is_active: true,
  account_code: '1124', account_name: 'NBS Bank Current Account', created_at: '2026-01-01T00:00:00Z',
};

function renderModal(onImported = vi.fn()) {
  const onClose = vi.fn();
  render(<StatementImportModal businessId="business-1" accounts={[account]} statements={[]} onClose={onClose} onImported={onImported} />);
  return { onClose, onImported };
}

async function proceedToCsv() {
  fireEvent.change(screen.getByLabelText('bankReconciliation.import.statementDate'), { target: { value: '2026-01-31' } });
  fireEvent.change(screen.getByLabelText('bankReconciliation.import.periodStart'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('bankReconciliation.statements.openingBalance'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('bankReconciliation.statements.closingBalance'), { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
}

async function uploadCsv(contents: string) {
  const file = new File([contents], 'statement.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(contents) });
  fireEvent.change(screen.getByLabelText('bankReconciliation.import.uploadCSV'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/bankReconciliation\.import\.preview/)).toBeTruthy());
}

afterEach(() => {
  cleanup();
  mocks.importStatement.mockReset();
});

describe('StatementImportModal', () => {
  it('imports standard signed-amount CSV and allows a closing-balance warning', async () => {
    mocks.importStatement.mockResolvedValue('statement-1');
    const { onImported } = renderModal();
    await proceedToCsv();
    await uploadCsv('Date,Description,Reference,Amount,Balance\n2026-01-15,Client payment,INV-1,50,150');

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
    expect(await screen.findByText('bankReconciliation.import.balanceMismatch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'bankReconciliation.import.importButton' }));

    await waitFor(() => expect(mocks.importStatement).toHaveBeenCalledOnce());
    expect(mocks.importStatement.mock.calls[0][1]).toMatchObject({
      businessId: 'business-1', bankAccountId: 'bank-1', statementDate: '2026-01-31', periodStart: '2026-01-01',
      openingBalance: 100, closingBalance: 200,
      lines: [{ transaction_date: '2026-01-15', description: 'Client payment', reference: 'INV-1', amount: 50, running_balance: 150 }],
    });
    expect(onImported).toHaveBeenCalledWith(1);
  });

  it('imports separate debit/credit columns with withdrawals negative and deposits positive', async () => {
    mocks.importStatement.mockResolvedValue('statement-2');
    renderModal();
    await proceedToCsv();
    await uploadCsv('Date,Description,Debit,Credit\n2026-01-15,Deposit,,75\n2026-01-16,Withdrawal,25,');
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }));
    fireEvent.click(screen.getByRole('button', { name: 'bankReconciliation.import.importButton' }));

    await waitFor(() => expect(mocks.importStatement).toHaveBeenCalledOnce());
    expect(mocks.importStatement.mock.calls[0][1].lines.map((line: { amount: number }) => line.amount)).toEqual([75, -25]);
  });

  it('rejects an invalid date in any row without calling the import repository', async () => {
    renderModal();
    await proceedToCsv();
    await uploadCsv('Date,Description,Amount\nnot-a-date,Invalid row,5');
    expect(screen.getByRole('alert').textContent).toContain('bankReconciliation.import.validateError');
    expect(screen.getByRole('button', { name: 'common.next' }).hasAttribute('disabled')).toBe(true);
    expect(mocks.importStatement).not.toHaveBeenCalled();
  });
});
