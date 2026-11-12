import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20261220000000_audit_triggers_and_verifier_fix.sql';
const sql = readFileSync(migrationPath, 'utf8');

function functionDefinition(name: string): string {
  const start = sql.search(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'),
  );
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const delimiter = rest.match(/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i)?.[1];
  expect(delimiter, `missing SQL body delimiter for ${name}`).toBeTruthy();
  const end = rest.indexOf(`${delimiter};`);
  expect(end, `missing SQL body terminator for ${name}`).toBeGreaterThan(0);
  return rest.slice(0, end + delimiter!.length + 1);
}

describe('Phase 8D SEC-05 / SEC-06 audit migration contract', () => {
  it('redacts employee bank, national ID, TPIN, and temporary password values', () => {
    const redactor = functionDefinition('_redact_audit_pii');
    expect(redactor).toMatch(/RETURNS\s+jsonb/i);
    expect(redactor).toMatch(/IMMUTABLE/i);
    for (const field of [
      'bank_account_number',
      'national_id',
      'tpin',
      'temporary_password',
    ]) {
      expect(redactor).toMatch(new RegExp(`p_data\\s*\\?\\s*'${field}'`, 'i'));
      expect(redactor).toMatch(new RegExp(`jsonb_build_object\\s*\\(\\s*'${field}'\\s*,\\s*'\\[REDACTED\\]'`, 'i'));
    }
  });

  it('captures full employee row snapshots after redaction for all mutation operations', () => {
    const employeeAudit = functionDefinition('log_employee_audit_event');
    expect(employeeAudit).toMatch(/TG_OP\s*=\s*'INSERT'[\s\S]*?to_jsonb\(NEW\)/i);
    expect(employeeAudit).toMatch(/TG_OP\s*=\s*'UPDATE'[\s\S]*?to_jsonb\(OLD\)[\s\S]*?to_jsonb\(NEW\)/i);
    expect(employeeAudit).toMatch(/ELSE[\s\S]*?to_jsonb\(OLD\)/i);
    for (const event of ['employee_created', 'employee_updated', 'employee_deleted']) {
      expect(employeeAudit).toContain(event);
    }
    expect(employeeAudit).toMatch(/_redact_audit_pii\s*\(\s*to_jsonb\(NEW\)\s*\)/i);
    expect(employeeAudit).toMatch(/_redact_audit_pii\s*\(\s*to_jsonb\(OLD\)\s*\)/i);
    expect(employeeAudit).toMatch(/old_values,\s*new_values/i);
    expect(employeeAudit).toMatch(/v_old_values,\s*v_new_values/i);
  });

  it('attaches the replay-safe row trigger to public.employees', () => {
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_audit_employees\s+ON\s+public\.employees/i);
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_audit_employees\s+AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.employees\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.log_employee_audit_event\s*\(\s*\)/i,
    );
  });

  it('uses caller request IP context for audit entries when available', () => {
    const ipHelper = functionDefinition('_audit_request_ip');
    expect(ipHelper).toMatch(/current_setting\s*\(\s*'request\.headers'/i);
    expect(ipHelper).toMatch(/x-forwarded-for/i);
    expect(ipHelper).toMatch(/inet_client_addr\s*\(\s*\)/i);

    const manualAudit = functionDefinition('log_manual_audit_event');
    expect(manualAudit).toMatch(/v_ip\s+inet\s*:=\s*public\._audit_request_ip\s*\(\s*\)/i);
    expect(manualAudit).toMatch(/v_old_values\s+jsonb\s*:=\s*public\._redact_audit_pii/i);
    expect(manualAudit).toMatch(/v_new_values\s+jsonb\s*:=\s*public\._redact_audit_pii/i);
    expect(manualAudit).toMatch(/v_now,\s*v_ip,\s*v_prev,\s*v_hash/i);
  });

  it('verifies the unfiltered business-wide chain before filtering returned rows', () => {
    const verifier = functionDefinition('verify_audit_chain');
    expect(verifier).toMatch(/p_resource_type\s+text\s+DEFAULT\s+NULL/i);
    expect(verifier).toMatch(/RETURNS\s+TABLE\s*\([\s\S]*?chain_valid\s+boolean/i);

    const iteration = verifier.match(/FOR\s+r\s+IN([\s\S]*?)LOOP/i)?.[1] ?? '';
    expect(iteration).toMatch(/WHERE\s+al\.business_id\s*=\s*p_business_id/i);
    expect(iteration).toMatch(/ORDER\s+BY\s+al\.occurred_at\s+ASC\s*,\s*al\.id\s+ASC/i);
    expect(iteration).not.toMatch(/p_resource_type/i);

    const hashPosition = verifier.indexOf('v_expected := public.audit_chain_hash');
    const resultFilterPosition = verifier.indexOf('IF p_resource_type IS NULL');
    const predecessorAdvancePosition = verifier.indexOf('v_prev_entry := r.entry_hash');
    expect(hashPosition).toBeGreaterThanOrEqual(0);
    expect(resultFilterPosition).toBeGreaterThan(hashPosition);
    expect(predecessorAdvancePosition).toBeGreaterThan(resultFilterPosition);
    expect(verifier).toMatch(/r\.prev_hash\s+IS\s+NOT\s+DISTINCT\s+FROM\s+v_prev_entry/i);
  });
});
