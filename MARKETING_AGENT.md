# Ledgr Marketing Agent

An in-app marketing assistant that helps a Ledgr business do three things:

1. **Sales & recommendations** — analyze the business's own products, stock,
   sales, and customers, and propose promotions, repricing, cross-sells, bundles,
   and audience segments. (Most valuable, lowest friction — see *Feasibility*.)
2. **Web + social research** — surface market trends, competitor activity, and
   content ideas, plus read the business's own page analytics.
3. **Facebook page management** — draft product/marketing posts and (later)
   publish them to the business's Facebook Business Page on a schedule.

It is the marketing sibling of the existing **Support Agent** and **AI Insights**
assistants, and reuses the same architecture: an Anthropic-powered Supabase Edge
Function that is auth-gated, rate-limited, and never exposes its API key to the
browser.

> **Status:** Phases 0–3 are **implemented** — see *Implementation status*
> below each phase. Phase 4 remains planned. The remaining open questions at
> the bottom still need your sign-off before we widen scope; the defaults built
> on are noted there.

---

## Feasibility (set expectations early)

| Capability | Reality | Friction |
|------------|---------|----------|
| Sales & recommendations | **Real & safe.** Uses Ledgr's own data (`products`, `inventory_balances`, `invoices`, `contacts`). | Low. No external APIs. |
| Web search (trends/competitors) | **Real.** Call a search API from inside the edge function. | Cost per query (fraction of a cent); needs a provider key. |
| Social *network* search | **Mostly a mirage.** Facebook deprecated public search; X/Twitter API is expensive and search-restricted; TikTok/LinkedIn research APIs are limited. Realistically you get **insights on the business's own pages** via the Graph API, not open social search. | High / narrow. |
| Facebook publishing | **Real but gated.** Requires a Meta Developer App, Facebook Login (OAuth), App Review (weeks), and stored Page access tokens. | Coding is easy; Meta review is the clock. |

This is why the roadmap below starts **draft-only** for Facebook and treats
recommendations as the first place the agent earns trust.

---

## Autonomy boundary (the key decision)

**Default: autonomous for analysis and drafting; human-approve-first for anything
public.**

- **Autonomous (immediate):** research, recommendations, audience segmentation,
  draft post/message generation, and content ideation. These never leave the app,
  so an off-target suggestion costs nothing.
- **Approve-first (until Phase 4):** any post, message, or DM that goes to a
  public channel. The agent produces a draft; the user reviews and hits
  **Approve/Publish** (or schedules it).
- **Progressively automated (Phase 4):** an approved content library + scheduler
  publishes on a cadence, behind guardrails (brand voice, fact-check against
  product data, rate limits, dry-run mode).

Why not "fully autonomous" on day one: a hallucinated or off-brand post landing
automatically on a real business page is the failure mode to engineer against.
Meta also throttles/bans aggressive or repetitive posting and now requires
labeling AI-generated content. Autonomy is the *destination*, reached by
progressively widening the autopilot — not the starting line.

---

## Architecture

```
Browser (MarketingAssistant page / widget)
   │  supabase.functions.invoke('marketing-agent', { body })   ← attaches user JWT
   ▼
supabase/functions/marketing-agent/index.ts   (Deno edge function)
   │  auth (getUser) + per-user rate limit (public.marketing_agent_usage)
   │  business-scoped data context via service-role client (RLS-enforced)
   ▼
Anthropic Claude (ANTHROPIC_API_KEY secret, forced tool-use for JSON)
   ├── (Phase 2) web search provider call — key stored as secret
   └── (Phase 3) facebook-publish module — Graph API via stored Page token
   ▼
Structured JSON → { content, recommendations[], drafts[], actions[], status }
```

This mirrors `supabase/functions/support-agent/index.ts` and
`supabase/functions/ai-insights/index.ts`: `serve` from `deno.land/std`,
service-role `createClient`, Sentry init, CORS from `_shared/cors.ts`, strict
security headers, `getUser()`-based auth, a per-user rate-limit table, and
Anthropic `/v1/messages` with a forced tool call to guarantee structured JSON.

### Data context builder

The edge function builds a compact, business-scoped summary that grounds the
model in the user's *real* data (no fabricated prices or products). Sources,
read via the existing repositories / service-role client:

- `products` + `product_categories` — name, SKU, category, price
- `inventory_balances` + `inventory_locations` — stock levels, reorder points,
  slow movers (great for "promote what's sitting")
