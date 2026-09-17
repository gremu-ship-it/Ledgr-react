/**
 * A tiny in-memory stand-in for PostgREST.
 *
 * Demo mode swaps the Supabase client for `demoClient`, whose `.from()`
 * returns one of these builders. It implements the subset of the
 * supabase-js query-builder surface the app actually uses (audited across
 * `src/`): select with embedded resources and `!inner`, every filter operator,
 * ordering, paging, `single`/`maybeSingle`, exact counts, and the four
 * mutations. Rows come from (and go back to) the visitor's local demo tables.
 *
 * Deliberate differences from the real thing:
 *   - comparisons are loose at the edges (`'1110' == 1110`) because PostgREST
 *     filter strings arrive untyped and Postgres would coerce for us;
 *   - there are no constraints, triggers or RLS — the seed is already scoped
 *     to one business, which is all RLS would have returned anyway;
 *   - unknown tables read as empty and writes create them, so a page touching
 *     a table the seed doesn't cover degrades to an empty state instead of
 *     throwing.
 */

import { computeDemoView, isDemoView } from './views';
import { markDemoStateChanged } from './store';
import { demoUuid } from './constants';
import type { DemoRow, DemoTables } from './dataset';

export interface DemoQueryResult<T = DemoRow> {
  data: T[] | T | null;
  error: DemoQueryError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export interface DemoQueryError {
  message: string;
  details: string;
  hint: string;
  code: string;
}

function error(message: string, code: string, details = ''): DemoQueryError {
  return { message, details, hint: '', code };
}

/** Every table the app can query, so embeds resolve even when the seed is empty. */
const KNOWN_TABLES = [
  'accounts', 'accounting_periods', 'api_keys', 'asset_categories', 'assets', 'audit_log',
  'bank_statement_lines', 'bank_statements', 'business_invitations', 'business_terms_acceptances',
  'business_users', 'businesses', 'contacts', 'currencies', 'depreciation_schedules', 'departments',
  'employees', 'exchange_rates', 'expense_lines', 'expense_payments', 'expenses', 'expenses_lines',
  'fixed_assets', 'fx_revaluations', 'inventory_balances', 'inventory_locations', 'invoice_lines',
  'invoice_payments', 'invoices', 'journal_entries', 'journal_lines', 'loan_repayments', 'loans',
  'partner_admins', 'partner_clients', 'partner_feature_flags', 'partner_invoices', 'partners',
  'paye_bands', 'payroll_employee_lines', 'payroll_runs', 'periods', 'products', 'share_transactions',
  'shares', 'stock_movements', 'stock_transfer_lines', 'stock_transfers', 'subscription_payments',
  'tax_alerts', 'tax_configurations', 'tax_payments', 'tax_returns', 'user_profiles', 'webhook_deliveries',
  'webhooks',
];

const KNOWN_VIEWS = [
  'v_ar_ageing', 'v_asset_register', 'v_cash_flow', 'v_inventory_ledger_variance',
  'v_partner_client_usage', 'v_reorder_alerts', 'v_trial_balance',
];

// ── select-string parsing ────────────────────────────────────────────────────

interface SelectNode {
  /** Column name on the parent (`*` when the node is a star). */
  column?: string;
  /** Output key in the result row. */
  key?: string;
  /** Embedded resource: table/view it points at. */
  embed?: string;
  inner?: boolean;
  children?: SelectNode[];
}

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseSelect(select: string): SelectNode[] {
  return splitTopLevel(select, ',').map(parseSelectItem);
}

function parseSelectItem(item: string): SelectNode {
  const trimmed = item.trim();
  if (trimmed === '*') return { column: '*', key: '*' };

  const openIdx = trimmed.indexOf('(');
  if (openIdx === -1) {
    // Plain column, optionally aliased: `business_id` or `biz:business_id`.
    const [alias, column] = trimmed.includes(':')
      ? trimmed.split(':')
      : [undefined, trimmed];
    return { column: column.trim(), key: (alias ?? column).trim() };
  }

  const head = trimmed.slice(0, openIdx).trim();
  const body = trimmed.slice(openIdx + 1, trimmed.lastIndexOf(')'));
  let alias: string | undefined;
  let resource = head;
  if (head.includes(':')) {
    const parts = head.split(':');
    alias = parts[0].trim();
    resource = parts[1].trim();
  }
  let inner = false;
  if (resource.includes('!')) {
    const [name, ...hints] = resource.split('!');
    resource = name.trim();
    inner = hints.some((h) => h.trim() === 'inner');
  }
  return {
    key: alias ?? resource,
    embed: resource,
    inner,
    children: parseSelect(body),
  };
}

// ── name helpers ─────────────────────────────────────────────────────────────

function pluralize(name: string): string {
  if (name.endsWith('ies')) return name;
  if (name.endsWith('s')) return name;
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function singularize(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('sses')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

/** Map an embedded resource name (`businesses`, `business`, `v_ar_ageing`) to a table. */
function resolveRelation(resource: string): string | null {
  const candidates = [resource, pluralize(resource), singularize(resource)];
  for (const c of candidates) {
    if (KNOWN_TABLES.includes(c) || KNOWN_VIEWS.includes(c)) return c;
  }
  // `businesses` → `business` already covered; handle irregular pairs.
  const irregular: Record<string, string> = { business: 'businesses', person: 'user_profiles' };
  return irregular[resource] ?? null;
}

// ── value comparison ─────────────────────────────────────────────────────────

function asComparable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  const s = String(value);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  return s;
}

function looseEq(a: unknown, b: unknown): boolean {
  const left = asComparable(a);
  const right = asComparable(b);
  if (left === right) return true;
  if (left === null || right === null) return false;
  return String(left) === String(right);
}

function compare(a: unknown, b: unknown): number {
  const left = a === null || a === undefined ? null : a;
  const right = b === null || b === undefined ? null : b;
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const ln = Number(left);
  const rn = Number(right);
  if (!Number.isNaN(ln) && !Number.isNaN(rn) && left !== '' && right !== '') {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }
  const ls = String(left);
  const rs = String(right);
  return ls === rs ? 0 : ls < rs ? -1 : 1;
}

function likeToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : undefined);
}

