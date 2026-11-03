// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  prevalidateLogoFile,
  uploadBusinessLogo,
  deleteBusinessLogo,
} from './storage';
import { supabase } from './supabase';

// Mock supabase client
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
  getSupabaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:54321'),
  getSupabaseAnonKey: vi.fn().mockReturnValue('mock-anon-key'),
}));

const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';

function createValidPngFile(name = 'logo.png', size = 100): File {
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, size, 0x00, 0x00, 0x00, size,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x4e, 0x9b, 0x67, 0x73,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

describe('storage.ts client gateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('prevalidateLogoFile', () => {
    it('rejects null or undefined file', async () => {
      const res = await prevalidateLogoFile(null as unknown as File);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.errorCode).toBe('ERR_CORRUPT_IMAGE');
      }
    });

    it('TC-UPL-04: immediately rejects SVG file by MIME or name', async () => {
      const svgFile = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
      const res = await prevalidateLogoFile(svgFile);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.errorCode).toBe('ERR_INVALID_IMAGE_TYPE');
        expect(res.errorMessage).toContain('SVG files are strictly prohibited');
      }
    });

    it('TC-UPL-05: rejects file larger than 2 MB', async () => {
      const largeBytes = new Uint8Array(2_097_152 + 100);
      const largeFile = new File([largeBytes], 'huge.png', { type: 'image/png' });
      const res = await prevalidateLogoFile(largeFile);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.errorCode).toBe('ERR_FILE_TOO_LARGE');
        expect(res.errorMessage).toContain('exceeds the 2 MB limit');
      }
    });

    it('TC-UPL-01: accepts clean valid PNG file', async () => {
      const pngFile = createValidPngFile();
      const res = await prevalidateLogoFile(pngFile);
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.format).toBe('png');
        expect(res.extension).toBe('png');
      }
    });
  });

  describe('uploadBusinessLogo', () => {
    it('rejects empty or missing businessId', async () => {
      const file = createValidPngFile();
      const res = await uploadBusinessLogo('', file);
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('valid business ID is required');
    });

    it('rejects missing file', async () => {
      const res = await uploadBusinessLogo(MOCK_BUSINESS_ID, null as unknown as File);
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('logo file must be selected');
    });

    it('fails fast on client pre-validation failure (e.g. SVG)', async () => {
      const svgFile = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' });
      const res = await uploadBusinessLogo(MOCK_BUSINESS_ID, svgFile);
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('SVG files are strictly prohibited');
    });

    it('fails when user is not authenticated', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const file = createValidPngFile();
      const res = await uploadBusinessLogo(MOCK_BUSINESS_ID, file);
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('Authentication session required');
    });

    it('dispatches multipart request and returns uploaded logoUrl on success', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-access-token',
          } as unknown as import('@supabase/supabase-js').Session,
        },
        error: null,
      });

      const mockResponse = {
        status: 'uploaded',
        businessId: MOCK_BUSINESS_ID,
        logoUrl: `http://127.0.0.1:54321/storage/v1/object/public/business-logos/${MOCK_BUSINESS_ID}/logo.png?v=123456`,
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const file = createValidPngFile();
      const res = await uploadBusinessLogo(MOCK_BUSINESS_ID, file);

      expect(res.error).toBeNull();
      expect(res.data).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:54321/functions/v1/upload-logo',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-access-token',
          }),
          body: expect.any(FormData),
        }),
      );
    });

    it('surfaces backend 413 file too large error properly', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'mock-token' } as unknown as import('@supabase/supabase-js').Session },
        error: null,
      });

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: async () => ({
          error: {
            code: 'ERR_FILE_TOO_LARGE',
            message: 'File size exceeds the 2 MB limit.',
          },
        }),
      });

      const file = createValidPngFile();
      const res = await uploadBusinessLogo(MOCK_BUSINESS_ID, file);

      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('File size exceeds the 2 MB limit.');
    });
  });

  describe('deleteBusinessLogo', () => {
    it('rejects empty businessId', async () => {
      const res = await deleteBusinessLogo('');
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('valid business ID is required');
    });

    it('fails when user is unauthenticated', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const res = await deleteBusinessLogo(MOCK_BUSINESS_ID);
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('Authentication session required');
    });

    it('dispatches DELETE request and returns deleted status on success', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: { access_token: 'mock-token' } as unknown as import('@supabase/supabase-js').Session },
        error: null,
      });

      const mockResponse = {
        status: 'deleted',
        businessId: MOCK_BUSINESS_ID,
      };

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const res = await deleteBusinessLogo(MOCK_BUSINESS_ID);
      expect(res.error).toBeNull();
      expect(res.data).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `http://127.0.0.1:54321/functions/v1/upload-logo?businessId=${MOCK_BUSINESS_ID}`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        }),
      );
    });
  });
});
