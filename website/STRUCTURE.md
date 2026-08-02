# Ledgr Website — Structure Plan

Marketing website for **Ledgr — Business Accounting for Malawi**. This document
lays out the full structure (sitemap, page anatomy, architecture, content
model, design system, SEO, deployment) and is the blueprint for building out
the site. The folder in this document is the implementation skeleton.

---

## 1. Goals

1. **Explain Ledgr** to Malawian SME owners — accounting, invoicing, payroll,
   inventory, all in MWK, working offline.
2. **Convert** — a clear path from landing page → sign up (free tier) → first
   invoice.
3. **Build trust** — MRA-ready compliance (PAYE, VAT, withholding tax), bank
   reconciliation, data safety, Malawian context.
4. **Serve secondary audiences** — banks/MFIs (white-label partners), software
   developers (public API + Zapier), and existing users (help center, pricing,
   blog).
5. **Rank in search** — SEO-friendly static pages, hreflang for EN/NY, sitemap,
   blog content targeting "accounting software Malawi" style queries.
6. **Match the brand** — same emerald/green design tokens, typography and tone
   as the app.

## 2. Decisions (and why)

| Question | Decision | Rationale |
|---|---|---|
| Location | `website/` folder **in this repo** | Versioned with the app (pricing, branding, docs stay in sync); deployable as an independent Vercel project via `rootDirectory`; the app's SPA/PWA/rewrites stay untouched |
| Framework | **Astro 7** + Tailwind CSS 4 | Content site → zero-JS pages, best-in-class SEO, built-in i18n routing for EN + Chichewa, content collections for blog/help, React islands available later (e.g. pricing calculator) |
| Tailwind | v4 via `@tailwindcss/vite` | Same version and `@theme` token syntax as the app — brand tokens are copied verbatim from `src/index.css` |
| Languages | **English + Chichewa** (`en`, `ny`) | Matches the app's i18n; `en` is default locale, both locales prefix URLs (`/en/…`, `/ny/…`) for clean hreflang |
| Content | Per-locale page files + JSON UI-string dictionaries | Page copy lives in the `.astro` files (full control per page); chrome strings (nav, footer, CTAs) live in `src/i18n/{en,ny}.json` |
| Blog/Help | Astro content collections (`src/content/blog`, `src/content/help`) with a `locale` field | Type-safe frontmatter, drafts, RSS generation |
| Output | Static (`astro build`) | Fast, cheap, cacheable; deploys anywhere Vercel/Netlify/nginx |
| Domain | `ledgr.com` (site) with the app at `app.ledgr.com` (cutover step) | The app's `partnerDomain.ts` already reserves `ledgr.com` as platform root and treats subdomains as partner tenants — see §9 for the cutover plan |

## 3. Sitemap & URL map

`prefixDefaultLocale: true` — every page exists under its locale prefix.
Astro auto-redirects `/` → `/en/`.

| Path (per locale) | Page | Priority |
|---|---|---|
| `/` → redirect | — | — |
| `/en/` (`/ny/`) | **Home** | P0 |
| `/en/features/` | **Features** — full module overview | P0 |
| `/en/pricing/` | **Pricing** — 4 tiers, MWK, annual toggle, comparison table | P0 |
| `/en/faq/` | **FAQ** | P1 |
| `/en/help/` | **Help center index** (articles from content collection) | P1 |
| `/en/help/[slug]/` | Help article | P1 |
| `/en/blog/` | **Blog / resource center index** | P1 |
| `/en/blog/[slug]/` | Blog post | P1 |
| `/en/partners/` | **Partners** — white-label for banks & MFIs | P1 |
| `/en/developers/` | **Developers** — API, webhooks, Zapier | P1 |
| `/en/about/` | **About** — mission, story, team | P2 |
| `/en/contact/` | **Contact** — form + channels | P2 |
| `/en/compare/` | **Compare** — Ledgr vs spreadsheets / generic tools | P2 |
| `/en/legal/terms/` | Terms & conditions | P2 |
| `/en/legal/privacy/` | Privacy policy | P2 |
| `/en/legal/cookies/` | Cookie policy | P2 |
| `/en/404/` (+ `/ny/404/`) | Localized 404 | P0 |
| `/sitemap-index.xml`, `/robots.txt`, `/rss.xml` | SEO plumbing (auto-generated) | P0 |

Future (not in v1): `/en/features/accounting/` deep module pages, `/en/case-studies/`,
`/en/security/`, `/en/changelog/`.

## 4. Page anatomy

Shared chrome (from `src/i18n/*.json`, translated per locale):

- **Header** — logo wordmark, nav (Features, Pricing, Partners, Developers, Help, Blog), language switcher, "Sign in" (→ app), "Start free" (→ app register)
- **Footer** — 4 columns (Product / Company / Legal / Contact), brand blurb, language switcher, copyright, PWA note
- **CTA banner** — reusable brand band placed before the footer on marketing pages

