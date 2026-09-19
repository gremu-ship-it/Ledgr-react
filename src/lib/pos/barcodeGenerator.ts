/**
 * Pure TypeScript Code 128 (Subset B) Barcode Generator.
 * Generates structured bars for native React SVG rendering without innerHTML.
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
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112', // 100-106
];

const START_B_INDEX = 104;
const STOP_INDEX = 106;

/**
 * Generate binary modules string for Code 128 Subset B string
 */
export function encodeCode128B(text: string): string {
  if (!text) return '';

  let cleanText = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      cleanText += text[i];
    }
  }
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

export interface BarcodeRect {
  x: number;
  width: number;
}

export interface BarcodeData {
  bars: BarcodeRect[];
  totalWidth: number;
  height: number;
  text: string;
}

/**
 * Compute bar geometries for pure React rendering without innerHTML
 */
export function getBarcodeData(
  text: string,
  options: { height?: number; barWidth?: number } = {},
): BarcodeData {
  const height = options.height || 40;
  const barWidth = options.barWidth || 1.5;
  const binary = encodeCode128B(text);

  if (!binary) {
    return { bars: [], totalWidth: 0, height, text };
  }

  const totalWidth = binary.length * barWidth;
  const bars: BarcodeRect[] = [];
  let currentBarStart = -1;

  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      if (currentBarStart === -1) currentBarStart = i;
    } else {
      if (currentBarStart !== -1) {
        bars.push({
          x: currentBarStart * barWidth,
          width: (i - currentBarStart) * barWidth,
        });
        currentBarStart = -1;
      }
    }
  }

  if (currentBarStart !== -1) {
    bars.push({
      x: currentBarStart * barWidth,
      width: (binary.length - currentBarStart) * barWidth,
    });
  }

  return { bars, totalWidth, height, text };
}
