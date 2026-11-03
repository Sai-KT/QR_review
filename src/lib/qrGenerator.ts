/**
 * Digital QR Generator & High-Resolution Export Engine
 *
 * Source: docs/ROADMAP.md (Task M5-T06); docs/UI_UX.md (SCR-OWN-06 / CMP-14)
 * Architecture: docs/ARCHITECTURE.md §lib/qrGenerator.ts
 *
 * Responsibilities:
 * - Generates ISO/IEC 18004 compliant QR matrices using pure TypeScript qrcodegen.
 * - Formats canonical first-party public review URLs: https://[domain]/q/:public_qr_id.
 * - Renders interactive canvas preview and generates high-resolution 1024x1024 PNG exports.
 * - Enforces mandatory 4-module quiet zone (quiet margin) per ISO/IEC 18004.
 * - Supports optional central brand logo overlay with error correction level H (High: ~30% recovery)
 *   and protective quiet padding to guarantee scan readability.
 * - Provides clean fallback monogram avatar when custom logo is not uploaded.
 */

import { QrCode, QrEcc } from './qrcodegen';

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrixResult {
  /** Size of QR code matrix in modules without quiet zone (e.g. 25) */
  matrixSize: number;
  /** Quiet zone width in modules (default: 4) */
  quietZone: number;
  /** Total dimension including quiet zone (matrixSize + 2 * quietZone) */
  totalSize: number;
  /** 2D grid of modules (true = dark, false = light) of dimension totalSize x totalSize */
  modules: boolean[][];
  /** Returns true if the module at (x, y) is dark */
  getModule: (x: number, y: number) => boolean;
}

export interface QrRenderOptions {
  /** Target canvas pixel dimension (default: 256 for preview, 1024 for high-res export) */
  size?: number;
  /** Quiet zone modules per ISO/IEC 18004 (default: 4) */
  quietZone?: number;
  /** Error correction level (default: 'H' to safely accommodate central branding) */
  errorCorrectionLevel?: ErrorCorrectionLevel;
  /** Module fill color (default: '#000000') */
  foregroundColor?: string;
  /** Background fill color (default: '#ffffff') */
  backgroundColor?: string;
  /** Optional logo image URL to overlay in center */
  logoUrl?: string | null;
  /** Bounded ratio of logo box relative to total QR width (default: 0.20, max: 0.22) */
  logoSizeRatio?: number;
  /** Corner radius for central logo container in pixels at target size (default: 8) */
  logoBorderRadius?: number;
  /** Quiet padding around central logo in pixels at target size (default: 6) */
  logoPadding?: number;
  /** Fallback business monogram initials when logoUrl is absent */
  fallbackMonogram?: string;
  /** Business display name */
  businessName?: string;
}

export interface QrExportOptions extends QrRenderOptions {
  /** Filename for exported PNG download */
  filename?: string;
}

function getProcessEnv(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env?.[key];
}

/**
 * Retrieves the configured application origin (e.g. https://app.qrs.co) from
 * Vite client environment variables or Node runtime process.
 */
export function getConfiguredAppUrl(): string | undefined {
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    'VITE_APP_URL' in import.meta.env &&
    typeof import.meta.env.VITE_APP_URL === 'string'
  ) {
    return import.meta.env.VITE_APP_URL;
  }
  return getProcessEnv('VITE_APP_URL');
}

/**
 * Validates public QR ID format.
 * Decoupled 10-character URL-safe alphanumeric string (e.g. 'luxe000001').
 */
export function isValidPublicQrId(publicQrId: string): boolean {
  return /^[a-zA-Z0-9_-]{6,32}$/.test(publicQrId);
}

/**
 * Builds the canonical first-party public review URL encoded into QR codes.
 *
 * Invariant: Encodes strictly `https://[domain]/q/:public_qr_id`.
 * Decoupled from mutable business names, vanity slugs, or external Google review URLs.
 * Prioritizes explicitly passed baseOrigin, followed by the configured VITE_APP_URL,
 * then browser window.location.origin, and finally default local dev fallback.
 */
export function buildFirstPartyReviewUrl(publicQrId: string, baseOrigin?: string): string {
  const trimmed = publicQrId?.trim() || '';
  if (!isValidPublicQrId(trimmed)) {
    throw new Error(`Invalid public QR identifier: '${publicQrId}'`);
  }

  let origin = baseOrigin;
  if (!origin) {
    const envAppUrl = getConfiguredAppUrl()?.trim();
    if (envAppUrl) {
      origin = envAppUrl;
    } else if (typeof window !== 'undefined' && window.location?.origin) {
      origin = window.location.origin;
    } else {
      origin = 'http://localhost:5173';
    }
  }

  // Remove trailing slashes
  origin = origin.replace(/\/+$/, '');
  return `${origin}/q/${encodeURIComponent(trimmed)}`;
}

