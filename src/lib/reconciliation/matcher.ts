export interface BankStatementMatchLine {
  id: string;
  transaction_date: string;
  description: string;
  reference: string | null;
  /** Signed cash impact: deposits are positive; withdrawals are negative. */
  amount: number;
  matchedAmount?: number;
}

export interface GlMatchLine {
  id: string;
  entry_date: string;
  description: string;
  entry_number: string;
  /** True for a debit to cash (positive impact), false for a credit (negative). */
  is_debit: boolean;
  amount: number;
  matchedAmount?: number;
}

export interface MatchCandidate {
  bankLineId: string;
  glLineId: string;
  amount: number;
  confidence: number;
  reason: 'exact' | 'amount_date' | 'amount_ref' | 'amount_unique';
}

export interface GroupMatch {
  bankLineId: string;
  glLineIds: string[];
  bankAmount: number;
  glTotal: number;
}

export interface MatchResult {
  matches: MatchCandidate[];
  unmatchedBank: string[];
  unmatchedGl: string[];
  suggestedGroups: GroupMatch[];
}

interface RemainingLine<T> {
  line: T;
  amount: number;
}

function cents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

function remainingAmount(lineAmount: number, matchedAmount = 0): number {
  const remaining = Math.max(0, Math.abs(lineAmount) - Math.max(0, matchedAmount));
  return cents(remaining) / 100;
}

function signedGlAmount(line: GlMatchLine, matchedAmount = 0): number {
  const remaining = remainingAmount(line.amount, matchedAmount);
  return line.is_debit ? remaining : -remaining;
}

function sameAmount(a: number, b: number): boolean {
  return cents(a) === cents(b);
}

function signedBankAmount(line: BankStatementMatchLine, matchedAmount = 0): number {
  const remaining = remainingAmount(line.amount, matchedAmount);
  return line.amount < 0 ? -remaining : remaining;
}

