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
  Building2,
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
  requiresCapability?: PlanCapability;
  minPlan?: PlanTier;
  partnerFeature?: PartnerFeatureKey;
}

export interface NavSectionConfig {
  labelKey: string;
  items: NavItemConfig[];
  minPlan?: PlanTier;
}

export const NAV_SECTIONS: NavSectionConfig[] = [
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
      { labelKey: 'navigation.items.bankReconciliation', path: '/bank-reconcile', icon: Building2, partnerFeature: 'bank_reconciliation', requiresCapability: 'bank_reconciliation', minPlan: 'growth' },
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
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_TIER_ORDER: PlanTier[] = ['free', 'growth', 'pro', 'enterprise'];

export function planMeetsMin(actual: PlanTier, required?: PlanTier): boolean {
  if (!required) return true;
  return PLAN_TIER_ORDER.indexOf(actual) >= PLAN_TIER_ORDER.indexOf(required);
}

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

export const GATED_PATHS: Set<string> = new Set(
  NAV_SECTIONS.flatMap((s) =>
    s.items
      .filter((i) => i.minPlan || i.requiresCapability)
      .map((i) => i.path)
  ),
);

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
