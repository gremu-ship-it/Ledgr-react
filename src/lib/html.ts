/**
 * html.ts — shared HTML-escaping helpers.
 *
 * Several features open a print-friendly document in a new tab via
 * `document.write(...)` (reports, audit-log exports, repayment schedules).
 * Any user- or database-supplied string interpolated into that markup must
 * go through `escapeHtml` first — otherwise a value like
 * `</title><script>…</script>` in a lender name or business name executes
 * script in the print window, which is same-origin with the app.
 *
 * Use this helper everywhere instead of re-declaring local `esc` functions.
 */

/** Escape the five characters that matter for HTML text/attribute contexts. */
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** RFC 4648 hex encoding of a digest — used for export signatures. */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute a hex SHA-256 of a string with Web Crypto.
 *
 * `crypto.subtle` only exists in secure contexts (HTTPS / localhost). When it
 * is unavailable (older embedded webviews), return null so the caller can say
 * "signature unavailable" instead of printing something misleading.
 */
export async function sha256Hex(content: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return toHex(digest);
  } catch {
    return null;
  }
}
