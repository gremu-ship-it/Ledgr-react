/**
 * The client and the Edge Function must derive the SAME login email from a
 * phone number. The server provisions the account; months later the login
 * screen derives the address from the number alone. If either constant or the
 * normalisation drifts, the account exists but can never be signed into — and
 * nothing fails loudly.
 *
 * There is no shared package between the Vite app and Deno functions, so assert
 * the two sources agree, the way rlsRoleParity.test.ts does for TypeScript ↔ SQL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALLING_CODE, PHONE_LOGIN_EMAIL_DOMAIN } from '../phone';

const REPO_ROOT = resolve(__dirname, '../../..');
const DENO_PHONE = resolve(REPO_ROOT, 'supabase/functions/_shared/phone.ts');
const CLIENT_PHONE = resolve(REPO_ROOT, 'src/lib/phone.ts');

/** Reads `export const NAME = '...';` */
function constant(src: string, name: string): string {
  const m = new RegExp(`export const ${name} = '([^']+)'`).exec(src);
  expect(m, `${name} not found`).toBeTruthy();
  return m![1];
}

/**
 * Body of a top-level `export function <name>(...)`, with comments and
 * whitespace removed so only the logic is compared.
 */
function logicOf(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}\n', start) + 2);
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');
}

describe('phone identity parity (client ↔ Edge Functions)', () => {
  const deno = readFileSync(DENO_PHONE, 'utf8');
  const client = readFileSync(CLIENT_PHONE, 'utf8');

  it('agrees on the synthetic email domain', () => {
    expect(constant(deno, 'PHONE_LOGIN_EMAIL_DOMAIN')).toBe(PHONE_LOGIN_EMAIL_DOMAIN);
  });

  it('agrees on the default calling code', () => {
    expect(constant(deno, 'DEFAULT_CALLING_CODE')).toBe(DEFAULT_CALLING_CODE);
  });

  it('normalises numbers identically', () => {
    expect(logicOf(deno, 'normalizePhone')).toBe(logicOf(client, 'normalizePhone'));
  });

  it('derives the login email identically', () => {
    expect(logicOf(deno, 'phoneLoginEmail')).toBe(logicOf(client, 'phoneLoginEmail'));
  });

  it('recognises its own synthetic addresses identically', () => {
    expect(logicOf(deno, 'isPhoneLoginEmail')).toBe(logicOf(client, 'isPhoneLoginEmail'));
  });
});
