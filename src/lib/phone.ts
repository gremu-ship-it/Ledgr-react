/**
 * Phone numbers as a first-class identity for team members.
 *
 * Why this exists
 * ───────────────
 * Till staff are added by the number the owner already has, not by an email
 * address they may not use. Supabase Auth identifies an account by email *or*
 * phone; phone sign-in (`signInWithOtp({ phone })`) needs an SMS provider and
 * costs per message. Instead we keep password auth and give every phone account
 * a **deterministic synthetic email** derived from the number:
 *
 *     +265991234567  →  265991234567@phone.ledgr.app
 *
 * Because the mapping is a pure function of the number, the login screen can
 * derive the email client-side and call the existing `signInWithPassword` — no
 * lookup endpoint, and therefore no oracle for enumerating which numbers have
 * accounts (Supabase returns the same "invalid credentials" for an unknown
 * email as for a wrong password).
 *
 * The Edge Function that provisions these accounts
 * (supabase/functions/_shared/phone.ts) MUST keep the same domain, otherwise
 * accounts created by the server cannot be signed into by the client.
 */

/** Domain of the synthetic emails. Must match supabase/functions/_shared/phone.ts. */
export const PHONE_LOGIN_EMAIL_DOMAIN = 'phone.ledgr.app';

/** Malawi. Used when the owner types a local number like 0991234567. */
export const DEFAULT_CALLING_CODE = '265';

/** National (significant) number length per calling code, where known. */
const NATIONAL_LENGTH: Record<string, number> = {
  '265': 9,
};

/** E.164 caps the whole number, country code included, at 15 digits. */
const E164_MAX_DIGITS = 15;
/** Shortest plausible full number: a 1-3 digit country code plus ~5 digits. */
const E164_MIN_DIGITS = 8;

export interface NormalizePhoneOptions {
  /** Calling code assumed for local numbers. Defaults to Malawi. */
  defaultCallingCode?: string;
}

/**
 * Normalises user input to E.164 (`+265991234567`), or null when the input
 * cannot be a phone number.
 *
 * Accepts the formats an owner actually types:
 *   0991234567 · 0991 234 567 · +265991234567 · 265 991 234 567 · 00265991234567
 *
 * Only length is validated, not carrier prefixes — a wrong-prefix number is
 * the owner's mistake to discover, and rejecting valid prefixes we did not
 * know about would lock real staff out.
 */
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
    // Explicit international format — take it at face value.
    full = digits;
  } else if (digits.startsWith('00')) {
    // 00 is the international prefix used across Africa and Europe.
    full = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // Local format: drop the trunk 0, add the default calling code.
    full = callingCode + digits.slice(1);
  } else if (
    digits.startsWith(callingCode) &&
    NATIONAL_LENGTH[callingCode] &&
    digits.length === callingCode.length + NATIONAL_LENGTH[callingCode]
  ) {
    // Already carries the calling code, no trunk 0 (265991234567).
    full = digits;
  } else if (NATIONAL_LENGTH[callingCode] && digits.length === NATIONAL_LENGTH[callingCode]) {
    // Bare national number (991234567).
    full = callingCode + digits;
  } else {
    // Unrecognised shape — keep the digits and let the length check decide.
    full = digits;
  }

  if (full.length < E164_MIN_DIGITS || full.length > E164_MAX_DIGITS) return null;
  if (full.startsWith('0')) return null;

  return `+${full}`;
}

/** E.164 without the leading `+` — the local part of the synthetic email. */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

/**
 * The synthetic login email for a phone number, or null if the number is not
 * normalisable. Never stored as a "real" address — nothing is ever sent to it.
 */
export function phoneLoginEmail(
  input: string | null | undefined,
  options: NormalizePhoneOptions = {},
): string | null {
  const e164 = normalizePhone(input, options);
  if (!e164) return null;
  return `${phoneDigits(e164)}@${PHONE_LOGIN_EMAIL_DOMAIN}`;
}

/** True when an email is one of our synthetic phone-login addresses. */
export function isPhoneLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const local = email.slice(0, at);
  return email.slice(at + 1).toLowerCase() === PHONE_LOGIN_EMAIL_DOMAIN && /^\d+$/.test(local);
}

/** `+265991234567` → `+265 991 234 567`. Falls back to the raw number. */
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
 * Share links so the *owner's* phone delivers the invite — no SMS gateway, no
 * per-message cost. WhatsApp is the default channel in Malawi; `sms:` covers
 * feature phones.
 */
export function whatsappShareLink(
  phone: string | null | undefined,
  message: string,
  options: NormalizePhoneOptions = {},
): string | null {
  const e164 = normalizePhone(phone, options);
  if (!e164) return null;
  return `https://wa.me/${phoneDigits(e164)}?text=${encodeURIComponent(message)}`;
}

export function smsShareLink(
  phone: string | null | undefined,
  message: string,
  options: NormalizePhoneOptions = {},
): string | null {
  const e164 = normalizePhone(phone, options);
  if (!e164) return null;
  return `sms:${e164}?body=${encodeURIComponent(message)}`;
}
