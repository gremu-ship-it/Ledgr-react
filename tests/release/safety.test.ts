import { expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalOnly, removeOwnedDirectory } from './safety.mjs';
import { evidenceExit, suites } from './gate.mjs';
import { evidenceSuite, safeError } from './evidence';
import { readdirSync } from 'node:fs';
const test=evidenceSuite('harness-safety');
const meta=(id:string,expected:string)=>({id,expected,source:'tests/release/safety.mjs',remediation:'R13',productionVerificationRequired:false,layer:'local harness self-test'});
test(meta('HARNESS.LOCAL','Empty configuration is local only'),()=>expect(()=>assertLocalOnly({},[])).not.toThrow());
for(const environment of ['production','staging','test'])test(meta(`HARNESS.REFUSE.${environment}`,'No remote target is accepted even if named test/staging'),()=>expect(()=>assertLocalOnly({LEDGR_TEST_ENV:environment},[])).toThrow());
test(meta('HARNESS.REFUSE.URL','External database URL/host and extra command arguments refused'),()=>{
  for(const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','R13_DATABASE_URL','R13_SUPABASE_URL']) expect(()=>assertLocalOnly({[name]:'synthetic'},[])).toThrow();
  expect(()=>assertLocalOnly({},['--production'])).toThrow();
});
test(meta('HARNESS.CLEANUP','Only a generated direct child with matching owner marker can be removed'),async()=>{
  const parent=await mkdtemp(join(tmpdir(),'r13-safety-'));
  try {
    const own=await mkdtemp(join(parent,'ledgr-r13-'));await writeFile(join(own,'.r13-owner'),'synthetic-nonce');
    const foreign=join(parent,'foreign');await mkdir(foreign);await writeFile(join(foreign,'.r13-owner'),'synthetic-nonce');
    await expect(removeOwnedDirectory(foreign,parent,'synthetic-nonce')).rejects.toThrow();
    await expect(removeOwnedDirectory(own,parent,'wrong')).rejects.toThrow();
    await access(foreign);await access(own);
    await removeOwnedDirectory(own,parent,'synthetic-nonce');await expect(access(own)).rejects.toThrow();
    await access(foreign);
  } finally { await rm(parent,{recursive:true}); }
});
test(meta('HARNESS.GATE','A FAIL/blocked/missing/unknown/not-applicable-only result never gives green exit'),()=>{
  expect(evidenceExit([{status:'PASS'}])).toBe(0);
  expect(evidenceExit([{status:'PASS'},{status:'FAIL'}])).toBe(1);
  expect(evidenceExit([{status:'PASS'},{status:'BLOCKED'}])).toBe(2);
  expect(evidenceExit([])).toBe(2);expect(evidenceExit([{status:'NOT VERIFIED'}])).toBe(2);
  expect(evidenceExit([{status:'NOT APPLICABLE'}])).toBe(2);
});
test(meta('HARNESS.REDACTION','Unexpected error payloads are omitted; only SQLSTATE/numeric observations retained'),()=>{
  expect(safeError(new Error('synthetic-private-token-and-customer-payload'))).not.toContain('synthetic-private');
  expect(safeError({code:'42501',message:'synthetic-private'})).toBe('Database SQLSTATE 42501');
  expect(safeError({actual:'synthetic-private',expected:'another-private'})).not.toContain('private');
});
test(meta('HARNESS.DISCOVERY','Every release suite has an expected evidence artifact'),()=>{
  expect(Object.keys(suites).sort()).toEqual(readdirSync('tests/release').filter(n=>n.endsWith('.test.ts')).sort());
});
