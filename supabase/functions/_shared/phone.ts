// supabase/functions/_shared/phone.ts
//
// Phone-number identity helpers for Edge Functions.
//
// MIRRORS src/lib/phone.ts — the two must agree exactly. The client derives a
// phone account's login email from the number alone, so if the server derives
// a different address the account exists but can never be signed into.
// src/lib/__tests__/phone.test.ts pins the client side; keep this in step.
//
// Usage:
//   import { normalizePhone, phoneLoginEmail } from '../_shared/phone.ts';

/** Must match PHONE_LOGIN_EMAIL_DOMAIN in src/lib/phone.ts. */
export const PHONE_LOGIN_EMAIL_DOMAIN = 'phone.ledgr.app';

/** Must match DEFAULT_CALLING_CODE in src/lib/phone.ts. Malawi. */
export const DEFAULT_CALLING_CODE = '265';

const NATIONAL_LENGTH: Record<string, number> = {
  '265': 9,
};

const E164_MAX_DIGITS = 15;
const E164_MIN_DIGITS = 8;

export interface NormalizePhoneOptions {
  defaultCallingCode?: string;
}

/** Normalises user input to E.164 (`+265991234567`), or null. */
export function normalizePhone(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {},
): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  const callingCode = options.defaultCallingCode ?? DEFAULT_CALLING_CODE;
  const hadPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  let full: string;
  if (hadPlus) {
    full = digits;
  } else if (digits.startsWith('00')) {
    full = digits.slice(2);
  } else if (digits.startsWith('0')) {
    full = callingCode + digits.slice(1);
  } else if (
    digits.startsWith(callingCode) &&
    NATIONAL_LENGTH[callingCode] &&
    digits.length === callingCode.length + NATIONAL_LENGTH[callingCode]
  ) {
    full = digits;
  } else if (NATIONAL_LENGTH[callingCode] && digits.length === NATIONAL_LENGTH[callingCode]) {
    full = callingCode + digits;
  } else {
    full = digits;
  }

  if (full.length < E164_MIN_DIGITS || full.length > E164_MAX_DIGITS) return null;
  if (full.startsWith('0')) return null;

  return `+${full}`;
}

export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** The synthetic login email for a phone number, or null. */
export function phoneLoginEmail(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {},
): string | null {
  const e164 = normalizePhone(input, options);
  if (!e164) return null;
  return `${phoneDigits(e164)}@${PHONE_LOGIN_EMAIL_DOMAIN}`;
}

export function isPhoneLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const local = email.slice(0, at);
  return email.slice(at + 1).toLowerCase() === PHONE_LOGIN_EMAIL_DOMAIN && /^\d+$/.test(local);
}

/** Human-readable form for messages and the team list. */
export function formatPhoneForDisplay(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {},
): string {
  const e164 = normalizePhone(input, options);
  if (!e164) return (input ?? '').trim();
  const digits = phoneDigits(e164);
  const callingCode = options.defaultCallingCode ?? DEFAULT_CALLING_CODE;
  if (digits.startsWith(callingCode)) {
    const national = digits.slice(callingCode.length);
    return `+${callingCode} ${national.replace(/(\d{3})(?=\d)/g, '$1 ').trim()}`;
  }
  return `+${digits}`;
}

/**
 * A temporary password for a phone account. Deliberately unambiguous (no 0/O,
 * 1/l/I) because it is read off a screen or a printed slip, and long enough to
 * clear Supabase's minimum password length.
 */
export function generateTempPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}
