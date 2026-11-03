/**
 * Image Validation Engine (TC-UPL-01..08 / Gate M0-03 / SECURITY §15.1)
 *
 * Implements strict binary validation for business brand logos:
 * - Magic byte inspection (PNG, JPEG, WebP)
 * - Strict SVG and script execution rejection
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

/**
 * Checks for prohibited script or XML patterns anywhere in the byte buffer.
 * Rejects SVG, PHP, HTML, and script polyglot injection attempts.
 */
function containsProhibitedScriptPatterns(bytes: Uint8Array): boolean {
  const inspectLength = Math.min(bytes.length, 8192);
  let ascii = '';
  for (let i = 0; i < inspectLength; i++) {
    const b = bytes[i];
    if (b !== undefined && b >= 32 && b <= 126) {
      ascii += String.fromCharCode(b);
    } else if (b === 10 || b === 13 || b === 9) {
      ascii += ' ';
    }
  }
  const lower = ascii.toLowerCase();

  if (
    lower.includes('<svg') ||
    lower.includes('<?xml') ||
    lower.includes('xmlns') ||
    lower.includes('<script') ||
    lower.includes('<!doctype svg') ||
    lower.includes('<?php') ||
    lower.includes('#!/bin/') ||
    lower.includes('eval(') ||
    lower.includes('powershell')
  ) {
    return true;
  }

  if (bytes.length > 8192) {
    let tailAscii = '';
    const tailStart = bytes.length - 2048;
    for (let i = tailStart; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== undefined && b >= 32 && b <= 126) {
        tailAscii += String.fromCharCode(b);
      }
    }
    const tailLower = tailAscii.toLowerCase();
    if (
      tailLower.includes('<?php') ||
      tailLower.includes('<script') ||
      tailLower.includes('<svg') ||
      tailLower.includes('eval(')
    ) {
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
 * Extracts dimensions from PNG chunks.
 */
function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;

  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
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

  return { width, height };
}

/**
 * Extracts dimensions from JPEG markers (SOF0, SOF1, SOF2).
 */
function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;

  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xFF) {
      offset++;
    }
    while (offset < bytes.length && bytes[offset] === 0xFF) {
      offset++;
    }
    if (offset >= bytes.length) break;

    const marker = bytes[offset++];
    if (marker === undefined) break;

    if (marker >= 0xD0 && marker <= 0xD7) continue;
    if (marker === 0xD8 || marker === 0xD9) continue;
    if (marker === 0x00 || marker === 0xFF) continue;

    if (offset + 1 >= bytes.length) break;
    const bLen0 = bytes[offset] ?? 0;
    const bLen1 = bytes[offset + 1] ?? 0;
    const length = (bLen0 << 8) | bLen1;
    if (length < 2) break;

    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      if (offset + 6 < bytes.length) {
        const h0 = bytes[offset + 3] ?? 0;
        const h1 = bytes[offset + 4] ?? 0;
        const w0 = bytes[offset + 5] ?? 0;
        const w1 = bytes[offset + 6] ?? 0;
        const height = (h0 << 8) | h1;
        const width = (w0 << 8) | w1;

        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      return null;
    }

    if (marker === 0xDA) break;

    offset += length;
  }

  return null;
}

/**
 * Extracts dimensions from WebP chunks (VP8, VP8L, VP8X).
 */
function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;

  const b12 = bytes[12] ?? 0;
  const b13 = bytes[13] ?? 0;
  const b14 = bytes[14] ?? 0;
  const b15 = bytes[15] ?? 0;
  const fourCC = String.fromCharCode(b12, b13, b14, b15);

  if (fourCC === 'VP8 ') {
    if (bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
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
    if (bytes[21] === 0x2F && bytes.length >= 26) {
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
    if (bytes.length >= 30) {
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

  // 2. Reject SVG, XML, script patterns (TC-UPL-04)
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

  // 4. Parse image dimensions
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