type FilterFn = (row: DemoRow) => boolean;

interface FilterSpec {
  /** Column on the parent row, or `relation.column` for an embedded filter. */
  column: string;
  op: string;
  value: unknown;
  negate: boolean;
}

function buildFilter(spec: FilterSpec, relationResolver: RelationResolver): FilterFn {
  const { column, op, value, negate } = spec;

  const evaluate = (row: DemoRow): boolean => {
    if (column.includes('.')) {
      const [relation, ...rest] = column.split('.');
      return relationResolver.matchesEmbed(row, relation, {
        column: rest.join('.'),
        op,
        value,
        negate: false,
      });
    }
    const actual = row[column];
    switch (op) {
      case 'eq': return looseEq(actual, value);
      case 'neq': return !looseEq(actual, value);
      case 'gt': return compare(actual, value) > 0;
      case 'gte': return compare(actual, value) >= 0;
      case 'lt': return compare(actual, value) < 0;
      case 'lte': return compare(actual, value) <= 0;
      case 'like': return likeToRegExp(String(value), false).test(String(actual ?? ''));
      case 'ilike': return likeToRegExp(String(value), true).test(String(actual ?? ''));
      case 'is': return value === null || value === 'null'
        ? actual === null || actual === undefined
        : looseEq(actual, value);
      case 'in': {
        const list = Array.isArray(value) ? value : String(value).replace(/^\(|\)$/g, '').split(',');
        return list.some((v) => looseEq(actual, String(v).trim()));
      }
      case 'contains': {
        if (!Array.isArray(actual)) return false;
        const wanted = Array.isArray(value) ? value : [value];
        return wanted.every((w) => actual.some((a) => looseEq(a, w)));
      }
      case 'cs': return JSON.stringify(actual ?? null) === JSON.stringify(value ?? null);
      case 'match':
      case 'fts':
      case 'plfts':
      case 'phfts':
        return String(actual ?? '').toLowerCase().includes(String(value).toLowerCase());
      case 'not.is': return !(value === null ? actual == null : looseEq(actual, value));
      default:
        // Unknown operator: do not silently drop rows — match everything so a
        // page still renders its (unfiltered) demo data.
        return true;
    }
  };

  return negate ? (row) => !evaluate(row) : evaluate;
}

// ── Or-filter parsing ────────────────────────────────────────────────────────

function parseOrExpression(expression: string): FilterSpec[][] {
  // Each comma-separated term is an AND group inside the OR.
  return splitTopLevel(expression, ',').map((term) => {
    const inner = term.replace(/^(and|or)\(/, '').replace(/\)$/, '');
    return splitTopLevel(inner, ',').map(parseFilterTerm);
  });
}

