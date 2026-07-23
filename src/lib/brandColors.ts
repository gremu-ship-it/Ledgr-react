/**
 * Generates a full brand color scale (50-950) from a single hex color.
 * Uses HSL manipulation to create lighter and darker shades.
 */

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (60 <= h && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (120 <= h && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (180 <= h && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (240 <= h && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (300 <= h && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  const rHex = Math.round((r + m) * 255)
    .toString(16)
    .padStart(2, '0');
  const gHex = Math.round((g + m) * 255)
    .toString(16)
    .padStart(2, '0');
  const bHex = Math.round((b + m) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

export function generateBrandScale(baseHex: string): Record<string, string> {
  const { h, s } = hexToHSL(baseHex);

  // Define lightness values for each shade
  // These create a perceptually balanced scale
  const scale = {
    50: 96,
    100: 91,
    200: 84,
    300: 76,
    400: 66,
    500: Math.max(40, Math.min(60, 50)), // Base color around 50% lightness
    600: 42,
    700: 35,
    800: 28,
    900: 22,
    950: 15,
  };

  // Adjust saturation for different shades
  // Lighter shades have less saturation, darker shades have slightly more
  const result: Record<string, string> = {};

  for (const [shade, lightness] of Object.entries(scale)) {
    let adjustedSat = s;

    // Reduce saturation for very light shades
    if (parseInt(shade) < 500) {
      const factor = (parseInt(shade) - 50) / 450; // 0 to 1
      adjustedSat = Math.max(20, s * (0.5 + factor * 0.5));
    }
    // Slightly increase saturation for darker shades
    else if (parseInt(shade) > 500) {
      const factor = (parseInt(shade) - 500) / 450;
      adjustedSat = Math.min(100, s * (1 + factor * 0.2));
    }

    result[shade] = hslToHex(h, adjustedSat, lightness);
  }

  return result;
}

export function applyBrandColors(hex: string): void {
  const scale = generateBrandScale(hex);
  const root = document.documentElement;

  for (const [shade, color] of Object.entries(scale)) {
    root.style.setProperty(`--color-brand-${shade}`, color);
  }
}

export function resetBrandColors(): void {
  const root = document.documentElement;
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  for (const shade of shades) {
    root.style.removeProperty(`--color-brand-${shade}`);
  }
}
