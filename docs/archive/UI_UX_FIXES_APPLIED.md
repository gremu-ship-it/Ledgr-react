# Fixes Applied — Desktop / Mobile Review

This doc lists what was changed from the review in `UI_UX_REVIEW.md`.

## P0 — Critical
- [x] **Deduplicated QueryClient**
  - Created `src/lib/queryClient.ts` singleton
  - `main.tsx` imports singleton; `App.tsx` no longer creates its own `QueryClientProvider`
  - Prevents double cache, stale data, double network requests

- [x] **Fixed duplicate routes in App.tsx**
  - Removed second ungated block for `/api-docs`, `/api-keys`, `/zapier`
  - Removed un-gated `accounts/assets/capital/tax/reports/journals/periods` from first block
  - Single source of truth: all accounting/organisation routes now gated via `PlanGate accounting_organisation`

- [x] **PWA Manifest orientation**
  - `public/manifest.json`: `portrait-primary` → `any`, removed `display_override: window-controls-overlay`
  - `vite.config.ts`: `orientation: portrait` → `any`, theme_color fixed to `#0E7C5A`, added shortcuts + language
  - Tablets/foldables can now use landscape

- [x] **Vite chunking fix**
  - Replaced experimental `rolldownOptions.advancedChunks` with standard `rollupOptions.output.manualChunks`
  - Build now correctly splits `vendor-react`, `vendor-charts`, `vendor-data`, `vendor-i18n`, `vendor`
  - `chunkSizeWarningLimit: 800`, precache now 88 entries (2.3MB) vs risk of >2MB single chunk

- [x] **Removed dead App.css**
  - Deleted `src/App.css` (Vite template leftovers)

## P1 — Mobile
- [x] **BottomNav safe-area + touch targets**
  - Now `bottom-[max(0.75rem,env(safe-area-inset-bottom))]` and `pb-[env(safe-area-inset-bottom)]`
  - Unified backdrop closing both FAB and More, Escape key handler
  - Dynamic balanced split: `leftItems = slice(0, ceil(n/2))` fixes off-center when inventory disabled
  - Touch targets: `min-h-[48px] min-w-[48px]`, `touch-manipulation`, haptics via `navigator.vibrate`
  - FAB action buttons `min-h-[48px]` active:scale
  - More grid items `min-h-[84px]` for easier tap, active state ring

- [x] **BottomSheet safe-area, drag-to-dismiss, iOS scroll lock**
  - New `useLockBodyScroll` using `position:fixed + scrollY` for iOS
  - Drag gesture: touchstart/move/end, threshold 100px closes
  - Layout: `inset-x-0 bottom-0 rounded-t-[2rem]` with `paddingBottom: env(safe-area-inset-bottom)`
  - Focus trap: autofocus close button, Escape closes
  - Improved accessibility `role="dialog" aria-modal`

- [x] **MobileDashboard performance + UX**
  - Removed 3 `fixed` blur divs (`blur-[120px]`) causing paint on Tecno/Infinix → replaced with CSS radial gradients via `bg-[radial-gradient(...)]`
  - Safe-area pb: `pb-[calc(6rem+env(safe-area-inset-bottom))]`
  - Header: `Smartphone` icon → `Settings`, correct aria-label
  - Hero card: `rounded-[2.5rem]` → `rounded-[1.75rem]`, added sign (`+`/`-`) instead of abs only, fixed copy `MK 500K` hiding negative
  - Stat cards: `rounded-3xl` → `rounded-2xl`, gap 4→3, touch-manipulation, larger tap area
  - QuickActions grid: `grid-cols-4 gap-4` → `gap-2`, `min-h-[72px]`, labels `text-[10px] uppercase`
  - Icons badge tone consistent, inventory card simplified
  - Chart dot size: `r:4` → `r:5` compact, `activeDot r:7` for touch

- [x] **MwkNumberPad haptics + validation**
  - Haptic feedback `vibrate(5)` per key
  - Leading zero logic fix (`. → 0.`), maxAmount guard (default 999M)
  - Fixed height `min-h-[56px]`, max reached indicator
  - Better accessibility aria-labels

## P1 — Desktop
- [x] **Sidebar**
  - Added tooltip for collapsed rail: absolute left 100%+8px, hidden until `group-hover` / `focus-within`, correct dark bg
  - Support section visually separated: `mt-8 pt-6 border-t`
  - Touch targets larger `py-2.5`, `rounded-xl`, `touch-manipulation`
  - Close button aria-label, backdrop blur
  - Plan lock opacity improved

- [x] **navConfig reordering**
  - New order: Overview → Finance → Inventory → Accounting → Organisation → AI → Support
  - Icon fix: `BankReconciliation` now `Building2` instead of duplicate `Landmark`
  - Support at bottom as expected

- [x] **AppLayout safe-area**
  - `pb-32 lg:pb-6` → `pb-[calc(7rem+env(safe-area-inset-bottom))]` on mobile, `pb-6` desktop
  - OfflineBanner sticky preserved

- [x] **Header click outside**
  - `mousedown` → `pointerdown` for touch devices + mouse

- [x] **useIsMobile SSR-safe**
  - Guard `window` undefined, resync on mount

- [x] **Dashboard KpiCard**
  - Removed `truncate` hiding large MWK values
  - Now clickable to copy full amount (clipboard), shows Copied! feedback
  - Leading-tight, better responsive clamp

- [x] **IncomeExpenseChart**
  - Dot radius bigger on compact mobile (5 vs 4), activeDot 7 for easier touch

- [x] **OfflineBanner contrast**
  - `bg-amber-500` → `bg-amber-600`, `bg-red-500` → `bg-red-600` to pass AA on white

## Build Verified
- `tsc -b` exit 0 (no errors)
- `vite build` success, precache 88 entries 2325 KiB

## Remaining Recommended (not yet done)
- Command+K palette, bulk invoice actions, resizable sidebar, vaul drawer, swipe gestures, skeleton loaders for Settings/Branches
- Consolidate `formatMwk` duplicated in 6 pages → central import (low risk, but many files)
- RecentTransactions sticky header `thead sticky top-0`
- Add `prefers-reduced-motion` already present but test on device

All changes on branch `arena/019fbc75-ledgr-react`, ready to push and PR.
