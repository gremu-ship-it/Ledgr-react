import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router';
import { useAuthListener } from '@/hooks/useAuthListener';
import { ProtectedRoute, PublicOnlyRoute, PlatformAdminRoute } from '@/routes/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { InstallPrompt } from '@/offline/InstallPrompt';
import {
  activateServiceWorkerUpdate,
  isServiceWorkerUpdateAvailable,
} from '@/offline/registerServiceWorker';
import { CookieConsentBanner } from '@/components/CookieConsentBanner';
import { useAppStore } from '@/store/useAppStore';
import { isPathAllowedForRole, getHomePathForRole } from '@/hooks/usePermissions';
import { useOrganisationCapabilityVisibility } from '@/hooks/useCapability';
import { useDefaultRoute } from './hooks/useDefaultRoute';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PlanGate } from '@/components/billing/PlanGate';
import { TrialBalanceUpgradePrompt } from '@/components/reports/TrialBalanceUpgradePrompt';
import { ProfitLossUpgradePrompt } from '@/components/reports/ProfitLossUpgradePrompt';
import { BalanceSheetUpgradePrompt } from '@/components/reports/BalanceSheetUpgradePrompt';
import { CashFlowUpgradePrompt } from '@/components/reports/CashFlowUpgradePrompt';
import { TaxReportUpgradePrompt } from '@/components/reports/TaxReportUpgradePrompt';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import {
  isChunkLoadError,
  attemptChunkRecovery,
  clearChunkRecovery,
} from '@/lib/chunkRecovery';

// Route-level code splitting. Every page is loaded on demand so the initial
// bundle stays small
// and no single chunk can blow past the service-worker precache limit.
// `lazyPage` adapts our named exports to the default export React.lazy wants
// and automatically recovers from chunk load errors (e.g. after a deployment)
// by reloading the page once so users get the latest bundle hashes seamlessly.
function lazyPage<K extends string, T extends Record<K, ComponentType<never>>>(
  loader: () => Promise<T>,
  name: K,
): T[K] {
  return lazy(async () => {
    try {
      const mod = await loader();
      clearChunkRecovery(name);
      return { default: mod[name] as ComponentType<Record<string, unknown>> };
    } catch (error) {
      if (isChunkLoadError(error) && attemptChunkRecovery(name)) {
        // Return a never-resolving promise so React Suspense stays pending while
        // the browser reloads, preventing an ErrorBoundary flicker.
        return new Promise(() => {});
      }
      throw error;
    }
  }) as unknown as T[K];
}

