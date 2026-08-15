#!/usr/bin/env python3
"""Build the authoritative Ledgr staging schema inventory from a LIVE capture.

Reads artifacts/database/capture/*.json (produced by
capture-staging-schema-via-api.sh or capture-staging-schema.sh) and emits:
  artifacts/database/staging-schema-inventory.json   (machine-readable)
  docs/database/staging-schema-inventory.md          (human-readable)

Every object is classified against the repository migrations:
  MATCH                     object exists in a migration (or base migration)
  MISSING FROM REPOSITORY   object is on staging but not created by any migration
"""
import json
import datetime
import glob
import os
from collections import OrderedDict, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAP = os.path.join(REPO, 'artifacts/database/capture')

def load(name):
    with open(os.path.join(CAP, name + '.json')) as f:
        d = json.load(f)
    return d if isinstance(d, list) else d.get('result', [])

def load_pairs(name):
    """rows -> {first col: {rest}} keyed by first column"""
    out = {}
    for r in load(name):
        items = list(r.items())
        key = str(items[0][1])
        out[key] = {k: v for k, v in items[1:]}
    return out

# ---------------------------------------------------------------- migrations set
MIG_TABLES = {
 'ai_insights_usage','api_keys','api_usage','business_invitations','business_terms_acceptances',
 'currencies','exchange_rates','fx_revaluations','invoice_delivery_events','loan_repayments','loans',
 'partner_admins','partner_clients','partner_feature_flags','partner_invoices','partners',
 'recurring_invoices','share_transactions','subscription_payments','subscription_reminders_sent',
 'support_agent_usage','tax_alerts','tax_payments','tax_returns','webhook_deliveries','webhooks',
}
BASE_TABLES = {
 'accounting_periods','accounts','asset_categories','audit_log','bank_statement_lines','bank_statements',
 'branches','budget_lines','budgets','business_users','businesses','contacts','departments',
 'depreciation_schedules','employee_allowances','employee_deductions','employees','expense_lines',
 'expense_payments','expenses','fixed_assets','inventory_balances','inventory_locations','invoice_lines',
 'invoice_payments','invoices','journal_entries','journal_lines','paye_bands','payroll_employee_lines',
 'payroll_runs','product_categories','products','profiles','stock_movements','stock_transfer_lines',
 'stock_transfers','tax_configurations','user_profiles',
}
MIG_ENUMS = {'tax_alert_channel','tax_alert_status','tax_alert_type','tax_return_status'}
BASE_ENUMS = {
 'account_subtype','account_type','asset_status','currency_code','depreciation_method','invoice_status',
 'journal_status','payment_method','payroll_status','stock_movement_type','tax_code','user_role',
}
# functions created by migrations (grep of migrations dir)
MIG_FUNCS = {
 'add_partner_admin','apply_subscription_payment','backfill_and_recalculate_inventory',
 'business_partner_id','can_admin_business_data','can_read_audit','can_read_partner_client',
 'can_read_partner_peer_business','can_view_payroll','can_write_business_data','can_write_payroll',
 'clear_partner_admins','consume_api_rate_limit','create_api_journal_entry','current_partner_ids',
 'diagnose_user_login','enforce_expense_payment_allowed','enforce_invoice_payment_allowed',
 'enforce_partner_client_limit','enforce_plan_tier_change','grant_user_business_access',
 'increment_amount_paid','is_business_member','is_partner_admin','is_partner_business_admin',
 'is_platform_admin','list_all_businesses','list_partner_admins','plan_tier_rank',
 'prevent_functional_currency_change','prevent_locked_bank_line_change','protect_partner_commercial_fields',
 'record_business_terms_acceptance','remove_partner_admin','reserve_next_document_number',
 'seed_partner_feature_flags','set_partner_invoice_number','set_updated_at','set_user_business_access',
 'user_has_role',
}
MIG_VIEWS = {'v_cash_flow','v_inventory_ledger_variance','v_partner_client_usage'}
PG_TRGM_FUNCS = {
 'gin_extract_query_trgm','gin_extract_value_trgm','gin_trgm_consistent','gin_trgm_triconsistent',
 'gtrgm_compress','gtrgm_consistent','gtrgm_decompress','gtrgm_distance','gtrgm_in','gtrgm_options',
 'gtrgm_out','gtrgm_penalty','gtrgm_picksplit','gtrgm_same','gtrgm_union','set_limit','show_limit',
 'show_trgm','similarity','similarity_dist','similarity_op','strict_word_similarity',
 'strict_word_similarity_commutator_op','strict_word_similarity_dist_commutator_op',
 'strict_word_similarity_dist_op','strict_word_similarity_op','word_similarity',
 'word_similarity_commutator_op','word_similarity_dist_commutator_op','word_similarity_dist_op',
 'word_similarity_op',
}
KNOWN_MISSING_RPCS = [
 'accept_invitation','create_business_with_owner','current_user_role','get_enum_values','get_user_role',
 'invite_member','log_manual_audit_event','seed_new_business','verify_audit_chain',
]
KNOWN_MISSING_VIEWS = ['v_ar_ageing','v_asset_register','v_reorder_alerts','v_trial_balance']

# ---------------------------------------------------------------- assemble
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
inv = OrderedDict()

inv['meta'] = {
  'phase': '8A.1',
  'title': 'Ledgr staging schema inventory — AUTHORITATIVE (from live capture)',
  'capture_status': 'LIVE CAPTURE — read-only Management API capture of project bkxzgkurcqvccsdjmqzg (ledgr-staging), 2026-08-15',
  'postgres_version': '17.6 (SHOW server_version from live capture)',
  'postgrest_version': 'n/a (captured via SQL, not gen types)',
  'generated_at': now,
  'capture_files': sorted(os.path.basename(p) for p in glob.glob(os.path.join(CAP, '*.json'))),
}

