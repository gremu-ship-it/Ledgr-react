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
  Scale,
  TrendingUp,
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
  ShoppingBag,
  Factory,
  ClipboardList,
  MapPin,
  FileCheck2,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { PlanCapability, PlanTier } from '@/lib/billing/plans';
import { hasCapability, PLAN_TIER_ORDER, PLANS, planMeetsMin } from '@/lib/billing/plans';
export { planMeetsMin } from '@/lib/billing/plans';
import type { PartnerFeatureKey } from '@/types/partners';
import type { OperatingModel, OrganisationCapability } from '@/lib/capabilities/profile';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

export interface NavItemConfig {
  labelKey: string;
  path: string;
  icon: LucideIcon;
  requiresCapability?: PlanCapability;
  minPlan?: PlanTier;
  partnerFeature?: PartnerFeatureKey;
  /** For authenticated, memory-only routes that expose no role-protected server data. */
  allowAllAuthenticatedRoles?: boolean;
  requiresOrgCapability?: OrganisationCapability;
  /** The item is available only when at least one of these business models is selected. */
  requiredOperatingModels?: readonly OperatingModel[];
  /** Per-operating-model label keys; paths and access gates remain unchanged. */
  verticalLabelOverrides?: Readonly<Record<string, string>>;
  /**
   * Pass-1 removal for the sites vocabulary: a pure construction or
   * manufacturing business manages its branch mirrors under Organisation →
   * Sites/Locations, so the Branches surface is absent for it (never locked).
   * A business that also runs a retail-family model (RETAIL / WHOLESALE /
   * PRODUCT_SALES) keeps Branches — see `sitesVocabularyReplacesBranches`.
   */
  hiddenWhenSitesReplaceBranches?: boolean;
  /**
   * Set by `visibleSectionsFor`, never by the static configuration. True when
   * the business has the right type (pass 1 kept the item) but its plan does not
   * include the module. A locked item is still returned so the caller can render
   * the existing lock + upgrade prompt; plan state never removes an item.
   */
  locked?: boolean;
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
      { labelKey: 'navigation.items.pos', path: '/pos', icon: ShoppingBag, requiresOrgCapability: 'pos', requiredOperatingModels: ['RETAIL'] },
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
      {
        labelKey: 'navigation.items.products',
        path: '/products',
        icon: Package,
        partnerFeature: 'inventory',
        requiresCapability: 'inventory',
        requiresOrgCapability: 'inventory',
        verticalLabelOverrides: { PROJECT_BASED: 'navigation.items.materials' },
      },
      {
        labelKey: 'navigation.items.warehouse',
        path: '/warehouse',
        icon: Warehouse,
        partnerFeature: 'inventory',
        requiresCapability: 'inventory',
        requiresOrgCapability: 'inventory',
        verticalLabelOverrides: { PROJECT_BASED: 'navigation.items.siteStores' },
      },
      {
        labelKey: 'navigation.items.transfers',
        path: '/transfers',
        icon: ArrowLeftRight,
        partnerFeature: 'inventory',
        requiresCapability: 'inventory',
        requiresOrgCapability: 'inventory',
        verticalLabelOverrides: { PROJECT_BASED: 'navigation.items.materialTransfer' },
      },
    ],
  },
  {
    labelKey: 'navigation.sections.construction',
    minPlan: 'enterprise',
    items: [
      {
        labelKey: 'navigation.items.constructionWorkspace',
        path: '/construction',
        icon: Building2,
        minPlan: 'enterprise',
        requiresOrgCapability: 'construction',
      },
      {
        labelKey: 'navigation.items.constructionSubcontractors',
        path: '/construction/subcontractors',
        icon: Users,
        minPlan: 'enterprise',
        requiresOrgCapability: 'construction',
      },
      {
        labelKey: 'navigation.items.paymentCertificates',
        path: '/construction/certificates',
        icon: FileCheck2,
        minPlan: 'enterprise',
        requiresOrgCapability: 'construction',
        requiredOperatingModels: ['PROJECT_BASED'],
      },
      {
        labelKey: 'navigation.items.retentionRegister',
        path: '/construction/retention-register',
        icon: WalletCards,
        minPlan: 'enterprise',
        requiresOrgCapability: 'construction',
        requiredOperatingModels: ['PROJECT_BASED'],
      },
    ],
  },
  {
    labelKey: 'navigation.sections.manufacturing',
    minPlan: 'enterprise',
    items: [
      {
        labelKey: 'manufacturing.bom.dashboard',
        path: '/manufacturing',
        icon: LayoutDashboard,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'navigation.items.manufacturingBom',
        path: '/manufacturing/bom',
        icon: Package,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'navigation.items.manufacturingMrp',
        path: '/manufacturing/mrp',
        icon: ClipboardList,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'manufacturing.bom.production',
        path: '/manufacturing/production',
        icon: Factory,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'navigation.items.manufacturingRuns',
        path: '/manufacturing/runs',
        icon: Factory,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'navigation.items.manufacturingRoutings',
        path: '/manufacturing/routings',
        icon: GitBranch,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        labelKey: 'navigation.items.manufacturingWorkCentres',
        path: '/manufacturing/work-centres',
        icon: MapPin,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
    ],
  },
  {
    labelKey: 'navigation.sections.accounting',
    items: [
      { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen, requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.journals', path: '/journals', icon: ScrollText, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
      { labelKey: 'navigation.items.periods', path: '/periods', icon: Lock, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
    ],
  },
  {
    labelKey: 'navigation.sections.reports',
    items: [
      { labelKey: 'nav.reports.trialBalance', path: '/reports/trial-balance', icon: Scale, minPlan: 'growth' },
      { labelKey: 'nav.reports.profitLoss', path: '/reports/profit-loss', icon: TrendingUp, minPlan: 'growth' },
      { labelKey: 'nav.reports.balanceSheet', path: '/reports/balance-sheet', icon: Landmark, minPlan: 'growth' },
      { labelKey: 'nav.reports.cashFlow', path: '/reports/cash-flow', icon: Coins, minPlan: 'growth' },
      { labelKey: 'navigation.items.revenueBreakdown', path: '/reports/revenue-breakdown', icon: BarChart2, minPlan: 'growth' },
      { labelKey: 'navigation.items.changesInEquity', path: '/reports/changes-in-equity', icon: Scale, minPlan: 'growth' },
      { labelKey: 'navigation.items.branchPerformance', path: '/reports/branch-performance', icon: Building2, minPlan: 'growth' },
    ],
  },
  {
    labelKey: 'navigation.sections.taxation',
    items: [
      { labelKey: 'navigation.items.taxConfiguration', path: '/tax', icon: Percent, minPlan: 'starter', requiresCapability: 'core_accounting' },
      { labelKey: 'nav.reports.vatReturn', path: '/reports/vat-return', icon: Receipt, minPlan: 'growth' },
      { labelKey: 'nav.reports.whtSchedule', path: '/reports/wht-schedule', icon: FileText, minPlan: 'growth' },
    ],
  },
  {
    labelKey: 'navigation.sections.banking',
    items: [
      { labelKey: 'navigation.items.bankAccounts', path: '/bank-reconciliation/accounts', icon: Landmark, partnerFeature: 'bank_reconciliation', requiresCapability: 'bank_reconciliation', minPlan: 'growth' },
      { labelKey: 'navigation.items.bankStatements', path: '/bank-reconciliation/statements', icon: Landmark, partnerFeature: 'bank_reconciliation', requiresCapability: 'bank_reconciliation', minPlan: 'growth' },
      { labelKey: 'navigation.items.bankReconciliationReconcile', path: '/bank-reconciliation/reconcile', icon: ArrowLeftRight, partnerFeature: 'bank_reconciliation', requiresCapability: 'bank_reconciliation', minPlan: 'growth' },
    ],
  },
  {
    labelKey: 'navigation.sections.assetsCapital',
    items: [
      { labelKey: 'navigation.items.fixedAssets', path: '/assets', icon: Landmark, minPlan: 'starter', requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.capitalEquity', path: '/capital', icon: Coins, minPlan: 'starter', requiresCapability: 'core_accounting' },
    ],
  },
  {
    labelKey: 'navigation.sections.organisation',
    items: [
      { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
      { labelKey: 'navigation.items.branches', path: '/branches', icon: GitBranch, minPlan: 'growth', requiresCapability: 'accounting_organisation', hiddenWhenSitesReplaceBranches: true },
      { labelKey: 'navigation.items.locations', path: '/locations', icon: MapPin, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
      { labelKey: 'navigation.items.departments', path: '/departments', icon: Users2, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
    ],
  },
  {
    labelKey: 'navigation.sections.audit',
    items: [
      { labelKey: 'navigation.items.auditLog', path: '/audit', icon: ShieldCheck, minPlan: 'growth', requiresCapability: 'accounting_organisation' },
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

// ── Vertical navigation vocabulary ─────────────────────────────────────────

/**
 * Construction/manufacturing capabilities use Sites for the existing
 * Locations entry. Inventory vocabulary is a separate, operating-model-based
 * decision: only PROJECT_BASED rewrites Products, Warehouse, and Transfers.
 * Routes, icons, and gates stay unchanged; no duplicate nav items are created.
 *
 * Keyed by the default label so navigation surfaces that hold their own items
 * can use the same translation mapping.
 */
export const CONSTRUCTION_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  // Construction and manufacturing businesses manage branch mirrors under
  // Sites/Locations; this capability-based label does not affect inventory
  // vocabulary, which is selected only by the PROJECT_BASED operating model.
  'navigation.items.locations': 'navigation.items.sites',
};

/** PROJECT_BASED changes only the three existing Supply Chain labels. */
export const PROJECT_BASED_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'navigation.items.products': 'navigation.items.materials',
  'navigation.items.warehouse': 'navigation.items.siteStores',
  'navigation.items.transfers': 'navigation.items.materialTransfer',
};

/** Resolve an item label using the selected model without changing its route. */
export function resolveNavItemLabelKey(
  item: NavItemConfig,
  operatingModels: readonly string[] | null | undefined,
): string {
  for (const [model, labelKey] of Object.entries(item.verticalLabelOverrides ?? {})) {
    if (operatingModels?.includes(model)) return labelKey;
  }
  return item.labelKey;
}

/**
 * Operating models whose daily surface is the retail till and its branch
 * scoping. When any of them is selected, branch management stays visible even
 * if a sites-vocabulary vertical is also on (a Retail + Construction business
 * keeps both workflows, exactly as it keeps one Materials entry).
 */
export const RETAIL_FAMILY_MODELS: ReadonlySet<string> =
  new Set(['RETAIL', 'WHOLESALE', 'PRODUCT_SALES']);

/**
 * True when the Sites vocabulary replaces branch management for a business:
 * construction or manufacturing is enabled AND no retail-family operating
 * model is selected. The Branches nav item is then REMOVED (absent, not
 * locked) and /branches redirects to /locations; the branch-mirror locations
 * ("Main Site", "Main Factory") stay manageable there through the existing
 * mirror-guarded name sync in Branch/LocationRepository.
 */
export function sitesVocabularyReplacesBranches(
  isOrgCapabilityEnabled: (capability: OrganisationCapability) => boolean,
  operatingModels?: readonly string[] | null,
): boolean {
  const sitesVocabulary = isOrgCapabilityEnabled('construction')
    || isOrgCapabilityEnabled('manufacturing');
  if (!sitesVocabulary) return false;
  return !(operatingModels ?? []).some((model) => RETAIL_FAMILY_MODELS.has(model));
}

/** Construction and manufacturing share the existing Sites label override. */
export const MANUFACTURING_LABEL_OVERRIDES: Readonly<Record<string, string>> =
  CONSTRUCTION_LABEL_OVERRIDES;

/**
 * Resolve one nav label key for a business.
 *
 * `useSitesVocabulary` is true for a construction or manufacturing business;
 * inventory labels are resolved separately from the selected operating model.
 */
export function resolveNavLabelKey(
  labelKey: string,
  useSitesVocabulary: boolean,
  operatingModels?: readonly string[] | null,
): string {
  if (operatingModels?.includes('PROJECT_BASED')) {
    return PROJECT_BASED_LABEL_OVERRIDES[labelKey] ?? labelKey;
  }
  if (!useSitesVocabulary) return labelKey;
  return CONSTRUCTION_LABEL_OVERRIDES[labelKey] ?? labelKey;
}

/**
 * Build the label resolver for one business from the same organisation
 * predicate `visibleSectionsFor` already receives. Navigation surfaces that
 * hold their own item lists (BottomNav) call this so their labels match the
 * sidebar's instead of duplicating the override table.
 */
export function navLabelResolver(
  isOrgCapabilityEnabled: (capability: OrganisationCapability) => boolean,
  operatingModels?: readonly string[] | null,
): (labelKey: string) => string {
  const useSitesVocabulary = isOrgCapabilityEnabled('construction')
    || isOrgCapabilityEnabled('manufacturing');
  return (labelKey: string) => resolveNavLabelKey(labelKey, useSitesVocabulary, operatingModels);
}

/**
 * Build the navigation for one business.
 *
 * Two gates, deliberately with different rendering:
 *
 *   Pass 1 — business type (`requiresOrgCapability`), the sites-vocabulary rule
 *   (`hiddenWhenSitesReplaceBranches`: a pure construction/manufacturing
 *   business manages branch mirrors under Sites and never sees Branches), plus
 *   the partner and role reachability gates. These REMOVE the item. A business must never see a
 *   surface that belongs to a different line of business: no locked icon, no
 *   placeholder, no trace. A role that cannot open a route gets no link to it.
 *
 *   Pass 2 — plan tier (`minPlan` / `requiresCapability`). These KEEP the item
 *   and mark it `locked`, because the lock and its upgrade prompt are the only
 *   upsell path (Construction: Free/Trial locked, Enterprise unlocked). A plan
 *   gate must never remove an item that pass 1 retained.
 *
 * A section disappears only when pass 1 leaves it with no items, so a heading
 * can never outlive its entire contents.
 *
 * Pass 3 — vocabulary. PROJECT_BASED businesses read the existing Supply Chain
 * children as Materials / Site Stores / Materials Transfer. Only `labelKey` is
 * rewritten: routes, icons, and both gates above are untouched. Other operating
 * models keep Products / Warehouse / Transfers.
 *
 * `isOrgCapabilityEnabled` is required: without a business-type decision there
 * is nothing to filter on, and silently skipping the type gate is exactly how
 * a retail business would end up seeing another vertical's modules.
 */
export function isOperatingModelEligible(
  item: Pick<NavItemConfig, 'requiredOperatingModels'>,
  operatingModels?: readonly string[] | null,
): boolean {
  const requiredModels = item.requiredOperatingModels;
  if (!requiredModels) return true;
  return requiredModels.some((model) => operatingModels?.includes(model));
}

export function visibleSectionsFor(
  isFeatureEnabled: (key: PartnerFeatureKey) => boolean,
  role: string | null | undefined,
  isOrgCapabilityEnabled: (capability: OrganisationCapability) => boolean,
  currentTier?: PlanTier,
  operatingModels?: readonly string[] | null,
): NavSectionConfig[] {
  const useSitesVocabulary = isOrgCapabilityEnabled('construction')
    || isOrgCapabilityEnabled('manufacturing');
  const sitesReplaceBranches = sitesVocabularyReplacesBranches(isOrgCapabilityEnabled, operatingModels);

  return NAV_SECTIONS
    .map((section) => {
      // Pass 1 — remove. Nothing plan-related is decided here.
      const reachable = section.items.filter((item) => {
        // This vertical boundary is independent of capability overrides: an
        // explicit POS override must never expose POS outside RETAIL.
        if (!isOperatingModelEligible(item, operatingModels)) return false;
        if (item.requiresOrgCapability && !isOrgCapabilityEnabled(item.requiresOrgCapability)) return false;
        if (item.hiddenWhenSitesReplaceBranches && sitesReplaceBranches) return false;
        if (item.partnerFeature && !isFeatureEnabled(item.partnerFeature)) return false;
        if (role && !item.allowAllAuthenticatedRoles && !isPathAllowedForRole(role, item.path.split('?')[0])) return false;
        return true;
      });

      // Pass 2 — keep, mark. `locked` is output-only: the shared NAV_SECTIONS
      // array is never mutated, and a caller that renders without a tier sees
      // the unmarked (unlocked) item exactly as before.
      // Pass 3 — rewrite the label for a construction business.
      const items: NavItemConfig[] = reachable.map((item) => ({
        ...item,
        labelKey: resolveNavItemLabelKey(
          {
            ...item,
            labelKey: resolveNavLabelKey(item.labelKey, useSitesVocabulary),
          },
          operatingModels,
        ),
        ...(currentTier === undefined
          ? {}
          : { locked: isItemLocked(item, currentTier, section.minPlan) }),
      }));

      return { ...section, items };
    })
    // Sections are judged on the pass-1 output; passes 2 and 3 only annotate.
    .filter((section) => section.items.length > 0);
}

export const GATED_PATHS: Set<string> = new Set(
  NAV_SECTIONS.flatMap((s) =>
    s.items
      .filter((i) => i.minPlan || i.requiresCapability || i.requiresOrgCapability || i.requiredOperatingModels)
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

/** Shared by alternative navigation surfaces. */
export function navItemForPath(path: string): NavItemConfig | undefined {
  return NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.path === path);
}

export function planRequiredForItem(item: NavItemConfig, sectionMinPlan?: PlanTier) {
  const tier = PLAN_TIER_ORDER.find((candidate) => !isItemLocked(item, candidate, sectionMinPlan));
  return tier ? PLANS[tier] : null;
}
