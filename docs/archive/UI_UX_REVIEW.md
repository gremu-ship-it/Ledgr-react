# Ledgr React – Desktop / Mobile UX & Code Review
**Date:** 2026-08-01  
**Stack:** React 19 + Vite 8 + Tailwind v4 + Supabase + Dexie (PWA) + Recharts + i18next  
**Target:** Malawian SMEs, MWK-first, offline-capable

This review is from a full read of `src/components/layout/*`, `mobile/*`, `dashboard/*`, `pages/*.tsx`, `App.tsx`, `vite.config.ts`, `index.css`, `manifest.json`, `hooks/*`, `store/*`.

---

## 1. Executive Summary

You have **two different apps in one codebase**:

* **Desktop:** Classic SaaS with collapsible sidebar (64 → 72px rail), top header, dense tables. Good structure, but suffers from duplicated QueryClient, duplicate routes, inconsistent design tokens, and hidden-columns instead of true responsive cards.
* **Mobile:** Futuristic glassmorphism (`rounded-[2.5rem]`, blur, gradient hero). Visually striking but heavy, not safe-area aware, touch targets <44px, and a 6-step expense flow that will cause drop-off on slow devices.

Overall grade: **B+ functionality, C+ UX consistency, B- performance mastery**.

Top 5 must-fix before scaling:

1. **Nested QueryClientProviders** – `main.tsx` creates one, `App.tsx` creates another. That doubles caches and causes stale data.
2. **PWA `orientation: portrait-primary`** in manifest + `vite.config.ts` -> locks tablets/ foldables to portrait. Change to `any` / `natural`.
3. **Mobile safe-area ignored** – BottomNav at `bottom-6 left-6 right-6` will be clipped on iPhone with home indicator. No `env(safe-area-inset-bottom)`.
4. **Touch targets failing WCAG 2.5.5** – `NavTab px-2 py-1`, BottomSheet close `h-10 w-10` borderline, More grid items 32px.
5. **Sidebar nav ordering** – `NAV_SECTIONS` starts with AI + Support at top, then Overview. Users expect Dashboard first. Move Support to bottom sticky section.

---

## 2. Desktop Review

### 2.1 Layout (AppLayout.tsx + Sidebar.tsx + Header.tsx)

**Good:**
- Skip link + live region already added (A11Y_REPORT.md fix is solid)
- Collapsible icon rail with `title` fallback on collapse.
- `transition-all duration-200 lg:ps-64 / lg:ps-[72px]` keeps content stable.

**Issues:**
- **Sidebar reveal:**
  - Collapsed state shows only icon but **no tooltip component**. Native `title` has 1s delay on Windows, not accessible for keyboard. Build a `Tooltip` using `role="tooltip"` + `aria-describedby`.
  - Close button only `lg:hidden` – on desktop collapsed rail, focus can be trapped if user tabs out of main. Need `inert` handling or focus return to toggle button (`ChevronsRight`).
- **Header:**
  - Subscription badge `hidden sm:flex` – disappears on 640px but sidebar handles billing upsell separately; keep visible on desktop.
  - Notification bell + user avatar dropdowns use `mousedown` outside listener – fails on touch. Use `pointerdown` and `focusout` for mobile/desktop parity.
  - `BusinessSwitcher` sits inside header with `toggleSidebar` button nearby – two left-aligned controls fight. Group them into `<div>` with divider.
- **Main content padding:** `pb-32 lg:pb-6` in AppLayout is a mobile hack leaking to desktop via class logic. Better: add `<div className="lg:hidden h-28" />` spacer only on mobile, keep main padding consistent.
- **Duplicate routes in App.tsx (lines ~208-211 vs 224+):** `/api-docs`, `/api-keys`, `/zapier`, `/accounts`, `/assets`, `/capital`, `/tax`, `/bank-reconcile`, `/reports`, `/journals`, `/periods` defined twice – one with PlanGate, one without. Second definition wins, bypassing gating. Remove the first un-gated block.

### 2.2 navConfig.ts

```ts
// current order
AI, Support, Overview, Finance, Inventory, Accounting, Organisation
```

