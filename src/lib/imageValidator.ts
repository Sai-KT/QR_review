/**
 * Image Validation Engine (TC-UPL-01..08 / Gate M0-03 / SECURITY §15.1)
 *
 * Implements strict binary validation for business brand logos:
 * - Magic byte inspection (PNG, JPEG, WebP)
 * - Strict SVG and script execution rejection across the entire byte buffer
 * - Structural format validation (PNG IHDR/IEND chunks, JPEG SOI/SOF/EOI, WebP RIFF/FourCC bounds)
 * - File size boundary check (<= 2 MB = 2,097,152 bytes)
 * - Dimension limits (<= 2048 x 2048 px)
 * - Aspect ratio boundaries (1:3 to 3:1)
 */

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB (2,097,152 bytes)
export const MAX_LOGO_BYTES = MAX_FILE_SIZE_BYTES;
export const MAX_DIMENSION = 2048; // Max width or height in pixels
export const MIN_ASPECT_RATIO = 1 / 3; // 0.333
export const MAX_ASPECT_RATIO = 3 / 1; // 3.000

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImageValidationSuccess {
  isValid: true;
  format: ImageFormat;
  extension: 'png' | 'jpeg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  aspectRatio: number;
  byteLength: number;
}

export interface ImageValidationFailure {
  isValid: false;
  errorCode:
    | 'ERR_FILE_EMPTY'
    | 'ERR_FILE_TOO_LARGE'
    | 'ERR_INVALID_IMAGE_TYPE'
    | 'ERR_CORRUPT_IMAGE'
    | 'ERR_IMAGE_DIMENSIONS_EXCEEDED'
    | 'ERR_INVALID_ASPECT_RATIO';
  errorMessage: string;
}

export type ImageValidationResult = ImageValidationSuccess | ImageValidationFailure;

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_SOI = [0xFF, 0xD8, 0xFF];
const RIFF_HEADER = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_HEADER = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

const PROHIBITED_PATTERNS = [
  '<svg',
  '<!doctype svg',
  'xmlns="http://www.w3.org/2000/svg"',
  'xmlns:svg',
  '<script',
  '<?php',
  '#!/bin/',
  'eval(',
  'javascript:',
  'vbscript:',
  'onload=',
  'onerror=',
  'powershell',
];

/**
 * Checks for prohibited script or XML patterns across the entire byte buffer.
 * Rejects SVG, PHP, HTML, and script polyglot injection attempts.
 * Operates safely without false-positive rejections on camera XMP metadata.
 */
function containsProhibitedScriptPatterns(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes).toLowerCase();
  for (const pattern of PROHIBITED_PATTERNS) {
    if (text.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Inspects magic bytes and detects format (png, jpeg, webp)
 */
function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;

  if (
    bytes.length >= 8 &&
    PNG_SIGNATURE.every((b, idx) => bytes[idx] === b)
  ) {
    return 'png';
  }

  if (
    bytes.length >= 3 &&
    JPEG_SOI.every((b, idx) => bytes[idx] === b)
  ) {
    return 'jpeg';
  }

  if (
    bytes.length >= 12 &&
    RIFF_HEADER.every((b, idx) => bytes[idx] === b) &&
    WEBP_HEADER.every((b, idx) => bytes[8 + idx] === b)
  ) {
    return 'webp';
  }

  return null;
}

/**
 * Extracts dimensions from PNG chunks with chunk structural integrity verification.
 * Verifies IHDR as the first chunk, checks chunk bounds, and ensures IEND chunk is reached.
 */
function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33) return null; // 8 (sig) + 4 (len) + 4 (IHDR) + 13 (data) + 4 (crc) = 33

  const ihdrLen =
    ((bytes[8]! << 24) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!) >>> 0;
  if (
    ihdrLen !== 13 ||
    bytes[12] !== 0x49 || // I
    bytes[13] !== 0x48 || // H
    bytes[14] !== 0x44 || // D
    bytes[15] !== 0x52    // R
  ) {
    return null;
  }

  const b16 = bytes[16] ?? 0;
  const b17 = bytes[17] ?? 0;
  const b18 = bytes[18] ?? 0;
  const b19 = bytes[19] ?? 0;

  const b20 = bytes[20] ?? 0;
  const b21 = bytes[21] ?? 0;
  const b22 = bytes[22] ?? 0;
  const b23 = bytes[23] ?? 0;

  const width = ((b16 << 24) | (b17 << 16) | (b18 << 8) | b19) >>> 0;
  const height = ((b20 << 24) | (b21 << 16) | (b22 << 8) | b23) >>> 0;

  if (width <= 0 || height <= 0) return null;

  // Scan chunks to verify chunk integrity and find IEND
  let offset = 8;
  let seenIend = false;

  while (offset + 8 <= bytes.length) {
    const chunkLen =
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
      0;
    const chunkType = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );

    const chunkTotal = 8 + chunkLen + 4;
    if (offset + chunkTotal > bytes.length) {
      // Chunk extends beyond buffer (truncated PNG)
      return null;
    }

    if (chunkType === 'IEND') {
      seenIend = true;
      break;
    }

    offset += chunkTotal;
  }

  if (!seenIend) {
    return null;
  }

  return { width, height };
}