function parseFilterTerm(term: string): FilterSpec {
  const trimmed = term.trim();
  const firstDot = trimmed.indexOf('.');
  const column = trimmed.slice(0, firstDot === -1 ? trimmed.length : firstDot);
  const rest = firstDot === -1 ? '' : trimmed.slice(firstDot + 1);
  const secondDot = rest.indexOf('.');
  const op = secondDot === -1 ? rest : rest.slice(0, secondDot);
  const rawValue = secondDot === -1 ? '' : rest.slice(secondDot + 1);
  return { column: column.trim(), op: op.trim(), value: decodeFilterValue(rawValue.trim()), negate: false };
}

function decodeFilterValue(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    return raw.slice(1, -1).split(',').map((v) => v.trim());
  }
  return raw;
}

// ── Embeds ───────────────────────────────────────────────────────────────────

interface RelationResolver {
  matchesEmbed(row: DemoRow, relation: string, spec: FilterSpec): boolean;
}

interface ResolvedRelation {
  table: string;
  /** Column on the parent holding the child's id (many-to-one). */
  parentIdColumn?: string;
  /** Column on the child holding the parent's id (one-to-many). */
  childIdColumn?: string;
  many: boolean;
}

export class DemoQueryBuilder implements PromiseLike<DemoQueryResult>, RelationResolver {
  private readonly tableName: string;
  private readonly tables: DemoTables;
  private readonly filters: FilterFn[] = [];
  private readonly orGroups: FilterSpec[][][] = [];
  private readonly orders: { column: string; ascending: boolean; nullsFirst: boolean; relation?: string }[] = [];
  private selectNodes: SelectNode[] = [{ column: '*', key: '*' }];
  private selectExplicit = false;
  private head = false;
  private wantsCount = false;
  private limitValue: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleMode: 'off' | 'single' | 'maybeSingle' = 'off';
  private mutation: 'none' | 'insert' | 'update' | 'upsert' | 'delete' = 'none';
  private payload: DemoRow | DemoRow[] | null = null;
  private patch: DemoRow | null = null;
  private onConflict: string | null = null;

  constructor(tableName: string, tables: DemoTables) {
    this.tableName = tableName;
    this.tables = tables;
  }

  // ── chainable API ──────────────────────────────────────────────────────────

  select(columns = '*', options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' }): this {
    this.selectNodes = parseSelect(columns);
    this.selectExplicit = true;
    this.head = Boolean(options?.head);
    this.wantsCount = Boolean(options?.count);
    return this;
  }

  insert(rows: DemoRow | DemoRow[]): this {
    this.mutation = 'insert';
    this.payload = rows;
    return this;
  }

  upsert(rows: DemoRow | DemoRow[], options?: { onConflict?: string }): this {
    this.mutation = 'upsert';
    this.payload = rows;
    this.onConflict = options?.onConflict ?? 'id';
    return this;
  }

  update(patch: DemoRow): this {
    this.mutation = 'update';
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.mutation = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this { return this.pushFilter(column, 'eq', value, false); }
  neq(column: string, value: unknown): this { return this.pushFilter(column, 'neq', value, false); }
  gt(column: string, value: unknown): this { return this.pushFilter(column, 'gt', value, false); }
  gte(column: string, value: unknown): this { return this.pushFilter(column, 'gte', value, false); }
  lt(column: string, value: unknown): this { return this.pushFilter(column, 'lt', value, false); }
  lte(column: string, value: unknown): this { return this.pushFilter(column, 'lte', value, false); }
  like(column: string, pattern: string): this { return this.pushFilter(column, 'like', pattern, false); }
  ilike(column: string, pattern: string): this { return this.pushFilter(column, 'ilike', pattern, false); }
  is(column: string, value: null | boolean): this { return this.pushFilter(column, 'is', value, false); }
  in(column: string, values: unknown[]): this { return this.pushFilter(column, 'in', values, false); }
  contains(column: string, value: unknown[]): this { return this.pushFilter(column, 'contains', value, false); }
  match(criteria: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(criteria)) this.pushFilter(column, 'eq', value, false);
    return this;
  }

  not(column: string, op: string, value: unknown): this {
    return this.pushFilter(column, op, value, true);
  }

  filter(column: string, op: string, value: unknown): this {
    return this.pushFilter(column, op, value, false);
  }

