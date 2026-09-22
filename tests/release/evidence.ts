import { afterAll, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Blocked extends Error {}
export class ObservedFailure extends Error {}
export interface Metadata {
  id: string; expected: string; source: string; remediation: string;
  layer?: string; productionVerificationRequired?: boolean;
}
export interface Outcome extends Metadata {
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT APPLICABLE'; actual: string;
  environment: 'local'; customerDataTouched: false; customerDataCouldBeAffectedIfDeployed: boolean;
}
// Only controlled assertion messages/code are retained; never stack, SQL payload, headers or tokens.
export function safeError(error: unknown): string {
  if (error instanceof Blocked || error instanceof ObservedFailure) return error.message;
  const code = (error as { code?: string })?.code;
  if (code && /^[0-9A-Z]{5}$/.test(code)) return `Database SQLSTATE ${code}`;
  const e = error as {actual?: unknown; expected?: unknown};
  const numeric = (v: unknown) => typeof v === 'number' || typeof v === 'boolean' || v === null;
  if (numeric(e?.actual) && numeric(e?.expected)) return `Observed ${e.actual}; expected ${e.expected}.`;
  if (numeric(e?.actual)) return `Observed ${e.actual}; required assertion not satisfied.`;
  return 'Assertion failed; inspect the identified source with synthetic fixtures.';
}
export function evidenceSuite(name: string) {
  const outcomes: Outcome[] = [];
  afterAll(() => {
    const directory = process.env.R13_EVIDENCE_DIR;
    if (!directory) throw new Error('Run via npm run test:release; missing owned evidence directory');
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(outcomes, null, 2), { mode: 0o600 });
  });
  return (meta: Metadata, run: () => unknown | Promise<unknown>) => {
    const base = { ...meta, layer: meta.layer ?? name, environment: 'local' as const,
      customerDataTouched: false as const, customerDataCouldBeAffectedIfDeployed: meta.remediation !== 'R13',
      productionVerificationRequired: meta.productionVerificationRequired ?? true };
    const index = outcomes.push({ ...base, status: 'BLOCKED', actual: 'Test did not execute; inspect suite setup/tooling.' }) - 1;
    return it(meta.id, async (context) => {
      try {
        await run();
        outcomes[index] = { ...base, status: 'PASS', actual: 'Expected assertion observed in the labeled local layer.' };
      } catch (error) {
        const status = error instanceof Blocked ? 'BLOCKED' : 'FAIL';
        outcomes[index] = { ...base, status, actual: safeError(error) };
        if (status === 'BLOCKED') context.skip(safeError(error));
        // eslint-disable-next-line preserve-caught-error -- Raw causes may contain credentials/payloads; retain sanitized evidence only.
        else throw new Error(`${meta.id}: ${safeError(error)}`);
      }
    });
  };
}
