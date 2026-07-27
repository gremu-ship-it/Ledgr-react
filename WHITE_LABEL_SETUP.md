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
| `/partner-admin/partners/:id/settings` | branding, domains, onboarding copy, feature flags, client limit, isolation, billing contact |
| `/partner-admin/partners/:id/billing` | partner-level invoices |

Access: platform admins see every partner; partner admins see only the
partners listed for them in `partner_admins`. Client limit and pricing are
editable by platform admins only.

## 7. Onboarding a new partner — checklist

```sql
-- 1. Create the partner in the portal (admin.ledgr.com), then link its staff:
insert into public.partner_admins (partner_id, user_id)
select p.id, u.id
  from public.partners p, auth.users u
 where p.slug = 'nbs' and u.email = 'ops@nbs.mw';
```

2. Point `nbs.ledgr.com` (or the vanity domain) at the deployment.
3. Set branding + onboarding copy under **Branding & features**.
4. Choose the **lite** or **full** module preset.
5. Set the client limit and price per client, then raise the first invoice
   under **Billing**.
