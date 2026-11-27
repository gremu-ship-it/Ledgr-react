/**
 * Minimal Code 39 barcode renderer built from native SVG.
 *
 * The dispensary and laboratory labels only need a scannable machine code for
 * an internal identifier (SMP-2026-0001), so Code 39 is enough: it is
 * alphanumeric, self-checking, and can be drawn without a font or a package.
 *
 * Each character is a 12-module pattern (three wide elements, six narrow).
 * We render the module string as SVG rectangles rather than using canvas so
 * the label can be printed at any DPI and embedded in an iframe document.
 */

/** Code 39 patterns: 1 = bar/space module on, 0 = off, 12 modules per char. */
const CODE39_PATTERNS: Record<string, string> = {
  '0': '101001101101',
  '1': '110100101011',
  '2': '101100101011',
  '3': '110110010101',
  '4': '101001101011',
  '5': '110100110101',
  '6': '101100110101',
  '7': '101001011011',
  '8': '110100101101',
  '9': '101100101101',
  A: '110101001011',
  B: '101101001011',
  C: '110110100101',
  D: '101011001011',
  E: '110101100101',
  F: '101101100101',
  G: '101010011011',
  H: '110101001101',
  I: '101101001101',
  J: '101011001101',
  K: '110101010011',
  L: '101101010011',
  M: '110110101001',
  N: '101011010011',
  O: '110101101001',
  P: '101101101001',
  Q: '101010110011',
  R: '110101011001',
  S: '101101011001',
  T: '101011011001',
  U: '110010101011',
  V: '100110101011',
  W: '110011010101',
  X: '100101101011',
  Y: '110010110101',
  Z: '100110110101',
  '-': '100101011011',
  '.': '110010101101',
  ' ': '100110101101',
  $: '100100100101',
  '/': '100100101001',
  '+': '100101001001',
  '%': '101001001001',
  '*': '100101101101',
};

/** Tiny guard so SVG text cannot inject markup. */
export function escapeBarcodeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Uppercase the code and replace anything outside the Code 39 alphabet with a
 * dash. Barcodes are machine identifiers, so silently sanitising is safer than
 * printing an unreadable symbol.
 */
export function sanitizeCode39(value: string): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z\-. $/+%]/g, '-')
    .trim()
    .slice(0, 40);
}

/** Module string including the start/stop asterisks and inter-character gap. */
export function encodeCode39(value: string): string {
  const sanitized = sanitizeCode39(value);
  if (!sanitized) return '';
  const characters = `*${sanitized}*`.split('');
  return characters
    .map((character) => CODE39_PATTERNS[character] ?? CODE39_PATTERNS['-'])
    .join('0');
}

export interface BarcodeOptions {
  /** Rendered width in px. The SVG also scales with its container. */
  width?: number;
  height?: number;
  /** Quiet zone in modules on either side. */
  quietZone?: number;
  showText?: boolean;
  color?: string;
}

/**
 * Build a standalone `<svg>` string for the code. Returns an empty string for
 * an empty value so callers can fall back to plain text.
 */
export function buildCode39Svg(value: string, options: BarcodeOptions = {}): string {
  const binary = encodeCode39(value);
  if (!binary) return '';

  const quiet = Math.max(2, options.quietZone ?? 10);
  const height = Math.max(24, options.height ?? 56);
  const showText = options.showText ?? true;
  const color = options.color ?? '#000000';
  const totalModules = binary.length + quiet * 2;
  const width = Math.max(80, options.width ?? totalModules * 2);
  const textHeight = showText ? 14 : 0;
  const totalHeight = height + textHeight;

  const rects: string[] = [];
  let runStart = -1;
  for (let index = 0; index <= binary.length; index += 1) {
    const module = binary[index];
    if (module === '1' && runStart < 0) runStart = index;
    if (module !== '1' && runStart >= 0) {
      rects.push(
        `<rect x="${runStart + quiet}" y="0" width="${index - runStart}" height="${height}"/>`,
      );
      runStart = -1;
    }
  }

  const text = showText
    ? `<text x="${totalModules / 2}" y="${height + 11}" text-anchor="middle" ` +
      `font-family="monospace" font-size="11">${escapeBarcodeText(value)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
    `viewBox="0 0 ${totalModules} ${totalHeight}" preserveAspectRatio="none" ` +
    `role="img" aria-label="${escapeBarcodeText(value)}" shape-rendering="crispEdges">` +
    `<g fill="${color}">${rects.join('')}${text}</g></svg>`
  );
}
