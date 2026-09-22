import { resolve, dirname, basename } from 'node:path';
import { readFile, rm, realpath } from 'node:fs/promises';

export function assertLocalOnly(env = process.env, args = []) {
  if (args.length || (env.LEDGR_TEST_ENV && env.LEDGR_TEST_ENV !== 'local')) {
    throw new Error('R13 supports local disposable environments only; remote/production execution refused.');
  }
  // No URL, credentials, host or port accepted from ambient application/test config.
  for (const name of Object.keys(env)) {
    if (/^(DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|R13_DATABASE_URL|R13_SUPABASE_URL)$/.test(name) && env[name]) {
      throw new Error('External database configuration refused (value withheld).');
    }
  }
}

export async function removeOwnedDirectory(directory, parent, nonce) {
  const actual = await realpath(directory);
  if (dirname(actual) !== await realpath(parent) || !basename(actual).startsWith('ledgr-r13-')) {
    throw new Error('Cleanup refused: directory is not an owned R13 child.');
  }
  if (await readFile(resolve(actual, '.r13-owner'), 'utf8') !== nonce) {
    throw new Error('Cleanup refused: ownership marker mismatch.');
  }
  await rm(actual, { recursive: true });
}
