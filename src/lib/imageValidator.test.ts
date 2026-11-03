import { describe, it, expect } from 'vitest';
import {
  validateImageBuffer,
  MAX_LOGO_BYTES,
} from './imageValidator';

/**
 * Creates a minimal valid PNG byte buffer with specified width and height.
 */
function createValidPng(width = 100, height = 100, padToLength?: number): Uint8Array {
  const header = [
    // PNG signature (8 bytes)
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR length: 13 bytes
    0x00, 0x00, 0x00, 0x0d,
    // 'IHDR' (4 bytes)
    0x49, 0x48, 0x44, 0x52,
    // Width (4 bytes Big Endian)
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    // Height (4 bytes Big Endian)
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    // Bit depth (8), color type (2 RGB), compression (0), filter (0), interlace (0)
    0x08, 0x02, 0x00, 0x00, 0x00,
    // CRC (4 bytes dummy)
    0x4e, 0x9b, 0x67, 0x73,
    // IEND chunk
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];

  if (padToLength && padToLength > header.length) {
    const buf = new Uint8Array(padToLength);
    buf.set(header);
    return buf;
  }

  return new Uint8Array(header);
}

/**
 * Creates a minimal valid JPEG byte buffer with specified width and height.
 */
function createValidJpeg(width = 120, height = 80): Uint8Array {
  const bytes = [
    // SOI
    0xff, 0xd8,
    // APP0
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // SOF0 (Baseline DCT)
    0xff, 0xc0,
    0x00, 0x11, // length 17
    0x08,       // precision 8
    (height >>> 8) & 0xff, height & 0xff, // Height
    (width >>> 8) & 0xff, width & 0xff,   // Width
    0x03,       // 3 components
    0x01, 0x22, 0x00, // Y
    0x02, 0x11, 0x01, // Cb
    0x03, 0x11, 0x01, // Cr
    // EOI
    0xff, 0xd9,
  ];

  return new Uint8Array(bytes);
}

/**
 * Creates a minimal valid WebP byte buffer (Extended VP8X format).
 */
function createValidWebp(width = 64, height = 64): Uint8Array {
  const w = width - 1;
  const h = height - 1;

  const bytes = [
    // RIFF (4 bytes)
    0x52, 0x49, 0x46, 0x46,
    // File size - 8 (4 bytes dummy)
    0x20, 0x00, 0x00, 0x00,
    // WEBP (4 bytes)
    0x57, 0x45, 0x42, 0x50,
    // VP8X chunk header (4 bytes)
    0x56, 0x50, 0x38, 0x58,
    // Chunk size: 10 bytes (4 bytes)
    0x0a, 0x00, 0x00, 0x00,
    // Flags (4 bytes)
    0x00, 0x00, 0x00, 0x00,
    // Width (24 bits Little Endian)
    w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff,
    // Height (24 bits Little Endian)
    h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff,
  ];

  return new Uint8Array(bytes);
}

describe('imageValidator: Security and Format Verification', () => {
  it('TC-UPL-01: accepts clean valid PNG image', () => {
    const png = createValidPng(300, 200);
    const result = validateImageBuffer(png);

    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.format).toBe('png');
      expect(result.extension).toBe('png');
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(300);
      expect(result.height).toBe(200);
      expect(result.aspectRatio).toBeCloseTo(1.5);
    }
  });

  it('TC-UPL-02: accepts clean valid JPEG image', () => {
    const jpeg = createValidJpeg(400, 300);
    const result = validateImageBuffer(jpeg);

    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.format).toBe('jpeg');
      expect(result.extension).toBe('jpeg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
      expect(result.aspectRatio).toBeCloseTo(1.33, 2);
    }
  });

  it('TC-UPL-03: accepts clean valid WebP image', () => {
    const webp = createValidWebp(250, 250);
    const result = validateImageBuffer(webp);

    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.format).toBe('webp');
      expect(result.extension).toBe('webp');
      expect(result.mimeType).toBe('image/webp');
      expect(result.width).toBe(250);
      expect(result.height).toBe(250);
      expect(result.aspectRatio).toBe(1.0);
    }
  });

  it('TC-UPL-04: strictly rejects malicious SVG file containing script tag', () => {
    const svgStr = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const bytes = new TextEncoder().encode(svgStr);
    const result = validateImageBuffer(bytes);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_INVALID_IMAGE_TYPE');
      expect(result.errorMessage).toContain('SVG and executable scripts are strictly prohibited');
    }
  });

  it('TC-UPL-05: rejects oversized file exceeding 2 MB', () => {
    const oversizedPng = createValidPng(100, 100, MAX_LOGO_BYTES + 1024);
    const result = validateImageBuffer(oversizedPng);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_FILE_TOO_LARGE');
      expect(result.errorMessage).toContain('exceeds the 2 MB limit');
    }
  });

  it('TC-UPL-06: accepts file measuring exactly 2,097,152 bytes (2 MB boundary)', () => {
    const boundaryPng = createValidPng(100, 100, MAX_LOGO_BYTES);
    const result = validateImageBuffer(boundaryPng);

    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.byteLength).toBe(MAX_LOGO_BYTES);
    }
  });

  it('TC-UPL-07: rejects polyglot JPEG executable with appended PHP payload', () => {
    const cleanJpeg = createValidJpeg(200, 200);
    const phpPayload = new TextEncoder().encode('<?php echo "injected_backdoor"; ?>');

    const polyglot = new Uint8Array(cleanJpeg.length + phpPayload.length);
    polyglot.set(cleanJpeg);
    polyglot.set(phpPayload, cleanJpeg.length);

    const result = validateImageBuffer(polyglot);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_INVALID_IMAGE_TYPE');
      expect(result.errorMessage).toContain('SVG and executable scripts are strictly prohibited');
    }
  });

  it('rejects empty or zero-byte file buffer', () => {
    const empty = new Uint8Array(0);
    const result = validateImageBuffer(empty);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_FILE_EMPTY');
    }
  });

  it('rejects random non-image binary file', () => {
    const randomBinary = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    const result = validateImageBuffer(randomBinary);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_INVALID_IMAGE_TYPE');
      expect(result.errorMessage).toContain('Missing valid PNG, JPEG, or WebP');
    }
  });

  it('rejects image with dimensions exceeding 2048px limit', () => {
    const largePng = createValidPng(2500, 1000);
    const result = validateImageBuffer(largePng);

    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.errorCode).toBe('ERR_IMAGE_DIMENSIONS_EXCEEDED');
      expect(result.errorMessage).toContain('exceed the maximum allowed 2048x2048px limit');
    }
  });

  it('rejects image with extreme aspect ratio outside 1:3 to 3:1 bounds', () => {
    // 100w x 400h = 0.25 aspect ratio (taller than 1:3)
    const tallPng = createValidPng(100, 400);
    const tallResult = validateImageBuffer(tallPng);

    expect(tallResult.isValid).toBe(false);
    if (!tallResult.isValid) {
      expect(tallResult.errorCode).toBe('ERR_INVALID_ASPECT_RATIO');
      expect(tallResult.errorMessage).toContain('must be between 1:3 and 3:1');
    }

    // 400w x 100h = 4.0 aspect ratio (wider than 3:1)
    const widePng = createValidPng(400, 100);
    const wideResult = validateImageBuffer(widePng);

    expect(wideResult.isValid).toBe(false);
    if (!wideResult.isValid) {
      expect(wideResult.errorCode).toBe('ERR_INVALID_ASPECT_RATIO');
      expect(wideResult.errorMessage).toContain('must be between 1:3 and 3:1');
    }
  });
});
