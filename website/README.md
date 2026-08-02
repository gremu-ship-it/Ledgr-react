# Ledgr Website

Marketing website for **Ledgr — Business Accounting for Malawi**.
Full structure plan: [`STRUCTURE.md`](./STRUCTURE.md).

## Stack

- **Astro 7** (static output) + **Tailwind CSS 4** (`@tailwindcss/vite`)
- **EN + Chichewa** i18n via Astro's built-in routing (`/en/…`, `/ny/…`)
- Content collections for blog + help center; RSS + sitemap auto-generated

## Quickstart

```bash
cd website
npm install
npm run dev        # http://localhost:4321 (redirects / → /en/)
npm run build      # static site → dist/
npm run preview    # serve the production build
```

## Project layout

```
src/
├── styles/global.css    # brand tokens (mirrors the app's src/index.css)
├── data/                # site constants + pricing (mirrors app plans.ts)
├── i18n/{en,ny}.json    # chrome strings (nav, footer, CTA, common)
├── layouts/             # BaseLayout (SEO) / SiteLayout / ArticleLayout
├── components/          # Header, Footer, LanguageSwitcher, cards…
├── content/             # blog + help collections (per-locale folders)
└── pages/{en,ny}/…      # one file tree per locale
```

## Conventions

- **Never hard-code chrome strings** in components — use `t(locale, 'nav.features')`
  from `src/i18n`.
- **Never hard-code links** — use `getRelativeLocaleUrl(locale, path)`.
- **New pages**: create the `.astro` file under `src/pages/en/`, then mirror it
  under `src/pages/ny/` with `locale = 'ny'` and a translated body.
- **New blog/help articles**: Markdown under `src/content/<col>/<locale>/` with
  the `locale` frontmatter field; indexes pick them up automatically.
- Keep `src/data/pricing.ts` in sync with the app's `src/lib/billing/plans.ts`.

## Deployment

Static site — deploy `dist/` anywhere. On Vercel: new project with
`rootDirectory: website` (framework preset: Astro). See `STRUCTURE.md` §9 for
the domain cutover plan (`ledgr.com` for the site, `app.ledgr.com` for the app).
