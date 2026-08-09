# White-Label Partner Setup (Banks & MFIs)

Lets a bank or MFI offer Ledgr to its SME clients under its own brand, on its
own domain, with its own module mix — while Ledgr bills the partner, not the
SMEs.

## 1. Database

Migrations:

| File | Contents |
| --- | --- |
| `20260727000002_white_label_partners.sql` | `partners`, `partner_feature_flags`, `partner_clients` |
| `20260727000003_partner_billing.sql` | `partner_invoices` |
| `20260727000004_white_label_partners_hardening.sql` | theming/onboarding/isolation columns, `partner_admins`, RLS, client-limit trigger, `v_partner_client_usage`, default-flag seeding |
| `20260727000005_partner_invoice_dedupe.sql` | one-invoice-per-period unique index + auto invoice numbering |
| `20260727000006_schedule_generate_partner_invoices.sql` | monthly pg_cron billing job |
| `20260727000007_fix_partner_client_rls_recursion.sql` | recursion-safe partner/client and business visibility policies |
| `20260809000000_protect_partner_commercial_fields.sql` | trigger: partner admins can't edit commercial/billing/routing fields |
| `20260809000001_partner_admin_management.sql` | SECURITY DEFINER RPCs to list/add/remove partner staff |
| `20260809000002_clear_partner_admin_access.sql` | SECURITY DEFINER RPC to revoke all of a partner's staff access |

Apply with `supabase db push` (or run the SQL in order against your project).

### Key tables

- **`partners`** — one row per bank/MFI. Branding (`logo_url`,
  `primary_colour`, `app_name`, `support_email`), routing (`slug`,
  `custom_domain`), commercials (`client_limit`, `price_per_client`,
  `billing_email`), onboarding copy (`onboarding_title`,
  `onboarding_subtitle`) and isolation (`allow_client_visibility`, default
  `false`).
- **`partner_feature_flags`** — `(partner_id, feature_key, enabled)` for
  `ai_advisor`, `payroll`, `inventory`, `multi_currency`,
  `bank_reconciliation`. New partners are seeded with all five enabled by a
  trigger; the portal's **lite** preset switches them all off.
- **`partner_clients`** — which businesses belong to which partner. A
  `before insert` trigger rejects the row once `client_limit` is reached.
- **`partner_admins`** — bank/MFI staff who may use the admin portal.
- **`partner_invoices`** — Ledgr → partner invoices.

### Isolation model (RLS)

- Clients are isolated by default. Sibling businesses under the same partner
  only become visible when `partners.allow_client_visibility = true`
  (`businesses_partner_peer_read`).
- Partner admins get an additive **SELECT-only** policy over their clients'
  businesses (`businesses_partner_admin_read`). No insert/update/delete
  policy is ever granted to them, so "view but not edit" is enforced in the
  database, not just the UI.
- `partners` and `partner_feature_flags` are world-readable because the login
  page must theme itself before anyone is signed in. They contain public
  brand material only.
- `partner_invoices` are readable only by that partner's admins; only platform
  admins can create or change them.
- Commercial/billing/routing fields on `partners` (`client_limit`,
  `price_per_client`, `billing_currency`, `billing_email`,
  `billing_contact_name`, `is_active`, `slug`, `custom_domain`) are **platform
  admin only**. A `before update` trigger
  (`20260809000000_protect_partner_commercial_fields.sql`) rejects any
  partner-admin change to them, so a bank can't re-price itself, redirect its
  invoices, deactivate its own tenant, or re-route/hijack a domain by crafting
  an API call. Partner admins can still edit branding, onboarding copy and
  client visibility.

## 2. Domain routing

`src/lib/partnerDomain.ts` resolves the browser host:

| Host | Result |
| --- | --- |
| `ledgr.com`, `www.ledgr.com` | platform — no partner branding |
| `admin.ledgr.com` | partner admin portal |
| `nbs.ledgr.com` | partner with `slug = 'nbs'` |
| `accounting.nbsmw.com` | partner with that `custom_domain` |

Override the root with `VITE_PLATFORM_ROOT_DOMAIN`. Add a wildcard
`*.ledgr.com` domain plus each vanity domain in your host (Vercel), pointed at
the same deployment — `vercel.json` already rewrites everything to
`index.html`.

**Local testing:** append `?partner=nbs` to any URL (it is remembered in
`localStorage`; `?partner=` clears it), or use `nbs.localhost:5173`.
`?partner=admin` simulates the admin portal.

## 3. Theming

`PartnerProvider` (wraps the whole app in `App.tsx`) exposes the tenant via
`usePartner()`. `usePartnerTheme()` applies the partner's primary colour
through the existing `applyBrandColors` scale and swaps the document title and
favicon. Auth pages, the create-business wizard and the app shell all use it;
a business's own brand colour still wins once a business is selected.

The resolved tenant is cached in `localStorage` so branded pages don't flash
Ledgr's default teal on load.

## 4. Feature flags

Two layers, applied in `PartnerPlanGate`:

1. the partner flag — a hard stop with no upsell (the SME buys from the bank);
2. the normal subscription `PlanGate`.

Disabled modules are also removed from the sidebar and mobile nav
(`visibleSectionsFor` in `navConfig.ts`), so a lite MFI offering simply never
shows payroll, inventory or the AI advisor.

## 5. Custom onboarding

