import type { AnomalyCategory, AnomalySeverity, AiAnomalySourceTable } from '@/types/ai';

export interface ScanExpense {
  id: string;
  expense_number: string;
  expense_date: string;
  total_amount: number;
  currency: string;
  contact_id: string | null;
  supplier_name: string | null;
}

export interface ScanExpenseLine {
  id: string;
  expense_id: string;
  line_total: number;
  tax_amount: number;
  tax_code: string | null;
}

export interface ScanJournalEntry {
  id: string;
  entry_date: string;
  entry_number: string;
  description: string;
}

export interface ScanJournalLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  account_name: string;
  amount_base: number;
  is_debit: boolean;
  department_id: string | null;
  tax_amount: number;
  tax_code: string | null;
}

export interface ScanPayrollRun {
  id: string;
  pay_date: string;
  run_number: string;
  total_gross: number;
}

export interface AnomalyScanInput {
  expenses: ScanExpense[];
  expenseLines: ScanExpenseLine[];
  journalEntries: ScanJournalEntry[];
  journalLines: ScanJournalLine[];
  payrollRuns: ScanPayrollRun[];
}

export interface DetectedAnomaly {
  category: AnomalyCategory;
  severity: AnomalySeverity;
  title: string;
  description: string;
  source_table: AiAnomalySourceTable;
  source_id: string;
  metadata: Record<string, string | number | boolean | null>;
}

interface ZScore {
  mean: number;
  standardDeviation: number;
  score: number;
}

/** Sample-standard-deviation z-score; null means there is not enough history to compare. */
export function calculateZScore(value: number, sample: number[]): ZScore | null {
  const finite = sample.filter(Number.isFinite);
  if (finite.length < 4 || !Number.isFinite(value)) return null;
  const mean = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  const sumSquares = finite.reduce((sum, item) => sum + (item - mean) ** 2, 0);
  const standardDeviation = Math.sqrt(sumSquares / (finite.length - 1));
  if (standardDeviation === 0) return null;
  return { mean, standardDeviation, score: (value - mean) / standardDeviation };
}

/** Lightweight Dice similarity over normalized supplier-name bigrams; no external fuzzy-matching dependency. */
interface ZScoreStats {
  count: number;
  mean: number;
  squaredDeviations: number;
}

function buildZScoreStats(values: number[]): ZScoreStats | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 5) return null;
  const mean = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  return {
    count: finite.length,
    mean,
    squaredDeviations: finite.reduce((sum, item) => sum + (item - mean) ** 2, 0),
  };
}

function calculateLeaveOneOutZScore(value: number, stats: ZScoreStats | null): ZScore | null {
  if (!stats || !Number.isFinite(value)) return null;
  const peerCount = stats.count - 1;
  const peerMean = (stats.mean * stats.count - value) / peerCount;
  const peerSquaredDeviations = stats.squaredDeviations
    - (value - stats.mean) ** 2
    - peerCount * (peerMean - stats.mean) ** 2;
  if (peerSquaredDeviations <= Number.EPSILON * Math.max(stats.squaredDeviations, 1)) return null;
  const standardDeviation = Math.sqrt(peerSquaredDeviations / (peerCount - 1));
  return { mean: peerMean, standardDeviation, score: (value - peerMean) / standardDeviation };
}

export function supplierNameSimilarity(first: string, second: string): number {
  const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const a = normalize(first);
  const b = normalize(second);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const bigrams = (value: string) => {
    const compact = value.replace(/\s/g, '');
    if (compact.length < 2) return new Set([compact]);
    return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)));
  };
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  const intersection = [...aGrams].filter((gram) => bGrams.has(gram)).length;
  const dice = (2 * intersection) / (aGrams.size + bGrams.size);

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const tokenIntersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const tokenDice = (2 * tokenIntersection) / (aTokens.size + bTokens.size);
  return Math.max(dice, tokenDice);
}

function severityForZScore(score: number): AnomalySeverity {
  if (score >= 3) return 'high';
  if (score >= 2.5) return 'medium';
  return 'low';
}

