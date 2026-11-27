/**
 * Central, pure navigation builder.
 *
 * The clinical workspace is deliberately re-architected around the day-to-day
 * clinic flow instead of inheriting the generic trading sidebar wholesale.
 * Pure / hybrid healthcare tenants get five clinical groups; generic income
 * and stock surfaces are suppressed unless the tenant also runs a retail-family
 * operating model. Non-clinical tenants continue to use the standard ERP
 * fallback defined by `buildNavigation` (the live sidebar continues to use the
 * richer capability/partner-aware configuration in `navConfig.ts`).
 */

export interface NavItem {
  key: string;
  labelKey: string;
  defaultLabel: string;
  path: string;
  icon: string;
  enterpriseOnly?: boolean;
  requiredOperatingModel?: string;
  badge?: string;
}

export interface NavSection {
  key: string;
  titleKey: string;
  defaultTitle: string;
  items: NavItem[];
}

export interface BuildNavOptions {
  subscriptionPlan?: string | null;
  operatingModels?: readonly string[] | null;
}

const RETAIL_FAMILY_MODELS = ['RETAIL', 'PRODUCT_SALES', 'WHOLESALE'] as const;

function normalizeModels(models: readonly string[] | null | undefined): string[] {
  return (models ?? []).map((model) => String(model).toUpperCase());
}

function healthcareItem(
  key: string,
  labelKey: string,
  defaultLabel: string,
  path: string,
  icon: string,
): NavItem {
  return {
    key,
    labelKey,
    defaultLabel,
    path,
    icon,
    enterpriseOnly: true,
    requiredOperatingModel: 'HEALTHCARE',
  };
}