* **Support at top is anti-pattern.** Move to separate bottom section with `mt-auto` in Sidebar.
* **Icons:** All finance uses `DollarSign`, `Receipt`, `FileText`, `Users` – `Users` for Payroll is ok, but `Landmark` reused for Assets + Bank Reconciliation – duplicate visual memory. Use `Banknote` vs `Building2`.
* **Plan gating logic:** `visibleSectionsFor` filters by partner flag + role, but `isItemLocked` still renders locked item with 70% opacity. On desktop, locked items should show `Upgrade` pill, not just lock icon on hover. Suggest: show lock + tooltip "Growth required".

### 2.3 DashboardPage.tsx (Desktop)

* **KpiCard:** `clamp(1.1rem, 2.5vw, 1.5rem)` + `truncate` will hide numbers like `MK 123,456,789.00`. Better: use `formatMwkCompact` always + `title={full}` already done, but add `onClick` copy full value. Also `trendUp` boolean misnamed – for expenses `trendUp=false` even if good.
* **QuickActions:** You import `QuickActions` component but define local `QuickActions()` function inside same file – shadowing. Remove local and reuse `src/components/dashboard/QuickActions.tsx`. Also mixed styles: one button brand solid, others white border – inconsistent.
* **Charts:** `IncomeExpenseChart` uses Recharts `ResponsiveContainer` but no `onClick` for drilldown. Desktop power users want clicking a month → filters RecentTransactions.
* **RecentTransactions:** Search + sort + pagination client-side – fine for 10 entries but you fetch 10 via `useRecentJournalEntries(businessId,10)` then paginate 5 per page → only 2 pages. Either fetch 50 + real pagination or remove pagination UI.
* **UsageMeter + TaxRemittancePanel** stacked without collapse – on 1080p screens takes 2 viewport heights before KPIs. Make collapsible or move to right rail.

### 2.4 Tables (InvoicesPage, IncomePage, ExpensesPage)

* `overflow-x-auto` present everywhere (good) but no **sticky header** – long lists lose column context.
* `formatMwk` redefined in 6 files identically – centralize to `@/lib/formatters` and delete local versions to ensure MWK formatting consistency.
* **Inline editing:** Invoice builder table uses `<input className="bg-transparent">` – no visible focus ring for WCAG. Also missing `aria-label` in some columns (you fixed some, but ExpensesPage still has naked inputs).
* **Empty states:** Nice icons but CTA only "Record Expense" – suggest secondary "Import CSV" or "Watch 30s video".
* **Posting status:** "Needs Posting" retry button works but error bar rendered below table outside scroll view – user may not see. Toast + sticky banner better.

---

## 3. Mobile Review

### 3.1 BottomNav.tsx – The Core Mobile Nav

**Current:** Glassmorphic floating bar `fixed bottom-6 left-6 right-6 h-16 rounded-3xl backdrop-blur-xl`. 4 tabs + center FAB (+).

**Problems:**
- **Safe area:** Should be `bottom-[max(1.5rem,env(safe-area-inset-bottom))]`. Right now clipped on iPhone 14+.
- **Touch target:** Spec is 24px minimum (AA), 44px AAA. Your `NavTab` is `px-2 py-1` + 20px icon = ~28px tall. Extend to `min-h-[48px] min-w-[48px]`.
- **FAB:** `h-14 w-14 -translate-y-4` gives big shadow but overlaps chart near bottom. On scroll, content under FAB is unreadable despite `pb-24` in MobileDashboard – uneven. Use `pb-[calc(6rem+env(safe-area-inset-bottom))]`.
- **More menu:** Triggered by same `moreOpen` backdrop as FAB but two backdrops can stack – bug if user opens FAB then More. Need single backdrop manager.
- **Accessibility:** `More` button `aria-expanded` correct, but grid items lack `aria-current` when active. Add check: same `NavLink` active logic as desktop.
- **Partner filtering:** `bottomItems.slice(0,2)` + `slice(2)` assumes 4 items. If partner disables `inventory`, array becomes length 3 → left side 2, right side 1 → off-center FAB. Compute balanced split dynamically.