/**
 * Maps string error correction level to QrEcc instance.
 */
function toEcc(ecl: ErrorCorrectionLevel = 'H'): QrEcc {
  switch (ecl) {
    case 'L':
      return QrEcc.LOW;
    case 'M':
      return QrEcc.MEDIUM;
    case 'Q':
      return QrEcc.QUARTILE;
    case 'H':
    default:
      return QrEcc.HIGH;
  }
}

/**
 * Generates an ISO/IEC 18004 compliant 2D module matrix for the given text.
 */
export function generateQrMatrix(
  text: string,
  options?: {
    errorCorrectionLevel?: ErrorCorrectionLevel;
    quietZone?: number;
  },
): QrMatrixResult {
  if (!text || text.trim() === '') {
    throw new Error('Cannot generate QR code for empty text');
  }

  const ecl = toEcc(options?.errorCorrectionLevel || 'H');
  const quietZone = Math.max(0, options?.quietZone ?? 4);

  const qr = QrCode.encodeText(text, ecl);
  const matrixSize = qr.size;
  const totalSize = matrixSize + 2 * quietZone;

  const modules: boolean[][] = [];
  for (let y = 0; y < totalSize; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < totalSize; x++) {
      const qrX = x - quietZone;
      const qrY = y - quietZone;
      if (qrX >= 0 && qrX < matrixSize && qrY >= 0 && qrY < matrixSize) {
        row.push(qr.getModule(qrX, qrY));
      } else {
        // Quiet zone modules are always light (false)
        row.push(false);
      }
    }
    modules.push(row);
  }

  return {
    matrixSize,
    quietZone,
    totalSize,
    modules,
    getModule: (x: number, y: number) => {
      if (x < 0 || x >= totalSize || y < 0 || y >= totalSize) {
        return false;
      }
      return modules[y]![x]!;
    },
  };
}

/**
 * Helper to generate brand monogram initials from business name.
 */
export function getBusinessMonogram(name?: string): string {
  if (!name || !name.trim()) return 'QR';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return ((parts[0]![0] || '') + (parts[1]![0] || '')).toUpperCase();
}

/**
 * Generates a clean, URL-safe download filename for exported QR PNG assets.
 */
export function generateSafeFilename(
  businessName: string,
  publicQrId: string,
  extension = 'png',
): string {
  const base =
    businessName
      ?.toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    publicQrId ||
    'qr-code';

  return `${base}-review-qr-1024.${extension}`;
}

/**
 * Helper to safely load an image URL into an HTMLImageElement with CORS support.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load logo image: ${e}`));
    img.src = url;
  });
}

/**
 * Draws rounded rectangle path on CanvasRenderingContext2D.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Renders an ISO/IEC 18004 compliant QR Code directly onto an HTMLCanvasElement.
 */