### Home (`/en/`)
1. **Hero** — headline ("Accounting that speaks Kwacha"), subhead, dual CTA (Start free / See pricing), product mockup visual, trust bullets (offline-first, MRA-ready, MWK)
2. **Trust bar** — "Built for Malawian SMEs" + placeholder stats/logos
3. **Feature grid** — 8 modules: Accounting · Invoicing · Payroll & Tax · Inventory · Reporting · Offline-first · Multi-user & RBAC · AI Insights
4. **How it works** — 3 steps: create business → record transactions → file & understand reports
5. **Offline/PWA highlight** — "Works when the network doesn't"
6. **Pricing teaser** — 4 compact plan cards → /pricing
7. **Testimonials** — 3 placeholder quotes (to be filled with real customers)
8. **FAQ teaser** — 3–4 items → /faq
9. **CTA banner**

### Features
Hero → module sections (Accounting, Invoicing, Payroll & tax, Inventory,
Reporting, Offline-first, Collaboration & RBAC, Integrations/AI) → comparison
nudge → CTA. Each module section: title, description, 3–4 capability bullets
(sourced from the app's README), icon.

### Pricing
Hero → billing toggle (monthly/annual, 20–25% discount from `plans.ts`) →
4 plan cards (Free MWK 0 / Growth MWK 100,000 / Pro MWK 200,000 ⭐ / Enterprise
MWK 500,000) → feature comparison table → payment note (PayChangu, MWK) →
FAQ → CTA. Data mirrored from `src/lib/billing/plans.ts` into
`src/data/pricing.ts` (single source of truth once the monorepo shares code).

### Partners
Hero → white-label value props (from `WHITE_LABEL_SETUP.md`: your brand, your
domain, your module mix; Ledgr bills the partner) → how it works → module
flags (AI advisor, payroll, inventory, multi-currency, bank reconciliation) →
portal demo → contact CTA.

### Developers
Hero → public JSON:API (`/api/v1`, hashed API keys) → webhooks → Zapier
template → link to in-app API docs & `/api-keys` → CTA.

### Help
Hero → search placeholder → article index (content collection, grouped) →
contact escalation (AI support agent, email) → CTA.

### Blog
Hero → post index (cards: title, excerpt, date, tags) → RSS link. Posts target
Malawi-specific topics (PAYE bands, VAT, MRA filings, SME bookkeeping tips).

### Legal, About, Contact, FAQ, Compare
Standard single-page layouts per their purpose; contact form posts to a
form backend (Formspree placeholder; TODO decide provider).

## 5. Repository structure

```
website/
├── STRUCTURE.md               ← this document
├── README.md                  ← quickstart + deploy notes
├── package.json               ← independent npm package (no workspaces)
├── astro.config.mjs           ← i18n, tailwind plugin, sitemap, site URL
├── tsconfig.json              ← astro/tsconfigs/strict
├── .gitignore
├── public/
│   ├── favicon.svg            ← copied from app (emerald “L” mark)
│   └── robots.txt
└── src/
    ├── styles/
    │   └── global.css         ← brand tokens copied from app src/index.css
    ├── data/
    │   ├── site.ts            ← name, URLs, app URL, emails (single source)
    │   └── pricing.ts         ← mirrors src/lib/billing/plans.ts
    ├── i18n/
    │   ├── en.json            ← chrome strings (nav, footer, CTA, common)
    │   ├── ny.json            ← Chichewa chrome strings
    │   └── index.ts           ← typed dict lookup helper
    ├── layouts/
    │   ├── BaseLayout.astro   ← <head>: SEO meta, OG, canonical, hreflang
    │   ├── SiteLayout.astro   ← BaseLayout + Header + main + Footer
    │   └── ArticleLayout.astro← SiteLayout + article chrome (blog/help)
    ├── components/
    │   ├── Header.astro       ← sticky nav + LanguageSwitcher + CTAs
    │   ├── Footer.astro
    │   ├── LanguageSwitcher.astro
    │   ├── CtaBanner.astro
    │   ├── SectionHeading.astro
    │   ├── FeatureCard.astro
    │   ├── PricingCard.astro
    │   ├── TestimonialCard.astro
    │   ├── FaqItem.astro
    │   └── home/              ← home-only sections (Hero, TrustBar, …)
    ├── content/
    │   ├── blog/en/           ← Markdown posts (en)
    │   ├── blog/ny/           ← translated posts (ny)
    │   ├── help/en/           ← help articles (en)
    │   └── help/ny/           ← help articles (ny)
    ├── content.config.ts      ← content collections (glob loader + schema)
    └── pages/
        ├── index.astro        ← redirect → /en/
        ├── en/                ← English pages (see sitemap)
        │   ├── index.astro  features.astro  pricing.astro  faq.astro
        │   ├── help.astro  help/[slug].astro  blog.astro  blog/[slug].astro
        │   ├── partners.astro  developers.astro  about.astro  contact.astro
        │   ├── compare.astro  legal/{terms,privacy,cookies}.astro  404.astro
        │   └── rss.xml.ts
        └── ny/                ← Chichewa mirrors (same tree)
```

**Conventions**
- One locale file tree per language; page bodies are hand-written per locale.
- Chrome strings never hard-coded in components — always via `t(locale, …)`.
- All links built with `getRelativeLocaleUrl(locale, path)` so switching
  locales never breaks URLs.
- Images: `public/` or `src/assets/` (Astro-optimized); no external image CDNs.

## 6. Content model

```ts
// src/content.config.ts
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(), description: z.string(),
    pubDate: z.coerce.date(), locale: z.enum(['en', 'ny']),
    tags: z.array(z.string()).default([]), draft: z.boolean().default(false),
  }),
});
const help = defineCollection({ /* same shape + `category` field */ });
```

- Blog/help posts live under locale folders; pages filter by
  `Astro.currentLocale`.
- Drafts hidden from indexes; `rss.xml` generated from published posts.
- Translation workflow: translate a post → set `locale: 'ny'` → it appears
  under `/ny/blog/…` automatically.

## 7. Design system

Everything reuses the app's tokens (copied into `src/styles/global.css`):

- **Brand green** scale `brand-50…950` (`#0E7C5A` = brand-500, AA on white)
- **Navy** text `#0F172A`, slate `#475569`, canvas `#F8FAFC`, white cards
- **Fonts**: system stack (matches app; swap to a bundled variable font later
  if desired — no external font CDN, consistent with the app's offline ethos)
- **Icons**: inline SVG (lucide-style strokes) — no icon dependency needed
- **Accessibility**: focus-visible rings (brand-600), AA contrast, reduced
  motion, skip link, semantic landmarks, localized `lang` attributes

## 8. SEO & analytics

- Per-page `title`/`description`, canonical URL, OG + Twitter tags in
  `BaseLayout` (hreflang alternates for `en`/`ny`)
- `@astrojs/sitemap` → sitemap with locale alternates; `robots.txt`
- Blog targeting Malawi accounting keywords; localized slugs later if needed
- Analytics: decide Vercel Analytics vs. a privacy-friendly option (TODO —
  app already uses Vercel Analytics/Speed Insights)

## 9. Deployment & domain cutover

1. **Now**: new Vercel project, `rootDirectory: website`, framework preset
   Astro → preview URL; site builds from `website/` only; app deploy untouched.
2. **Cutover**: move the app to `app.ledgr.com` (update the app's Vercel
   project domain + `VITE_PLATFORM_ROOT_DOMAIN` stays `ledgr.com`; verify
   partner-domain resolution in `partnerDomain.ts` still works — it treats
   `app.ledgr.com` as a partner subdomain today, so this needs a code tweak:
   add `app.` to the platform-root set). Marketing site takes `ledgr.com`.
3. CI: add a GitHub Actions job (`.github/workflows/website.yml`) that runs
   `npm install && npm run build` in `website/` on PRs — safe to add later;
   it doesn't touch the app pipeline.

## 10. Build order (milestones)

**Status: M1–M3 scaffolded, M4 (home) done, M5 partial — updated 2026-08-02**

1. ✅ Skeleton — config, layouts, components, all routes with placeholder
   sections, EN home page shell, sample content, builds green
2. ✅ **M1 — Core pages**: Home (hero mockup + who-it's-for + all sections),
   Features (anchors + Excel-comparison nudge), Pricing (real plan data +
   monthly/annual toggle with localStorage), FAQ, legal pages (EN) + NY
   chrome
3. ✅ **M2 — Content systems**: blog with 4 EN seed posts + NY stubs, help
   center with 4 EN articles + NY stubs, RSS
4. ✅ **M3 — Secondary pages**: Partners, Developers, About, Contact, Compare
5. 🟡 **M4 — Chichewa**: home page fully translated; other pages have
   translated chrome + body TODO flags (translate `src/pages/ny/*` bodies)
6. 🟡 **M5 — Polish**: OG image done; remaining: real screenshots,
   testimonials, analytics, CI job (added: `.github/workflows/website.yml`),
   domain cutover

**Remaining before launch** (from §11): app domain confirmation, contact
emails, testimonials, legal copy review, NY body-copy translations, real
product screenshots.

## 11. Open questions (need answers from the team)

- App domain for CTA links (`app.ledgr.com` assumption in `src/data/site.ts`)
- Support/contact email addresses and phone/WhatsApp channel
- Real testimonial quotes + customer logos (placeholders now)
- Product screenshots/mockups for hero and feature sections
- Analytics provider choice for the marketing site
- Contact form backend (Formspree/Web3Forms/self-hosted endpoint)
