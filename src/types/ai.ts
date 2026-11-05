import type { Json } from '@/dal/types/database';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export type AnomalyCategory =
  | 'duplicate_invoice'
  | 'unallocated_cost_center'
  | 'missing_tax_tag'
  | 'amount_outlier'
  | 'payroll_variance';

export type AiAnomalySourceTable = 'expenses' | 'expense_lines' | 'journal_entries' | 'payroll_runs';

/** Stored ledger-health finding. Text columns contain ai.* translation keys. */
export interface AiAnomalyLog {
  id: string;
  business_id: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  title: string;
  description: string;
  source_table: AiAnomalySourceTable | null;
  source_id: string | null;
  metadata: Json;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface DiagnosticScanResult {
  scanned: number;
  created: number;
  skippedExisting: number;
}
