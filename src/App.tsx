import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router';
import { useAuthListener } from '@/hooks/useAuthListener';
import { ProtectedRoute, PublicOnlyRoute, PlatformAdminRoute } from '@/routes/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { InstallPrompt } from '@/offline/InstallPrompt';
import { CookieConsentBanner } from '@/components/CookieConsentBanner';
import { useAppStore } from '@/store/useAppStore';
import { isPathAllowedForRole, getHomePathForRole } from '@/hooks/usePermissions';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PlanGate } from '@/components/billing/PlanGate';
import {
  isChunkLoadError,
  attemptChunkRecovery,
  clearChunkRecovery,
} from '@/lib/chunkRecovery';

// Route-level code splitting. Every page (and the chart-heavy bank
// reconciliation view) is loaded on demand so the initial bundle stays small
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
const ResetPasswordPage = lazyPage(() => import('@/pages/auth/ResetPasswordPage'), 'ResetPasswordPage');
const AcceptInvitationPage = lazyPage(() => import('@/pages/AcceptInvitationPage'), 'AcceptInvitationPage');
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage');
const IncomePage = lazyPage(() => import('@/pages/IncomePage'), 'IncomePage');
const ExpensesPage = lazyPage(() => import('@/pages/ExpensesPage'), 'ExpensesPage');
const InvoicesPage = lazyPage(() => import('@/pages/InvoicesPage'), 'InvoicesPage');
const PayrollPage = lazyPage(() => import('@/pages/PayrollPage'), 'PayrollPage');
const ContactsPage = lazyPage(() => import('@/pages/ContactsPage'), 'ContactsPage');
const ProductsPage = lazyPage(() => import('@/pages/ProductsPage'), 'ProductsPage');
const InventoryPage = lazyPage(() => import('@/pages/InventoryPage'), 'InventoryPage');
const AccountsPage = lazyPage(() => import('@/pages/AccountsPage'), 'AccountsPage');
const AssetsPage = lazyPage(() => import('@/pages/AssetsPage'), 'AssetsPage');
const CapitalPage = lazyPage(() => import('@/pages/CapitalPage'), 'CapitalPage');
const TaxPage = lazyPage(() => import('@/pages/TaxPage'), 'TaxPage');
const ApiDocumentationPage = lazyPage(() => import('@/pages/ApiDocumentationPage'), 'ApiDocumentationPage');
const ApiKeysPage = lazyPage(() => import('@/pages/ApiKeysPage'), 'ApiKeysPage');
const ZapierIntegrationPage = lazyPage(() => import('@/pages/ZapierIntegrationPage'), 'ZapierIntegrationPage');
const ReportsPage = lazyPage(() => import('@/pages/ReportsPage'), 'ReportsPage');
const AiInsightsPage = lazyPage(() => import('@/pages/AiInsightsPage'), 'AiInsightsPage');
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage');
const WarehousePage = lazyPage(() => import('@/pages/WarehousePage'), 'WarehousePage');
const TransfersPage = lazyPage(() => import('@/pages/TransfersPage'), 'TransfersPage');
const BranchesPage = lazyPage(() => import('@/pages/BranchesPage'), 'BranchesPage');
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
const BankReconciliation = lazyPage(
  () => import('@/components/bank/BankReconciliation'),
  'BankReconciliation',
);
const SupportPage = lazyPage(() => import('@/pages/SupportPage'), 'SupportPage');
const ToolsPage = lazyPage(() => import('@/pages/ToolsPage'), 'default');
const DataImportPage = lazyPage(() => import('@/pages/DataImportPage'), 'DataImportPage');

// Plan gates wrap routes, so they stay in the main bundle.
import { PartnerAdminRoute } from '@/routes/PartnerAdminRoute';
import { PartnerProvider } from '@/partner/PartnerProvider';
import { PartnerPlanGate } from '@/components/billing/PartnerPlanGate';
import { isAdminPortalHost } from '@/lib/partnerDomain';

import { isSupabaseConfigured } from '@/lib/supabase';
import { ConfigError } from '@/components/ConfigError';

export function RoleRoute() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const role = currentBusiness?.role || null;
  const location = useLocation();

  if (!isPathAllowedForRole(role, location.pathname)) {
    const fallback = getHomePathForRole(role);
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}

/**
 * Phase 10.4 — new-version banner. The service worker (registered in
 * main.tsx) dispatches 'app:update-available' when a fresh build is ready;
 * we surface a reload button instead of silently waiting for the next load,
 * which previously left users on a stale bundle after deploys.
 */
function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false);
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
          onClick={() => window.location.reload()}
          className="rounded bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

function App() {
  useAuthListener();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const role = currentBusiness?.role || null;
  const roleHome = getHomePathForRole(role);
  const homePath = isAdminPortalHost() ? '/partner-admin' : (roleHome !== '/dashboard' ? roleHome : '/dashboard');

  // Defense-in-depth for audit A-01: if the Supabase env vars were missing at
  // build time, supabase.ts now falls back to a placeholder client instead of
  // throwing at import (which blanks the page). Show a readable error here so
  // operators immediately see what to fix, rather than a white screen or a
  // cascade of network errors.
  if (!isSupabaseConfigured) {
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

            {/* Standalone — accessible during PASSWORD_RECOVERY regardless of auth state */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
                  <Route path="/dashboard" element={<DashboardPage />} />

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
                    <PartnerPlanGate featureKey="inventory" featureName="Products">
                      <ProductsPage />
                    </PartnerPlanGate>
                  } />
                  <Route path="/inventory" element={
                    <PartnerPlanGate featureKey="inventory" featureName="Inventory">
                      <InventoryPage />
                    </PartnerPlanGate>
                  } />
                  <Route path="/warehouse" element={
                    <PartnerPlanGate featureKey="inventory" featureName="Warehouses">
                      <WarehousePage />
                    </PartnerPlanGate>
                  } />
                  <Route path="/transfers" element={
                    <PartnerPlanGate featureKey="inventory" featureName="Stock transfers">
                      <TransfersPage />
                    </PartnerPlanGate>
                  } />

                  {/* Accounting — all gated via accounting_organisation */}
                  <Route path="/accounts" element={
                    <PlanGate capability="accounting_organisation" featureName="Chart of Accounts">
                      <AccountsPage />
                    </PlanGate>
                  } />
                  <Route path="/assets" element={
                    <PlanGate capability="accounting_organisation" featureName="Assets">
                      <AssetsPage />
                    </PlanGate>
                  } />
                  <Route path="/capital" element={
                    <PlanGate capability="accounting_organisation" featureName="Capital">
                      <CapitalPage />
                    </PlanGate>
                  } />
                  <Route path="/tax" element={
                    <PlanGate capability="accounting_organisation" featureName="Tax">
                      <TaxPage />
                    </PlanGate>
                  } />
                  <Route path="/reports" element={
                    <PlanGate capability="accounting_organisation" featureName="Reports">
                      <ReportsPage />
                    </PlanGate>
                  } />
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
                  <Route path="/bank-reconcile" element={
                    <PartnerPlanGate featureKey="bank_reconciliation" capability="bank_reconciliation" featureName="Bank Reconciliation">
                      <BankReconciliation businessId={currentBusiness?.business?.id || ''} />
                    </PartnerPlanGate>
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
            <Route path="/" element={<Navigate to={homePath} replace />} />
            <Route path="*" element={<Navigate to={homePath} replace />} />
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