function makeAnomaly(
  category: AnomalyCategory,
  severity: AnomalySeverity,
  titleKey: string,
  descriptionKey: string,
  sourceTable: AiAnomalySourceTable,
  sourceId: string,
  metadata: DetectedAnomaly['metadata'],
): DetectedAnomaly {
  return { category, severity, title: titleKey, description: descriptionKey, source_table: sourceTable, source_id: sourceId, metadata };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Deterministic, explainable ledger checks. These produce translation keys, never hard-coded UI copy. */
export function detectLedgerAnomalies(input: AnomalyScanInput): DetectedAnomaly[] {
  const findings: DetectedAnomaly[] = [];

  // Block duplicate matching by currency and rounded cents before fuzzy comparisons.
  // This avoids comparing every expense against every unrelated amount in a large ledger.
  const duplicateByExpense = new Map<string, DetectedAnomaly>();
  const expenseGroups = new Map<string, Array<{ expense: ScanExpense; date: number; cents: number }>>();
  for (const expense of input.expenses) {
    const date = Date.parse(expense.expense_date);
    if (!expense.supplier_name || !Number.isFinite(expense.total_amount) || expense.total_amount <= 0 || !Number.isFinite(date)) continue;
    const cents = Math.round(expense.total_amount * 100);
    const key = `${expense.currency.toUpperCase()}:${cents}`;
    const group = expenseGroups.get(key) ?? [];
    group.push({ expense, date, cents });
    expenseGroups.set(key, group);
  }
  for (const group of expenseGroups.values()) {
    group.sort((a, b) => a.date - b.date || a.expense.id.localeCompare(b.expense.id));
  }

  const maxSupplierComparisonsPerExpense = 200;
  const weekMs = 7 * 86_400_000;
  for (const [key, group] of expenseGroups) {
    const split = key.lastIndexOf(':');
    const currency = key.slice(0, split);
    const cents = Number(key.slice(split + 1));
    const upperCentGroup = expenseGroups.get(`${currency}:${cents + 1}`) ?? [];
    let upperStart = 0;

    const considerPair = (first: ScanExpense, second: ScanExpense, firstDate: number, secondDate: number) => {
      if (first.currency.toUpperCase() !== second.currency.toUpperCase()) return;
      if (Math.abs(first.total_amount - second.total_amount) > 0.01) return;
      const similarity = supplierNameSimilarity(first.supplier_name!, second.supplier_name!);
      if (similarity < 0.72) return;

      const current = firstDate > secondDate || (firstDate === secondDate && first.id > second.id) ? first : second;
      const matched = current.id === first.id ? second : first;
      const finding = makeAnomaly(
        'duplicate_invoice', 'high', 'ai.anomalyTitles.duplicateInvoice', 'ai.anomalyDescriptions.duplicateInvoice',
        'expenses', current.id,
        {
          amount: current.total_amount,
          date: current.expense_date,
          supplier: current.supplier_name,
          matchedExpenseId: matched.id,
          matchedExpenseNumber: matched.expense_number,
          similarityPercent: Math.round(similarity * 100),
        },
      );
      const previous = duplicateByExpense.get(current.id);
      if (!previous || Number(finding.metadata.similarityPercent) > Number(previous.metadata.similarityPercent)) {
        duplicateByExpense.set(current.id, finding);
      }
    };

    for (let left = 0; left < group.length; left += 1) {
      const first = group[left];
      let comparisons = 0;
      for (let right = left + 1; right < group.length && group[right].date - first.date <= weekMs; right += 1) {
        if (comparisons >= maxSupplierComparisonsPerExpense) break;
        considerPair(first.expense, group[right].expense, first.date, group[right].date);
        comparisons += 1;
      }
      while (upperStart < upperCentGroup.length && upperCentGroup[upperStart].date < first.date - weekMs) upperStart += 1;
      for (let right = upperStart; right < upperCentGroup.length && upperCentGroup[right].date <= first.date + weekMs; right += 1) {
        if (comparisons >= maxSupplierComparisonsPerExpense) break;
        considerPair(first.expense, upperCentGroup[right].expense, first.date, upperCentGroup[right].date);
        comparisons += 1;
      }
    }
  }
  findings.push(...duplicateByExpense.values());

  // Missing cost-center allocation: report only where this account normally uses departments.
  const debitLinesByAccount = new Map<string, ScanJournalLine[]>();
  for (const line of input.journalLines) {
    if (!line.is_debit || !Number.isFinite(line.amount_base) || line.amount_base <= 0) continue;
    const group = debitLinesByAccount.get(line.account_id) ?? [];
    group.push(line);
    debitLinesByAccount.set(line.account_id, group);
  }
  const entryDate = new Map(input.journalEntries.map((entry) => [entry.id, entry.entry_date]));
  const allocationByEntry = new Set<string>();
  for (const [accountId, lines] of debitLinesByAccount) {
    const allocated = lines.filter((line) => Boolean(line.department_id));
    if (allocated.length < 4 || allocated.length / lines.length < 0.6) continue;
    const materiality = median(allocated.map((line) => line.amount_base));
    for (const line of lines) {
      if (line.department_id || line.amount_base < materiality) continue;
      if (allocationByEntry.has(line.journal_entry_id)) continue;
      allocationByEntry.add(line.journal_entry_id);
      findings.push(makeAnomaly(
        'unallocated_cost_center', line.amount_base >= materiality * 3 ? 'medium' : 'low',
        'ai.anomalyTitles.unallocatedCostCenter', 'ai.anomalyDescriptions.unallocatedCostCenter',
        'journal_entries', line.journal_entry_id,
        { amount: line.amount_base, account: line.account_name || accountId, date: entryDate.get(line.journal_entry_id) ?? null, lineId: line.id },
      ));
    }
  }

  // A tax amount without a specific tax code is inconsistent and merits review.
  const expenseNumberById = new Map(input.expenses.map((expense) => [expense.id, expense.expense_number]));
  for (const line of input.expenseLines) {
    if (line.tax_amount <= 0 || (line.tax_code && line.tax_code !== 'none')) continue;
    findings.push(makeAnomaly(
      'missing_tax_tag', 'medium', 'ai.anomalyTitles.missingTaxTag', 'ai.anomalyDescriptions.missingTaxTag',
      'expense_lines', line.id,
      { amount: line.line_total, taxAmount: line.tax_amount, expenseId: line.expense_id, expenseNumber: expenseNumberById.get(line.expense_id) ?? null },
    ));
  }
  for (const line of input.journalLines) {
    if (line.tax_amount <= 0 || (line.tax_code && line.tax_code !== 'none')) continue;
    findings.push(makeAnomaly(
      'missing_tax_tag', 'medium', 'ai.anomalyTitles.missingTaxTag', 'ai.anomalyDescriptions.missingTaxTag',
      'journal_entries', line.journal_entry_id,
      { amount: line.amount_base, taxAmount: line.tax_amount, lineId: line.id },
    ));
  }

  // Statistical high-amount outliers on posted general-ledger entries (90-day comparison window).
  const entryAmounts = new Map<string, number>();
  for (const line of input.journalLines) {
    if (line.is_debit && Number.isFinite(line.amount_base)) {
      entryAmounts.set(line.journal_entry_id, (entryAmounts.get(line.journal_entry_id) ?? 0) + line.amount_base);
    }
  }
  const entriesWithAmount = input.journalEntries
    .map((entry) => ({ entry, amount: entryAmounts.get(entry.id) ?? 0 }))
    .filter(({ amount }) => amount > 0);
  const entryAmountStats = buildZScoreStats(entriesWithAmount.map(({ amount }) => amount));
  for (const { entry, amount } of entriesWithAmount) {
    const z = calculateLeaveOneOutZScore(amount, entryAmountStats);
    if (!z || z.score < 2) continue;
    findings.push(makeAnomaly(
      'amount_outlier', severityForZScore(z.score), 'ai.anomalyTitles.amountOutlier', 'ai.anomalyDescriptions.amountOutlier',
      'journal_entries', entry.id,
      { amount, average: z.mean, zScore: Number(z.score.toFixed(2)), date: entry.entry_date, entryNumber: entry.entry_number },
    ));
  }

  // Leave-one-run-out comparison prevents a single extreme payroll from inflating its own baseline.
  const payrollSample = input.payrollRuns.filter((run) => Number.isFinite(run.total_gross) && run.total_gross > 0);
  const payrollStats = buildZScoreStats(payrollSample.map((run) => run.total_gross));
  for (const run of payrollSample) {
    const z = calculateLeaveOneOutZScore(run.total_gross, payrollStats);
    if (!z || Math.abs(z.score) < 2) continue;
    findings.push(makeAnomaly(
      'payroll_variance', severityForZScore(Math.abs(z.score)), 'ai.anomalyTitles.payrollVariance', 'ai.anomalyDescriptions.payrollVariance',
      'payroll_runs', run.id,
      { amount: run.total_gross, average: z.mean, zScore: Number(Math.abs(z.score).toFixed(2)), direction: z.score > 0 ? 'above' : 'below', date: run.pay_date, runNumber: run.run_number },
    ));
  }

  // One row per source/category keeps a single scan from flooding the dashboard.
  const unique = new Map<string, DetectedAnomaly>();
  for (const finding of findings) {
    const key = `${finding.category}:${finding.source_table}:${finding.source_id}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  const severityRank: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...unique.values()].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.category.localeCompare(b.category));
}