/**
 * Extracts dimensions from JPEG markers (SOF0, SOF1, SOF2) with structural integrity checks.
 * Ensures marker bounds are valid and stream contains an EOI termination marker.
 */
function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  let dims: { width: number; height: number } | null = null;
  let hasEoi = false;

  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset++;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= bytes.length) break;

    const marker = bytes[offset++];
    if (marker === undefined) break;

    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd8) continue;
    if (marker === 0xd9) {
      hasEoi = true;
      break;
    }
    if (marker === 0x00) continue;

    if (offset + 1 >= bytes.length) return null;
    const bLen0 = bytes[offset] ?? 0;
    const bLen1 = bytes[offset + 1] ?? 0;
    const length = (bLen0 << 8) | bLen1;
    if (length < 2) return null;
    if (offset + length > bytes.length) return null;

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length >= 7 && offset + 6 < bytes.length) {
        const h0 = bytes[offset + 3] ?? 0;
        const h1 = bytes[offset + 4] ?? 0;
        const w0 = bytes[offset + 5] ?? 0;
        const w1 = bytes[offset + 6] ?? 0;
        const height = (h0 << 8) | h1;
        const width = (w0 << 8) | w1;

        if (width > 0 && height > 0) {
          dims = { width, height };
        }
      } else {
        return null;
      }
    }

    if (marker === 0xda) {
      let scanIdx = offset + length;
      while (scanIdx + 1 < bytes.length) {
        if (bytes[scanIdx] === 0xff && bytes[scanIdx + 1] === 0xd9) {
          hasEoi = true;
          break;
        }
        scanIdx++;
      }
      break;
    }

    offset += length;
  }

  if (!hasEoi) {
    for (let i = bytes.length - 2; i >= Math.max(0, bytes.length - 16); i--) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
        hasEoi = true;
        break;
      }
    }
  }

  if (!dims || !hasEoi) return null;
  return dims;
}

/**
 * Extracts dimensions from WebP chunks (VP8, VP8L, VP8X) with chunk bounds validation.
 */