function dateDistanceDays(first: string, second: string): number {
  const firstTime = Date.parse(`${first.slice(0, 10)}T00:00:00Z`);
  const secondTime = Date.parse(`${second.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(firstTime - secondTime) / 86_400_000;
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 3) ?? [];
}

function referenceSimilarity(reference: string | null, description: string, entryNumber: string): boolean {
  if (!reference?.trim()) return false;
  const normalizedReference = reference.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedReference) return false;
  const normalizedCandidates = [description, entryNumber]
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  if (normalizedCandidates.some((candidate) => candidate.includes(normalizedReference) || normalizedReference.includes(candidate))) {
    return true;
  }
  const referenceTokens = new Set(normalizedTokens(reference));
  const candidateTokens = normalizedCandidates.flatMap(normalizedTokens);
  return candidateTokens.some((token) => referenceTokens.has(token));
}

interface Pair {
  bank: RemainingLine<BankStatementMatchLine>;
  gl: RemainingLine<GlMatchLine>;
}

function findSuggestedGroups(
  bank: RemainingLine<BankStatementMatchLine>,
  glLines: RemainingLine<GlMatchLine>[],
): GroupMatch | null {
  const candidates = glLines
    .filter((gl) => Math.sign(gl.amount) === Math.sign(bank.amount) && Math.abs(gl.amount) < Math.abs(bank.amount))
    .slice(0, 24);
  if (candidates.length < 2) return null;

  let explored = 0;
  const maxNodes = 60_000;
  const target = cents(Math.abs(bank.amount));
  let result: RemainingLine<GlMatchLine>[] | null = null;

  const search = (start: number, selected: RemainingLine<GlMatchLine>[], total: number) => {
    if (result || explored >= maxNodes) return;
    explored += 1;
    if (selected.length >= 2 && cents(total) === target) {
      result = [...selected];
      return;
    }
    if (selected.length >= 6 || cents(total) >= target) return;
    for (let index = start; index < candidates.length; index += 1) {
      const next = candidates[index];
      search(index + 1, [...selected, next], total + Math.abs(next.amount));
      if (result || explored >= maxNodes) return;
    }
  };
  search(0, [], 0);
  if (!result) return null;
  const selected = result as RemainingLine<GlMatchLine>[];
  return {
    bankLineId: bank.line.id,
    glLineIds: selected.map(({ line }) => line.id),
    bankAmount: bank.amount,
    glTotal: selected.reduce((total, { amount }) => total + amount, 0),
  };
}

/**
 * Greedy priority matcher. A candidate is auto-applied only when it is unique
 * on both sides at the current confidence level; ambiguous lines are held back
 * from lower-confidence matching and returned for manual review.
 */
export function autoMatch(
  bankLines: BankStatementMatchLine[],
  glLines: GlMatchLine[],
  options: { dateTolerance?: number } = {},
): MatchResult {
  const tolerance = Math.max(0, options.dateTolerance ?? 3);
  const banks: RemainingLine<BankStatementMatchLine>[] = bankLines
    .map((line) => ({ line, amount: signedBankAmount(line, line.matchedAmount) }))
    .filter(({ amount }) => Math.abs(amount) >= 0.005);
  const gls: RemainingLine<GlMatchLine>[] = glLines
    .map((line) => ({ line, amount: signedGlAmount(line, line.matchedAmount) }))
    .filter(({ amount }) => Math.abs(amount) >= 0.005);

  const availableBank = new Map(banks.map((item) => [item.line.id, item]));
  const availableGl = new Map(gls.map((item) => [item.line.id, item]));
  const blockedBank = new Set<string>();
  const blockedGl = new Set<string>();
  const matches: MatchCandidate[] = [];
  const priorities: Array<{
    confidence: number;
    reason: MatchCandidate['reason'];
    eligible: (bank: RemainingLine<BankStatementMatchLine>, gl: RemainingLine<GlMatchLine>) => boolean;
  }> = [
    {
      confidence: 100,
      reason: 'exact',
      eligible: (bank, gl) => sameAmount(bank.amount, gl.amount)
        && bank.line.transaction_date.slice(0, 10) === gl.line.entry_date.slice(0, 10)
        && referenceSimilarity(bank.line.reference, gl.line.entry_number, gl.line.entry_number),
    },
    {
      confidence: 90,
      reason: 'amount_date',
      eligible: (bank, gl) => sameAmount(bank.amount, gl.amount)
        && dateDistanceDays(bank.line.transaction_date, gl.line.entry_date) <= tolerance,
    },
    {
      confidence: 80,
      reason: 'amount_ref',
      eligible: (bank, gl) => sameAmount(bank.amount, gl.amount)
        && (referenceSimilarity(bank.line.reference, gl.line.description, gl.line.entry_number)
          || referenceSimilarity(bank.line.description, gl.line.entry_number, gl.line.entry_number)),
    },
  ];

  const applyPair = (pair: Pair, confidence: number, reason: MatchCandidate['reason']) => {
    const { bank, gl } = pair;
    matches.push({
      bankLineId: bank.line.id,
      glLineId: gl.line.id,
      amount: Math.abs(bank.amount),
      confidence,
      reason,
    });
    availableBank.delete(bank.line.id);
    availableGl.delete(gl.line.id);
  };

  for (const priority of priorities) {
    const eligiblePairs: Pair[] = [];
    for (const bank of availableBank.values()) {
      if (blockedBank.has(bank.line.id)) continue;
      for (const gl of availableGl.values()) {
        if (blockedGl.has(gl.line.id) || !sameAmount(bank.amount, gl.amount)) continue;
        if (priority.eligible(bank, gl)) eligiblePairs.push({ bank, gl });
      }
    }
    const bankCounts = new Map<string, number>();
    const glCounts = new Map<string, number>();
    for (const pair of eligiblePairs) {
      bankCounts.set(pair.bank.line.id, (bankCounts.get(pair.bank.line.id) ?? 0) + 1);
      glCounts.set(pair.gl.line.id, (glCounts.get(pair.gl.line.id) ?? 0) + 1);
    }
    for (const pair of eligiblePairs) {
      if (bankCounts.get(pair.bank.line.id) !== 1 || glCounts.get(pair.gl.line.id) !== 1) {
        blockedBank.add(pair.bank.line.id);
        blockedGl.add(pair.gl.line.id);
      }
    }
    for (const pair of eligiblePairs) {
      if (bankCounts.get(pair.bank.line.id) === 1 && glCounts.get(pair.gl.line.id) === 1
        && availableBank.has(pair.bank.line.id) && availableGl.has(pair.gl.line.id)) {
        applyPair(pair, priority.confidence, priority.reason);
      }
    }
  }

  const bankAmountCounts = new Map<number, number>();
  const glAmountCounts = new Map<number, number>();
  for (const bank of availableBank.values()) {
    if (!blockedBank.has(bank.line.id)) {
      const key = cents(bank.amount);
      bankAmountCounts.set(key, (bankAmountCounts.get(key) ?? 0) + 1);
    }
  }
  for (const gl of availableGl.values()) {
    if (!blockedGl.has(gl.line.id)) {
      const key = cents(gl.amount);
      glAmountCounts.set(key, (glAmountCounts.get(key) ?? 0) + 1);
    }
  }
  for (const bank of [...availableBank.values()]) {
    if (blockedBank.has(bank.line.id)) continue;
    const key = cents(bank.amount);
    if (bankAmountCounts.get(key) !== 1 || glAmountCounts.get(key) !== 1) continue;
    const gl = [...availableGl.values()].find((candidate) => !blockedGl.has(candidate.line.id) && cents(candidate.amount) === key);
    if (gl) applyPair({ bank, gl }, 60, 'amount_unique');
  }

  const unmatchedBankLines = [...availableBank.values()];
  const suggestedGroups = unmatchedBankLines
    .map((bank) => findSuggestedGroups(bank, [...availableGl.values()].filter((gl) => !blockedGl.has(gl.line.id))))
    .filter((group): group is GroupMatch => group !== null);

  return {
    matches,
    unmatchedBank: [...availableBank.keys()],
    unmatchedGl: [...availableGl.keys()],
    suggestedGroups,
  };
}