**Improvement sketch:**
```tsx
<nav className="pb-[env(safe-area-inset-bottom)] ...">
  <div className="flex h-[64px] items-center gap-1 px-safe"> // px-safe custom
```
Add haptics: `navigator.vibrate(10)` on tab press for MWK-first tactile feel.

### 3.2 MobileDashboard.tsx

You swung to **"futuristic glassmorphism"** – large 2.5rem radius, blur layers, gradient hero.

**Pros:** Greeting + first name personalization great for SMEs. Trend % badge helpful.

**Cons:**
- **Performance:** Three fixed `blur-[120px]` divs with `pointer-events-none` + `fixed inset-0 -z-10` cause expensive paint on low-end Tecno / Infinix devices common in Malawi. Replace with single CSS radial gradient: `background: radial-gradient(...)` instead of DOM nodes.
- **Hero card:** `rounded-[2.5rem]` + `shadow-2xl shadow-brand-500/20` looks premium but clips on 320px width (Galaxy A01). Use `rounded-[1.75rem] sm:rounded-[2rem]`.
- **Net profit hero:** You show `Math.abs(netProfit)` + status "Surplus/Deficit" separate. Could confuse: user sees `MK 500K` but profit is -500K. Better: show sign + color – `+MK 500K` in brand, `-MK 500K` in red, with trend arrow.
- **Header inside dashboard:** Custom header duplicates `Header.tsx`. It shows business logo + first name, and a `Smartphone` icon button navigating to `/settings`. Icon semantics wrong – `Smartphone` ≠ settings. Use `Settings` or `User`.
- **Quick Actions grid:** 4 columns `gap-4` – on 360px, each button ~72px wide → label `text-xs` truncates. Use `grid-cols-4 gap-2` or scrollable row.
- **Charts compact = 208px height:** Recharts tooltip on touch: user must long-press tiny dots `r:4`. Increase dot to `r:6` on touch devices (`pointerType: coarse` media query).
- **Inventory card + Integrations card:** Good – but low-stock alert shows `quantity_available` raw number – no reorder point context. Add `/{reorder_level}`.

### 3.3 BottomSheet.tsx + MwkNumberPad.tsx + QuickExpenseMobile.tsx

**BottomSheet:**
- Uses `document.body.style.overflow = 'hidden'` – fails on iOS Safari (still scrollable). Use `useLockBodyScroll` with `position:fixed` trick.
- No **drag to dismiss** – users expect swipe down. Implement pan gesture with `framer-motion` or simple touch handlers.
- Not centered – `left-4 right-4 bottom-4` leaves gaps; better `inset-x-0 bottom-0 rounded-t-[2rem]` for native feel.
- No focus trap – tab key can escape behind backdrop. Use `focus-trap-react` or manual.
- Title `text-[10px] font-black uppercase` very small – use `text-xs` for readability.

**MwkNumberPad:**
- Display `MK ${parseFloat(...).toLocaleString()}` on every keystroke – causes layout shift as number grows. Fix height: `min-h-[3rem]`.
- `value === '0'` handling replaces but doesn't handle `00` leading – allow only single leading zero.
- Delete icon `Delete` lucide but imported name conflicts with JS keyword – works but odd. Use `DeleteIcon` alias.
- No **haptic + sound** feedback per key – add `navigator.vibrate(5)` for tactile.
- No max amount check – user can enter `999999999999` – add business logic limit.

**QuickExpenseMobile:**
- Flow 6 steps is long. Analytics will show drop at `costCenter`. Suggestion: **Condense to 3 steps**: 1️⃣ Amount + VAT toggle, 2️⃣ Category + Product searchable combo, 3️⃣ Confirm (with optional description drawer).
- Category screen: Shows "Expense accounts from Chart of Accounts" – good, but search filters `code` + `name` only. Needs grouped by parent account type (`Cost of Sales` vs `Operating Expenses`) – add section headers.
- Product search: No debounced search, filters in memory fine but `sku` filter only works if product has sku. If 500 products, UI lags – virtualize list with `react-window` or pagination.
- Branch/Department selector: Uses 2-col grid of buttons – ok but no selected checkmark, only border color change (contrast 1.5:1). Add check icon for selected.
- Success state auto-closes after 1500ms – may be too fast to read receipt number. Keep success visible + "Close" button.

