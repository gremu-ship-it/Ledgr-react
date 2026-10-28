import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';

export interface AccountNode extends TrialBalanceRow {
  children: AccountNode[];
  rollupDebit: number;
  rollupCredit: number;
  rollupBalance: number;
}

export interface VisibleAccountRow {
  node: AccountNode;
  depth: number;
}

export function buildAccountTree(rows: TrialBalanceRow[]): AccountNode[] {
  const byId = new Map<string, AccountNode>();

  for (const row of rows) {
    byId.set(row.account_id, {
      ...row,
      total_debit: Number(row.total_debit ?? 0),
      total_credit: Number(row.total_credit ?? 0),
      balance: Number(row.balance ?? 0),
      children: [],
      rollupDebit: Number(row.total_debit ?? 0),
      rollupCredit: Number(row.total_credit ?? 0),
      rollupBalance: Number(row.balance ?? 0),
    });
  }

  const roots: AccountNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_account_id ? byId.get(node.parent_account_id) : undefined;
    if (parent && parent.account_id !== node.account_id) parent.children.push(node);
    else roots.push(node);
  }

  const rollUp = (node: AccountNode, visited = new Set<string>()): void => {
    // Protect rendering if corrupted hierarchy data contains a cycle.
    if (visited.has(node.account_id)) return;
    const path = new Set(visited).add(node.account_id);
    for (const child of node.children) {
      rollUp(child, path);
      node.rollupDebit += child.rollupDebit;
      node.rollupCredit += child.rollupCredit;
      node.rollupBalance += child.rollupBalance;
    }
  };

  roots.forEach((root) => rollUp(root));
  return roots;
}

export function visibleAccountRows(
  roots: AccountNode[],
  expandedAccountIds: ReadonlySet<string>,
): VisibleAccountRow[] {
  const visible: VisibleAccountRow[] = [];
  const visit = (nodes: AccountNode[], depth: number) => {
    for (const node of nodes) {
      visible.push({ node, depth });
      if (node.children.length && expandedAccountIds.has(node.account_id)) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(roots, 0);
  return visible;
}

export function accountIdsWithChildren(roots: AccountNode[]): string[] {
  const ids: string[] = [];
  const visit = (nodes: AccountNode[]) => {
    for (const node of nodes) {
      if (node.children.length) ids.push(node.account_id);
      visit(node.children);
    }
  };
  visit(roots);
  return ids;
}

export function defaultExpandedAccountIds(roots: AccountNode[]): Set<string> {
  return new Set(roots.filter((node) => node.children.length > 0).map((node) => node.account_id));
}
