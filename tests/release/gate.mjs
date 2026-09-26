export function evidenceExit(outcomes) {
  if (!outcomes.length) return 2;
  if (outcomes.some(r => !['PASS','FAIL','BLOCKED','NOT APPLICABLE'].includes(r.status))) return 2;
  if (outcomes.some(r => r.status === 'FAIL')) return 1;
  if (outcomes.some(r => r.status === 'BLOCKED')) return 2;
  return outcomes.some(r => r.status === 'PASS') ? 0 : 2;
}
export const suites = {
  'database.test.ts': 'database.json',
  'edge.test.ts': 'edge-handler-mocked-platform.json',
  'offline.test.ts': 'offline-indexeddb-postgres.json',
  'safety.test.ts': 'harness-safety.json',
  'r01-security.test.ts': 'r01-security.json',
  'r02-recovery.test.ts': 'r02-recovery.json',
  'r03-ai.test.ts': 'r03-ai.json',
  'r04-roles.test.ts': 'r04-roles.json',
  'r05-finance.test.ts': 'r05-finance.json',
  'r06-pos.test.ts': 'r06-pos.json',
  'r06-stock.test.ts': 'r06-stock.json',
  'r07-approvals.test.ts': 'r07-approvals.json',
  'r08-shifts.test.ts': 'r08-shifts.json',
  'r07-corrections.test.ts': 'r07-corrections.json',
  'r093-reconciliation.test.ts': 'r093-reconciliation.json',
  'r094-browser.test.ts': 'r094-browser.json',
  'r094-sw-update.test.ts': 'r094-sw-update.json',
  'r094-revalidation-investigation.test.ts': 'r094-revalidation-investigation.json',
  'r06-concurrent-2c.test.ts': 'r06-concurrent-2c.json',
  'ic-containment.test.ts': 'ic-containment.json',
  'od-owner-decisions.test.ts': 'od-owner-decisions.json',
};
