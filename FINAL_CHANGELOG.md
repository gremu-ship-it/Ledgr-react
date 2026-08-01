# Final Changelog – Desktop/Mobile UX Overhaul
Branch: `arena/019fbc75-ledgr-react`
Date: 2026-08-01

This document summarizes all improvements applied across 7 commits from initial review to finalization.

## Tier 1 – Critical Fixes
- Singleton QueryClient (`src/lib/queryClient.ts`) – removed duplicate providers in main.tsx/App.tsx
- Unified routes in App.tsx – removed duplicate un-gated accounting routes, single source of truth with PlanGate
- PWA manifest orientation `portrait-primary` → `any`, theme_color `#0E7C5A`, added shortcuts, removed `window-controls-overlay`
- Vite chunking: `rolldownOptions.advancedChunks` → `rollupOptions.manualChunks` (react, charts, data, i18n, vendor), precache 88 entries 2.3MB
- Deleted dead `src/App.css`
- OfflineBanner contrast fix `amber-500→600`, `red-500→600`
- `generateOfflineNumber` now `crypto.randomUUID()` + base36 timestamp

## Tier 2 – Mobile Shell & Desktop Layout
- BottomNav:
  - Safe-area `bottom-[max(0.75rem,env(safe-area-inset-bottom))]` + `pb-[env(safe-area-inset-bottom)]`
  - Dynamic balanced split for FAB centering, unified backdrop, Escape handler
  - 48px min touch targets, `touch-manipulation`, haptics `navigator.vibrate`
  - More menu 84px min height, selected state ring
- BottomSheet:
  - iOS scroll lock via `position:fixed` + scrollY restore
  - Drag-to-dismiss 100px threshold, focus trap, safe-area padding, `role=dialog`
- MobileDashboard:
  - Removed 3× fixed `blur-[120px]` DOM → CSS radial gradients
  - Hero profit now shows sign `+MK/-MK` not abs only, rounded `1.75rem`, safe-area pb
  - Stat cards `rounded-2xl`, quick actions `min-h-[72px]` 4-col gap-2
  - Pull-to-refresh + EmptyState + SwipeableRow on recent entries
  - Chart dots 5px compact, active 7px for touch
- Sidebar:
  - Tooltip for collapsed 72px rail (hover + focus-within)
  - Support separated `mt-8 border-t`, resizable 200-360px drag handle, persisted in localStorage
  - Density-aware padding
- navConfig reordered: Overview → Finance → Inventory → Accounting → Organisation → AI → Support, icon `Building2` for bank-reconcile
- AppLayout: `pb-[calc(7rem+env(safe-area-inset-bottom))]` mobile, dynamic `paddingInlineStart` from sidebarWidth
- Header: `mousedown` → `pointerdown`, useIsMobile SSR-safe
- Dashboard KpiCard: no truncate, tap to copy full amount
- IncomeExpenseChart: compact dots larger
- useIsMobile hook guarded

## Tier 3 – Feature Upgrades
- Command Palette `⌘K/Ctrl+K` + `/` – global, searchable nav + quick actions + business switcher, keyboard nav ↑↓ ⏎ Esc
- Bulk invoice selection – checkboxes, indeterminate header, selected count + total, Clear, EmptyState
- Mobile invoice cards – when `isMobile`, card view with SwipeableRow View/Pay actions, instead of table
- Sticky headers batch-patched across Expenses, Income, Journals, Products, Reports, etc
- Resizable sidebar + density toggle: `useAppStore` now has `sidebarWidth` + `density`, persisted, Appearance tab in Settings (comfortable/compact, width slider, shortcuts)
- Centralized formatters: `formatMwkDetailed` + `formatDateShort` single source, removed 13 duplicate local definitions
- Skeleton components: `Skeleton`, `TableSkeleton`, `CardSkeleton`, `PageSkeleton`
- EmptyState component: variants finance/search/inventory/default with Malawi-aware copy

## Tier 4 – Advanced Mobile UX (continue phase 1)
- Pull-to-refresh hook `usePullToRefresh` + `PullToRefreshIndicator` – used in MobileDashboard, Invoices, Income, Expenses
- SwipeableRow component – left swipe reveals actions, used in recent entries, invoices, expenses, income
- VirtualList component – windowing with overscan, avoids DOM blowup for 500+ products
- QuickExpenseMobile condensed 6 → 3 steps: amount + details (account searchable + product searchable + description + branch/dept) + confirm
- QuickIncomeMobile condensed similarly 6 → 3 steps
- Product list limited to 100 visible + search, 20/30 slice for filtered
- ExpenseList & IncomeList now mobile card view with swipe, pull-to-refresh, density-aware, EmptyState

## Tier 5 – Final Polish (continue finalize phase)
- ProductsPage: mobile card view with swipe Edit/Delete, pull-to-refresh, search, EmptyState `InventoryEmptyState` and `SearchEmptyState`, density-aware th/td classes, limited to 100/200 visible to avoid heavy DOM, shadow-sm rounded-2xl
- IncomePage & ExpensesPage: mobile cards, swipe actions, pull-to-refresh, EmptyState, density
- InvoicesPage: mobile cards with swipe, bulk selection synced, pull-to-refresh, EmptyState
- useDensity hook applied across tables
- All TS errors fixed, build clean

## Build Verification
- `tsc -b` exit 0
- `vite build` 88 precache entries ~2.3MB
- No unused imports, no duplicate formatters

## Remaining Suggestions (if you want to go further)
- Command palette: add recent transactions search, Cmd+P for products
- Data export: add CSV export on pull-to-refresh long press
- Offline queue UI: show pending count in OfflineBanner with tap to view queue
- Coachmark tutorial for FAB on first launch
- Unit tests for new hooks (pull-to-refresh, swipeable, density)

All changes on `arena/019fbc75-ledgr-react`, ready for PR.
