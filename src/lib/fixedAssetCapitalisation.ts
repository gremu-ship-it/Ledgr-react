/**
 * Pure helpers for fixed-asset capitalisation journals.
 *
 * Register-era fixed assets (created in the Assets register or via CSV
 * import) were saved with NO general-ledger entry at all, so the Statement
 * of Financial Position — a GL report — showed fixed assets at zero even
 * when the register listed them. Depreciation/disposal/revaluation journals
 * existed in FixedAssetsJournalService; the initial capitalisation leg was
 * simply missing.
 *
 * These functions decide the shape of the repair, so they carry no Supabase
 * dependency and can be unit-tested without a database (same pattern as
 * inventoryValuation.ts).
 */

export interface CapitalisationLineParams {
  assetAccountId: string;
  fundingAccountId: string;
  /** Always positive; `direction` decides which side the asset sits on. */
  amount: number;
  description: string;
  direction: 'increase' | 'decrease';
}

export interface CapitalisationLine {
  line_number: number;
  account_id: string;
  description: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
  currency: string;
  exchange_rate: number;
  tax_code: 'none';
  tax_amount: number;
  reconciled: boolean;
}

/**
 * Builder for the capitalisation journal lines:
 *   increase: DR Fixed Asset (cost) / CR funding (bank, creditor or capital)
 *   decrease: CR Fixed Asset / DR funding (cost adjustment down)
 */
export function buildCapitalisationLines(p: CapitalisationLineParams): CapitalisationLine[] {
  const assetIsDebit = p.direction === 'increase';
  const line = (accountId: string, isDebit: boolean, lineNumber: number): CapitalisationLine => ({
    line_number: lineNumber,
    account_id: accountId,
    description: p.description,
    is_debit: isDebit,
    amount: p.amount,
    amount_base: p.amount,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
  });
  return [
    line(assetIsDebit ? p.assetAccountId : p.fundingAccountId, true, 1),
    line(assetIsDebit ? p.fundingAccountId : p.assetAccountId, false, 2),
  ];
}

/**
 * Selector for the backfill: which register assets still need a
 * capitalisation journal. Disposed assets are excluded — their cost was
 * already derecognised on both sides by the disposal journal (posting a
 * capitalisation for them now would resurrect the asset in the GL).
 */
export function selectAssetsMissingCapitalisation<T extends { id: string; status: string }>(
  assets: T[],
  capitalisedAssetIds: ReadonlySet<string>,
): T[] {
  return assets.filter((a) => a.status !== 'disposed' && !capitalisedAssetIds.has(a.id));
}