const LoginPage = lazyPage(() => import('@/pages/LoginPage'), 'LoginPage');
const RegisterPage = lazyPage(() => import('@/pages/RegisterPage'), 'RegisterPage');
const TermsAndConditionsPage = lazyPage(() => import('@/pages/TermsAndConditionsPage'), 'TermsAndConditionsPage');
const CreateBusinessPage = lazyPage(() => import('@/pages/CreateBusinessPage'), 'CreateBusinessPage');
const ForgotPasswordPage = lazyPage(() => import('@/pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage');
const PasswordRecoveryPage = lazyPage(() => import('@/pages/auth/PasswordRecoveryPage'), 'PasswordRecoveryPage');
const AcceptInvitationPage = lazyPage(() => import('@/pages/AcceptInvitationPage'), 'AcceptInvitationPage');
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage');
const ConstructionWorkspacePage = lazyPage(
  () => import('@/pages/construction/ConstructionWorkspacePage'),
  'ConstructionWorkspacePage',
);
const SubcontractorsPage = lazyPage(
  () => import('@/pages/construction/SubcontractorsPage'),
  'SubcontractorsPage',
);
const PaymentCertificatesPage = lazyPage(
  () => import('@/pages/construction/PaymentCertificatesPage'),
  'PaymentCertificatesPage',
);
const RetentionRegisterPage = lazyPage(
  () => import('@/pages/construction/RetentionRegisterPage'),
  'RetentionRegisterPage',
);
const ManufacturingDashboardPage = lazyPage(
  () => import('@/pages/manufacturing/ManufacturingDashboardPage'),
  'ManufacturingDashboardPage',
);
const BomListPage = lazyPage(() => import('@/pages/manufacturing/BomListPage'), 'BomListPage');
const BomEditorPage = lazyPage(() => import('@/pages/manufacturing/BomEditorPage'), 'BomEditorPage');
const BomDetailPage = lazyPage(() => import('@/pages/manufacturing/BomDetailPage'), 'BomDetailPage');
const WorkOrderListPage = lazyPage(
  () => import('@/pages/manufacturing/WorkOrderListPage'),
  'WorkOrderListPage',
);
const WorkOrderCreatePage = lazyPage(
  () => import('@/pages/manufacturing/WorkOrderCreatePage'),
  'WorkOrderCreatePage',
);
const WorkOrderDetailPage = lazyPage(
  () => import('@/pages/manufacturing/WorkOrderDetailPage'),
  'WorkOrderDetailPage',
);
const WorkCentresPage = lazyPage(() => import('@/pages/manufacturing/WorkCentresPage'), 'WorkCentresPage');
const RoutingsPage = lazyPage(() => import('@/pages/manufacturing/RoutingsPage'), 'RoutingsPage');
const ProductionRunsPage = lazyPage(() => import('@/pages/manufacturing/ProductionRunsPage'), 'ProductionRunsPage');
const MrpWorkbenchPage = lazyPage(() => import('@/pages/manufacturing/MrpWorkbenchPage'), 'MrpWorkbenchPage');
const PosPage = lazyPage(() => import('@/pages/PosPage'), 'PosPage');
const IncomePage = lazyPage(() => import('@/pages/IncomePage'), 'IncomePage');
const ExpensesPage = lazyPage(() => import('@/pages/ExpensesPage'), 'ExpensesPage');
const InvoicesPage = lazyPage(() => import('@/pages/InvoicesPage'), 'InvoicesPage');
const PayrollPage = lazyPage(() => import('@/pages/PayrollPage'), 'PayrollPage');
const ContactsPage = lazyPage(() => import('@/pages/ContactsPage'), 'ContactsPage');
const ProductsPage = lazyPage(() => import('@/pages/ProductsPage'), 'ProductsPage');
const AccountsPage = lazyPage(() => import('@/pages/AccountsPage'), 'AccountsPage');
const AssetsPage = lazyPage(() => import('@/pages/AssetsPage'), 'AssetsPage');
const CapitalPage = lazyPage(() => import('@/pages/CapitalPage'), 'CapitalPage');
const TaxPage = lazyPage(() => import('@/pages/TaxPage'), 'TaxPage');
const ApiDocumentationPage = lazyPage(() => import('@/pages/ApiDocumentationPage'), 'ApiDocumentationPage');
const ApiKeysPage = lazyPage(() => import('@/pages/ApiKeysPage'), 'ApiKeysPage');
const ZapierIntegrationPage = lazyPage(() => import('@/pages/ZapierIntegrationPage'), 'ZapierIntegrationPage');
const TrialBalancePage = lazyPage(() => import('@/pages/reports/TrialBalancePage'), 'TrialBalancePage');
const ProfitLossPage = lazyPage(() => import('@/pages/reports/ProfitLossPage'), 'ProfitLossPage');
const BalanceSheetPage = lazyPage(() => import('@/pages/reports/BalanceSheetPage'), 'BalanceSheetPage');
const CashFlowPage = lazyPage(() => import('@/pages/reports/CashFlowPage'), 'CashFlowPage');
const ChangesInEquityPage = lazyPage(() => import('@/pages/reports/ChangesInEquityPage'), 'ChangesInEquityPage');
const RevenueBreakdownPage = lazyPage(() => import('@/pages/reports/RevenueBreakdownPage'), 'RevenueBreakdownPage');
const BranchPerformancePage = lazyPage(() => import('@/pages/reports/BranchPerformancePage'), 'BranchPerformancePage');
const VatReturnPage = lazyPage(() => import('@/pages/reports/VatReturnPage'), 'VatReturnPage');
const WhtSchedulePage = lazyPage(() => import('@/pages/reports/WhtSchedulePage'), 'WhtSchedulePage');
const AiInsightsPage = lazyPage(() => import('@/pages/AiInsightsPage'), 'AiInsightsPage');
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage');
const WarehousePage = lazyPage(() => import('@/pages/WarehousePage'), 'WarehousePage');
const TransfersPage = lazyPage(() => import('@/pages/TransfersPage'), 'TransfersPage');
const BranchesPage = lazyPage(() => import('@/pages/BranchesPage'), 'BranchesPage');
const LocationsPage = lazyPage(() => import('@/pages/LocationsPage'), 'LocationsPage');
const DepartmentsPage = lazyPage(() => import('@/pages/DepartmentsPage'), 'DepartmentsPage');
const PeriodManagementPage = lazyPage(() => import('@/pages/PeriodManagementPage'), 'PeriodManagementPage');
const JournalsPage = lazyPage(() => import('@/pages/JournalsPage'), 'JournalsPage');
const RepairCoaPage = lazyPage(() => import('@/pages/RepairCoaPage'), 'RepairCoaPage');
const AuditLogPage = lazyPage(() => import('@/pages/AuditLogPage'), 'AuditLogPage');
const AdminLayout = lazyPage(() => import('@/pages/admin/AdminLayout'), 'AdminLayout');
const AdminBillingPage = lazyPage(() => import('@/pages/admin/AdminBillingPage'), 'AdminBillingPage');
const AdminBusinessesPage = lazyPage(() => import('@/pages/admin/AdminBusinessesPage'), 'AdminBusinessesPage');
const PartnerAdminLayout = lazyPage(() => import('@/pages/partner-admin/PartnerAdminLayout'), 'PartnerAdminLayout');
const PartnerAdminDashboard = lazyPage(() => import('@/pages/partner-admin/PartnerAdminDashboard'), 'PartnerAdminDashboard');
const PartnerOverviewPage = lazyPage(() => import('@/pages/partner-admin/PartnerOverviewPage'), 'PartnerOverviewPage');
const PartnerSettingsPage = lazyPage(() => import('@/pages/partner-admin/PartnerSettingsPage'), 'PartnerSettingsPage');
const PartnerClientsPage = lazyPage(() => import('@/pages/partner-admin/PartnerClientsPage'), 'PartnerClientsPage');
const PartnerBillingPage = lazyPage(() => import('@/pages/partner-admin/PartnerBillingPage'), 'PartnerBillingPage');
const BankAccountsPage = lazyPage(() => import('@/pages/bank-reconciliation/BankAccountsPage'), 'BankAccountsPage');
const StatementsPage = lazyPage(() => import('@/pages/bank-reconciliation/StatementsPage'), 'StatementsPage');
const StatementDetailPage = lazyPage(() => import('@/pages/bank-reconciliation/StatementDetailPage'), 'StatementDetailPage');
const ReconcilePage = lazyPage(() => import('@/pages/bank-reconciliation/ReconcilePage'), 'ReconcilePage');
const SupportPage = lazyPage(() => import('@/pages/SupportPage'), 'SupportPage');
const ToolsPage = lazyPage(() => import('@/pages/ToolsPage'), 'default');
const DataImportPage = lazyPage(() => import('@/pages/DataImportPage'), 'DataImportPage');
const DemoPage = lazyPage(() => import('@/pages/DemoPage'), 'DemoPage');
const DemoEntryPage = lazyPage(() => import('@/pages/DemoEntryPage'), 'DemoEntryPage');

// Plan gates wrap routes, so they stay in the main bundle.
import { PartnerAdminRoute } from '@/routes/PartnerAdminRoute';
import { PartnerProvider } from '@/partner/PartnerProvider';
import { PartnerPlanGate } from '@/components/billing/PartnerPlanGate';
import { BankReconciliationPlanGate } from '@/components/bank-reconciliation/BankReconciliationPlanGate';
import { OperatingModelGate } from '@/components/billing/OperatingModelGate';
import { isAdminPortalHost } from '@/lib/partnerDomain';

import { isSupabaseConfigured } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demo/mode';
import { ConfigError } from '@/components/ConfigError';

export function RoleRoute() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const role = currentBusiness?.role || null;
  const location = useLocation();
  const isOrgCapabilityEnabled = useOrganisationCapabilityVisibility();

  if (!isPathAllowedForRole(role, location.pathname)) {
    // Capability-aware: a till role in a business without POS (e.g.
    // construction) must not be bounced "home" to a gated /pos page.
    const fallback = getHomePathForRole(role, isOrgCapabilityEnabled);
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}

function TrialBalanceRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={t('reports.trialBalance.title')}
      fallback={<TrialBalanceUpgradePrompt />}
    >
      <TrialBalancePage />
    </PlanGate>
  );
}

function ProfitLossRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={t('reports.profitLoss.title')}
      fallback={<ProfitLossUpgradePrompt />}
    >
      <ProfitLossPage />
    </PlanGate>
  );
}

function BalanceSheetRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={t('reports.balanceSheet.title')}
      fallback={<BalanceSheetUpgradePrompt />}
    >
      <BalanceSheetPage />
    </PlanGate>
  );
}

function CashFlowRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={t('reports.cashFlow.title')}
      fallback={<CashFlowUpgradePrompt />}
    >
      <CashFlowPage />
    </PlanGate>
  );
}

function ChangesInEquityRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate capability="accounting_organisation" featureName={t('reports.statementOfChangesInEquity')}>
      <ChangesInEquityPage />
    </PlanGate>
  );
}

function RevenueBreakdownRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate capability="accounting_organisation" featureName={t('reports.revenueBreakdown.title')}>
      <RevenueBreakdownPage />
    </PlanGate>
  );
}

function BranchPerformanceRoute() {
  const { t } = useTranslation();
  return (
    <PlanGate capability="accounting_organisation" featureName={t('reports.branchPerformance')}>
      <BranchPerformancePage />
    </PlanGate>
  );
}

function VatReturnRoute() {
  const { t } = useTranslation();
  const title = t('reports.vatReturn.title');
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={title}
      fallback={<TaxReportUpgradePrompt title={title} />}
    >
      <VatReturnPage />
    </PlanGate>
  );
}

