import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// Site URL placeholder — must match the production domain of the marketing
// site (ledgr.com after the domain cutover, see STRUCTURE.md §9).
const SITE_URL = 'https://ledgr.com';

// When deploying a preview under a sub-path (e.g. GitHub Pages at
// https://<org>.github.io/Ledgr-react/), set ASTRO_BASE=/Ledgr-react.
// Production (custom domain) leaves it unset.
const base = process.env.ASTRO_BASE ?? undefined;

export default defineConfig({
  site: SITE_URL,
  base,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // Sitemap integration picks up the i18n config and emits hreflang
      // alternates automatically. Localized slugs can be mapped here later.
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', ny: 'ny' },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ny'],
    routing: {
      // /en/… and /ny/… — both locales prefixed for clean hreflang/canonicals.
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true,
    },
  },
});