export async function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options?: QrRenderOptions,
): Promise<void> {
  const size = options?.size ?? 1024;
  const quietZone = options?.quietZone ?? 4;
  const errorCorrectionLevel = options?.errorCorrectionLevel ?? 'H';
  const foregroundColor = options?.foregroundColor ?? '#000000';
  const backgroundColor = options?.backgroundColor ?? '#ffffff';
  const logoSizeRatio = Math.min(0.22, Math.max(0.12, options?.logoSizeRatio ?? 0.18));
  const logoPadding = options?.logoPadding ?? Math.max(4, Math.round(size * 0.01));
  const logoBorderRadius = options?.logoBorderRadius ?? Math.max(4, Math.round(size * 0.015));

  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D rendering context is not available');
  }

  // 1. Generate QR matrix
  const qrMatrix = generateQrMatrix(text, {
    errorCorrectionLevel,
    quietZone,
  });

  const totalModules = qrMatrix.totalSize;
  const modulePixelSize = size / totalModules;

  // 2. Draw solid background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, size, size);

  // 3. Draw dark modules
  ctx.fillStyle = foregroundColor;
  for (let y = 0; y < totalModules; y++) {
    for (let x = 0; x < totalModules; x++) {
      if (qrMatrix.getModule(x, y)) {
        // Use Math.ceil to prevent subpixel hairline gaps between modules
        const px = Math.floor(x * modulePixelSize);
        const py = Math.floor(y * modulePixelSize);
        const pw = Math.ceil((x + 1) * modulePixelSize) - px;
        const ph = Math.ceil((y + 1) * modulePixelSize) - py;
        ctx.fillRect(px, py, pw, ph);
      }
    }
  }

  // 4. Central logo or monogram overlay (if requested)
  const hasLogoUrl = Boolean(options?.logoUrl && options.logoUrl.trim());
  const fallbackMonogram = options?.fallbackMonogram || getBusinessMonogram(options?.businessName);

  if (hasLogoUrl || fallbackMonogram) {
    const logoBoxSize = Math.round(size * logoSizeRatio);
    const logoBoxX = Math.round((size - logoBoxSize) / 2);
    const logoBoxY = Math.round((size - logoBoxSize) / 2);

    let logoLoadedImg: HTMLImageElement | null = null;
    if (hasLogoUrl && typeof Image !== 'undefined') {
      try {
        logoLoadedImg = await loadImage(options!.logoUrl!);
      } catch (err) {
        // If image loading fails (e.g. offline, CORS, or missing logo), fall back to monogram
        console.warn('Unable to load custom QR logo image; falling back to monogram badge', err);
      }
    }

    ctx.save();

    // 4a. White protective quiet backdrop behind logo
    ctx.fillStyle = backgroundColor;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = Math.round(size * 0.015);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(size * 0.005);

    drawRoundedRect(ctx, logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, logoBorderRadius);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Subtle container border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = Math.max(1, Math.round(size * 0.002));
    ctx.stroke();

    // 4b. Render loaded image or fallback monogram
    const innerX = logoBoxX + logoPadding;
    const innerY = logoBoxY + logoPadding;
    const innerSize = logoBoxSize - 2 * logoPadding;

    if (logoLoadedImg && innerSize > 0) {
      // Clip inner region with rounded corners
      ctx.save();
      const innerRadius = Math.max(2, logoBorderRadius - 2);
      drawRoundedRect(ctx, innerX, innerY, innerSize, innerSize, innerRadius);
      ctx.clip();

      // Fit image aspect ratio inside inner square
      const imgWidth = logoLoadedImg.naturalWidth || logoLoadedImg.width;
      const imgHeight = logoLoadedImg.naturalHeight || logoLoadedImg.height;

      let drawWidth = innerSize;
      let drawHeight = innerSize;
      let offsetX = innerX;
      let offsetY = innerY;

      if (imgWidth > imgHeight) {
        drawHeight = (innerSize * imgHeight) / imgWidth;
        offsetY = innerY + (innerSize - drawHeight) / 2;
      } else if (imgHeight > imgWidth) {
        drawWidth = (innerSize * imgWidth) / imgHeight;
        offsetX = innerX + (innerSize - drawWidth) / 2;
      }

      ctx.drawImage(logoLoadedImg, offsetX, offsetY, drawWidth, drawHeight);
      ctx.restore();
    } else if (fallbackMonogram && innerSize > 0) {
      // Monogram badge fallback
      ctx.save();
      const innerRadius = Math.max(2, logoBorderRadius - 2);
      drawRoundedRect(ctx, innerX, innerY, innerSize, innerSize, innerRadius);
      ctx.fillStyle = '#0f172a'; // Deep slate
      ctx.fill();

      // Draw white monogram initials
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.round(innerSize * 0.44);
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(
        fallbackMonogram.slice(0, 3),
        innerX + innerSize / 2,
        innerY + innerSize / 2 + Math.round(fontSize * 0.06),
      );
      ctx.restore();
    }

    ctx.restore();
  }
}

/**
 * Generates an SVG string representation of the QR code with mandatory quiet zone.
 * Useful for razor-sharp vector display without canvas dependencies.
 */
export function generateQrSvgString(text: string, options?: QrRenderOptions): string {
  const quietZone = options?.quietZone ?? 4;
  const errorCorrectionLevel = options?.errorCorrectionLevel ?? 'H';
  const foregroundColor = options?.foregroundColor ?? '#000000';
  const backgroundColor = options?.backgroundColor ?? '#ffffff';

  const qrMatrix = generateQrMatrix(text, {
    errorCorrectionLevel,
    quietZone,
  });

  const totalModules = qrMatrix.totalSize;

  let pathData = '';
  for (let y = 0; y < totalModules; y++) {
    for (let x = 0; x < totalModules; x++) {
      if (qrMatrix.getModule(x, y)) {
        pathData += `M${x},${y}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${totalModules}" height="${totalModules}" fill="${backgroundColor}"/><path d="${pathData.trim()}" fill="${foregroundColor}"/></svg>`;
}

/**
 * Generates a high-resolution PNG Blob (1024x1024 initial target).
 */
export async function generateQrPngBlob(
  text: string,
  options?: QrRenderOptions,
): Promise<Blob> {
  const size = options?.size ?? 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  await renderQrToCanvas(canvas, text, {
    ...options,
    size,
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create PNG blob from canvas'));
      }
    }, 'image/png');
  });
}

/**
 * Triggers a browser download of the high-resolution PNG QR asset.
 */
export async function downloadQrPng(
  text: string,
  filename: string,
  options?: QrRenderOptions,
): Promise<void> {
  const blob = await generateQrPngBlob(text, options);
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename || 'review-qr-1024.png';
  document.body.appendChild(anchor);
  anchor.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  }, 100);
}