function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;

  if (
    bytes[0] !== 0x52 || // R
    bytes[1] !== 0x49 || // I
    bytes[2] !== 0x46 || // F
    bytes[3] !== 0x46 || // F
    bytes[8] !== 0x57 || // W
    bytes[9] !== 0x45 || // E
    bytes[10] !== 0x42 || // B
    bytes[11] !== 0x50    // P
  ) {
    return null;
  }

  const b12 = bytes[12] ?? 0;
  const b13 = bytes[13] ?? 0;
  const b14 = bytes[14] ?? 0;
  const b15 = bytes[15] ?? 0;
  const fourCC = String.fromCharCode(b12, b13, b14, b15);

  const chunkLen =
    ((bytes[16] ?? 0) |
      ((bytes[17] ?? 0) << 8) |
      ((bytes[18] ?? 0) << 16) |
      ((bytes[19] ?? 0) << 24)) >>>
    0;

  if (12 + 8 + chunkLen > bytes.length + 1) {
    return null;
  }

  if (fourCC === 'VP8 ') {
    if (bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const b26 = bytes[26] ?? 0;
      const b27 = bytes[27] ?? 0;
      const b28 = bytes[28] ?? 0;
      const b29 = bytes[29] ?? 0;
      const width = (b26 | (b27 << 8)) & 0x3fff;
      const height = (b28 | (b29 << 8)) & 0x3fff;
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  } else if (fourCC === 'VP8L') {
    if (bytes.length >= 26 && bytes[21] === 0x2f) {
      const b0 = bytes[22] ?? 0;
      const b1 = bytes[23] ?? 0;
      const b2 = bytes[24] ?? 0;
      const b3 = bytes[25] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  } else if (fourCC === 'VP8X') {
    if (bytes.length >= 30 && chunkLen >= 10) {
      const b24 = bytes[24] ?? 0;
      const b25 = bytes[25] ?? 0;
      const b26 = bytes[26] ?? 0;
      const b27 = bytes[27] ?? 0;
      const b28 = bytes[28] ?? 0;
      const b29 = bytes[29] ?? 0;
      const width = 1 + (b24 | (b25 << 8) | (b26 << 16));
      const height = 1 + (b27 | (b28 << 8) | (b29 << 16));
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }

  return null;
}

/**
 * Validates image binary payload against security, format, size, and dimension constraints.
 */
export function validateImageBuffer(bytes: Uint8Array): ImageValidationResult {
  if (!bytes || bytes.length === 0) {
    return {
      isValid: false,
      errorCode: 'ERR_FILE_EMPTY',
      errorMessage: 'The uploaded file is empty.',
    };
  }

  // 1. Boundary check: <= 2 MB
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      errorCode: 'ERR_FILE_TOO_LARGE',
      errorMessage: `File size (${(bytes.length / (1024 * 1024)).toFixed(2)} MB) exceeds the 2 MB limit.`,
    };
  }

  // 2. Reject SVG, scripts, and executable patterns across entire payload
  if (containsProhibitedScriptPatterns(bytes)) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_IMAGE_TYPE',
      errorMessage: 'SVG and executable scripts are strictly prohibited for security reasons. Please upload a PNG, JPEG, or WebP image.',
    };
  }

  // 3. Magic byte detection (PNG, JPEG, WebP)
  const format = detectFormat(bytes);
  if (!format) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_IMAGE_TYPE',
      errorMessage: 'Missing valid PNG, JPEG, or WebP magic bytes. Only PNG, JPEG, and WebP are permitted.',
    };
  }

  // 4. Parse image dimensions and verify structure
  let dimensions: { width: number; height: number } | null = null;
  if (format === 'png') {
    dimensions = parsePngDimensions(bytes);
  } else if (format === 'jpeg') {
    dimensions = parseJpegDimensions(bytes);
  } else if (format === 'webp') {
    dimensions = parseWebpDimensions(bytes);
  }

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      isValid: false,
      errorCode: 'ERR_CORRUPT_IMAGE',
      errorMessage: 'Failed to parse valid image dimensions from the uploaded file.',
    };
  }

  const { width, height } = dimensions;

  // 5. Dimension boundary: <= 2048 x 2048
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return {
      isValid: false,
      errorCode: 'ERR_IMAGE_DIMENSIONS_EXCEEDED',
      errorMessage: `Image dimensions (${width}x${height}px) exceed the maximum allowed 2048x2048px limit.`,
    };
  }

  // 6. Aspect ratio boundary: 1:3 (0.333) to 3:1 (3.000)
  const aspectRatio = width / height;
  if (aspectRatio < MIN_ASPECT_RATIO || aspectRatio > MAX_ASPECT_RATIO) {
    return {
      isValid: false,
      errorCode: 'ERR_INVALID_ASPECT_RATIO',
      errorMessage: `Image aspect ratio (${aspectRatio.toFixed(2)}:1) must be between 1:3 and 3:1.`,
    };
  }

  const mimeMap: Record<ImageFormat, 'image/png' | 'image/jpeg' | 'image/webp'> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };

  return {
    isValid: true,
    format,
    extension: format,
    mimeType: mimeMap[format],
    width,
    height,
    aspectRatio,
    byteLength: bytes.length,
  };
}

/**
 * Pre-validates a File in the browser before upload (client-side ergonomics).
 */
export async function prevalidateLogoFile(
  file: File,
): Promise<{ isValid: true; mimeType: string } | { isValid: false; errorMessage: string }> {
  if (!file) {
    return { isValid: false, errorMessage: 'No file selected.' };
  }

  // Client size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      errorMessage: `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 2 MB limit.`,
    };
  }

  // Quick extension/MIME check
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.svg') || file.type.includes('svg')) {
    return {
      isValid: false,
      errorMessage: 'SVG and executable scripts are strictly prohibited for security reasons. Please upload a PNG, JPEG, or WebP image.',
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const result = validateImageBuffer(bytes);
    if (!result.isValid) {
      return {
        isValid: false,
        errorMessage: result.errorMessage,
      };
    }

    return {
      isValid: true,
      mimeType: result.mimeType,
    };
  } catch {
    return {
      isValid: false,
      errorMessage: 'Failed to read image file data.',
    };
  }
}