# schemas / extensions
inv['schemas'] = [r['nspname'] for r in load('schemas')]
inv['extensions'] = load('extensions')

# enums
inv['enums'] = OrderedDict()
for r in load('enums'):
    labels = [l.strip() for l in (r.get('string_agg') or '').split('\n') if l.strip()]
    name = r['typname']
    inv['enums'][name] = {
        'labels': labels,
        'classification': 'MISSING FROM REPOSITORY (base enum)' if name in BASE_ENUMS else 'MATCH (created by migration)',
    }

# tables
inv['tables'] = OrderedDict()
tbl_rows = defaultdict(list)
for r in load('tables'):
    tbl_rows[r['relname']].append(r)
for tname in sorted(tbl_rows):
    cols = OrderedDict()
    for c in sorted(tbl_rows[tname], key=lambda x: 0):
        cols[c['attname']] = {
            'pg_type': c['format_type'],
            'not_null': c['attnotnull'],
            'default': c['default_expr'],
            'identity': c['attidentity'] or None,
            'generated': c['attgenerated'] or None,
        }
    inv['tables'][tname] = {
        'columns': cols,
        'classification': 'MATCH (created by migration)' if tname in MIG_TABLES
                         else ('MATCH (created by base migration 20250101000000)' if tname in BASE_TABLES
                               else 'UNKNOWN (not in repository)'),
    }

# constraints
inv['primary_keys'] = load('primary_keys')
inv['foreign_keys'] = load('foreign_keys')
inv['unique_constraints'] = load('unique_constraints')
inv['check_constraints'] = load('check_constraints')
inv['indexes'] = load('indexes')
inv['generated_columns'] = load('generated_columns')
inv['identity_columns'] = load('identity_columns')
inv['sequences'] = load('sequences')

# views + matviews
inv['views'] = []
for r in load('views'):
    name = r['relname']
    inv['views'].append({
        'name': name,
        'definition': r['pg_get_viewdef'],
        'classification': 'MATCH (created by migration)' if name in MIG_VIEWS
                          else 'MISSING FROM REPOSITORY (exists only on legacy database — not reproducible)'
                          if name in KNOWN_MISSING_VIEWS else 'UNKNOWN',
    })
inv['matviews'] = load('matviews')

# functions
inv['functions'] = []
for r in load('functions'):
    name = r['?column?'].split('(')[0]
    cls = ('MATCH (created by migration)' if name in MIG_FUNCS
           else 'MATCH (pg_trgm extension function)' if name in PG_TRGM_FUNCS
           else 'MISSING FROM REPOSITORY (not created by any migration)' if name in KNOWN_MISSING_RPCS
           else 'UNKNOWN')
    inv['functions'].append({
        'signature': r['?column?'],
        'volatility': r['provolatile'],
        'security_definer': r['prosecdef'],
        'owner': r['pg_get_userbyid'],
        'search_path': r['proconfig'],
        'definition': r['pg_get_functiondef'],
        'classification': cls,
    })

# triggers
inv['triggers'] = load('triggers')

# rls + policies
inv['rls'] = load('rls')
policies = load('policies')
inv['policies'] = policies
pol_by_tab = defaultdict(list)
for p in policies:
    pol_by_tab[p['tablename']].append(p['policyname'])
inv['policies_by_table'] = {k: sorted(v) for k, v in pol_by_tab.items()}

# rls gaps
rls_on = {r['relname'] for r in inv['rls'] if r['relrowsecurity']}
inv['rls_enabled_no_policies'] = sorted(rls_on - set(pol_by_tab))

# grants / roles
inv['grants'] = load('grants')
inv['roles'] = load('roles')

# storage
inv['storage'] = {
    'buckets': load('storage_buckets'),
    'policies': load('storage_policies'),
}

# cron
inv['cron_jobs'] = load('cron_jobs')

# classification summary
inv['classification_summary'] = {
    'tables_total': len(inv['tables']),
    'tables_match': sum(1 for t in inv['tables'].values() if t['classification'].startswith('MATCH')),
    'tables_unknown': sum(1 for t in inv['tables'].values() if t['classification'] == 'UNKNOWN'),
    'enums_total': len(inv['enums']),
    'enums_base_missing_from_repo': [n for n, e in inv['enums'].items() if 'MISSING' in e['classification']],
    'functions_total': len(inv['functions']),
    'functions_missing_from_repo': [f['signature'] for f in inv['functions'] if 'MISSING' in f['classification']],
    'views_total': len(inv['views']),
    'views_missing_from_repo': [v['name'] for v in inv['views'] if 'MISSING' in v['classification']],
    'policies_total': len(inv['policies']),
    'rls_enabled_no_policies': inv['rls_enabled_no_policies'],
    'storage_buckets': [b['id'] for b in inv['storage']['buckets']],
    'cron_jobs': [r['jobid'] for r in inv['cron_jobs']],
    'known_rpcs_missing_everywhere': KNOWN_MISSING_RPCS,
    'known_views_missing_everywhere': KNOWN_MISSING_VIEWS,
}

out = os.path.join(REPO, 'artifacts/database/staging-schema-inventory.json')
with open(out, 'w') as f:
    json.dump(inv, f, indent=2)
print('wrote', out)
print('tables:', len(inv['tables']), '| enums:', len(inv['enums']), '| functions:', len(inv['functions']),
      '| views:', len(inv['views']), '| policies:', len(inv['policies']), '| cron:', len(inv['cron_jobs']))
print('RLS enabled, no policies:', len(inv['rls_enabled_no_policies']))
