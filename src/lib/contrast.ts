/**
 * WCAG 2.2 Relative Luminance and Contrast Ratio Calculations
 * Compliant with WCAG 2.2 Level AA / AAA specifications.
 */

export interface ContrastResult {
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly passesNormalTextAA: boolean; // >= 4.5:1
  readonly passesLargeTextAA: boolean; // >= 3.0:1
  readonly passesNonTextAA: boolean; // >= 3.0:1
  readonly passesAAA: boolean; // >= 7.0:1
}

/**
 * Converts a 6-digit hex color string (e.g., "#18181B" or "18181B") to sRGB channels (0-255).
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace(/^#/, '');
  if (cleanHex.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}. Expected 6 hex characters.`);
  }

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Could not parse RGB channels from hex color: ${hex}`);
  }

  return { r, g, b };
}

/**
 * Calculates the relative luminance of an sRGB color.
 * Formula per W3C WCAG 2.2:
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function calculateRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  const [sR, sG, sB] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * sR! + 0.7152 * sG! + 0.0722 * sB!;
}

/**
 * Calculates the contrast ratio between two hex colors.
 * Formula per W3C WCAG 2.2: (L1 + 0.05) / (L2 + 0.05) where L1 >= L2.
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateRelativeLuminance(hex1);
  const lum2 = calculateRelativeLuminance(hex2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  // Round to 2 decimal places
  return Math.round(ratio * 100) / 100;
}

/**
 * Evaluates WCAG 2.2 AA and AAA compliance for a foreground/background pair.
 */
export function evaluateContrast(foregroundHex: string, backgroundHex: string): ContrastResult {
  const ratio = calculateContrastRatio(foregroundHex, backgroundHex);

  return {
    foreground: foregroundHex,
    background: backgroundHex,
    ratio,
    passesNormalTextAA: ratio >= 4.5,
    passesLargeTextAA: ratio >= 3.0,
    passesNonTextAA: ratio >= 3.0,
    passesAAA: ratio >= 7.0,
  };
}
