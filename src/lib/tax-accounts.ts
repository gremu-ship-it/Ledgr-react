export interface TaxAccount {
  id: string;
  code: string;
  name: string;
  account_type: string | null;
}

export interface TaxAccountClassification {
  inputVat: TaxAccount[];
  outputVat: TaxAccount[];
  whtPayable: TaxAccount[];
}

const normalizedName = (name: string) => name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isVatInputName = (name: string) => /\bvat\b/.test(name) && /\b(input|receivable|claimable)\b/.test(name);
const isVatOutputName = (name: string) => /\bvat\b/.test(name) && /\b(output|payable|collected)\b/.test(name);
const isWhtPayableName = (name: string) =>
  /\b(wht|withholding)\b/.test(name) && /\bpayable\b/.test(name);

/** Classify only leaf asset/liability accounts used in the tax schedules. */
export function classifyTaxAccounts(accounts: readonly TaxAccount[]): TaxAccountClassification {
  const inputVat: TaxAccount[] = [];
  const outputVat: TaxAccount[] = [];
  const whtPayable: TaxAccount[] = [];

  for (const account of accounts) {
    const name = normalizedName(account.name);
    const code = account.code.trim();
    if (account.account_type === 'asset' && (code === '1135' || isVatInputName(name))) {
      inputVat.push(account);
    }
    if (account.account_type === 'liability' && (code === '2121' || isVatOutputName(name))) {
      outputVat.push(account);
    }
    // WHT payable accounts are selected by their account name, not a fixed code:
    // businesses may use their own chart-of-accounts numbering.
    if (account.account_type === 'liability' && isWhtPayableName(name)) {
      whtPayable.push(account);
    }
  }

  return { inputVat, outputVat, whtPayable };
}