  or(expression: string): this {
    this.orGroups.push(parseOrExpression(expression));
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string }): this {
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst ?? false,
      relation: options?.referencedTable ?? options?.foreignTable,
    });
    return this;
  }

  limit(n: number): this { this.limitValue = n; return this; }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single(): this { this.singleMode = 'single'; return this; }
  maybeSingle(): this { this.singleMode = 'maybeSingle'; return this; }

  /** Type-only helpers in supabase-js — no runtime effect here. */
  returns<R = unknown>(): DemoQueryBuilder & PromiseLike<DemoQueryResult<R & DemoRow>> {
    return this as never;
  }
  overrideTypes<R = unknown>(): DemoQueryBuilder & PromiseLike<DemoQueryResult<R & DemoRow>> {
    return this as never;
  }
  throwOnError(): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- accepted for supabase-js API compatibility; local queries never abort
  abortSignal(_signal?: AbortSignal): this { return this; }
  csv(): this { return this; }

  // ── filter plumbing ────────────────────────────────────────────────────────

  private readonly embedFilters = new Map<string, FilterFn[]>();

  private pushFilter(column: string, op: string, value: unknown, negate: boolean): this {
    this.filters.push(buildFilter({ column, op, value, negate }, this));
    if (column.includes('.')) {
      // Keep a child-scoped copy so the embedded list is narrowed as well
      // (`businesses.is_active` → only the active business is embedded).
      const relation = column.split('.')[0];
      const childColumn = column.split('.').slice(1).join('.');
      const existing = this.embedFilters.get(relation) ?? [];
      existing.push(buildFilter({ column: childColumn, op, value, negate }, this));
      this.embedFilters.set(relation, existing);
    }
    return this;
  }

  /** Used by dotted filters: does the embedded relation satisfy the predicate? */
  matchesEmbed(row: DemoRow, relation: string, spec: FilterSpec): boolean {
    const [alias, resource] = relation.includes(':') ? relation.split(':') : [relation, relation];
    const resolved = this.resolveRelation(row, resource, alias);
    if (!resolved) return false;
    const childFilter = buildFilter(spec, this);
    const children = this.relatedRows(row, resolved);
    if (resolved.many) return children.some(childFilter);
    return children.length > 0 && childFilter(children[0]);
  }

  // ── resolution ─────────────────────────────────────────────────────────────

  private sourceRows(): DemoRow[] {
    if (isDemoView(this.tableName)) return computeDemoView(this.tableName, this.tables);
    return this.tables[this.tableName] ?? [];
  }

  private isView(): boolean {
    return isDemoView(this.tableName) || KNOWN_VIEWS.includes(this.tableName);
  }

  private resolveRelation(row: DemoRow, resource: string, alias?: string): ResolvedRelation | null {
    const table = resolveRelation(resource);
    if (!table) return null;
    const singularChild = singularize(table);
    const singularParent = singularize(this.tableName);

    // Many-to-one: the parent carries the FK. Prefer an alias-derived column
    // (`supplier:contacts(…)` → supplier_id) before the table-derived one
    // (`businesses(…)` → business_id).
    const candidates: string[] = [];
    if (alias && alias !== resource) {
      candidates.push(`${singularize(alias)}_id`, `${alias}_id`);
    }
    candidates.push(`${singularChild}_id`);
    for (const column of candidates) {
      if (column in row) return { table, parentIdColumn: column, many: false };
    }

    // One-to-many: the child carries the FK.
    const childFk = `${singularParent}_id`;
    const childRows = isDemoView(table) ? computeDemoView(table, this.tables) : (this.tables[table] ?? []);
    if (childRows.some((c) => childFk in c)) return { table, childIdColumn: childFk, many: true };

    return null;
  }

  private relatedRows(row: DemoRow, resolved: ResolvedRelation): DemoRow[] {
    const pool = isDemoView(resolved.table)
      ? computeDemoView(resolved.table, this.tables)
      : (this.tables[resolved.table] ?? []);

    if (resolved.parentIdColumn) {
      const id = row[resolved.parentIdColumn];
      if (id === null || id === undefined) return [];
      return pool.filter((child) => looseEq(child.id, id));
    }
    if (resolved.childIdColumn) {
      const column = resolved.childIdColumn;
      return pool.filter((child) => looseEq(child[column], row.id));
    }
    return [];
  }

  private passesFilters(row: DemoRow): boolean {
    for (const filter of this.filters) if (!filter(row)) return false;
    // Each `.or()` call must match at least one of its terms.
    for (const groups of this.orGroups) {
      const ok = groups.some((andTerms) =>
        andTerms.every((term) => buildFilter(term, this)(row)),
      );
      if (!ok) return false;
    }
    // `!inner` embeds: drop parents whose embedded row is missing.
    for (const node of this.selectNodes) {
      if (!node.embed || !node.inner) continue;
      const resolved = this.resolveRelation(row, node.embed, node.key);
      if (!resolved) continue;
      const children = this.embedChildren(row, node, resolved);
      if (children.length === 0) return false;
    }
    return true;
  }

  /**
   * Children of an embed. Dotted filters that target this embed (e.g.
   * `.eq('businesses.is_active', true)`) narrow the child list too, matching
   * PostgREST's behaviour for filtered embeds.
   */
  private embedChildren(row: DemoRow, node: SelectNode, resolved: ResolvedRelation): DemoRow[] {
    const children = this.relatedRows(row, resolved);
    const embedName = node.embed!;
    const dotted = this.embedFilters.get(embedName) ?? this.embedFilters.get(node.key ?? embedName);
    if (!dotted || dotted.length === 0) return children;
    return children.filter((child) => dotted.every((filter) => filter(child)));
  }

  private serialize(row: DemoRow): DemoRow {
    const star = this.selectNodes.some((n) => n.column === '*');
    const out: DemoRow = star ? { ...row } : {};

    for (const node of this.selectNodes) {
      if (node.column === '*') continue;
      if (node.embed) {
        const resolved = this.resolveRelation(row, node.embed, node.key);
        if (!resolved) {
          // Unresolvable embed: behave like PostgREST with an empty relation.
          out[node.key!] = null;
          continue;
        }
        const children = this.embedChildren(row, node, resolved);
        const projected = children.map((child) => projectChild(child, node.children ?? []));
        out[node.key!] = resolved.many ? projected : (projected[0] ?? null);
        continue;
      }
      if (node.column) out[node.key!] = row[node.column] ?? null;
    }
    return out;
  }

  private applyOrdering(list: DemoRow[]): DemoRow[] {
    if (this.orders.length === 0) return list;
    const sorted = [...list];
    sorted.sort((a, b) => {
      for (const order of this.orders) {
        const av = a[order.column];
        const bv = b[order.column];
        const an = av === null || av === undefined;
        const bn = bv === null || bv === undefined;
        if (an && bn) continue;
        if (an || bn) {
          const nullFirst = order.nullsFirst;
          if (an) return nullFirst ? -1 : 1;
          return nullFirst ? 1 : -1;
        }
        const cmp = compare(av, bv);
        if (cmp !== 0) return order.ascending ? cmp : -cmp;
      }
      return 0;
    });
    return sorted;
  }

  private applyPaging(list: DemoRow[]): DemoRow[] {
    let out = list;
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      out = out.slice(this.rangeFrom, this.rangeTo + 1);
    } else if (this.limitValue !== null) {
      out = out.slice(0, this.limitValue);
    }
    return out;
  }

  // ── mutations ──────────────────────────────────────────────────────────────

  private executeMutation(): { rows: DemoRow[]; errorResult: DemoQueryError | null } {
    if (this.isView()) {
      return {
        rows: [],
        errorResult: error(`cannot insert/update/delete on view "${this.tableName}"`, '42809'),
      };
    }
    const table = (this.tables[this.tableName] ??= []);
    const nowIso = new Date().toISOString();

    if (this.mutation === 'insert' || this.mutation === 'upsert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const affected: DemoRow[] = [];
      for (const raw of incoming) {
        const conflictColumns = (this.mutation === 'upsert'
          ? (this.onConflict ?? 'id').split(',').map((c) => c.trim())
          : []
        );
        const existing =
          this.mutation === 'upsert'
            ? table.find((row) => conflictColumns.every((c) => looseEq(row[c], raw[c])))
            : undefined;

        if (existing) {
          Object.assign(existing, raw, { updated_at: raw.updated_at ?? nowIso });
          affected.push(existing);
          continue;
        }

        const row: DemoRow = {
          ...defaults(this.tableName),
          ...raw,
          id: raw.id ?? demoUuid(this.tableName, `${table.length}:${Math.random().toString(36).slice(2, 8)}`),
          created_at: raw.created_at ?? nowIso,
        };
        if ('updated_at' in row || this.tableName !== 'currencies') row.updated_at ??= nowIso;
        table.push(row);
        affected.push(row);
      }
      markDemoStateChanged();
      return { rows: affected, errorResult: null };
    }

    if (this.mutation === 'update') {
      const targets = table.filter((row) => this.passesFilters(row));
      for (const row of targets) {
        Object.assign(row, this.patch ?? {}, { updated_at: (this.patch?.updated_at as string) ?? nowIso });
      }
      markDemoStateChanged();
      return { rows: targets, errorResult: null };
    }

    if (this.mutation === 'delete') {
      const targets = table.filter((row) => this.passesFilters(row));
      for (const row of targets) {
        const idx = table.indexOf(row);
        if (idx >= 0) table.splice(idx, 1);
      }
      markDemoStateChanged();
      return { rows: targets, errorResult: null };
    }

    return { rows: [], errorResult: null };
  }

  // ── promise plumbing ───────────────────────────────────────────────────────

  private resolve(): DemoQueryResult {
    try {
      if (this.mutation !== 'none') {
        const { rows, errorResult } = this.executeMutation();
        if (errorResult) return finish(null, errorResult, null);
        if (!this.selectExplicit) return finish(null, null, null);
        const serialized = this.applyPaging(this.applyOrdering(rows)).map((row) => this.serialize(row));
        return this.finalize(serialized, serialized.length);
      }

      const matched = this.sourceRows().filter((row) => this.passesFilters(row));
      const ordered = this.applyOrdering(matched);
      const count = this.wantsCount ? ordered.length : null;
      if (this.head) return finish(null, null, count);
      const paged = this.applyPaging(ordered).map((row) => this.serialize(row));
      return this.finalize(paged, count);
    } catch (err) {
      return finish(
        null,
        error(
          `[demo] ${err instanceof Error ? err.message : String(err)} (table: ${this.tableName})`,
          'DEMO01',
        ),
        null,
      );
    }
  }

  private finalize(rowsList: DemoRow[], count: number | null): DemoQueryResult {
    if (this.singleMode === 'single') {
      if (rowsList.length === 0) {
        return finish(null, error('JSON object requested, multiple (or no) rows returned', 'PGRST116'), count);
      }
      if (rowsList.length > 1) {
        return finish(null, error('JSON object requested, multiple (or no) rows returned', 'PGRST116'), count);
      }
      return finish(rowsList[0], null, count ?? 1);
    }
    if (this.singleMode === 'maybeSingle') {
      if (rowsList.length > 1) {
        return finish(null, error('JSON object requested, multiple (or no) rows returned', 'PGRST116'), count);
      }
      return finish(rowsList[0] ?? null, null, count ?? rowsList.length);
    }
    return finish(rowsList, null, count);
  }

  then<TResult1 = DemoQueryResult, TResult2 = never>(
    onfulfilled?: ((value: DemoQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<DemoQueryResult | TResult> {
    return Promise.resolve(this.resolve()).catch(onrejected);
  }
}

function finish(data: DemoRow[] | DemoRow | null, err: DemoQueryError | null, count: number | null): DemoQueryResult {
  return { data, error: err, count, status: err ? 400 : 200, statusText: err ? 'Bad Request' : 'OK' };
}

function projectChild(child: DemoRow, nodes: SelectNode[]): DemoRow {
  const star = nodes.some((n) => n.column === '*');
  const out: DemoRow = star ? { ...child } : {};
  for (const node of nodes) {
    if (node.column === '*') continue;
    if (node.column) out[node.key!] = child[node.column] ?? null;
  }
  return out;
}

/** Column defaults that Postgres would fill in, so inserted rows look complete. */
function defaults(table: string): DemoRow {
  const base: DemoRow = {};
  const zeroAmountTables = new Set([
    'invoices', 'expenses', 'journal_lines', 'payroll_runs', 'payroll_employee_lines',
  ]);
  if (zeroAmountTables.has(table)) {
    for (const key of [
      'amount_paid', 'vat_amount', 'wht_amount', 'discount_amount', 'discount_percent',
      'total_gross', 'total_paye', 'total_net', 'total_other_deductions', 'tax_amount',
      'amount', 'amount_base',
    ]) {
      base[key] = 0;
    }
  }
  if (table === 'invoices' || table === 'expenses') {
    base.exchange_rate = 1;
    base.rate_is_stale = false;
    base.currency = 'MWK';
  }
  if (table === 'contacts') {
    base.wht_exempt = false;
    base.is_active = true;
  }
  if (table === 'accounts') {
    base.is_active = true;
    base.is_group = false;
    base.is_system = false;
    base.is_bank_account = false;
    base.opening_balance = 0;
  }
  return base;
}
