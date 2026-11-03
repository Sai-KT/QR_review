/**
 * Digital QR Generator Unit & Optical Scan Decoding Tests
 *
 * Source: docs/ROADMAP.md (Task M5-T06); docs/TEST_PLAN.md (TC-PRT-05, TC-OWN-11, TC-OWN-12)
 *
 * Verifies:
 * - ISO/IEC 18004 module matrix generation and 4-module mandatory quiet zone.
 * - Format of first-party URL: https://[domain]/q/:public_qr_id.
 * - Rejection of invalid, empty, or malicious public QR IDs.
 * - Programmatic optical decoding of generated QR code back to exact URL via jsQR.
 * - Optical scan resilience with central logo / brand monogram overlay.
 * - Safe download filename generation.
 * - Monogram fallback calculation.
 * - SVG string generation for crisp vector previews.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsQR from 'jsqr';
import {
  generateQrMatrix,
  buildFirstPartyReviewUrl,
  isValidPublicQrId,
  getBusinessMonogram,
  generateSafeFilename,
  generateQrSvgString,
  renderQrToCanvas,
} from './qrGenerator';

describe('M5-T06: qrGenerator', () => {
  const TEST_PUBLIC_QR_ID = 'luxe000001';
  const EXPECTED_URL = `https://review.qrs.local/q/${TEST_PUBLIC_QR_ID}`;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Public QR ID Validation & First-Party URL Construction', () => {
    it('accepts valid 10-char alphanumeric and safe public QR IDs', () => {
      expect(isValidPublicQrId('luxe000001')).toBe(true);
      expect(isValidPublicQrId('cafe000002')).toBe(true);
      expect(isValidPublicQrId('ABCD1234EF')).toBe(true);
      expect(isValidPublicQrId('demo-123456')).toBe(true);
      expect(isValidPublicQrId('test_tenant_01')).toBe(true);
    });

    it('rejects empty, short, or illegal public QR IDs', () => {
      expect(isValidPublicQrId('')).toBe(false);
      expect(isValidPublicQrId('   ')).toBe(false);
      expect(isValidPublicQrId('short')).toBe(false); // < 6 chars
      expect(isValidPublicQrId('inv@lid!id')).toBe(false);
      expect(isValidPublicQrId('<script>')).toBe(false);
      expect(isValidPublicQrId('../../admin')).toBe(false);
    });

    it('builds canonical first-party review URL with specified origin', () => {
      const url = buildFirstPartyReviewUrl(TEST_PUBLIC_QR_ID, 'https://review.qrs.local');
      expect(url).toBe('https://review.qrs.local/q/luxe000001');
    });

    it('strips trailing slashes from base origin to prevent double slashes', () => {
      const url = buildFirstPartyReviewUrl(TEST_PUBLIC_QR_ID, 'https://review.qrs.local///');
      expect(url).toBe('https://review.qrs.local/q/luxe000001');
    });

    it('throws when building URL with invalid public QR ID', () => {
      expect(() => buildFirstPartyReviewUrl('')).toThrow(/Invalid public QR identifier/);
      expect(() => buildFirstPartyReviewUrl('bad!id')).toThrow(/Invalid public QR identifier/);
    });
  });

  describe('2. QR Matrix Generation & Mandatory Quiet Zone (ISO/IEC 18004)', () => {
    it('generates a valid 2D module grid with default 4-module quiet zone', () => {
      const matrix = generateQrMatrix(EXPECTED_URL);
      expect(matrix.matrixSize).toBeGreaterThan(20);
      expect(matrix.quietZone).toBe(4);
      expect(matrix.totalSize).toBe(matrix.matrixSize + 8);
      expect(matrix.modules.length).toBe(matrix.totalSize);
      expect(matrix.modules[0]!.length).toBe(matrix.totalSize);
    });

    it('verifies that quiet zone modules are strictly light (false)', () => {
      const matrix = generateQrMatrix(EXPECTED_URL, { quietZone: 4 });
      const total = matrix.totalSize;

      // Top 4 rows must be completely light (false)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < total; x++) {
          expect(matrix.getModule(x, y)).toBe(false);
        }
      }

      // Bottom 4 rows must be completely light (false)
      for (let y = total - 4; y < total; y++) {
        for (let x = 0; x < total; x++) {
          expect(matrix.getModule(x, y)).toBe(false);
        }
      }

      // Left 4 columns and right 4 columns must be completely light (false)
      for (let y = 0; y < total; y++) {
        for (let x = 0; x < 4; x++) {
          expect(matrix.getModule(x, y)).toBe(false);
        }
        for (let x = total - 4; x < total; x++) {
          expect(matrix.getModule(x, y)).toBe(false);
        }
      }
    });

    it('throws when attempting to generate QR for empty text', () => {
      expect(() => generateQrMatrix('')).toThrow(/empty text/i);
      expect(() => generateQrMatrix('   ')).toThrow(/empty text/i);
    });
  });

  describe('3. Programmatic Optical Decoding with jsQR (TC-PRT-05)', () => {
    it('decodes the generated module matrix back to the exact URL payload', () => {
      const matrix = generateQrMatrix(EXPECTED_URL, { errorCorrectionLevel: 'H', quietZone: 4 });
      const scale = 8;
      const pixelSize = matrix.totalSize * scale;

      // Render to RGBA buffer
      const buffer = new Uint8ClampedArray(pixelSize * pixelSize * 4);
      buffer.fill(255); // White background

      for (let y = 0; y < matrix.totalSize; y++) {
        for (let x = 0; x < matrix.totalSize; x++) {
          if (matrix.getModule(x, y)) {
            const px = x * scale;
            const py = y * scale;
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const idx = ((py + dy) * pixelSize + (px + dx)) * 4;
                buffer[idx] = 0;
                buffer[idx + 1] = 0;
                buffer[idx + 2] = 0;
                buffer[idx + 3] = 255;
              }
            }
          }
        }
      }

      const decoded = jsQR(buffer, pixelSize, pixelSize);
      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(EXPECTED_URL);
    });

    it('decodes reliably when a central monogram badge (up to 18% width) is overlaid (error correction level H)', () => {
      const matrix = generateQrMatrix(EXPECTED_URL, { errorCorrectionLevel: 'H', quietZone: 4 });
      const scale = 12;
      const pixelSize = matrix.totalSize * scale;

      const buffer = new Uint8ClampedArray(pixelSize * pixelSize * 4);
      buffer.fill(255);

      // Draw QR modules
      for (let y = 0; y < matrix.totalSize; y++) {
        for (let x = 0; x < matrix.totalSize; x++) {
          if (matrix.getModule(x, y)) {
            const px = x * scale;
            const py = y * scale;
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const idx = ((py + dy) * pixelSize + (px + dx)) * 4;
                buffer[idx] = 0;
                buffer[idx + 1] = 0;
                buffer[idx + 2] = 0;
                buffer[idx + 3] = 255;
              }
            }
          }
        }
      }

      // Simulate a central branding badge covering 18% of QR code
      const badgeSize = Math.round(pixelSize * 0.18);
      const startX = Math.round((pixelSize - badgeSize) / 2);
      const startY = Math.round((pixelSize - badgeSize) / 2);

      for (let y = startY; y < startY + badgeSize; y++) {
        for (let x = startX; x < startX + badgeSize; x++) {
          const idx = (y * pixelSize + x) * 4;
          buffer[idx] = 15;
          buffer[idx + 1] = 23;
          buffer[idx + 2] = 42;
          buffer[idx + 3] = 255;
        }
      }

      const decoded = jsQR(buffer, pixelSize, pixelSize);
      expect(decoded).not.toBeNull();
      expect(decoded?.data).toBe(EXPECTED_URL);
    });
  });

  describe('4. Brand Monogram, Safe Filename & SVG Utilities', () => {
    it('extracts two-letter monogram from multi-word business name', () => {
      expect(getBusinessMonogram('Luxe Salon')).toBe('LS');
      expect(getBusinessMonogram('The Roasted Bean Cafe')).toBe('TR');
      expect(getBusinessMonogram('HairCraft Studio')).toBe('HS');
    });

    it('extracts first two letters for single-word business name', () => {
      expect(getBusinessMonogram('Zeta')).toBe('ZE');
      expect(getBusinessMonogram('Salon')).toBe('SA');
    });

    it('falls back safely to QR for empty or whitespace business name', () => {
      expect(getBusinessMonogram('')).toBe('QR');
      expect(getBusinessMonogram('   ')).toBe('QR');
      expect(getBusinessMonogram(undefined)).toBe('QR');
    });

    it('generates clean, safe filenames for PNG export', () => {
      expect(generateSafeFilename('Luxe Salon & Spa', 'luxe000001')).toBe(
        'luxe-salon-spa-review-qr-1024.png',
      );
      expect(generateSafeFilename('Café Mocha!', 'cafe000002')).toBe(
        'caf-mocha-review-qr-1024.png',
      );
      expect(generateSafeFilename('', 'luxe000001')).toBe('luxe000001-review-qr-1024.png');
    });

    it('generates valid, crisp SVG XML string with quiet zones and viewBox', () => {
      const svg = generateQrSvgString(EXPECTED_URL);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox=');
      expect(svg).toContain('shape-rendering="crispEdges"');
      expect(svg).toContain('<path d="');
      expect(svg).toContain('fill="#000000"');
    });
  });

  describe('5. Canvas Rendering Pipeline (TC-OWN-11, TC-OWN-12)', () => {
    it('sets canvas dimensions to target resolution and draws background and modules', async () => {
      const mockFillRect = vi.fn();
      const mockFill = vi.fn();
      const mockStroke = vi.fn();
      const mockSave = vi.fn();
      const mockRestore = vi.fn();
      const mockBeginPath = vi.fn();
      const mockClosePath = vi.fn();
      const mockMoveTo = vi.fn();
      const mockLineTo = vi.fn();
      const mockArcTo = vi.fn();

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          fillStyle: '',
          fillRect: mockFillRect,
          fill: mockFill,
          stroke: mockStroke,
          save: mockSave,
          restore: mockRestore,
          beginPath: mockBeginPath,
          closePath: mockClosePath,
          moveTo: mockMoveTo,
          lineTo: mockLineTo,
          arcTo: mockArcTo,
          fillText: vi.fn(),
          drawImage: vi.fn(),
          clip: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement;

      await renderQrToCanvas(mockCanvas, EXPECTED_URL, {
        size: 1024,
        businessName: 'Luxe Salon',
      });

      expect(mockCanvas.width).toBe(1024);
      expect(mockCanvas.height).toBe(1024);
      expect(mockFillRect).toHaveBeenCalledWith(0, 0, 1024, 1024); // background
      expect(mockFillRect.mock.calls.length).toBeGreaterThan(100); // modules drawn
    });

    it('throws error if canvas 2D context is unavailable', async () => {
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(null),
      } as unknown as HTMLCanvasElement;

      await expect(renderQrToCanvas(mockCanvas, EXPECTED_URL)).rejects.toThrow(
        /Canvas 2D rendering context is not available/,
      );
    });
  });
});

