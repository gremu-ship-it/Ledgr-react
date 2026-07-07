import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TableName, Row, InsertDto, UpdateDto } from '../types/database';
import { NotFoundError, UnsupportedOperationError, toRepositoryError } from '../errors/RepositoryError';

/**
 * Tables that have a `deleted_at` column and support soft-delete.
 * softDelete() is only valid on these tables.
 */
const SOFT_DELETE_TABLES = new Set<string>([
  'businesses', 'branches', 'departments', 'accounts', 'contacts',
  'invoices', 'expenses', 'products', 'employees', 'fixed_assets',
]);

export class BaseRepository<T extends TableName> {
  protected readonly client: SupabaseClient<Database>;
  protected readonly table: T;

  constructor(client: SupabaseClient<Database>, table: T) {
    this.client = client;
    this.table = table;
  }

  /** Public accessor so consumers can run raw queries without bypassing the repo layer. */
  get db(): SupabaseClient<Database> {
    return this.client;
  }

  async findById(id: string): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(this.table)
      .select('*')
      .eq('id' as any, id)
      .maybeSingle();
    if (error) throw toRepositoryError(this.table as string, error);
    if (!data) throw new NotFoundError(this.table as string, id);
    return data as Row<T>;
  }

  async findAll(options?: {
    limit?: number;
    offset?: number;
    orderBy?: keyof Row<T> & string;
    ascending?: boolean;
  }): Promise<Row<T>[]> {
    let query = this.client.from(this.table).select('*');
    if (options?.orderBy) {
      query = query.order(options.orderBy as any, { ascending: options.ascending ?? true });
    }
    if (options?.limit !== undefined) {
      const from = options.offset ?? 0;
      query = query.range(from, from + options.limit - 1);
    }
    const { data, error } = await query;
    if (error) throw toRepositoryError(this.table as string, error);
    return (data ?? []) as Row<T>[];
  }

  async create(dto: InsertDto<T>): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(this.table)
      .insert(dto as never)
      .select('*')
      .single();
    if (error) throw toRepositoryError(this.table as string, error);
    return data as Row<T>;
  }

  async update(id: string, dto: UpdateDto<T>): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(this.table)
      .update(dto as never)
      .eq('id' as any, id)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(this.table as string, error);
    if (!data) throw new NotFoundError(this.table as string, id);
    return data as Row<T>;
  }

  /**
   * Soft-delete a record by setting `deleted_at` to now.
   *
   * FIX [BaseRepository]: Guards against calling softDelete() on tables that
   * have no `deleted_at` column (e.g. journal_entries, payroll_runs,
   * inventory_balances, stock_movements). Previously this would produce a
   * confusing PostgREST error. Now throws UnsupportedOperationError immediately.
   *
   * Valid tables: businesses, branches, departments, accounts, contacts,
   *               invoices, expenses, products, employees, fixed_assets.
   */
  async softDelete(id: string): Promise<Row<T>> {
    const tableNameStr = this.table as string;

    if (!SOFT_DELETE_TABLES.has(tableNameStr)) {
      throw new UnsupportedOperationError(
        tableNameStr,
        `softDelete`,
        // message details which tables are valid
      );
    }

    const dto = { deleted_at: new Date().toISOString() } as unknown as UpdateDto<T>;
    const { data, error } = await this.client
      .from(this.table)
      .update(dto as never)
      .eq('id' as any, id)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(tableNameStr, error);
    if (!data) throw new NotFoundError(tableNameStr, id);
    return data as Row<T>;
  }
}