/**
 * Pure TypeScript Code 128 (Subset B) Barcode Generator.
 * Generates SVG vector string or renders directly to HTMLCanvasElement.
 */

// Code 128 patterns (Subset B)
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', // 0-9
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', // 10-19
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', // 20-29
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 30-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', // 40-49
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', // 50-59
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', // 60-69
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 70-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', // 80-89
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', // 90-99
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112', // 100-106 (Stop pattern is 7 digits)
];

const START_B_INDEX = 104;
const STOP_INDEX = 106;

/**
 * Generate binary modules string for Code 128 Subset B string
 */
export function encodeCode128B(text: string): string {
  if (!text) return '';

  const cleanText = text.replace(/[\x00-\x1F\x7F-\xFF]/g, ''); // ASCII 32-126
  let checksum = START_B_INDEX;
  const indices: number[] = [START_B_INDEX];

  for (let i = 0; i < cleanText.length; i++) {
    const charCode = cleanText.charCodeAt(i);
    const charIndex = charCode - 32;
    indices.push(charIndex);
    checksum += charIndex * (i + 1);
  }

  const checkIndex = checksum % 103;
  indices.push(checkIndex);
  indices.push(STOP_INDEX);

  // Convert pattern strings (widths: 1, 2, 3, 4) into binary 1s and 0s
  let binaryString = '';
  indices.forEach((index) => {
    const pattern = CODE128_PATTERNS[index];
    if (!pattern) return;
    let isBar = true;
    for (let p = 0; p < pattern.length; p++) {
      const width = parseInt(pattern[p], 10);
      binaryString += (isBar ? '1' : '0').repeat(width);
      isBar = !isBar;
    }
  });

  return binaryString;
}

/**
 * Generate standalone SVG representation of Code 128 barcode
 */
export function generateBarcodeSvg(
  text: string,
  options: {
    height?: number;
    barWidth?: number;
    showText?: boolean;
    color?: string;
  } = {},
): string {
  const height = options.height || 50;
  const barWidth = options.barWidth || 2;
  const showText = options.showText !== false;
  const color = options.color || '#000000';

  const binary = encodeCode128B(text);
  if (!binary) return '';

  const totalWidth = binary.length * barWidth;
  const svgHeight = showText ? height + 16 : height;

  let rects = '';
  let currentBarStart = -1;

  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      if (currentBarStart === -1) currentBarStart = i;
    } else {
      if (currentBarStart !== -1) {
        const w = (i - currentBarStart) * barWidth;
        const x = currentBarStart * barWidth;
        rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${color}" />`;
        currentBarStart = -1;
      }
    }
  }

  if (currentBarStart !== -1) {
    const w = (binary.length - currentBarStart) * barWidth;
    const x = currentBarStart * barWidth;
    rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${color}" />`;
  }

  const textElement = showText
    ? `<text x="${totalWidth / 2}" y="${height + 12}" font-family="monospace" font-size="11" font-weight="bold" text-anchor="middle" fill="${color}">${text}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${svgHeight}" width="${totalWidth}" height="${svgHeight}">${rects}${textElement}</svg>`;
}
