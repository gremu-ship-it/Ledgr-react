-- Phase 5A-4a: align the P4 trial-balance aggregation with ledger balances.
-- Preserve the existing function signature and output columns for callers.
CREATE OR REPLACE FUNCTION public.get_trial_balance(
  p_business_id uuid,
  p_date_from date,
  p_date_to date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  parent_account_id uuid,
  total_debit numeric,
  total_credit numeric,
  balance numeric,
  level integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Access denied to business %', p_business_id
      USING ERRCODE = '42501';
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid trial balance date range'
      USING ERRCODE = '22023';
  END IF;

  -- Reject an inaccessible (or cross-business) branch before aggregating.
  -- This makes a manipulated client-side branch parameter fail closed.
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND public.can_access_branch(p_business_id, p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Access denied to branch %', p_branch_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH RECURSIVE account_tree AS (
    SELECT
      a.id,
      a.code,
      a.name,
      a.account_type::text,
      a.parent_id,
      a.normal_balance::text AS normal_balance,
      a.opening_balance,
      a.opening_balance_date,
      0::integer AS level
    FROM public.accounts a
    WHERE a.business_id = p_business_id
      AND a.parent_id IS NULL
      AND a.is_active = true
      AND a.deleted_at IS NULL

    UNION ALL

    SELECT
      a.id,
      a.code,
      a.name,
      a.account_type::text,
      a.parent_id,
      a.normal_balance::text AS normal_balance,
      a.opening_balance,
      a.opening_balance_date,
      parent.level + 1
    FROM public.accounts a
    JOIN account_tree parent ON a.parent_id = parent.id
    WHERE a.business_id = p_business_id
      AND a.is_active = true
      AND a.deleted_at IS NULL
  ),
  posted_lines AS (
    SELECT
      jl.account_id,
      SUM(CASE WHEN jl.is_debit THEN jl.amount_base ELSE 0 END) AS debit_sum,
      SUM(CASE WHEN NOT jl.is_debit THEN jl.amount_base ELSE 0 END) AS credit_sum
    FROM public.journal_lines jl
    JOIN public.journal_entries je
      ON je.id = jl.journal_entry_id
      AND je.business_id = jl.business_id
    WHERE jl.business_id = p_business_id
      AND je.business_id = p_business_id
      AND je.status IN (
        'posted'::public.journal_status,
        'reversed'::public.journal_status
      )
      AND je.entry_date >= p_date_from
      AND je.entry_date <= p_date_to
      AND (p_branch_id IS NULL OR je.branch_id = p_branch_id)
      -- Do not special-case NULL entry branch IDs: can_access_branch deliberately
      -- fails closed for branch-assigned roles when an entry has no branch.
      AND public.can_access_branch(p_business_id, je.branch_id)
      -- journal_lines also carry branch_id and are scoped by their own RLS
      -- policy. Preserve that boundary while allowing legacy NULL line scopes
      -- only when the parent journal entry itself is accessible.
      AND (
        jl.branch_id IS NULL
        OR public.can_access_branch(p_business_id, jl.branch_id)
      )
    GROUP BY jl.account_id
  ),
  balances AS (
    SELECT
      tree.id,
      tree.code,
      tree.name,
      tree.account_type,
      tree.parent_id,
      tree.level,
      COALESCE(lines.debit_sum, 0::numeric) AS movement_debit,
      COALESCE(lines.credit_sum, 0::numeric) AS movement_credit,
      CASE
        -- Account opening balances are business-level (not branch-attributed),
        -- natural-side amounts. Include them only in an all-branches result.
        -- Income/expense opening amounts are intentionally excluded: period P&L
        -- callers must receive activity only, matching the legacy repository.
        WHEN p_branch_id IS NULL
          AND tree.account_type IN ('asset', 'liability', 'equity')
          AND (tree.opening_balance_date IS NULL OR tree.opening_balance_date <= p_date_to)
        THEN CASE
          WHEN tree.normal_balance = 'credit'
            THEN -COALESCE(tree.opening_balance, 0::numeric)
          ELSE COALESCE(tree.opening_balance, 0::numeric)
        END
        ELSE 0::numeric
      END AS opening_raw_balance
    FROM account_tree tree
    LEFT JOIN posted_lines lines ON lines.account_id = tree.id
  )
  SELECT
    balances.id,
    balances.code,
    balances.name,
    balances.account_type,
    balances.parent_id,
    balances.movement_debit + GREATEST(balances.opening_raw_balance, 0::numeric),
    balances.movement_credit + GREATEST(-balances.opening_raw_balance, 0::numeric),
    balances.movement_debit - balances.movement_credit + balances.opening_raw_balance,
    balances.level
  FROM balances
  ORDER BY balances.code, balances.id;
END;
$function$;

COMMENT ON FUNCTION public.get_trial_balance(uuid, date, date, uuid) IS
  'Returns active accounts with posted and reversed journal-line totals for a date range, using amount_base. Adds dated natural-side opening balances for balance-sheet accounts in all-branches results. Branch access is enforced server-side; the account hierarchy is returned as flat rows with depth metadata.';

REVOKE ALL ON FUNCTION public.get_trial_balance(uuid, date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_trial_balance(uuid, date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_trial_balance(uuid, date, date, uuid) TO authenticated;
