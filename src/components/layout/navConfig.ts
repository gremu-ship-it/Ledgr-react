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
  Users2,
  Lock,
  ScrollText,
  ShieldCheck,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import type { PlanCapability, PlanTier } from '@/lib/billing/plans';
import { hasCapability } from '@/lib/billing/plans';
import type { PartnerFeatureKey } from '@/types/partners';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

export interface NavItemConfig {
  labelKey: string;
  path: string;
  icon: LucideIcon;
  /** If set, the item is soft-gated: still visible/clickable, but shows a small lock badge + onClick toast when the current plan doesn't include this capability. */
  requiresCapability?: PlanCapability;
  /** Per-item minimum plan (for Accounting/Organisation items). Falls back to section minPlan. */
  minPlan?: PlanTier;
  /**
   * White-label module switch. When the current partner (bank/MFI) has this
   * feature disabled the item is hidden entirely — unlike plan gating there
   * is no upsell, because the client buys from the partner, not from Ledgr.
   */
  partnerFeature?: PartnerFeatureKey;
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
      { labelKey: 'navigation.items.ledgrAi', path: '/ai', icon: Sparkles, partnerFeature: 'ai_advisor', requiresCapability: 'ai_insights' },
    ],
  },
  {
    labelKey: 'navigation.sections.support',
    items: [
      { labelKey: 'navigation.items.support', path: '/support', icon: LifeBuoy },
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
      { labelKey: 'navigation.items.payroll', path: '/payroll', icon: Users, partnerFeature: 'payroll' },
    ],
  },
  {
    labelKey: 'navigation.sections.inventory',
    items: [
      { labelKey: 'navigation.items.products', path: '/products', icon: Package, partnerFeature: 'inventory' },
      { labelKey: 'navigation.items.warehouse', path: '/warehouse', icon: Warehouse, partnerFeature: 'inventory' },
      { labelKey: 'navigation.items.transfers', path: '/transfers', icon: ArrowLeftRight, partnerFeature: 'inventory' },
    ],
  },
  {
    labelKey: 'navigation.sections.accounting',
    items: [
      { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen, minPlan: 'growth' },
      { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent, minPlan: 'growth' },
      { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark, minPlan: 'growth' },
      { labelKey: 'navigation.items.capital', path: '/capital', icon: Coins, minPlan: 'growth' },
      { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2, minPlan: 'growth' },
      { labelKey: 'navigation.items.journals', path: '/journals', icon: ScrollText, minPlan: 'growth' },
      { labelKey: 'navigation.items.bankReconciliation', path: '/bank-reconcile', icon: Landmark, partnerFeature: 'bank_reconciliation', requiresCapability: 'bank_reconciliation', minPlan: 'growth' },
      { labelKey: 'navigation.items.periods', path: '/periods', icon: Lock, minPlan: 'growth' },
      { labelKey: 'navigation.items.auditLog', path: '/audit', icon: ShieldCheck, minPlan: 'growth' },
    ],
  },
  {
    labelKey: 'navigation.sections.organisation',
    items: [
      { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser, minPlan: 'growth' },
      { labelKey: 'navigation.items.branches', path: '/branches', icon: GitBranch, minPlan: 'growth' },
      { labelKey: 'navigation.items.departments', path: '/departments', icon: Users2, minPlan: 'growth' },
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

/** Nav sections filtered to the modules the current partner has enabled and the user's role permissions. */
export function visibleSectionsFor(
  isFeatureEnabled: (key: PartnerFeatureKey) => boolean,
  role?: string | null,
): NavSectionConfig[] {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((i) => {
        if (i.partnerFeature && !isFeatureEnabled(i.partnerFeature)) return false;
        if (role && !isPathAllowedForRole(role, i.path)) return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

/** Set of all paths gated behind a paid plan (item has minPlan or requiresCapability). */
export const GATED_PATHS: Set<string> = new Set(
  NAV_SECTIONS.flatMap((s) =>
    s.items
      .filter((i) => i.minPlan || i.requiresCapability)
      .map((i) => i.path)
  ),
);

/**
 * Returns true if the given item should be considered locked for the current plan tier.
 */
export function isItemLocked(
  item: NavItemConfig,
  currentTier: PlanTier,
  sectionMinPlan?: PlanTier
): boolean {
  const effectiveMin = item.minPlan ?? sectionMinPlan;
  if (effectiveMin && !planMeetsMin(currentTier, effectiveMin)) {
    return true;
  }
  if (item.requiresCapability && !hasCapability(currentTier, item.requiresCapability)) {
    return true;
  }
  return false;
}
