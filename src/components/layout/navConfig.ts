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
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import type { PlanCapability, PlanTier } from '@/lib/billing/plans';
import { hasCapability, PLAN_TIER_ORDER, PLANS } from '@/lib/billing/plans';
import type { PartnerFeatureKey } from '@/types/partners';
import type { OrganisationCapability } from '@/lib/capabilities/profile';
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
      { labelKey: 'navigation.items.pos', path: '/pos', icon: ShoppingBag, requiresOrgCapability: 'pos' },
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
    // Renamed from "Inventory": the section now carries the materials flow
    // (products → warehouse → transfers → construction procurement). The label
    // key is unchanged so no route, translation key or test path moves.
    labelKey: 'navigation.sections.inventory',
    items: [
      { labelKey: 'navigation.items.products', path: '/products', icon: Package, partnerFeature: 'inventory', requiresCapability: 'inventory', requiresOrgCapability: 'inventory' },
      { labelKey: 'navigation.items.warehouse', path: '/warehouse', icon: Warehouse, partnerFeature: 'inventory', requiresCapability: 'inventory', requiresOrgCapability: 'inventory' },
      { labelKey: 'navigation.items.transfers', path: '/transfers', icon: ArrowLeftRight, partnerFeature: 'inventory', requiresCapability: 'inventory', requiresOrgCapability: 'inventory' },
      {
        // Construction is an Enterprise module selected through the operating
        // model profile. `minPlan` is what a Starter/Growth/Free business hits;
        // `requiresOrgCapability` is what hides it from an Enterprise business
        // that does not do construction. Deliberately no `partnerFeature`: the
        // partner inventory flag does not gate construction procurement, and no
        // `allowAllAuthenticatedRoles`: the role list now applies.
        labelKey: 'navigation.items.constructionWorkspace',
        path: '/construction',
        icon: Building2,
        minPlan: 'enterprise',
        requiresOrgCapability: 'construction',
      },
    ],
  },
  {
    labelKey: 'navigation.sections.manufacturing',
    items: [
      {
        // Read-only reporting is the landing page for the manufacturing module.
        labelKey: 'manufacturing.bom.dashboard',
        path: '/manufacturing',
        icon: LayoutDashboard,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        // Bill of Materials — Phase B workspace.
        labelKey: 'manufacturing.bom.title',
        path: '/manufacturing/bom',
        icon: Package,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
      {
        // Production — Phase C work-order workspace.
        labelKey: 'manufacturing.bom.production',
        path: '/manufacturing/production',
        icon: Factory,
        minPlan: 'enterprise',
        requiresOrgCapability: 'manufacturing',
      },
    ],
  },
  {
    labelKey: 'navigation.sections.accounting',
    items: [
      { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen, requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent, requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark, requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.capital', path: '/capital', icon: Coins, requiresCapability: 'core_accounting' },
      { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2, requiresCapability: 'core_accounting' },
      { labelKey: 'nav.reports.trialBalance', path: '/reports/trial-balance', icon: Scale, minPlan: 'growth' },
      { labelKey: 'nav.reports.profitLoss', path: '/reports/profit-loss', icon: TrendingUp, minPlan: 'growth' },
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
      { labelKey: 'navigation.items.branches', path: '/branches', icon: GitBranch, minPlan: 'growth', hiddenWhenSitesReplaceBranches: true },
      { labelKey: 'navigation.items.locations', path: '/locations', icon: MapPin, minPlan: 'growth' },
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

export function planMeetsMin(actual: PlanTier, required?: PlanTier): boolean {
  if (!required) return true;
  return PLAN_TIER_ORDER.indexOf(actual) >= PLAN_TIER_ORDER.indexOf(required);
}

// ── Materials label vocabulary (construction and manufacturing) ──────────────

/**
 * A construction business buys its materials, stores them on site and moves
 * them between sites, so the Supply Chain children read in site language
 * instead of retail language. The routes, icons and gates are identical — only
 * the label key changes — so this is a vocabulary swap, never a second set of
 * nav items: `/products` must not appear twice under two names, and a
 * Construction + Retail business (both capabilities on) keeps one Materials
 * entry rather than a Materials/Products pair.
 *
 * A manufacturing business reads exactly the same vocabulary: it also buys
 * materials, holds them in stores and moves them through production, so the
 * same three keys are rewritten and MANUFACTURING_LABEL_OVERRIDES is an alias
 * of this table rather than a second one that could drift from it.
 *
 * Keyed by the default label key so any surface holding a nav label — the
 * sidebar, the mobile workspace list, the bottom bar's own More menu — resolves
 * through one table.
 */
export const CONSTRUCTION_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'navigation.items.products': 'navigation.items.materials',
  'navigation.items.warehouse': 'navigation.items.siteStores',
  'navigation.items.transfers': 'navigation.items.materialTransfers',
  // A construction business runs sites, and a manufacturer runs its factory
  // and stores as sites too, so the locations master-data entry reads in the
  // same vocabulary ("Sites") for both — one shared table, no drift.
  'navigation.items.locations': 'navigation.items.sites',
};

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

/** A manufacturing business uses the same materials vocabulary as construction. */
export const MANUFACTURING_LABEL_OVERRIDES: Readonly<Record<string, string>> =
  CONSTRUCTION_LABEL_OVERRIDES;

/**
 * Resolve one nav label key for a business.
 *
 * `useMaterialsVocabulary` is true for a construction or a manufacturing
 * business; every other business gets the key back untouched, so the default
 * vocabulary can never drift.
 */
export function resolveNavLabelKey(
  labelKey: string,
  useMaterialsVocabulary: boolean,
): string {
  if (!useMaterialsVocabulary) return labelKey;
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
): (labelKey: string) => string {
  const useMaterialsVocabulary = isOrgCapabilityEnabled('construction')
    || isOrgCapabilityEnabled('manufacturing');
  return (labelKey: string) => resolveNavLabelKey(labelKey, useMaterialsVocabulary);
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
 * Pass 3 — vocabulary. A construction or manufacturing business reads the Supply
 * Chain children as Materials / Site Stores / Material Transfers (see
 * CONSTRUCTION_LABEL_OVERRIDES, aliased by MANUFACTURING_LABEL_OVERRIDES). Only
 * `labelKey` is rewritten: paths, icons and both gates above are untouched, and a
 * business with neither capability gets the default keys back unchanged.
 *
 * `isOrgCapabilityEnabled` is required: without a business-type decision there
 * is nothing to filter on, and silently skipping the type gate is exactly how
 * a retail business would end up seeing another vertical's modules.
 */
export function visibleSectionsFor(
  isFeatureEnabled: (key: PartnerFeatureKey) => boolean,
  role: string | null | undefined,
  isOrgCapabilityEnabled: (capability: OrganisationCapability) => boolean,
  currentTier?: PlanTier,
  operatingModels?: readonly string[] | null,
): NavSectionConfig[] {
  const resolveLabelKey = navLabelResolver(isOrgCapabilityEnabled);
  const sitesReplaceBranches = sitesVocabularyReplacesBranches(isOrgCapabilityEnabled, operatingModels);

  return NAV_SECTIONS
    .map((section) => {
      // Pass 1 — remove. Nothing plan-related is decided here.
      const reachable = section.items.filter((item) => {
        if (item.requiresOrgCapability && !isOrgCapabilityEnabled(item.requiresOrgCapability)) return false;
        if (item.hiddenWhenSitesReplaceBranches && sitesReplaceBranches) return false;
        if (item.partnerFeature && !isFeatureEnabled(item.partnerFeature)) return false;
        if (role && !item.allowAllAuthenticatedRoles && !isPathAllowedForRole(role, item.path)) return false;
        return true;
      });

      // Pass 2 — keep, mark. `locked` is output-only: the shared NAV_SECTIONS
      // array is never mutated, and a caller that renders without a tier sees
      // the unmarked (unlocked) item exactly as before.
      // Pass 3 — rewrite the label for a construction business.
      const items: NavItemConfig[] = reachable.map((item) => ({
        ...item,
        labelKey: resolveLabelKey(item.labelKey),
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
      .filter((i) => i.minPlan || i.requiresCapability || i.requiresOrgCapability)
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

/** Shared by alternative navigation surfaces; /inventory aliases Products. */
export function navItemForPath(path: string): NavItemConfig | undefined {
  const canonicalPath = path === '/inventory' ? '/products' : path;
  return NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.path === canonicalPath);
}

export function planRequiredForItem(item: NavItemConfig, sectionMinPlan?: PlanTier) {
  const tier = PLAN_TIER_ORDER.find((candidate) => !isItemLocked(item, candidate, sectionMinPlan));
  return tier ? PLANS[tier] : null;
}
