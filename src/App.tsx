import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthListener } from '@/hooks/useAuthListener';
import { ProtectedRoute, PublicOnlyRoute, PlatformAdminRoute } from '@/routes/ProtectedRoute';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { InstallPrompt } from '@/offline/InstallPrompt';
import { CookieConsentBanner } from '@/components/CookieConsentBanner';
import { useAppStore } from '@/store/useAppStore';
import { isPathAllowedForRole, getHomePathForRole } from '@/hooks/usePermissions';

// Auth pages
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { CreateBusinessPage } from '@/pages/CreateBusinessPage';

// App pages
import { DashboardPage } from '@/pages/DashboardPage';
import { IncomePage } from '@/pages/IncomePage';
import { ExpensesPage } from '@/pages/ExpensesPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { PayrollPage } from '@/pages/PayrollPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { AssetsPage } from '@/pages/AssetsPage';
import { CapitalPage } from '@/pages/CapitalPage';
import { TaxPage } from '@/pages/TaxPage';
import { BankReconciliation } from '@/components/bank/BankReconciliation';
import { ApiDocumentationPage } from '@/pages/ApiDocumentationPage';
import { ApiKeysPage } from '@/pages/ApiKeysPage';
import { ZapierIntegrationPage } from '@/pages/ZapierIntegrationPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AiInsightsPage } from '@/pages/AiInsightsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PlanGate } from '@/components/billing/PlanGate';
import { WarehousePage } from './pages/WarehousePage';
import { TransfersPage } from './pages/TransfersPage';
import { BranchesPage } from './pages/BranchesPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { PeriodManagementPage } from '@/pages/PeriodManagementPage';
import { JournalsPage } from '@/pages/JournalsPage';
import { RepairCoaPage } from '@/pages/RepairCoaPage';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { AdminBillingPage } from '@/pages/admin/AdminBillingPage';
import { PartnerAdminLayout } from '@/pages/partner-admin/PartnerAdminLayout';
import { PartnerAdminDashboard } from '@/pages/partner-admin/PartnerAdminDashboard';
import { PartnerOverviewPage } from '@/pages/partner-admin/PartnerOverviewPage';
import { PartnerSettingsPage } from '@/pages/partner-admin/PartnerSettingsPage';
import { PartnerClientsPage } from '@/pages/partner-admin/PartnerClientsPage';
import { PartnerBillingPage } from '@/pages/partner-admin/PartnerBillingPage';
import { PartnerAdminRoute } from '@/routes/PartnerAdminRoute';
import { PartnerProvider } from '@/partner/PartnerProvider';
import { PartnerPlanGate } from '@/components/billing/PartnerPlanGate';
import { isAdminPortalHost } from '@/lib/partnerDomain';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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

function App() {
  useAuthListener();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const role = currentBusiness?.role || null;
  const roleHome = getHomePathForRole(role);
  // admin.ledgr.com is the partner admin portal; otherwise role-specific home or /dashboard.
  const homePath = isAdminPortalHost() ? '/partner-admin' : (roleHome !== '/dashboard' ? roleHome : '/dashboard');

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PartnerProvider>
        <BrowserRouter>
          <Routes>
            {/* Public-only */}
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>

            {/* Standalone — accessible during PASSWORD_RECOVERY regardless of auth state */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Invitation flow – public so it can show "sign in to accept" UI; internally handles both authenticated and unauthenticated states */}
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

            {/* Protected, no AppLayout */}
            <Route element={<ProtectedRoute />}>
              <Route path="/create-business" element={<CreateBusinessPage />} />
            </Route>

            {/* Internal admin tools — platform admins only, doesn't need a business selected */}
            <Route element={<PlatformAdminRoute />}>
              <Route path="/admin/billing" element={<AdminBillingPage />} />
            </Route>

            {/* Partner admin portal — served at admin.ledgr.com, also reachable
                at /partner-admin on the main app for convenience. */}
            <Route element={<PartnerAdminRoute />}>
              <Route element={<PartnerAdminLayout />}>
                <Route path="/partner-admin" element={<PartnerAdminDashboard />} />
                <Route path="/partner-admin/partners/:id" element={<PartnerOverviewPage />} />
                <Route path="/partner-admin/partners/:id/settings" element={<PartnerSettingsPage />} />
                <Route path="/partner-admin/partners/:id/clients" element={<PartnerClientsPage />} />
                <Route path="/partner-admin/partners/:id/billing" element={<PartnerBillingPage />} />
              </Route>
            </Route>

            {/* Protected with AppLayout & RoleRoute */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route element={<RoleRoute />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/income" element={<IncomePage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/payroll" element={
                    <PartnerPlanGate featureKey="payroll" featureName="Payroll">
                      <PayrollPage />
                    </PartnerPlanGate>
                  } />
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
                  <Route path="/accounts" element={<AccountsPage />} />
                  <Route path="/assets" element={<AssetsPage />} />
                  <Route path="/capital" element={<CapitalPage />} />
                  <Route path="/tax" element={<TaxPage />} />
                  <Route path="/bank-reconcile" element={(
                    <PartnerPlanGate featureKey="bank_reconciliation" capability="bank_reconciliation" featureName="Bank Reconciliation">
                      <BankReconciliation businessId={currentBusiness?.business?.id || ''} />
                    </PartnerPlanGate>
                  )} />
                  <Route path="/api-docs" element={(
                    <PlanGate capability="api_access" featureName="Public API">
                      <ApiDocumentationPage />
                    </PlanGate>
                  )} />
                  <Route path="/api-keys" element={(
                    <PlanGate capability="api_access" featureName="API Keys">
                      <ApiKeysPage />
                    </PlanGate>
                  )} />
                  <Route path="/zapier" element={(
                    <PlanGate capability="webhooks" featureName="Zapier Integration">
                      <ZapierIntegrationPage />
                    </PlanGate>
                  )} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/journals" element={<JournalsPage />} />
                  <Route path="/periods" element={<PeriodManagementPage />} />
                  <Route path="/ai" element={(
                    <PartnerPlanGate featureKey="ai_advisor" capability="ai_insights" featureName="AI Insights">
                      <AiInsightsPage />
                    </PartnerPlanGate>
                  )} />
                  <Route path="/chat" element={<Navigate to="/ai" replace />} />
                  <Route path="/settings" element={<SettingsPage />} />
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
                  <Route path="/settings/repair-coa" element={<RepairCoaPage />} />
                  <Route path="/api-docs" element={<ApiDocumentationPage />} />
                  <Route path="/api-keys" element={<ApiKeysPage />} />
                  <Route path="/zapier" element={<ZapierIntegrationPage />} />

                  {/* Accounting & Organisation */}
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
                  <Route path="/bank-reconcile" element={
                    <PartnerPlanGate featureKey="bank_reconciliation" capability="bank_reconciliation" featureName="Bank Reconciliation">
                      <BankReconciliation businessId={currentBusiness?.business?.id || ''} />
                    </PartnerPlanGate>
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
                  <Route path="/audit" element={
                    <PlanGate capability="accounting_organisation" featureName="Audit Log">
                      <AuditLogPage />
                    </PlanGate>
                  } />
                </Route>
              </Route>
            </Route>

            {/* Fallbacks */}
            <Route path="/" element={<Navigate to={homePath} replace />} />
            <Route path="*" element={<Navigate to={homePath} replace />} />
          </Routes>

          <InstallPrompt />
          <CookieConsentBanner />
        </BrowserRouter>
        </PartnerProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
