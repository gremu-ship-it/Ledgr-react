import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthListener } from '@/hooks/useAuthListener';
import { ProtectedRoute, PublicOnlyRoute } from '@/routes/ProtectedRoute';  // ← your live path
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { InstallPrompt } from '@/offline/InstallPrompt';                     // ← your live path

// Auth pages — kept in your existing flat @/pages/ location
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { CreateBusinessPage } from '@/pages/CreateBusinessPage';             // ← your live page, kept

// App pages — all your live pages preserved exactly
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
import { TaxPage } from '@/pages/TaxPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AiInsightsPage } from '@/pages/AiInsightsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WarehousePage } from './pages/WarehousePage';
import { TransfersPage } from './pages/TransfersPage';
import { BranchesPage } from './pages/BranchesPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  useAuthListener();

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            {/* Public-only — redirect to /dashboard if already authenticated */}
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>

            {/*
              Password reset — outside PublicOnlyRoute intentionally.
              The Supabase PASSWORD_RECOVERY event fires after the user
              clicks the reset link in their email. This needs to be
              accessible whether the user is authenticated or not.
            */}
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/*
              Protected but outside AppLayout — user is authenticated but
              has no business yet, so the normal shell shouldn't render.
            */}
            <Route element={<ProtectedRoute />}>
              <Route path="/create-business" element={<CreateBusinessPage />} />
            </Route>

            {/* Protected — redirect to /login if not authenticated */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/income" element={<IncomePage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/payroll" element={<PayrollPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/tax" element={<TaxPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/ai" element={<AiInsightsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/warehouse" element={<WarehousePage />} />
                <Route path="/transfers" element={<TransfersPage />} />
                <Route path="/branches" element={<BranchesPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              </Route>
            </Route>

            {/* Fallbacks */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          <InstallPrompt />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
