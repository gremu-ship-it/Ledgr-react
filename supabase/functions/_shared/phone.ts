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
 * Character classes for a temporary password.
 *
 * Deliberately unambiguous — no 0/O, no 1/l/I — because the owner reads it off
 * a screen, or off a printed slip, and types it into a phone that autocorrects.
 * Symbols skip the ones that are painful to dictate or that break out of a
 * shell/URL if the owner pastes the password somewhere unexpected.
 */
const PASSWORD_LOWERS = 'abcdefghjkmnpqrstuvwxyz';
const PASSWORD_UPPERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#%*+=?';
const PASSWORD_ALL = PASSWORD_LOWERS + PASSWORD_UPPERS + PASSWORD_DIGITS + PASSWORD_SYMBOLS;

function randomChar(alphabet: string): string {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return alphabet[bytes[0] % alphabet.length];
}

/** Fisher-Yates with crypto randomness, so the class guarantees below do not
 *  leak as fixed positions. */
function shuffle(chars: string[]): string[] {
  const out = [...chars];
  const bytes = new Uint8Array(out.length);
  crypto.getRandomValues(bytes);
  for (let i = out.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A temporary password for a phone account.
 *
 * A project can enforce a password policy (Auth → Password requirements:
 * letters, digits and/or symbols, plus a minimum length) and GoTrue applies it
 * to `auth.admin.createUser` as well as to sign-up. A password that fails the
 * policy makes the invite fail with a 422 the owner cannot act on, so every
 * password we hand out satisfies the strictest preset
 * (`lower_upper_letters_digits_symbols`) by construction: one character from
 * each class, the rest from the combined alphabet, then shuffled.
 */
export function generateTempPassword(length = 12): string {
  const size = Math.max(length, 8);
  const required = [
    randomChar(PASSWORD_LOWERS),
    randomChar(PASSWORD_UPPERS),
    randomChar(PASSWORD_DIGITS),
    randomChar(PASSWORD_SYMBOLS),
  ];
  const rest = Array.from({ length: size - required.length }, () => randomChar(PASSWORD_ALL));
  return shuffle([...required, ...rest]).join('');
}