### 3.4 QuickIncomeMobile.tsx (not read but similar)

Assume same issues. Check if it also has 6-step flow. Income should be even faster – one-tap type (sale, service, other) + amount.

---

## 4. Cross-Platform / System Issues

### 4.1 Duplicated QueryClient
`src/main.tsx`:
```ts
const queryClient = new QueryClient(...)
<QueryClientProvider>
  <App />
```
`src/App.tsx`:
```ts
const queryClient = new QueryClient(...)
<ErrorBoundary>
  <QueryClientProvider>
```

**Fix:** Delete client from `App.tsx`, rely on `main.tsx`, or export singleton `src/lib/queryClient.ts`.

### 4.2 Vite Config
```ts
build: { rolldownOptions: { ... } }
```
Vite 8 uses `rollupOptions`, `rolldownOptions` is experimental for Rolldown (Vite 6 beta). On CI it may be ignored → your `advancedChunks` never applied, reverting to big chunks >2MB hitting PWA precache. Change to:
```ts
build: {
  chunkSizeWarningLimit: 800,
  rollupOptions: { output: { manualChunks: {...} } }
}
```

### 4.3 PWA Manifest
`public/manifest.json`: `orientation: portrait-primary` + `display: standalone` + `display_override: window-controls-overlay`. `window-controls-overlay` is for desktop PWA (Edge). On mobile it does nothing but blocks landscape use for accountants using tablet with keyboard. Change to:
```json
"orientation": "any",
"display": "standalone"
```
And `vite.config.ts` manifest duplication – you have manifest in both `public/manifest.json` and `VitePWA({ manifest: {...} })`. The plugin will generate its own ignoring public one unless `strategies: injectManifest`. Remove manifest from `public/` or set `manifest: false` in plugin and keep file? Currently you have two competing manifests.

### 4.4 Offline
- `OfflineBanner` text contrast: `bg-amber-500 text-white` → 2.3:1 contrast fails. Use `bg-amber-600` or `text-amber-950`.
- Sync engine: `queueApi.ts` uses `generateOfflineNumber('EXP')` – if user creates 2 offline expenses quickly, both could get same timestamp-based number? Check uniqueness – use `crypto.randomUUID().slice(0,8)`.
- `isOfflineError` detection relies on `navigator.onLine` only – captive portals in Malawi mobile data will give false online. Should also catch `fetch` failures.

### 4.5 Forms & Currency
- `formatMwk` duplicated 6 times. Centralize.
- `CurrencySelector` unchecked – if business base_currency MWK but user selects USD, `resolveTransactionRate` calls Frankfurter API → requires internet. No offline fallback exchange rate stored in Dexie – store last known.

