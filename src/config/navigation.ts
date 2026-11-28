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
 *
 * Operational groups (billing/POS, payroll, banking/clearing, general ledger,
 * tax and reports) are depth-preserving accordions: the parent carries no
 * destination of its own, while every child keeps the exact path (including a
 * `?tab=` query) that the application resolves to a canonical screen.
 */

export interface NavSubItem {
  key: string;
  labelKey: string;
  defaultLabel: string;
  path: string;
  icon?: string;
}

export interface NavItem {
  key: string;
  labelKey: string;
  defaultLabel: string;
  /**
   * Leaf destination. Accordion parents are intentionally pathless: their
   * button toggles the group, and the active state is derived from a child.
   */
  path?: string;
  icon: string;
  children?: NavSubItem[];
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

/** One destination inside an operational accordion. */
function subItem(
  key: string,
  labelKey: string,
  defaultLabel: string,
  path: string,
  icon: string,
): NavSubItem {
  return { key, labelKey, defaultLabel, path, icon };
}

function payrollChildren(): NavSubItem[] {
  return [
    subItem('payroll_employees', 'nav.sub.payroll_employees', 'Employees', '/payroll', 'Users'),
    subItem('payroll_payruns', 'nav.sub.payroll_payruns', 'Pay Runs', '/payroll?tab=payruns', 'UserCheck'),
    subItem('payroll_leave', 'nav.sub.payroll_leave', 'Leave Requests', '/payroll?tab=leave', 'CalendarDays'),
  ];
}

function bankingChildren(): NavSubItem[] {
  return [
    subItem('banking_accounts', 'nav.sub.banking_accounts', 'Bank Accounts', '/banking', 'Landmark'),
    subItem('banking_statements', 'nav.sub.banking_statements', 'Bank Statements', '/banking?tab=statements', 'FileText'),
    subItem('banking_reconciliation', 'nav.sub.banking_reconciliation', 'Account Reconciliation', '/banking?tab=reconcile', 'CheckCheck'),
    subItem('banking_deposits', 'nav.sub.banking_deposits', 'Cash Deposits', '/banking?tab=deposits', 'Banknote'),
    subItem('banking_exchange_rates', 'nav.sub.banking_exchange_rates', 'Exchange Rates', '/banking?tab=currencies', 'ArrowLeftRight'),
  ];
}

function accountingChildren(): NavSubItem[] {
  return [
    subItem('gl_accounts', 'nav.sub.gl_accounts', 'Chart of Accounts', '/accounting', 'BookOpen'),
    subItem('gl_journals', 'nav.sub.gl_journals', 'Journal Entries', '/accounting?tab=journals', 'FileSpreadsheet'),
    subItem('gl_periods', 'nav.sub.gl_periods', 'Period Management', '/accounting?tab=periods', 'CalendarRange'),
  ];
}

function taxationChildren(): NavSubItem[] {
  return [
    subItem('tax_overview', 'nav.sub.tax_overview', 'Tax Overview', '/taxation', 'Percent'),
    subItem('tax_vat', 'nav.sub.tax_vat', 'VAT Returns', '/taxation?tab=vat', 'FileSpreadsheet'),
    subItem('tax_wht', 'nav.sub.tax_wht', 'WHT Schedule', '/taxation?tab=wht', 'FileCheck2'),
  ];
}

function reportChildren(): NavSubItem[] {
  return [
    subItem('rep_trial_balance', 'nav.sub.trialBalance', 'Trial Balance', '/reports?tab=trial-balance', 'Scale'),
    subItem('rep_pnl', 'nav.sub.profitAndLoss', 'Profit & Loss (P&L)', '/reports?tab=pnl', 'TrendingUp'),
    subItem('rep_balance_sheet', 'nav.sub.balanceSheet', 'Balance Sheet', '/reports?tab=balance-sheet', 'Landmark'),
    subItem('rep_cash_flow', 'nav.sub.cashFlow', 'Cash Flow Statement', '/reports?tab=cash-flow', 'Wallet'),
    subItem('rep_revenue', 'nav.sub.revenueBreakdown', 'Revenue Breakdown', '/reports?tab=revenue', 'ChartPie'),
    subItem('rep_equity', 'nav.sub.changesInEquity', 'Changes in Equity', '/reports?tab=equity', 'Scale'),
    subItem('rep_branches', 'nav.sub.departmentPerformance', 'Branch / Department Perf.', '/reports?tab=branches', 'GitBranch'),
  ];
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
          healthcareItem('patient_directory', 'nav.patients', 'Patient Intake & Registry', '/healthcare/patients', 'Users'),
          healthcareItem('nurse_triage', 'nav.nurseTriage', 'Nurse Triage', '/healthcare/triage', 'HeartPulse'),
          healthcareItem('doctor_consultation', 'nav.doctorStation', 'Doctor Consultation Room', '/healthcare/consultation', 'Stethoscope'),
          healthcareItem('telemedicine_station', 'nav.telemedicine', 'Telemedicine', '/healthcare/telemedicine', 'Video'),
          healthcareItem('radiology_station', 'nav.radiologyStation', 'Radiology & Imaging', '/healthcare/radiology', 'ScanLine'),
          healthcareItem('lab_diagnostics', 'nav.labDiagnostics', 'Lab Diagnostics', '/healthcare/lab', 'FlaskConical'),
          healthcareItem('pharmacy_dispensary', 'nav.pharmacyDispensary', 'Pharmacy & Dispensary', '/healthcare/pharmacy', 'Pill'),
          healthcareItem('healthcare_catalogue', 'nav.healthcare.catalogue', 'Drug & Service Catalogue', '/healthcare/catalogue', 'Package'),
          healthcareItem('hospital_wards', 'nav.wardsAndBeds', 'Wards & Visual Bed Grid', '/healthcare/wards', 'BedDouble'),
          healthcareItem('inpatient_admissions', 'nav.inpatientRegistry', 'Inpatient Admissions (IPD)', '/healthcare/admissions', 'UsersRound'),
        ],
      },
      {
        key: 'billing_claims',
        titleKey: 'nav.sections.billingAndClaims',
        defaultTitle: 'Billing & Claims',
        items: [
          {
            key: 'patient_billing_pos',
            labelKey: 'nav.patientBilling',
            defaultLabel: 'Patient Billing & POS',
            icon: 'Receipt',
            enterpriseOnly: true,
            requiredOperatingModel: 'HEALTHCARE',
            children: [
              subItem('patient_invoices', 'nav.sub.patient_invoices', 'Patient Invoices', '/healthcare/billing', 'Receipt'),
              subItem('pos_terminal', 'nav.sub.pos_terminal', 'POS Terminal', '/pos', 'ShoppingCart'),
              subItem('cash_drawer_shifts', 'nav.sub.cash_drawer_shifts', 'Cash Drawer Shifts', '/pos?tab=shifts', 'Clock3'),
            ],
          },
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
          {
            key: 'staff_payroll',
            labelKey: 'nav.staffPayroll',
            defaultLabel: 'Staff Payroll',
            icon: 'UserCheck',
            children: payrollChildren(),
          },
          {
            key: 'banking_pos_clearing',
            labelKey: 'nav.banking',
            defaultLabel: 'Banking & POS Clearing',
            icon: 'Landmark',
            children: bankingChildren(),
          },
          { key: 'assets', labelKey: 'nav.medicalEquipment', defaultLabel: 'Medical Equipment & Assets', path: '/assets', icon: 'Boxes' },
          { key: 'budgets', labelKey: 'nav.budgets', defaultLabel: 'Budgets', path: '/budgets', icon: 'PiggyBank' },
        ],
      },
      {
        key: 'compliance_accounting',
        titleKey: 'nav.sections.complianceAndAccounting',
        defaultTitle: 'Accounting, Tax & Compliance',
        items: [
          {
            key: 'general_ledger',
            labelKey: 'nav.generalLedger',
            defaultLabel: 'General Ledger & Accounts',
            icon: 'BookOpen',
            children: accountingChildren(),
          },
          {
            key: 'taxation_statutory',
            labelKey: 'nav.taxation',
            defaultLabel: 'Taxation & Statutory',
            icon: 'FileSpreadsheet',
            children: taxationChildren(),
          },
          {
            key: 'financial_reports',
            labelKey: 'nav.clinicReports',
            defaultLabel: 'Financial & Clinic Reports',
            icon: 'BarChart3',
            children: reportChildren(),
          },
          { key: 'departments', labelKey: 'nav.clinicalDepartments', defaultLabel: 'Departments & Cost Centres', path: '/departments', icon: 'Building2' },
          { key: 'branches', labelKey: 'nav.branches', defaultLabel: 'Branches & Facilities', path: '/branches', icon: 'GitBranch' },
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
        {
          key: 'payroll',
          labelKey: 'nav.payroll',
          defaultLabel: 'Payroll',
          icon: 'UserCheck',
          children: payrollChildren(),
        },
      ],
    },
    {
      key: 'finance',
      titleKey: 'nav.sections.finance',
      defaultTitle: 'Finance & Banking',
      items: [
        {
          key: 'banking',
          labelKey: 'nav.banking',
          defaultLabel: 'Banking',
          icon: 'Landmark',
          children: bankingChildren(),
        },
        {
          key: 'taxation',
          labelKey: 'nav.taxation',
          defaultLabel: 'Taxation',
          icon: 'FileSpreadsheet',
          children: taxationChildren(),
        },
        {
          key: 'accounting',
          labelKey: 'nav.accounting',
          defaultLabel: 'Accounting',
          icon: 'BookOpen',
          children: accountingChildren(),
        },
        { key: 'budgets', labelKey: 'nav.budgets', defaultLabel: 'Budgets', path: '/budgets', icon: 'PiggyBank' },
        { key: 'assets', labelKey: 'nav.assets', defaultLabel: 'Assets & Capital', path: '/assets', icon: 'Boxes' },
        {
          key: 'reports',
          labelKey: 'nav.standardReports',
          defaultLabel: 'Reports',
          icon: 'BarChart3',
          children: reportChildren(),
        },
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

/** Every leaf destination in a section list, including accordion children. */
export function navigationPaths(nav: readonly NavSection[]): string[] {
  return nav.flatMap((section) =>
    section.items.flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.children ?? []).map((child) => child.path),
    ]),
  );
}