- `invoices` + `invoice_lines` + `invoice_payments` — best sellers, margin,
  overdue invoices, repeat customers
- `contacts` — customer segments (e.g. hasn't ordered in 90 days)
- `businesses` — name, trading name, brand color (for tone/branding hints)

Everything stays scoped to the invoking user's `business_id` (RLS), the same way
the financial assistant in `ai-insights` is scoped.

---

## Data model (new)

One new migration: `supabase/migrations/20260803000000_marketing_agent.sql`
(following the existing `YYYYMMDDHHMMSS_name.sql` convention).

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `marketing_posts` | Drafts + scheduled + published content | `business_id`, `created_by`, `kind`, `channel`, `status`, `content_json`, `generated_at`, `scheduled_for`, `published_at`, `external_id`, `error` |
| `marketing_agent_usage` | Per-user rate limit | `user_id`, `window_start`, `count` (mirrors `support_agent_usage`) |
| `social_connections` *(Phase 3)* | OAuth'd page tokens, encrypted | `business_id`, `provider`, `account_id`, `account_name`, `access_token_encrypted`, `scopes`, `connected_at`, `revoked_at` |
| `marketing_campaigns` *(Phase 4)* | Grouped posts + goal | `business_id`, `name`, `goal`, `status`, `starts_at`, `ends_at` |

`marketing_posts.status` enum: `draft → approved → scheduled → publishing →
published` (or `failed`), plus `archived`. RLS: rows visible only to members of
the owning business (same pattern as `business_users`).

---

## Brand voice & tone

Generated content must sound like the business, not a generic bot. Defaults
(Malawian SME register; can be overridden per business):

- **Currency:** MWK-first, local formatting (the app is already MWK-first).
- **Language:** English primary, with a Chichewa-English code-mix register
  available — the app already ships `en` + `ny` (Chichewa) locales, plus `fr`,
  `pt`, `sw`.
- **Tone:** warm, practical, no hype, no fabricated scarcity ("only 2 left!" —
  only if `inventory_balances` actually says so).
- **Facts grounded:** product names/prices must come from `products`/`invoices`
  data passed in the context — the model is instructed not to invent SKUs,
  prices, or testimonials.
- **Accessibility & clarity:** plain language, emoji used sparingly (the project
  has an `A11Y_FIX_PLAN.md` and `A11Y_REPORT.md` — generated text inherits those
  standards).

A short **brand-voice profile** (tone, do/don't list, sign-off) is stored per
business (recommended: a settings row keyed off `businesses`) and injected into
the system prompt — the same place `buildSystemPrompt()` lives in the support
agent.

---

## Phased roadmap

### Phase 0 — Foundation *(draft-only, matches current intent)*
- New edge function `supabase/functions/marketing-agent/index.ts`.
- Data-context builder reading `products` / `inventory_balances` / `invoices`.
- `MarketingAssistant` page with three tabs: **Research · Recommendations · Publish**.
- "Publish" tab renders a **preview** of the generated post (mock; no API call).
- Migration: `marketing_posts` + `marketing_agent_usage`.
- **Outcome:** click-through-the-real-thing, content generated from live data,
  nothing leaves the app.

**✅ Phase 0 — DONE (implemented)**
- `supabase/functions/marketing-agent/index.ts` — auth-gated, rate-limited
  (`marketing_agent_usage`), reads business data via the user's JWT (RLS-scoped),
  forced-tool-use structured JSON (`recommendations` / `drafts` / `research`).
- `supabase/migrations/20260803000000_marketing_agent.sql` — `marketing_posts`
  (business-member RLS) + `marketing_agent_usage`.
- `src/lib/marketingAgent.ts` — typed client (`callMarketingAgent`, `saveDraft`).
- `src/pages/MarketingAssistantPage.tsx` — 3-tab UI with a Facebook-style
  **preview-only** Publish card, "Save draft" (persists to `marketing_posts`),
  disabled "Publish (soon)", and a clearly-labelled "Preview a sample result"
  so the UI is explorable locally before the function is deployed.
- Wired into routing (`/marketing`), the sidebar, the role allowlist, and i18n.
- `marketing_posts` typed in `src/dal/types/database.supplement.ts`.
- Verified: `typecheck`, `lint` (0 errors), `test` (170 passing), `build` all green.

### Phase 1 — Recommendations engine
- Wire `InventoryRepository`, `InvoiceRepository`, `ContactRepository` into the
  context builder (slow movers, best sellers, overdue, dormant customers).
- Model returns structured recommendations (promo ideas, repricing, cross-sell,
  bundles, audience segments) with a rationale and the data it used.
- **Internal-only; this is where the agent builds trust.**

**✅ Phase 1 — DONE (implemented)**
- Richer server-side context in `marketing-agent`: best sellers (last 90 days
  from `invoice_lines`), **slow movers** (stocked but no recent sales), overdue
  receivables + top debtors, and **customer segments** (active/dormant counts,
  dormant sample, top customers).
- Sharper recommendations: the tool schema gained `targetSegment` (who a
  recommendation targets) and the prompt now prioritises slow-mover bundles,
  dormant-customer re-engagement, and overdue nudges.
- **Per-business brand voice** — new `marketing_settings` table (migration
  `20260803000001`) with business-member RLS; editable "Brand voice & tone"
  panel on the page (`loadBrandVoice` / `saveBrandVoice`), injected into the
  agent's system prompt so generated posts match the business's voice.
- `marketing_settings` typed in `database.supplement.ts`.
- Verified: `typecheck`, `lint` (0 errors), `test` (170 passing), `build`.

### Phase 2 — Research
- Integrate a web-search provider (Brave / Serper / Tavily / Bing), key as a
  secret, called server-side from the edge function.
- Trends, competitor moves, content ideas; results summarized with citations.
- Social side limited to the business's **own** page insights (Graph API read),
  where a connection exists.

**✅ Phase 2 — DONE (implemented)**
- Provider-agnostic `supabase/functions/_shared/webSearch.ts` — supports
  **Tavily** (`POST api.tavily.com/search`, Bearer key) and **Brave**
  (`GET api.search.brave.com/...`, `X-Subscription-Token`). Provider is forced
  via `WEB_SEARCH_PROVIDER` or auto-detected from whichever key is set; fails
  soft (returns `[]`, 8s timeout) so research never breaks.
- `marketing-agent` research mode now grounds responses in **live web results**
  when a key is configured (query localised to Malawi), and surfaces the sources
  to the UI via a new `sources[]` field; with no key it keeps the honest
  general-guidance fallback.
- UI: a **Sources** card with a "Live web search" badge renders the cited links.
- Verified: `typecheck`, `lint` (0 errors), `test` (170 passing), `build`.
- **Note:** "social search" (own-page insights via the Graph API) is deferred to
  Phase 3, where the Facebook OAuth connection it depends on is built.

### Phase 3 — Real Facebook publishing
- Meta Developer App + Facebook Login (OAuth) + request
  `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
- **Submit for App Review** (weeks) before non-developer users can publish.
- `social_connections` table (encrypted Page token) + a `facebook-publish`
  edge-function module that posts to `/{page-id}/feed`.
- Approve → Schedule → Publish flow in the UI.

**✅ Phase 3 — DONE (implemented)** — code-complete; you wire your Meta app.
- `_shared/crypto.ts` — AES-GCM encrypt/decrypt for tokens at rest
  (`SOCIAL_TOKEN_ENC_KEY` = base64 of 32 bytes).
- `_shared/facebook.ts` — Graph API v25.0 client: build OAuth URL, exchange code
  → long-lived user token → `/me/accounts` Page tokens, `POST /{page-id}/feed`.
- `facebook-auth` edge function — `start` (creates a CSRF `state`, returns the
  Login URL), browser `callback` (validates state, exchanges tokens, stores the
  **encrypted** Page token, redirects back to `/marketing`), and `disconnect`.
- `facebook-publish` edge function — loads + decrypts the Page token, posts to
  the feed, records `published`/`failed` on `marketing_posts`. **Approve-first**:
  the user must click Publish; nothing is autonomous.
- Migration `20260803000002_social_connections` — `social_connections`
  (business-member RLS; token encrypted) + `social_oauth_states` (service-role).
- UI — Facebook connection card (Connect/Disconnect), status banner, and the
  Publish tab's Publish button goes **live** once a Page is connected.
- `social_connections` typed in `database.supplement.ts`.
- Verified: `typecheck`, `lint` (0 errors), `test` (170 passing), `build`.
- **Not done here (needs you):** register the Meta app, add the redirect URI
  (`<SUPABASE_URL>/functions/v1/facebook-auth`) to *Valid OAuth Redirect URIs*,
  and submit for App Review for `pages_manage_posts` + `pages_read_engagement`.

### Phase 4 — Autonomy (the destination)
- Approved content library + a scheduler (Vercel cron / pg_cron → publish
  runner) that posts on a cadence.
- Guardrails: brand-voice filter, fact-check vs. product data, per-channel rate
  limits, dry-run mode, and AI-content labeling where the platform requires it.
- Analytics loop: post performance feeds back into recommendations
  (double-down on what works).

---

## Security & privacy

- **Auth-gated:** only a signed-in Ledgr user (JWT) may invoke the function; the
  user's JWT is forwarded so the function verifies identity (`getUser()`), as the
  other agents do.
- **Key isolation:** the Anthropic key (and later the web-search key) live in
  Supabase secrets and are never sent to the browser.
- **Encrypted tokens:** `social_connections.access_token_encrypted` at rest.
- **Grounded output:** the system prompt forbids inventing prices, stock levels,
  or testimonials; recommendations cite the data they used.
- **Rate limiting:** `marketing_agent_usage` prevents abuse of the (paid) model.
- **PII minimization:** research queries strip customer PII; only aggregate
  signals leave the edge function.
- **AI disclaimer:** the UI shows an "AI-generated" notice on every draft, with
  a path to edit before publishing.

---

## Setup (once code exists)

```bash
# Deploy the function
supabase functions deploy marketing-agent

# Required — the AI provider (already configured for the other agents):
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# Optional — model override (defaults to claude-sonnet-4-20250514):
supabase secrets set MARKETING_AGENT_MODEL=claude-sonnet-4-20250514

# Phase 2 — web search (set ONE; optional WEB_SEARCH_PROVIDER forces a choice):
supabase secrets set TAVILY_API_KEY=tvly-...        # https://tavily.com
#   or
supabase secrets set BRAVE_API_KEY=...              # https://api.search.brave.com
# supabase secrets set WEB_SEARCH_PROVIDER=tavily   # 'tavily' | 'brave'

# Phase 3 — Facebook (real publishing). Requires a Meta app in App Review for
# pages_manage_posts + pages_read_engagement, and the redirect URI below added
# to "Valid OAuth Redirect URIs" in the Meta app dashboard:
#   <SUPABASE_URL>/functions/v1/facebook-auth
openssl rand -base64 32 | supabase secrets set SOCIAL_TOKEN_ENC_KEY=-   # token encryption
supabase secrets set FB_APP_ID=... FB_APP_SECRET=...
# optional override (defaults to <SUPABASE_URL>/functions/v1/facebook-auth):
# supabase secrets set FB_REDIRECT_URI=https://your-app.example.com/callback

# Apply the data-model migration
supabase db push   # or supabase migration up for 20260803000000_marketing_agent.sql
```

---

## Open questions (decide before widening scope)

> The defaults below are what **Phase 0 was built on**. They're easy to change —
> just say the word.

1. **Autonomy boundary** — confirm the default: autonomous for
   analysis/drafts, approve-first for public posts? *(Built on: YES — the
   Publish tab is preview-only with a disabled "Publish" button.)*
2. **Brand-voice profile** — store as a settings row on `businesses`, or a new
   `marketing_settings` table? *(Resolved in Phase 1: a dedicated
   `marketing_settings` table with an editable "Brand voice & tone" panel on the
   page, injected into the agent's system prompt.)*
3. **Web-search provider** — Brave, Serper, Tavily, or Bing for Phase 2?
   *(Resolved in Phase 2: a provider-agnostic module supports **Tavily** and
   **Brave**; set one key (`TAVILY_API_KEY` or `BRAVE_API_KEY`) and it
   auto-detects. Research is live when a key is present, else general guidance.)*
4. **Facebook scope** — one Business Page per business, or multiple Pages/channels?
   *(Resolved in Phase 3: one Page per business (the first the user authorises);
   `channel` is free-text and `social_connections` supports multiple rows, so
   multi-page/multi-channel is forward-compatible.)*
5. **Post languages** — generate English only, or also Chichewa (`ny`) / others
   the business serves? *(Built on: English; the `brandVoice` field is the
   intended lever for language/tone.)*

---

## Local development

Like the support and insights agents, the edge function is **not** invoked by the
Vite dev server, so the Marketing page will show a friendly "couldn't reach the
marketing assistant" message locally until the function is deployed and the
client is pointed at a Supabase project. Phase 0's preview/mock mode will,
however, let the UI be developed and clicked through locally without a live
model call.
