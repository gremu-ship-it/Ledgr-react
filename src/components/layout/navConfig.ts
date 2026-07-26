import {
  LayoutDashboard,
  DollarSign,
  Receipt,
  FileText,
  Users,
  BookUser,
  Package,
  BookOpen,
  Percent,
  Landmark,
  Coins,
  BarChart2,
  Sparkles,
  Warehouse,
  ArrowLeftRight,
  GitBranch,
  Lock,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { PlanTier } from '@/lib/billing/plans';

export interface NavItemConfig {
  labelKey: string;
  path: string;
  icon: LucideIcon;
}

export interface NavSectionConfig {
  labelKey: string;
  items: NavItemConfig[];
  /** Minimum plan tier required to see this section. Omit for free (visible to all). */
  minPlan?: PlanTier;
}

export const NAV_SECTIONS: NavSectionConfig[] = [
  {
    labelKey: 'navigation.sections.ai',
    items: [
      { labelKey: 'navigation.items.ledgrAi', path: '/chat', icon: Sparkles },
    ],
  },
  {
    labelKey: 'navigation.sections.overview',
    items: [
      { labelKey: 'navigation.items.dashboard', path: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    labelKey: 'navigation.sections.finance',
    items: [
      { labelKey: 'navigation.items.income', path: '/income', icon: DollarSign },
      { labelKey: 'navigation.items.expenses', path: '/expenses', icon: Receipt },
      { labelKey: 'navigation.items.invoices', path: '/invoices', icon: FileText },
      { labelKey: 'navigation.items.payroll', path: '/payroll', icon: Users },
    ],
  },
  {
    labelKey: 'navigation.sections.inventory',
    items: [
      { labelKey: 'navigation.items.products', path: '/products', icon: Package },
      { labelKey: 'navigation.items.warehouse', path: '/warehouse', icon: Warehouse },
      { labelKey: 'navigation.items.transfers', path: '/transfers', icon: ArrowLeftRight },
    ],
  },
  {
    labelKey: 'navigation.sections.accounting',
    minPlan: 'growth',
    items: [
      { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen },
      { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent },
      { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark },
      { labelKey: 'navigation.items.capital', path: '/capital', icon: Coins },
      { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2 },
      { labelKey: 'navigation.items.journals', path: '/journals', icon: ScrollText },
      { labelKey: 'navigation.items.bankReconciliation', path: '/bank-reconcile', icon: Landmark },
      { labelKey: 'navigation.items.periods', path: '/periods', icon: Lock },
      { labelKey: 'navigation.items.auditLog', path: '/audit', icon: ShieldCheck },
    ],
  },
  {
    labelKey: 'navigation.sections.organisation',
    minPlan: 'growth',
    items: [
      { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser },
      { labelKey: 'navigation.items.branches', path: '/branches', icon: GitBranch },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_TIER_ORDER: PlanTier[] = ['free', 'growth', 'pro', 'enterprise'];

/**
 * Returns true if `actual` tier meets or exceeds `required`.
 * If required is undefined the section is open to everyone.
 */
export function planMeetsMin(actual: PlanTier, required?: PlanTier): boolean {
  if (!required) return true;
  return PLAN_TIER_ORDER.indexOf(actual) >= PLAN_TIER_ORDER.indexOf(required);
}

/** Set of all paths gated behind a paid plan (minPlan !== undefined). */
export const GATED_PATHS: Set<string> = new Set(
  NAV_SECTIONS
    .filter((s) => s.minPlan)
    .flatMap((s) => s.items.map((i) => i.path)),
);
