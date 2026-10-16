// Execute the actual workflow shell blocks with a fake CLI: no Docker,
// Supabase credentials, dependencies, or network required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

for (const environment of ['staging', 'production']) {
  const block = workflow.match(new RegExp(
    `      - name: Deploy Edge Functions \\(${environment}\\)\\n        id: edge\\n        run: \\|\\n((?:          [^\\n]*\\n)+)`,
  ));
  assert.ok(block, `Missing ${environment} Edge Function step`);
  const script = block[1].replace(/^          /gm, '');

  for (const failure of [false, true]) {
    test(`${environment}: API bundling ${failure ? 'fails closed' : 'deploys every function with auth flags intact'}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), 'edge-deploy-'));
      try {
        mkdirSync(join(cwd, 'bin'));
        for (const fn of ['accept-invite-link', 'api', 'webhook-dispatcher', '_shared']) {
          mkdirSync(join(cwd, 'supabase/functions', fn), { recursive: true });
        }
        writeFileSync(join(cwd, 'bin/supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$4" != --use-api ]]; then exit 99; fi
if [[ "$3" == accept-invite-link && "$FAIL" == yes ]]; then exit 42; fi
exit 0
`, { mode: 0o755 });
        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${join(cwd, 'bin')}:${process.env.PATH}`, SUPABASE_PROJECT_REF: 'test-project', CALLS: join(cwd, 'calls'), FAIL: failure ? 'yes' : 'no' },
        });
        const calls = readFileSync(join(cwd, 'calls'), 'utf8').trim().split('\n');
        const expected = (failure ? ['accept-invite-link'] : ['accept-invite-link', 'api', 'webhook-dispatcher'])
          .map(fn => `functions deploy ${fn} --use-api --no-verify-jwt --project-ref test-project`);
        assert.deepEqual(calls, expected);
        if (failure) assert.notEqual(result.status, 0, 'Function failure must block the frontend');
        else assert.equal(result.status, 0, result.stderr);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}