/**
 * Canonical route that renders a builder path. Several clinical labels use a
 * context-facing URL (for example `/banking`) while the application keeps its
 * historical canonical screen (for example `/bank-reconciliation/accounts`).
 * The App aliases keep the builder URLs live; the sidebar uses this map for
 * role reachability and active state.
 *
 * Query-bearing child paths resolve here too. The same table powers the
 * landing redirects in `App.tsx`, so a deep link such as
 * `/payroll?tab=leave` lands on the Leave screen while the sidebar still
 * highlights the Leave sub-item.
 */
const NAVIGATION_TARGETS: Readonly<Record<string, string>> = {
  '/payroll': '/payroll/employees',
  '/payroll?tab=payruns': '/payroll/pay-runs',
  '/payroll?tab=leave': '/payroll/leave',
  '/banking': '/bank-reconciliation/accounts',
  '/banking?tab=statements': '/bank-reconciliation/statements',
  '/banking?tab=reconcile': '/bank-reconciliation/reconcile',
  '/banking?tab=deposits': '/cash-deposits',
  '/banking?tab=currencies': '/settings/exchange-rates',
  '/taxation': '/tax',
  '/taxation?tab=vat': '/reports/vat-return',
  '/taxation?tab=wht': '/reports/wht-schedule',
  '/accounting': '/accounts',
  '/accounting?tab=journals': '/journals',
  '/accounting?tab=periods': '/periods',
  '/reports': '/reports/trial-balance',
  '/reports?tab=trial-balance': '/reports/trial-balance',
  '/reports?tab=pnl': '/reports/profit-loss',
  '/reports?tab=balance-sheet': '/reports/balance-sheet',
  '/reports?tab=cash-flow': '/reports/cash-flow',
  '/reports?tab=revenue': '/reports/revenue-breakdown',
  '/reports?tab=equity': '/reports/changes-in-equity',
  '/reports?tab=branches': '/reports/branch-performance',
  '/pos?tab=shifts': '/pos/shifts',
  '/inventory': '/products',
  '/budgets': '/reports/budgets',
  '/audit-logs': '/audit',
  '/organization': '/departments',
  '/settings/organization': '/departments',
  '/settings/departments': '/departments',
  '/insights': '/ai',
  '/healthcare/wards': '/healthcare/wards',
  '/healthcare/admissions': '/healthcare/admissions',
};

