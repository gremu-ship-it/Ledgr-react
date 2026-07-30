# Ledgr Support Agent

An in-app assistant that helps users with three things from anywhere in the app:

1. **Customer / product questions** — how features work and how to perform tasks
   (invoicing, payroll, bank reconciliation, reports, multi-currency, API/webhooks…).
2. **App-error triage** — when a user picks *Report a problem*, the client attaches
   sanitised, recently-captured browser errors so the agent can suggest concrete fixes.
3. **Compliance** — data export, account deletion (and its grace period), cookie
   consent, audit logs, terms acceptance, MFA, inactivity timeout, RBAC, and MRA
   tax filings (VAT / withholding / PAYE).

## Surfaces

- **Floating widget** (`src/components/support/SupportWidget.tsx`) — a permanent
  chat bubble in the bottom-right, mounted once in `AppLayout`, available on every
  authenticated page.
- **Support page** (`/support`, `src/pages/SupportPage.tsx`) — a fuller experience
  with compliance self-service shortcuts and a "talk to a human" card.
- Both share `src/components/support/SupportChat.tsx`.

## Architecture

```
Browser (SupportChat)
   │  supabase.functions.invoke('support-agent', { body })  ← attaches user JWT
   ▼
supabase/functions/support-agent/index.ts   (Deno edge function)
   │  auth (getUser) + per-user rate limit (support_agent_usage)
   ▼
Anthropic Claude (ANTHROPIC_API_KEY secret, forced tool-use for JSON)
   ▼
Structured JSON: { content, actions[], escalate, category, supportEmail? }
```

> History note: an optional "Arena agent" provider referenced in earlier
> revisions of this document was removed. It pointed at a speculative
> `api.arena.ai` agents endpoint that is not publicly available. The Arena
> Agent *Mode* chat UI is unrelated to this integration.

The AI provider key is **never** exposed to the browser. The edge function is
auth-gated: only a signed-in user may call it, and the user's JWT is forwarded so
the function can verify identity.

## Setup

1. Deploy the function:

   ```bash
   supabase functions deploy support-agent
   ```

2. Set secrets (only the ones you need):

   ```bash
   # Required — the AI provider:
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

   # Optional — shown to users on escalation:
   supabase secrets set SUPPORT_EMAIL=support@ledgr.app
   ```

3. Apply the rate-limit table migration:

   ```bash
   supabase db push   # or `supabase migration up` for the 20260730000000 migration
   ```

   The function tolerates the table being absent, but it should exist in
   production to prevent abuse of the (paid) AI provider.

## Tuning the agent

- **System prompt & capabilities:** edit `buildSystemPrompt()` in
  `supabase/functions/support-agent/index.ts`. It already knows the Ledgr module
  map, compliance self-service paths, RBAC model, and the support email.
- **In-app shortcuts:** the model returns `actions` with paths from a fixed allow
  list (`VALID_PATHS`). Add new paths there and in `SupportAction` (frontend).
- **Model:** `SUPPORT_AGENT_MODEL` (defaults to `claude-sonnet-4-20250514`).

## Privacy

- Error diagnostics are captured client-side (`src/lib/errorCapture.ts`) as a small
  ring buffer of message + a 3-line stack slice + source URL + timestamp. They are
  attached only when the user is in *Report a problem* mode and opts in, and the
  buffer is cleared after a report is sent. No cookies, auth tokens, or free-text
  user data are captured.
- The assistant is AI-generated; the UI shows a disclaimer and an escalation path
  (support email) for billing, legal, or urgent issues.

## Local development

The edge function is not invoked by the Vite dev server, so the widget/page will
show a friendly "couldn't reach the support assistant" message locally until the
function is deployed and the client is pointed at a Supabase project.