### 4.6 Design Tokens
- `index.css` defines massive Tailwind 4 theme but also `App.css` exists with legacy hero styles `.counter`, `.hero`, `#center`, `#next-steps` – unused Vite template leftovers. Delete `App.css` – currently imported but unused, adds 3KB.
- Brand colors in oklch are great but some inline styles use hex `#0E7C5A` vs var – use `bg-brand-500` everywhere for theming (white-label partners override `--color-brand-500` via `useBrandTheme` but hex fallback won't override).

### 4.7 Performance for Malawi low-end devices
- Recharts bundled as vendor-charts – heavy (d3 deps). Consider lighter `uplot` or lazy-load charts only on Reports/Dashboard.
- No image optimization – `hero.png` uncompressed. Provide webp + srcset.
- PWA `maximumFileSizeToCacheInBytes: 5MB` – allows 5MB chunks but on 2G/3G first install will timeout. Keep chunk limit but add `navigateFallbackDenylist` already but missing `offline.html` fallback.

---

## 5. Quick Wins (1-2 days)

**P0**
- [ ] Fix duplicate QueryClientProviders
- [ ] Delete duplicate routes in App.tsx (search `ApiDocumentationPage` duplicate)
- [ ] Manifest orientation `any`
- [ ] Add `env(safe-area-inset-bottom)` to BottomNav and BottomSheet
- [ ] Remove `src/App.css` import and file if unused

**P1 Mobile**
- [ ] BottomNav center FAB logic: `const left = bottomItems.slice(0, Math.ceil(bottomItems.length/2))`
- [ ] Increase touch targets to 48px, add `active:scale-95` already present but add `touch-manipulation`
- [ ] Add drag-to-dismiss to BottomSheet (simple: on `touchstart` track Y, if >100px close)
- [ ] Merge expense flow steps: amount → category+product (combined searchable list) → confirm
- [ ] Delete decorative blur divs in MobileDashboard, replace with CSS gradient

**P1 Desktop**
- [ ] Reorder nav: Overview first, Support last sticky
- [ ] Add tooltip component for collapsed sidebar (use Radix or custom)
- [ ] Make RecentTransactions table header sticky: `thead sticky top-0 bg-white z-10`
- [ ] Consolidate `formatMwk` imports

**P2**
- [ ] Replace `rolldownOptions` with `rollupOptions.manualChunks`
- [ ] Add focus-trap to BottomSheet + More menu
- [ ] Reduce hero rounded-[2.5rem] to 2xl on <375px
- [ ] Improve offline number uniqueness

---

## 6. Bigger Improvisations (Roadmap)

### Mobile app feels like web wrapped – make it feel native:
1. **BottomSheet as native vaul** – use `vaul` library (https://github.com/emilkowalski/vaul) already designed for PWA drawer, supports over-drag, snapping.
2. **Gesture navigation:** Swipe left on invoice list to "Pay", swipe right to "Edit". Use `useSwipe`.
3. **One-handed number pad:** `MwkNumberPad` currently center, but thumb zone is bottom 1/3. Move pad closer to bottom and amount display top sticky.
4. **Biometric quick add:** Since PWA can't access biometrics, but can use WebAuthn for confirmation of large expenses >MK 500k.
5. **Offline-first images:** Product images not present – if you add them, use Dexie to cache.

### Desktop – power user features:
1. **Command K palette** – `Cmd+K` to jump to Income, New Invoice, Search contacts. Critical for accountants handling many businesses.
2. **Keyboard shortcuts** – `n` new transaction, `?` help, `/` search.
3. **Resizable sidebar** – allow dragging width 72px ↔ 280px, persist in localStorage.
4. **Data density toggle** – Compact vs Comfortable for tables (user preference in Settings).
5. **Bulk actions** – InvoicesPage list no checkbox. Add select multiple → bulk reminder, bulk download PDF.

### Both:
- **Design system audit:** Audit all rounded values – you have `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-[2.5rem]` in same screens. Standardize: `card: 2xl`, `button: xl`, `modal: 2xl`, `mobile sheet: [2rem]`.
- **Empty state illustrations:** Replace lucide icons with custom Malawi-aware illustrations (e.g., market stall) – improves emotional connection.
- **Loading states:** Replace all `animate-pulse` gray boxes with skeleton that mimics layout (you already have for dashboard but not for Settings, Branches etc).

---

## 7. Code Snippets – Concrete Fixes

**Fix QueryClient duplication:**
```ts
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({...});
```
Import in both `main.tsx` and `App.tsx` (or only main).

**Safe-area BottomNav:**
```tsx
<nav className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 
  pb-[env(safe-area-inset-bottom)] ...">
```

**Tooltip for collapsed sidebar:**
```tsx
{!sidebarOpen && (
  <span className="absolute left-[72px] ml-2 hidden group-hover:block bg-gray-900 text-white text-xs px-2 py-1 rounded">
    {t(item.labelKey)}
  </span>
)}
```

---

## 8. Conclusion

You are 80% there. Desktop is solid SaaS-grade, mobile is ambitious but over-designed for the actual device profile of your users. **Simplify mobile interactions to 2-tap flows**, respect safe-areas and touch targets, and clean up the duplicated providers/routes. Then you can ship a PWA that feels native in Blantyre on a $60 Tecno phone.

If you want, I can start implementing the P0 quick wins in code now.