/**
 * Extra surfaces that render the same destination as a child. The reports
 * workspace is the important case: `/reports` with no tab defaults to Trial
 * Balance inside `ReportsPage`, even before its URL is canonicalized.
 */
const NAVIGATION_PATH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '/reports?tab=trial-balance': ['/reports'],
};

export function resolveNavigationTarget(path: string): string {
  return NAVIGATION_TARGETS[path] ?? path;
}

function splitPath(path: string): { pathname: string; search: string } {
  const queryIndex = path.indexOf('?');
  if (queryIndex === -1) return { pathname: path, search: '' };
  return {
    pathname: path.slice(0, queryIndex),
    search: path.slice(queryIndex),
  };
}

/**
 * Path + query aware active test shared by the sidebar accordions and tests.
 *
 * A query-bearing destination is active when the current URL matches it
 * exactly, or when the browser has already settled on its canonical target
 * (the landing redirects are `replace`, so `/payroll?tab=leave` becomes
 * `/payroll/leave`). Plain destinations also accept their legacy alias target
 * (`/banking` → `/bank-reconciliation/accounts`).
 */
export function isNavigationPathActive(
  path: string,
  pathname: string,
  search = '',
): boolean {
  const destination = splitPath(path);
  if (destination.search) {
    if (pathname === destination.pathname && search === destination.search) return true;
    return search === ''
      && (pathname === resolveNavigationTarget(path)
        || (NAVIGATION_PATH_ALIASES[path] ?? []).includes(pathname));
  }
  if (search) return false;
  return pathname === destination.pathname
    || pathname === resolveNavigationTarget(destination.pathname);
}

/** True when a leaf or any of its accordion children is the current surface. */
export function isNavigationItemActive(
  item: NavItem,
  pathname: string,
  search = '',
): boolean {
  if (item.path && isNavigationPathActive(item.path, pathname, search)) return true;
  return (item.children ?? []).some((child) =>
    isNavigationPathActive(child.path, pathname, search),
  );
}