/** Build the sidebar sections for the active business context. */
export function buildNavigation(options: BuildNavOptions = {}): NavSection[] {
  const plan = (options.subscriptionPlan ?? '').toLowerCase().trim() || 'free';
  const isEnterprise = plan === 'enterprise';
  const models = normalizeModels(options.operatingModels);

  const isHealthcare = models.includes('HEALTHCARE');
  const hasRetailOrTrading = models.some((model) =>
    (RETAIL_FAMILY_MODELS as readonly string[]).includes(model),
  );
  const isConstruction = models.includes('CONSTRUCTION');
  const isManufacturing = models.includes('MANUFACTURING');

  // ── 1. Healthcare-centric workspace ───────────────────────────────────────
  if (isHealthcare && isEnterprise && !isConstruction && !isManufacturing) {
    const clinicalSections: NavSection[] = [
      {
        key: 'clinical_operations',
        titleKey: 'nav.sections.clinicalOperations',
        defaultTitle: 'Clinical Operations',
        items: [
          healthcareItem('clinic_hub', 'nav.clinicHub', 'Clinic Hub & Queue', '/healthcare', 'Activity'),
          healthcareItem('patient_directory', 'nav.patients', 'Patient Directory', '/healthcare/patients', 'Users'),
          healthcareItem('doctor_consultation', 'nav.doctorStation', 'Doctor Consultation', '/healthcare/consultation', 'Stethoscope'),
          healthcareItem('lab_diagnostics', 'nav.labDiagnostics', 'Lab Diagnostics', '/healthcare/lab', 'FlaskConical'),
          healthcareItem('pharmacy_dispensary', 'nav.pharmacyDispensary', 'Pharmacy & Dispensary', '/healthcare/pharmacy', 'Pill'),
        ],
      },
      {
        key: 'billing_claims',
        titleKey: 'nav.sections.billingAndClaims',
        defaultTitle: 'Billing & Claims',
        items: [
          healthcareItem('patient_billing', 'nav.patientBilling', 'Patient Invoices & POS', '/healthcare/billing', 'Receipt'),
          healthcareItem('insurance_claims', 'nav.insuranceClaims', 'Insurance & HMO Claims', '/healthcare/insurance', 'ShieldCheck'),
          healthcareItem('doctor_commissions', 'nav.doctorCommissions', 'Doctor Commissions', '/healthcare/doctor-fees', 'BadgePercent'),
        ],
      },
      {
        key: 'clinic_financials',
        titleKey: 'nav.sections.clinicFinancials',
        defaultTitle: 'Clinic Financials & Banking',
        items: [
          { key: 'expenses', labelKey: 'nav.clinicExpenses', defaultLabel: 'Clinic Expenses', path: '/expenses', icon: 'TrendingDown' },
          { key: 'payroll', labelKey: 'nav.staffPayroll', defaultLabel: 'Staff Payroll', path: '/payroll', icon: 'UserCheck' },
          { key: 'banking', labelKey: 'nav.banking', defaultLabel: 'Banking & POS Clearing', path: '/banking', icon: 'Landmark' },
          { key: 'assets', labelKey: 'nav.medicalEquipment', defaultLabel: 'Medical Equipment & Assets', path: '/assets', icon: 'Boxes' },
          { key: 'budgets', labelKey: 'nav.budgets', defaultLabel: 'Budgets', path: '/budgets', icon: 'PiggyBank' },
        ],
      },
      {
        key: 'compliance_accounting',
        titleKey: 'nav.sections.complianceAndAccounting',
        defaultTitle: 'Accounting, Tax & Compliance',
        items: [
          { key: 'accounting', labelKey: 'nav.generalLedger', defaultLabel: 'General Ledger & Accounts', path: '/accounting', icon: 'BookOpen' },
          { key: 'taxation', labelKey: 'nav.taxation', defaultLabel: 'Taxation & Statutory', path: '/taxation', icon: 'FileSpreadsheet' },
          { key: 'reports', labelKey: 'nav.clinicReports', defaultLabel: 'Financial & Clinic Reports', path: '/reports', icon: 'BarChart3' },
          { key: 'departments', labelKey: 'nav.clinicalDepartments', defaultLabel: 'Clinical Departments', path: '/settings/organization', icon: 'Building2' },
          { key: 'audit_logs', labelKey: 'nav.complianceAudit', defaultLabel: 'Compliance Audit Log', path: '/audit-logs', icon: 'ShieldAlert' },
        ],
      },
      {
        key: 'intelligence_support',
        titleKey: 'nav.sections.intelligenceAndSupport',
        defaultTitle: 'Intelligence & Support',
        items: [
          { key: 'insights', labelKey: 'nav.aiAssistant', defaultLabel: 'Ledgr AI Assistant', path: '/insights', icon: 'Bot' },
          { key: 'support', labelKey: 'nav.support', defaultLabel: 'Help & Support', path: '/support', icon: 'HelpCircle' },
        ],
      },
    ];

    if (!hasRetailOrTrading) return clinicalSections;

    // A healthcare + retail/wholesale tenant still needs the general inventory
    // register for non-clinical stock; the clinic's FEFO pharmacy remains
    // separate. Keep all other clinical groups intact.
    const inventoryItem: NavItem = {
      key: 'inventory',
      labelKey: 'nav.retailInventory',
      defaultLabel: 'Retail / General Inventory',
      path: '/inventory',
      icon: 'Package',
    };
    return clinicalSections.map((section) =>
      section.key === 'clinic_financials'
        ? { ...section, items: [...section.items.slice(0, 3), inventoryItem, ...section.items.slice(3)] }
        : section,
    );
  }

  // ── 2. Standard / multi-vertical ERP fallback ─────────────────────────────
  return [
    {
      key: 'core',
      titleKey: 'nav.sections.core',
      defaultTitle: 'Overview',
      items: [
        { key: 'dashboard', labelKey: 'nav.dashboard', defaultLabel: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
      ],
    },
    {
      key: 'operations',
      titleKey: 'nav.sections.operations',
      defaultTitle: 'Operations',
      items: [
        { key: 'income', labelKey: 'nav.income', defaultLabel: 'Income', path: '/income', icon: 'TrendingUp' },
        { key: 'expenses', labelKey: 'nav.expenses', defaultLabel: 'Expenses', path: '/expenses', icon: 'TrendingDown' },
        { key: 'invoices', labelKey: 'nav.invoices', defaultLabel: 'Invoices', path: '/invoices', icon: 'Receipt' },
        { key: 'inventory', labelKey: 'nav.inventory', defaultLabel: 'Inventory', path: '/inventory', icon: 'Package' },
        { key: 'payroll', labelKey: 'nav.payroll', defaultLabel: 'Payroll', path: '/payroll', icon: 'UserCheck' },
      ],
    },
    {
      key: 'finance',
      titleKey: 'nav.sections.finance',
      defaultTitle: 'Finance & Banking',
      items: [
        { key: 'banking', labelKey: 'nav.banking', defaultLabel: 'Banking', path: '/banking', icon: 'Landmark' },
        { key: 'taxation', labelKey: 'nav.taxation', defaultLabel: 'Taxation', path: '/taxation', icon: 'FileSpreadsheet' },
        { key: 'accounting', labelKey: 'nav.accounting', defaultLabel: 'Accounting', path: '/accounting', icon: 'BookOpen' },
        { key: 'budgets', labelKey: 'nav.budgets', defaultLabel: 'Budgets', path: '/budgets', icon: 'PiggyBank' },
        { key: 'assets', labelKey: 'nav.assets', defaultLabel: 'Assets & Capital', path: '/assets', icon: 'Boxes' },
        { key: 'reports', labelKey: 'nav.standardReports', defaultLabel: 'Reports', path: '/reports', icon: 'BarChart3' },
      ],
    },
    {
      key: 'management',
      titleKey: 'nav.sections.management',
      defaultTitle: 'Management & Tools',
      items: [
        { key: 'organization', labelKey: 'nav.organization', defaultLabel: 'Organisation', path: '/settings/organization', icon: 'Building2' },
        { key: 'audit_logs', labelKey: 'nav.auditLog', defaultLabel: 'Audit Log', path: '/audit-logs', icon: 'ShieldAlert' },
        { key: 'insights', labelKey: 'nav.aiAssistant', defaultLabel: 'Ledgr AI', path: '/insights', icon: 'Bot' },
        { key: 'support', labelKey: 'nav.support', defaultLabel: 'Support', path: '/support', icon: 'HelpCircle' },
      ],
    },
  ];
}

/** True when the builder selected the clinical five-group workspace. */
export function usesClinicalNavigation(options: BuildNavOptions = {}): boolean {
  return buildNavigation(options).some((section) => section.key === 'clinical_operations');
}


/**
 * Canonical route that renders a builder path. Several clinical labels use a
 * context-facing URL (for example `/banking`) while the application keeps its
 * historical canonical screen (for example `/bank-reconciliation/accounts`).
 * The App aliases keep the builder URLs live; the sidebar uses this map for
 * role reachability and active state.
 */
const NAVIGATION_TARGETS: Readonly<Record<string, string>> = {
  '/banking': '/bank-reconciliation/accounts',
  '/taxation': '/tax',
  '/accounting': '/accounts',
  '/inventory': '/products',
  '/reports': '/reports/trial-balance',
  '/budgets': '/reports/budgets',
  '/audit-logs': '/audit',
  '/organization': '/departments',
  '/settings/organization': '/departments',
  '/settings/departments': '/departments',
  '/insights': '/ai',
};

export function resolveNavigationTarget(path: string): string {
  return NAVIGATION_TARGETS[path] ?? path;
}
