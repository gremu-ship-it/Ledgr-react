# Phase 10.2 — Restore Fixed Assets to Non-Current Assets

**Date:** 2026-08-19 · **PR:** #109 (this branch) · **Builds on:** PR #107 (merged), #108 (merged)

## 1. What the user reported

> "Restore fixed assets to Non-Current Assets — #107 is green but non-current
> assets are still not updated."

PR #107 (merged 2026-08-19 14:45Z) made the Statement of Financial Position
(SOFP) include fixed-asset-related accounts (register links, category
defaults, register-NBV fallback) and surface integrity findings. The report
still showed fixed assets missing from Non-Current Assets.

## 2. Root-cause analysis

**Deployment state (verified via GitHub commit statuses + Actions history):**
- The `#107` merge was auto-deployed by Vercel to the production project
  `ledgr-react` at 14:45Z (`Deployment has completed` on commit `43fc9df`).
- The staging project (`ledgr-react-prod`) deploy **failed at the Vercel
  step** on both the #107 and #108 merges (A-06 — unchanged; requires a
  Vercel dashboard action; see Phase 10.1 report §7).
- No `v*` tag / approved production Actions deploy has run since 2026-08-16,
  so the GitHub-Actions pipeline has not re-deployed production.

**Code/data gap (the reason the symptom can survive a deploy):**
The SOFP routes accounts to sections by `account_subtype`. The 1500-1599
range is the documented Non-Current Assets range
(`seedChartOfAccounts.ts` header: *"1500s Non-Current Assets"*), but legacy
rows and manual edits can leave a 15xx **asset** account with:

| Stored subtype | Behaviour before Phase 10.2 |
|---|---|
| `NULL` | Handled by PR #107's NULL fallback (included in NCA) |
| `fixed_asset` / `non_current_asset` | Correctly routed to NCA |
| `current_asset` | Routed to **Current Assets** — wrong section, no NCA entry |
| any non-asset value (`revenue`, `current_liability`, …) | Dropped from **every** SOFP section (invisible) |

PR #107 only covered the `NULL` case. The non-NULL mis-set cases survived.

## 3. Fix

1. **Report override** (`FinancialStatementRepository.getSOFP` +
   `buildSection`): a subtype override map classifies **every** 15xx asset
   account as `fixed_asset` for statement purposes. Because the same
   override is applied in every section, an account can never appear in two
   sections (no double counting), and deliberately reclassified accounts
   outside the 15xx range are untouched.
2. **Data repair migration**
   `20260819000000_phase10_2_restore_fixed_asset_subtypes.sql`:
   - `151x`/`152x` asset accounts with a clearly-broken subtype (`NULL` or a
     non-asset value) → `fixed_asset`;
   - other `15xx` asset accounts with a clearly-broken subtype →
     `non_current_asset`;
   - `current_asset` rows are deliberately left alone (the report override
     already presents them correctly);
   - every repair is logged with `RAISE NOTICE`; idempotent.

## 4. Verification

- **Unit (vitest):** 243/243 pass, incl. 3 new SOFP tests:
  - 15xx + `current_asset` → Non-Current Assets only (not CA, no double count);
  - 15xx + junk subtype (`revenue`) → Non-Current Assets;
  - non-15xx current asset stays in Current Assets.
- **DB (disposable PostgreSQL, 66 migrations):** replay OK; new
  `phase10_2_subtype_repair` suite **8/8** (repairs NULL/junk, preserves
  `current_asset` and correct rows, idempotent); all prior suites green
  (rls 41, rpc 20, storage 8, workflow 16, paye 10, phase10 11,
  remediation 16).
- **Typecheck + lint:** clean.

## 5. Deployment note (what the user must do)

- The fix ships to **production** via the normal approved path: merge this
  PR, then push a `v*` tag (or dispatch `environment: production`) and
  approve the environment gate. The migration will repair broken 15xx
  subtypes in production (logged in the deploy output).
- **Staging is still blocked** (A-06): the `ledgr-react-prod` Vercel project
  deploy fails. Confirm in the Vercel dashboard that project
  `prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9` exists under team
  `team_ABA9J00MCqgkKSmDAWvrnr5b` with the same build settings as the
  working `ledgr-react` project, and read the failed step log in the GitHub
  Actions UI.
- **Quick data check** (run in Supabase SQL editor, replace `<business>`):
  ```sql
  select code, name, account_subtype
    from public.accounts
   where account_type='asset' and code like '15%' and deleted_at is null
   order by code;
  ```
  Rows with `NULL` or non-asset subtypes are exactly what this PR repairs.
