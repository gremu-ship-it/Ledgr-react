# WCAG 2.1 AA Compliance Fix Plan — Ledgr

## Audit summary (BEFORE)
| Category | Count |
|---|---|
| `focus:ring-1` (1px, fails 3px min) | 235 |
| `<input>` with placeholder only / no label | ~30 |
| `<table>` without `scope` attributes | 25+ tables |
| Charts without `role="img"` / `aria-label` | 3+ |
| Missing `aria-current="page"` on NavLink | all sidebar items |
| Missing skip-to-main link | 1 |
| Missing `aria-live` for dynamic content | 1 (toast region) |
| Brand `#0F766E` on white | 4.69:1 (passes AA Large only) |
| Brand `#1D9E75` on white (manifest/meta) | 4.36:1 (FAILS AA) |
| Sidebar `<nav>` missing `role` / `aria-label` | 1 |
| `text-brand-500` on `bg-brand-50` (active nav) | possibly failing AA |
| `text-red-500` on white (error) | 4.83:1 — fails AA Normal |
| `text-emerald-600` on white | 4.55:1 — fails AA Normal |
| `text-yellow-600` on white | 3.53:1 — fails AA |

## Plan
1. **Global focus style** — `:focus-visible` 3px ring in index.css (single-file fix for 235+ instances)
2. **Brand color** — bump DEFAULT_BRAND_COLOR from #0F766E to #0E7C5A (5.32:1) + add WCAG-safe accent token
3. **Skip link** — add `<a href="#main-content">` as first focusable in AppLayout
4. **Sidebar a11y** — add `role="navigation"`, `aria-label`, `aria-current="page"` on active
5. **Notifications** — wire `aria-live` region + keyboard support (Esc, Arrow keys) + `aria-expanded` on bell
6. **Charts** — wrap with `role="img"` + `aria-label` describing data
7. **Tables** — add `scope="col"` on all `<th>`s in core pages
8. **Color contrast** — replace failing text colors with WCAG-safe variants
9. **Forms** — ensure every input has a `<label>` (replace placeholder-only inputs)
10. **Error messages** — confirm error components use icon + text (already done in AuthUI/FormField)
11. **200% zoom** — verify all `min-w-[...]` and `whitespace-nowrap` don't break horizontal scroll
12. **Report** — write `A11Y_REPORT.md` with before/after counts