function WhtScheduleRoute() {
  const { t } = useTranslation();
  const title = t('reports.whtSchedule.title');
  return (
    <PlanGate
      capability="accounting_organisation"
      featureName={title}
      fallback={<TaxReportUpgradePrompt title={title} />}
    >
      <WhtSchedulePage />
    </PlanGate>
  );
}

/**
 * Phase 10.4 — new-version banner. The service worker (registered in
 * main.tsx) dispatches 'app:update-available' when a fresh build is ready;
 * we surface a reload button instead of silently waiting for the next load,
 * which previously left users on a stale bundle after deploys.
 */
function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(isServiceWorkerUpdateAvailable);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const show = () => setAvailable(true);
    window.addEventListener('app:update-available', show);
    return () => window.removeEventListener('app:update-available', show);
  }, []);
  if (!available) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3">
      <div className="flex items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
        <span>A new version of Ledgr is available.</span>
        <button
          type="button"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            void activateServiceWorkerUpdate().catch(() => window.location.reload());
          }}
          className="rounded bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-wait disabled:opacity-70"
        >
          {updating ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

export function SmartRedirect() {
  const route = useDefaultRoute();
  return <Navigate to={route} replace />;
}

function App() {
  useAuthListener();
  const { t } = useTranslation();

  // Defense-in-depth for audit A-01: if the Supabase env vars were missing at
  // build time, supabase.ts now falls back to a placeholder client instead of
  // throwing at import (which blanks the page). Show a readable error here so
  // operators immediately see what to fix, rather than a white screen or a
  // cascade of network errors.
  // The public demo must stay reachable even when env vars are missing
  // (marketing / preview builds). That covers both the static product tour
  // (/demo) and the client-side demo account (/demo/enter and anything reached
  // from it), neither of which talks to Supabase at all.
  const onPublicDemo =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/demo');
  if (!isSupabaseConfigured && !onPublicDemo && !isDemoMode()) {
    return <ConfigError />;
  }

  return (
    <ErrorBoundary name="App">
      <UpdateAvailableBanner />
      <PartnerProvider>
        <BrowserRouter>
          {/* Lazy route chunks resolve here; fullScreen keeps layout stable. */}
          <Suspense fallback={<LoadingSpinner fullScreen label="Loading…" />}>
          <Routes>
            {/* Public-only */}
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>

            {/* Public legal page */}
            <Route path="/terms-and-conditions" element={<TermsAndConditionsPage />} />

            {/* Public product tour — no auth, no live tenant data */}
            <Route path="/demo" element={<DemoPage />} />

            {/* One-click demo account: signs the visitor in as
                demo@ledgr.test against seeded, browser-local books. This is
                the URL external sites (the marketing site on Vercel) link to. */}
            <Route path="/demo/enter" element={<DemoEntryPage />} />

            {/* Standalone — accessible during PASSWORD_RECOVERY regardless of auth state */}
            <Route path="/reset-password" element={<PasswordRecoveryPage />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

            {/* Protected, no AppLayout */}
            <Route element={<ProtectedRoute />}>
              <Route path="/create-business" element={<CreateBusinessPage />} />
            </Route>

            {/* Internal admin tools — wrapped in AdminLayout so there is always
                a visible way back into the main app. */}
            <Route element={<PlatformAdminRoute />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin/billing" element={<AdminBillingPage />} />
                <Route path="/admin/businesses" element={<AdminBusinessesPage />} />
              </Route>
            </Route>

            {/* Partner admin portal */}
            <Route element={<PartnerAdminRoute />}>
              <Route element={<PartnerAdminLayout />}>
                <Route path="/partner-admin" element={<PartnerAdminDashboard />} />
                <Route path="/partner-admin/partners/:id" element={<PartnerOverviewPage />} />
                <Route path="/partner-admin/partners/:id/settings" element={<PartnerSettingsPage />} />
                <Route path="/partner-admin/partners/:id/clients" element={<PartnerClientsPage />} />
                <Route path="/partner-admin/partners/:id/billing" element={<PartnerBillingPage />} />
              </Route>
            </Route>

            {/* Protected with AppLayout & RoleRoute — single source of truth, no duplicate paths */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route element={<RoleRoute />}>
                  {/* The Construction workspace is gated at route and page level. */}
                  <Route
                    path="/construction/subcontractors"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.items.constructionSubcontractors')}>
                        <CapabilityGate capability="construction">
                          <SubcontractorsPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/construction/certificates"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.items.paymentCertificates')}>
                        <OperatingModelGate requiredOperatingModels={['PROJECT_BASED']}>
                          <CapabilityGate capability="construction">
                            <PaymentCertificatesPage />
                          </CapabilityGate>
                        </OperatingModelGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/construction/retention-register"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.items.retentionRegister')}>
                        <OperatingModelGate requiredOperatingModels={['PROJECT_BASED']}>
                          <CapabilityGate capability="construction">
                            <RetentionRegisterPage />
                          </CapabilityGate>
                        </OperatingModelGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/construction/*"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.items.constructionWorkspace')}>
                        <CapabilityGate capability="construction">
                          <ConstructionWorkspacePage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  {/* Every Manufacturing URL is Enterprise-only, business-capability gated, and role checked. */}
                  <Route
                    path="/manufacturing"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <ManufacturingDashboardPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/bom"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <BomListPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/bom/new"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <BomEditorPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/bom/:id"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <BomDetailPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/bom/:id/edit"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <BomEditorPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/mrp"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <MrpWorkbenchPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/production"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <WorkOrderListPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/production/new"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <WorkOrderCreatePage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/production/:id"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <WorkOrderDetailPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/runs"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <ProductionRunsPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/routings"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <RoutingsPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/work-centres"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <WorkCentresPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route
                    path="/manufacturing/dashboard"
                    element={
                      <PlanGate minPlan="enterprise" featureName={t('navigation.sections.manufacturing')}>
                        <CapabilityGate capability="manufacturing">
                          <ManufacturingDashboardPage />
                        </CapabilityGate>
                      </PlanGate>
                    }
                  />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/pos" element={
                    <OperatingModelGate requiredOperatingModels={['RETAIL']} redirectTo="/income">
                      <CapabilityGate capability="pos">
                        <PosPage />
                      </CapabilityGate>
                    </OperatingModelGate>
                  } />

                  {/* Finance */}
                  <Route path="/income" element={<IncomePage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/payroll" element={
                    <PartnerPlanGate featureKey="payroll" featureName="Payroll">
                      <PayrollPage />
                    </PartnerPlanGate>
                  } />

                  {/* Inventory */}
                  <Route path="/products" element={
                    <PartnerPlanGate featureKey="inventory" capability="inventory" featureName="Products">
                      <CapabilityGate capability="inventory">
                        <ProductsPage />
                      </CapabilityGate>
                    </PartnerPlanGate>
                  } />
                  <Route path="/warehouse" element={
                    <PartnerPlanGate featureKey="inventory" capability="inventory" featureName="Warehouses">
                      <CapabilityGate capability="inventory" rolePath="/warehouse">
                        <WarehousePage />
                      </CapabilityGate>
                    </PartnerPlanGate>
                  } />
                  <Route path="/transfers" element={
                    <PartnerPlanGate featureKey="inventory" capability="inventory" featureName="Stock transfers">
                      <CapabilityGate capability="inventory" rolePath="/transfers">
                        <TransfersPage />
                      </CapabilityGate>
                    </PartnerPlanGate>
                  } />

                  {/* Accounting — core modules on Starter; advanced modules on Growth */}
                  <Route path="/accounts" element={
                    <PlanGate capability="core_accounting" featureName="Chart of Accounts">
                      <AccountsPage />
                    </PlanGate>
                  } />
                  <Route path="/assets" element={
                    <PlanGate capability="core_accounting" featureName="Assets">
                      <AssetsPage />
                    </PlanGate>
                  } />
                  <Route path="/capital" element={
                    <PlanGate capability="core_accounting" featureName="Capital">
                      <CapitalPage />
                    </PlanGate>
                  } />
                  <Route path="/tax" element={
                    <PlanGate capability="core_accounting" featureName="Tax">
                      <TaxPage />
                    </PlanGate>
                  } />
                  <Route path="/reports/trial-balance" element={<TrialBalanceRoute />} />
                  <Route path="/reports/profit-loss" element={<ProfitLossRoute />} />
                  <Route path="/reports/balance-sheet" element={<BalanceSheetRoute />} />
                  <Route path="/reports/cash-flow" element={<CashFlowRoute />} />
                  <Route path="/reports/changes-in-equity" element={<ChangesInEquityRoute />} />
                  <Route path="/reports/revenue-breakdown" element={<RevenueBreakdownRoute />} />
                  <Route path="/reports/branch-performance" element={<BranchPerformanceRoute />} />
                  <Route path="/reports/vat-return" element={<VatReturnRoute />} />
                  <Route path="/reports/wht-schedule" element={<WhtScheduleRoute />} />
                  <Route path="/journals" element={
                    <PlanGate capability="accounting_organisation" featureName="Journals">
                      <JournalsPage />
                    </PlanGate>
                  } />
                  <Route path="/periods" element={
                    <PlanGate capability="accounting_organisation" featureName="Period Management">
                      <PeriodManagementPage />
                    </PlanGate>
                  } />
                  <Route path="/bank-reconciliation/accounts" element={
                    <BankReconciliationPlanGate><BankAccountsPage /></BankReconciliationPlanGate>
                  } />
                  <Route path="/bank-reconciliation/reconcile" element={
                    <Navigate to="/bank-reconciliation/statements" replace />
                  } />
                  <Route path="/bank-reconciliation/statements" element={
                    <BankReconciliationPlanGate><StatementsPage /></BankReconciliationPlanGate>
                  } />
                  <Route path="/bank-reconciliation/statements/:id" element={
                    <BankReconciliationPlanGate><StatementDetailPage /></BankReconciliationPlanGate>
                  } />
                  <Route path="/bank-reconciliation/reconcile/:statementId" element={
                    <BankReconciliationPlanGate><ReconcilePage /></BankReconciliationPlanGate>
                  } />
                  <Route path="/audit" element={
                    <PlanGate capability="accounting_organisation" featureName="Audit Log">
                      <AuditLogPage />
                    </PlanGate>
                  } />

                  {/* Organisation */}
                  <Route path="/contacts" element={
                    <PlanGate capability="accounting_organisation" featureName="Contacts">
                      <ContactsPage />
                    </PlanGate>
                  } />
                  <Route path="/branches" element={
                    <PlanGate capability="accounting_organisation" featureName="Branches">
                      <BranchesPage />
                    </PlanGate>
                  } />
                  <Route path="/locations" element={
                    <PlanGate capability="accounting_organisation" featureName="Locations">
                      <LocationsPage />
                    </PlanGate>
                  } />
                  <Route path="/departments" element={
                    <PlanGate capability="accounting_organisation" featureName="Departments">
                      <DepartmentsPage />
                    </PlanGate>
                  } />

                  {/* Integrations — gated */}
                  <Route path="/api-docs" element={
                    <PlanGate capability="api_access" featureName="Public API">
                      <ApiDocumentationPage />
                    </PlanGate>
                  } />
                  <Route path="/api-keys" element={
                    <PlanGate capability="api_access" featureName="API Keys">
                      <ApiKeysPage />
                    </PlanGate>
                  } />
                  <Route path="/zapier" element={
                    <PlanGate capability="webhooks" featureName="Zapier Integration">
                      <ZapierIntegrationPage />
                    </PlanGate>
                  } />

                  {/* AI & Settings */}
                  <Route path="/ai" element={
                    <PartnerPlanGate featureKey="ai_advisor" capability="ai_insights" featureName="AI Insights">
                      <AiInsightsPage />
                    </PartnerPlanGate>
                  } />
                  <Route path="/chat" element={<Navigate to="/ai" replace />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/approvals" element={<SettingsPage />} />
                  <Route path="/settings/repair-coa" element={<RepairCoaPage />} />
                  <Route path="/support" element={<SupportPage />} />
                  <Route path="/tools" element={<ToolsPage />} />
                  <Route path="/import" element={<DataImportPage />} />
                  <Route path="/data-import" element={<DataImportPage />} />
                  <Route path="/onboarding/import" element={<DataImportPage />} />
                </Route>
              </Route>
            </Route>

            {/* Fallbacks */}
            <Route
              path="/"
              element={isAdminPortalHost() ? <Navigate to="/partner-admin" replace /> : <SmartRedirect />}
            />
            <Route
              path="*"
              element={isAdminPortalHost() ? <Navigate to="/partner-admin" replace /> : <SmartRedirect />}
            />
          </Routes>
          </Suspense>

          <InstallPrompt />
          <CookieConsentBanner />
        </BrowserRouter>
      </PartnerProvider>
    </ErrorBoundary>
  );
}

export default App;
