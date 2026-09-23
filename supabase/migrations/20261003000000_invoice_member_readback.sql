-- ============================================================================
-- 20261003000000_invoice_member_readback.sql
--
-- P-D4 (owner authorization, 2026-09-23): declare the authenticated member
-- invoice read surface that the architecture already assumes.
--
-- Background:
--
--   The role-aware RLS design (20260728000008) established a business-wide
--   read tier: active business members read their own business's master and
--   operational data via `*_member_read` policies backed by
--   public.is_business_member(business_id). The POS write-scope migration
--   (20260922000000) explicitly documented "Reads are deliberately unchanged
--   (business-wide read tier)" — but invoices/invoice_lines were never given
--   that tier: the entire migration chain contains zero SELECT policies and
--   zero SELECT grants to `authenticated` for either table.
--
--   Production reads through InvoiceRepository.findByIdWithLines,
--   IncomeRepository and the offline post-sale readback
--   (posService.loadCommittedPosSale) therefore depended on out-of-band
--   platform privileges not declared in migrations. Consequences already on
--   file:
--     * tests/release/offline.test.ts requireReadback() gated four release
--       records (OFFLINE.REOPEN, OFFLINE.RETRY,
--       R09.QUEUE.ACTOR-BINDING.SAME-USER, R09.QUEUE.REGRESSION.REPLAY-CONTRACT)
--       — all BLOCKED pending this declaration.
--     * P-D3-FINAL §11 investigation
--       (docs/audits/LEDGR_R093_P_D3_FINAL_COMPLETION_2026-09-23 §5.1) named
--       this exact migration shape as the owner-decision activation
--       prerequisite and forbade opportunistic grants inside R09.3 itself.
--
-- What this declares (and does not declare):
--
--   * Active members may SELECT invoices/invoice_lines of their own business
--     — the same scope every other business-scoped table already has. POS
--     posting flows already return the full committed document to the caller
--     through post_pos_sale, so no genuinely new data exposure is created:
--     this makes the assumed tier explicit, auditable and replayable.
--   * Cross-business reads remain impossible (RLS). `anon` gets nothing.
--   * Write scope is UNCHANGED (20260922000000 tiers still govern writes).
--   * No data touched. Idempotent.
--
-- Verification:
--   tests/release/offline.test.ts (four readback-gated records now activate),
--   tests/release/r093-reconciliation.test.ts
--   (R093.SEALED-PAIR.READBACK-INVESTIGATION asserts the declared tier live).
-- ============================================================================

-- ── 1. Grants ────────────────────────────────────────────────────────────────

grant select on public.invoices to authenticated;
grant select on public.invoice_lines to authenticated;

-- ── 2. Member read policies (house pattern: <table>_member_read) ────────────

drop policy if exists invoices_member_read on public.invoices;
create policy invoices_member_read on public.invoices
  for select using (public.is_business_member(business_id));

drop policy if exists invoice_lines_member_read on public.invoice_lines;
create policy invoice_lines_member_read on public.invoice_lines
  for select using (public.is_business_member(business_id));