`partners.onboarding_title` replaces *"Create your Ledgr account"* with e.g.
*"Create your NBS Business Account"* on `/register`; `onboarding_subtitle`
replaces the strapline. When a business is created on a partner domain it is
automatically linked into `partner_clients` — and the wizard surfaces a clear
error (pointing at the partner's support email) if the partner is at its
client limit.

## 6. Partner admin portal

Served at `admin.ledgr.com`, and also reachable at `/partner-admin` on the main
app. Routes live under `PartnerAdminRoute` + `PartnerAdminLayout`:

| Route | Purpose |
| --- | --- |
| `/partner-admin` | list partners; platform admins can create one (name, logo, colour, domain, client limit, lite/full preset) |
| `/partner-admin/partners/:id` | overview — clients, capacity, enabled modules, isolation state |
| `/partner-admin/partners/:id/clients` | read-only client roster with usage stats |
| `/partner-admin/partners/:id/settings` | branding, domains, onboarding copy, feature flags, client limit, isolation, billing contact, **Team** (partner staff) |
| `/partner-admin/partners/:id/billing` | partner-level invoices |

Access: platform admins see every partner; partner admins see only the
partners listed for them in `partner_admins`. Client limit, pricing, billing
contact, domains and activation are editable by platform admins only (enforced
both in the UI and by a DB trigger).

Partner staff are managed from **Settings → Team** (platform admin only): add a
staff member by email (role `admin` or `viewer`), update their role, or remove
them. This calls `list_partner_admins` / `add_partner_admin` /
`remove_partner_admin` (see `20260809000001_partner_admin_management.sql`),
which resolve the user against `auth.users` server-side and enforce
authorization inside the SECURITY DEFINER functions.

**Deactivate vs. end staff access** (both on the partner overview, Ledgr
admins only):
- **Deactivate / Reactivate** (`partners.is_active`) is a *commercial soft
  stop*: the branded domain stops resolving, new sign-ups stop being linked,
  and monthly billing stops. Existing SME clients keep all their data and
  modules — they are never affected by deactivation.
- **End staff access** (`clear_partner_admins`,
  `20260809000002_clear_partner_admin_access.sql`) removes every
  `partner_admins` membership, revoking bank/MFI staff access to the admin
  portal. Deactivation on its own does **not** revoke portal access (the RLS
  helpers and `getForAdminUser` ignore `is_active`), so ending a relationship
  requires clearing staff access explicitly.

## 7. Onboarding a new partner — checklist

1. Create the partner in the portal (admin.ledgr.com), then add its staff
   under **Settings → Team** (by email; the person must already have a Ledgr
   account). No raw SQL needed — `add_partner_admin` resolves the user for you.
2. Point `nbs.ledgr.com` (or the vanity domain) at the deployment.
3. Set branding + onboarding copy under **Branding & features**.
4. Choose the **lite** or **full** module preset.
5. Set the client limit and price per client, then raise the first invoice
   under **Billing**.

## 8. Automated monthly billing

`supabase/functions/generate-partner-invoices` raises one invoice per active
partner for the month that just closed, following the same shape as
`expire-subscriptions` and `send-renewal-reminders`:

- **Schedule:** 02:00 UTC on the 1st of each month, via `pg_cron` + `pg_net`
  (`20260727000006_schedule_generate_partner_invoices.sql`). This sits clear of
  the 01:00 `expire-subscriptions` job and the 08:00 reminder job.
- **Auth:** the shared `x-cron-secret` header, same as the other cron
  functions — set `CRON_SECRET` with `supabase secrets set`.
- **Amount:** `partners.price_per_client × clients onboarded on or before the
  period end`. Partners with no clients, or with no price set (bespoke or
  zero-rated deals), are skipped rather than sent a zero invoice.
- **Idempotent:** the unique index `partner_invoices_period_key
  (partner_id, period_start)` means a re-run, a double cron fire, or a manual
  raise for the same period is skipped on a `23505` instead of double-billing.
  Voided invoices are excluded from the index, so a mistake can be voided and
  re-raised.
- **Email:** if `SENDGRID_API_KEY` is set, the invoice is emailed to
  `billing_email` (falling back to `support_email`) via SendGrid. **An email
  failure never rolls back the invoice** — the row is the source of truth.
- **Invoice numbers:** assigned by a DB trigger as `PINV-000001`, so they're
  never null and always sequential.

### Deploy

```bash
supabase functions deploy generate-partner-invoices
supabase secrets set CRON_SECRET=...            # if not already set
supabase secrets set SENDGRID_API_KEY=...       # optional, enables emails
supabase secrets set PARTNER_ADMIN_URL=https://admin.ledgr.com
```

Then apply `20260727000006_…`, replacing `<PROJECT_REF>` and `<CRON_SECRET>`
with real values (same placeholder dance as the existing schedule
migrations).

### Manual runs and backfills

```bash
# Preview what would be billed for the last closed month, writing nothing
curl -X POST https://<ref>.supabase.co/functions/v1/generate-partner-invoices \
  -H 'x-cron-secret: <secret>' -H 'content-type: application/json' \
  -d '{"dryRun":true}'

# Backfill a specific month
curl -X POST https://<ref>.supabase.co/functions/v1/generate-partner-invoices \
  -H 'x-cron-secret: <secret>' -H 'content-type: application/json' \
  -d '{"period":"2026-06"}'
```

The portal's **Raise invoice manually** button targets the same period as the
cron, so the two can't produce duplicate invoices — the second attempt shows
"An invoice for last month already exists for this partner."
