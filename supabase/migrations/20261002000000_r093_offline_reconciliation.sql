-- ============================================================================
-- R09.3 (P-D3-FINAL = Model 3 + Model 4) — Offline queue replay reconciliation.
--
-- Owner authorization: docs/audits/LEDGR_R09.3_DECISION_PACKAGE_2026-09-23.md
-- (P-D3-FINAL signed 2026-09-23). This migration is the SERVER half of Model 4:
-- reconciliation is an authority action, never a normal retry button.
--
--   * public.offline_queue_reconciliations — append-only audit of every
--     reconciliation decision: original client key, original actor (evidence
--     only), reconciliation actor (server-derived), reason, exception class,
--     revalidation result, disposition. Members may READ; only the SECURITY
--     DEFINER function below may WRITE (no insert/update/delete policies,
--     no grants).
--   * public.reconcile_offline_queue_item(jsonb) — the single sanctioned
--     reconciliation command. Freshly validates manager-tier authority
--     (owner/admin/manager, server-side), integrity-class refusal, and
--     request/payload identity, then replays the ORIGINAL transaction through
--     the ORIGINAL authoritative posting path (post_pos_sale) with the
--     ORIGINAL client key, so every existing authority (membership, branch,
--     terminal, shift, DEC-08 late arrival, R10 P0QLT quota, R06 23514 stock
--     invariant, client-key idempotency) is re-validated fresh, server-side.
--
-- Hard guarantees kept (non-negotiable controls, owner doc Part B):
--   - R06: no negative stock, no oversell, no stock override — the replay
--     executes post_pos_sale, which enforces chk_inventory_balances_on_hand_nonneg.
--   - R10: P0QLT remains the sole quota signal; no second meter; a denial
--     during reconciliation is RECORDED, never bypassed.
--   - R09.2: provenance is evidence only; the reconciliation actor never
--     replaces the original actor; integrity quarantines (actor-mismatch,
--     missing-provenance, legacy, and R09.3's payload-tampered) can NEVER
--     enter this function (exception_class check below).
--   - R08: branch/terminal/shift/late-arrival semantics are untouched; the
--     replay IS post_pos_sale, so they apply verbatim.
--   - The function flips no payload field: the original payload is replayed
--     as captured. Substantive changes require a new capture + new client key
--     (out of scope here by design).
--
-- ADDITIVE + IDEMPOTENT: create-table-if-not-exists, create-or-replace
-- function, grants. No data changes, no existing object altered.
-- ============================================================================


-- ── 1. Audit table ───────────────────────────────────────────────────────────

create table if not exists public.offline_queue_reconciliations (
  id uuid primary key default gen_random_uuid(),

  -- Tenant + transaction identity (the original queue client key — the SAME
  -- key the original posting used; reconciliation never mints a new one).
  business_id uuid not null references public.businesses(id),
  client_key uuid not null,
  operation_type text not null check (operation_type in (
    'income', 'expense', 'invoice', 'invoice_payment', 'expense_payment',
    'payroll_run', 'stock_movement', 'pos_sale'
  )),

  -- The typed Model-3 exception being resolved. Integrity quarantine classes
  -- are excluded at the CHECK level so no code path can record one here.
  exception_class text not null check (exception_class in ('stock-denied', 'policy-denied')),

  -- Original provenance: EVIDENCE ONLY (R09.2 §3). Never used for
  -- authorization; the server derives every authority decision from
  -- auth.uid() and the posting function's own guards.
  origin_user_id uuid null,
  origin_device_id text null,
  captured_at timestamptz null,

  -- The reconciliation actor, always server-derived. Distinct column from
  -- origin_user_id: the reconciler never impersonates the original actor.
  reconciled_by uuid not null,

  -- Manager-recorded reason (bounded; no payload contents).
  reason text not null check (char_length(reason) between 1 and 500),

  -- What the server freshly validated, and how the replay ended.
  revalidation jsonb not null default '{}'::jsonb,
  disposition text not null check (disposition in ('replay-accepted', 'replay-denied')),
  replayed_document_id uuid null,
  denial_code text null,
  denial_message text null,

  created_at timestamptz not null default now()
);

create index if not exists offline_queue_reconciliations_business_client_key
  on public.offline_queue_reconciliations (business_id, client_key);
create index if not exists offline_queue_reconciliations_reconciled_by
  on public.offline_queue_reconciliations (reconciled_by);

comment on table public.offline_queue_reconciliations is
  'R09.3 Model 4: append-only audit of offline-queue reconciliation decisions. Written solely by reconcile_offline_queue_item (SECURITY DEFINER); readable by active members. origin_* columns are R09.2 evidence, never authority.';

alter table public.offline_queue_reconciliations enable row level security;

drop policy if exists offline_queue_reconciliations_member_read
  on public.offline_queue_reconciliations;
create policy offline_queue_reconciliations_member_read
  on public.offline_queue_reconciliations
  for select using (public.is_business_member(business_id));

-- No insert/update/delete policies and no DML grants: the audit is
-- append-only through the definer function (the table owner bypasses RLS).
revoke all on public.offline_queue_reconciliations from anon;
grant select on public.offline_queue_reconciliations to authenticated;


-- ── 2. The reconciliation command ────────────────────────────────────────────

create or replace function public.reconcile_offline_queue_item(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business_id uuid := nullif(p_request->>'business_id', '')::uuid;
  v_client_key uuid := nullif(p_request->>'client_key', '')::uuid;
  v_operation_type text := p_request->>'operation_type';
  v_exception_class text := p_request->>'exception_class';
  v_reason text := btrim(coalesce(p_request->>'reason', ''));
  v_payload jsonb := p_request->'payload';
  v_origin_user uuid := nullif(p_request->>'origin_user_id', '')::uuid;
  v_origin_device text := nullif(p_request->>'origin_device_id', '');
  v_captured_at timestamptz := nullif(p_request->>'captured_at', '')::timestamptz;
  v_doc jsonb;
  v_ok boolean;
  v_code text;
  v_msg text;
  v_doc_id uuid;
  v_idempotent boolean;
begin
  -- 1. Authenticated caller. SECURITY DEFINER makes this guard mandatory.
  if v_uid is null then
    raise exception 'Authentication required for offline reconciliation (R09.3).'
      using errcode = '42501';
  end if;

  -- 2. Request shape. Missing identity is a contract violation, not a
  --    replay denial; nothing is recorded because no reconciliation exists.
  if v_business_id is null or v_client_key is null
     or v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Malformed reconciliation request (R09.3).' using errcode = '22023';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'A reconciliation reason (1-500 chars) is mandatory (R09.3).'
      using errcode = '22023';
  end if;

  -- 3. Integrity quarantines can never enter reconciliation (R09.2 Part G).
  --    Only the two typed business-exception classes are eligible. Anything
  --    else — actor-mismatch, missing-provenance, legacy, payload-tampered,
  --    or an invented class — is refused before any audit row exists.
  if v_exception_class is null or v_exception_class not in ('stock-denied', 'policy-denied') then
    raise exception 'Exception class is not reconcilable (R09.3).'
      using errcode = '22023';
  end if;

  -- 4. Operation support for this revision: replayable only through a single
  --    server-authoritative posting function. pos_sale is the sole type with
  --    one today; other queue types stay classified + visible client-side
  --    and are deliberately NOT replayable here (no client-orchestrated
  --    multi-write replay is re-created server-side).
  if v_operation_type is distinct from 'pos_sale' then
    raise exception 'Operation type is not reconcilable under R09.3.'
      using errcode = '22023';
  end if;

  -- 5. Manager-tier authority, server-side (Part E): the existing R08 tier —
  --    owner/admin/manager. Client role claims are never read. New roles are
  --    never created.
  if not exists (
       select 1 from public.business_users bu
        where bu.business_id = v_business_id
          and bu.user_id = v_uid
          and bu.is_active = true
          and bu.role::text in ('owner', 'admin', 'manager')
     ) then
    raise exception 'Reconciliation requires manager-tier authority (R09.3).'
      using errcode = '42501';
  end if;

  -- 6. Request/payload identity must match: the caller may not reconcile
  --    transaction A's key against transaction B's payload, and may not mint
  --    a replacement client key for the same financial transaction (Part E).
  if nullif(v_payload->>'business_id', '')::uuid is distinct from v_business_id
     or nullif(v_payload->>'client_key', '')::uuid is distinct from v_client_key then
    raise exception 'Reconciliation identity does not match the original transaction (R09.3).'
      using errcode = '22023';
  end if;

  -- 7. Audit-first: the decision row survives whether the replay lands or
  --    not. Disposition starts denied and is upgraded only by a commit.
  --    revalidation records WHAT was freshly validated server-side.
  v_ok := false;
  begin
    -- Fresh server validation + authoritative replay in ONE step: post_pos_sale
    -- re-derives the caller (auth.uid()), membership/till authority, branch,
    -- terminal, shift steering and DEC-08 late arrival, the R10 quota
    -- assertion (P0QLT), the R06 stock invariant (23514) and client-key
    -- idempotency — exactly the Part-E list. Nothing cached is trusted.
    v_doc := public.post_pos_sale(v_payload);
    v_ok := true;
    v_doc_id := nullif(v_doc->>'id', '')::uuid;
    v_idempotent := coalesce((v_doc->>'idempotent')::boolean, false);
  exception when others then
    -- Subtransaction: the replay rolled back (zero financial mutation);
    -- the typed denial is captured for the audit row instead of propagating.
    v_code := sqlstate;
    v_msg := sqlerrm;
  end;

  insert into public.offline_queue_reconciliations (
    business_id, client_key, operation_type, exception_class,
    origin_user_id, origin_device_id, captured_at,
    reconciled_by, reason, revalidation,
    disposition, replayed_document_id, denial_code, denial_message
  ) values (
    v_business_id, v_client_key, v_operation_type, v_exception_class,
    v_origin_user, v_origin_device, v_captured_at,
    v_uid, left(v_reason, 500),
    jsonb_build_object(
      'validated_by', 'post_pos_sale',
      'actor_source', 'auth.uid()',
      'checked_at', now(),
      'manager_tier', true,
      'fresh_authority', true
    ),
    case when v_ok then 'replay-accepted' else 'replay-denied' end,
    v_doc_id,
    case when v_ok then null else v_code end,
    case when v_ok then null else left(v_msg, 300) end
  );

  return jsonb_build_object(
    'ok', v_ok,
    'disposition', case when v_ok then 'replay-accepted' else 'replay-denied' end,
    'document_id', v_doc_id,
    'idempotent', coalesce(v_idempotent, false),
    'code', case when v_ok then null else v_code end,
    'message', case when v_ok then null else left(v_msg, 300) end
  );
end;
$$;

comment on function public.reconcile_offline_queue_item(jsonb) is
  'R09.3 Model 4: authorized manager-tier reconciliation of a typed offline-queue exception. Freshly validates authority server-side, replays the ORIGINAL transaction through post_pos_sale with the ORIGINAL client key (exactly-once), and appends an audit decision. Integrity quarantines (R09.2 classes + payload-tampered) and non-POS operation types are refused. Never overrides stock/quota/shift authority.';

revoke all on function public.reconcile_offline_queue_item(jsonb) from public, anon;
grant execute on function public.reconcile_offline_queue_item(jsonb) to authenticated;
