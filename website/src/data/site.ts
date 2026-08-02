/**
 * Single source of truth for site-wide constants.
 * TODO(team): confirm the app URL/emails before launch — see STRUCTURE.md §11.
 */
export const SITE = {
  name: 'Ledgr',
  tagline: 'Business Accounting for Malawi',
  url: 'https://ledgr.com',
  /** Where the actual product lives. The app's partner-domain logic
   *  currently treats any subdomain of ledgr.com as a partner tenant, so the
   *  cutover to app.ledgr.com needs a small code tweak (STRUCTURE.md §9). */
  appUrl: 'https://app.ledgr.com',
  supportEmail: 'support@ledgr.com',
  salesEmail: 'hello@ledgr.com',
  locale: 'en-MW' as const,
  /** Marketing site locales — order matters (matches astro.config.mjs). */
  locales: [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'ny', label: 'Chichewa', nativeLabel: 'Chichewa' },
  ] as const,
} as const;

export type Locale = (typeof SITE.locales)[number]['code'];
