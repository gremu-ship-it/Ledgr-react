import { describe, expect, it } from 'vitest';
import { classifyTaxAccounts, type TaxAccount } from '@/lib/tax-accounts';

const accounts: TaxAccount[] = [
  { id: 'vat-in-code', code: '1135', name: 'Input VAT', account_type: 'asset' },
  { id: 'vat-in-custom', code: 'A-44', name: 'VAT Receivable (Input Tax)', account_type: 'asset' },
  { id: 'vat-out-code', code: '2121', name: 'Output VAT', account_type: 'liability' },
  { id: 'vat-out-custom', code: 'L-8', name: 'VAT Payable (Output Tax)', account_type: 'liability' },
  { id: 'wht-custom', code: 'TAX-91', name: 'Withholding Tax Payable', account_type: 'liability' },
  { id: 'wht-code-not-liability', code: '2123', name: 'WHT Payable', account_type: 'expense' },
  { id: 'unrelated-asset', code: '1136', name: 'WHT Receivable', account_type: 'asset' },
  { id: 'unrelated-liability', code: '2124', name: 'PAYE Payable', account_type: 'liability' },
];

describe('classifyTaxAccounts', () => {
  it('classifies input VAT and output VAT by standard code or tax-specific name within the correct account type', () => {
    const result = classifyTaxAccounts(accounts);

    expect(result.inputVat.map(({ id }) => id)).toEqual(['vat-in-code', 'vat-in-custom']);
    expect(result.outputVat.map(({ id }) => id)).toEqual(['vat-out-code', 'vat-out-custom']);
  });

  it('includes every liability WHT payable account regardless of its account code', () => {
    const result = classifyTaxAccounts(accounts);

    expect(result.whtPayable.map(({ id }) => id)).toEqual(['wht-custom']);
  });

  it('does not classify VAT or WHT accounts with an incompatible account type', () => {
    const result = classifyTaxAccounts([
      { id: 'wrong-vat', code: '2121', name: 'VAT Payable', account_type: 'asset' },
      { id: 'wrong-wht', code: 'TAX-1', name: 'WHT Payable', account_type: 'expense' },
    ]);

    expect(result.inputVat).toEqual([]);
    expect(result.outputVat).toEqual([]);
    expect(result.whtPayable).toEqual([]);
  });
});
