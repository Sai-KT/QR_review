// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  handler,
  extractTenantStoragePath,
  pruneSupersededLogos,
  BUCKET_NAME,
} from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000002';
const MOCK_OTHER_USER_ID = '00000000-0000-4000-8000-000000000099';
const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';

// Canonical RFC 4122 UUID v4 regex
const FULL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates minimal valid PNG byte buffer.
 */
function createValidPngBytes(width = 100, height = 100, padToLength?: number): Uint8Array {
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d,                         // IHDR length
    0x49, 0x48, 0x44, 0x52,                         // IHDR
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,                   // Bit depth, RGB
    0x4e, 0x9b, 0x67, 0x73,                         // CRC
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];

  if (padToLength && padToLength > header.length) {
    const buf = new Uint8Array(padToLength);
    buf.set(header);
    return buf;
  }
  return new Uint8Array(header);
}

function createMockSupabase(overrides: {
  authError?: Error | null;
  user?: { id: string } | null;
  business?: { id: string; owner_id: string; logo_url: string | null } | null;
  recheckBusiness?: { id: string; owner_id: string; logo_url: string | null } | null;
  recheckError?: Error | null;
  storageUploadError?: Error | null;
  storageRemoveError?: Error | null;
  dbUpdateError?: Error | null;
  updateReturnsNoRows?: boolean;
}) {
  const user = overrides.user !== undefined ? overrides.user : { id: MOCK_USER_ID };
  const authError = overrides.authError ?? null;
  const initialBusiness =
    overrides.business !== undefined
      ? overrides.business
      : { id: MOCK_BUSINESS_ID, owner_id: MOCK_USER_ID, logo_url: null };

  let selectCallCount = 0;

  const mockStorageFrom = {
    upload: vi.fn().mockResolvedValue({
      data: overrides.storageUploadError ? null : { path: 'uploaded-path' },
      error: overrides.storageUploadError || null,
    }),
    remove: vi.fn().mockResolvedValue({
      data: overrides.storageRemoveError ? null : [],
      error: overrides.storageRemoveError || null,
    }),
    list: vi.fn().mockResolvedValue({
      data: [],
      error: null,
    }),
  };

  const mockStorage = {
    from: vi.fn().mockReturnValue(mockStorageFrom),
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'businesses') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(async () => {
              selectCallCount++;
              if (selectCallCount > 1) {
                // Authoritative re-read call
                if (overrides.recheckError) {
                  return { data: null, error: overrides.recheckError };
                }
                const recheckData =
                  overrides.recheckBusiness !== undefined
                    ? overrides.recheckBusiness
                    : initialBusiness;
                return { data: recheckData, error: null };
              }
              // First select (initial check)
              return { data: initialBusiness, error: null };
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: overrides.updateReturnsNoRows || overrides.dbUpdateError ? null : initialBusiness,
                  error: overrides.dbUpdateError || null,
                }),
              }),
              is: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: overrides.updateReturnsNoRows || overrides.dbUpdateError ? null : initialBusiness,
                    error: overrides.dbUpdateError || null,
                  }),
                }),
              }),
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: overrides.updateReturnsNoRows || overrides.dbUpdateError ? null : initialBusiness,
                    error: overrides.dbUpdateError || null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
    from: mockFrom,
    storage: mockStorage,
  };

  return { client, mockStorageFrom, mockFrom };
}

function makeUploadRequest(formData: FormData, token = 'valid-token'): Request {
  return new Request('http://localhost:54321/functions/v1/upload-logo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
}

describe('upload-logo Edge Function (API-OWN-07 & API-OWN-08)', () => {
  it('handles OPTIONS CORS preflight with 204 No Content', async () => {
    const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
      method: 'OPTIONS',
    });
    const res = await handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('rejects unsupported HTTP methods with 405', async () => {
    const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
      method: 'GET',
    });
    const res = await handler(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
  });

  it('rejects unauthenticated requests lacking Bearer token with HTTP 401', async () => {
    const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
      method: 'POST',
    });
    const { client } = createMockSupabase({});
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects invalid or expired session token with HTTP 401', async () => {
    const { client } = createMockSupabase({
      authError: new Error('Token expired'),
      user: null,
    });
    const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer expired-token' },
    });
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(401);
  });

  it('rejects POST requests that are not multipart/form-data with HTTP 400', async () => {
    const { client } = createMockSupabase({});
    const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ businessId: MOCK_BUSINESS_ID }),
    });
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BAD_REQUEST');
  });

  it('rejects POST missing businessId parameter with HTTP 400', async () => {
    const { client } = createMockSupabase({});
    const formData = new FormData();
    const pngBytes = createValidPngBytes();
    formData.append('file', new File([pngBytes], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BAD_REQUEST');
    expect(body.error.message).toContain('businessId is required');
  });

  it('rejects POST with invalid UUID format with HTTP 400', async () => {
    const { client } = createMockSupabase({});
    const formData = new FormData();
    formData.append('businessId', 'invalid-uuid-format');
    const pngBytes = createValidPngBytes();
    formData.append('file', new File([pngBytes], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('must be a valid UUID');
  });

  it('rejects POST missing file payload with HTTP 400', async () => {
    const { client } = createMockSupabase({});
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('File payload is required');
  });

  it('returns HTTP 404 when target business does not exist', async () => {
    const { client } = createMockSupabase({ business: null });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes()], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_NOT_FOUND');
  });

  it('returns HTTP 403 when caller is not the business owner (cross-tenant isolation)', async () => {
    const { client } = createMockSupabase({
      business: { id: MOCK_BUSINESS_ID, owner_id: MOCK_OTHER_USER_ID, logo_url: null },
    });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes()], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
  });

  it('TC-UPL-05: returns HTTP 413 when file exceeds 2 MB limit', async () => {
    const { client } = createMockSupabase({});
    const oversizedBytes = createValidPngBytes(100, 100, 2_097_152 + 1024);
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([oversizedBytes], 'big.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FILE_TOO_LARGE');
  });

  it('TC-UPL-04: returns HTTP 415 when uploaded file is SVG', async () => {
    const { client } = createMockSupabase({});
    const svgStr = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([svgStr], 'image.svg', { type: 'image/svg+xml' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_IMAGE_TYPE');
    expect(body.error.message).toContain('SVG and executable scripts are strictly prohibited');
  });

  // --------------------------------------------------------------------------
  // CORRECTION A — Full Cryptographic UUID Object Identifiers
  // --------------------------------------------------------------------------
  it('Correction A / TC-UPL-01: successfully uploads valid PNG with full RFC 4122 UUID v4', async () => {
    const { client, mockStorageFrom } = createMockSupabase({});
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes(200, 200)], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('uploaded');
    expect(body.businessId).toBe(MOCK_BUSINESS_ID);

    // Verify URL path contains full RFC 4122 UUID v4
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logos/logo_`);
    const match = body.logoUrl.match(
      /\/logos\/logo_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.png/,
    );
    expect(match).not.toBeNull();
    expect(FULL_UUID_REGEX.test(match![1])).toBe(true);

    // Verify Storage upload was called with upsert: false and full UUID path
    expect(mockStorageFrom.upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^${MOCK_BUSINESS_ID}/logos/logo_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`,
        ),
      ),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/png', upsert: false }),
    );
  });

  it('Correction A / TC-UPL-02: successfully uploads valid JPEG with full UUID', async () => {
    const { client, mockStorageFrom } = createMockSupabase({});
    const jpegBytes = [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
      0x00, 0x64, 0x00, 0x64, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03,
      0x11, 0x01, 0xff, 0xd9,
    ];
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append(
      'file',
      new File([new Uint8Array(jpegBytes)], 'logo.jpeg', { type: 'image/jpeg' }),
    );

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('uploaded');
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logos/logo_`);
    expect(body.logoUrl).toMatch(
      /\/logos\/logo_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpeg/,
    );
    expect(mockStorageFrom.upload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^${MOCK_BUSINESS_ID}/logos/logo_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpeg$`,
        ),
      ),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
  });

  it('Correction A / TC-UPL-03: successfully uploads valid WebP with full UUID', async () => {
    const { client } = createMockSupabase({});
    const w = 63;
    const h = 63;
    const webpBytes = [
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
      0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff,
      h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff,
    ];
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append(
      'file',
      new File([new Uint8Array(webpBytes)], 'logo.webp', { type: 'image/webp' }),
    );

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('uploaded');
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logos/logo_`);
    expect(body.logoUrl).toMatch(
      /\/logos\/logo_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp/,
    );
  });

  it('TC-UPL-07: rejects polyglot executable script injected into image bytes', async () => {
    const { client } = createMockSupabase({});
    const cleanPng = createValidPngBytes(100, 100);
    const scriptPayload = new TextEncoder().encode('<script>evil();</script>');
    const polyglot = new Uint8Array(cleanPng.length + scriptPayload.length);
    polyglot.set(cleanPng);
    polyglot.set(scriptPayload, cleanPng.length);

    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([polyglot], 'polyglot.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_IMAGE_TYPE');
  });

  it('rejects image with dimensions exceeding 2048px with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const largePng = createValidPngBytes(2500, 1000);
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([largePng], 'large.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_IMAGE_DIMENSIONS_EXCEEDED');
  });

  it('rejects image with invalid aspect ratio with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const extremePng = createValidPngBytes(100, 500);
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([extremePng], 'extreme.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_ASPECT_RATIO');
  });

  it('returns HTTP 500 when storage upload fails', async () => {
    const { client } = createMockSupabase({
      storageUploadError: new Error('S3 bucket timeout'),
    });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes()], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_STORAGE_ERROR');
  });

  // --------------------------------------------------------------------------
  // CORRECTION B — Ambiguous Database Commit Outcomes
  // --------------------------------------------------------------------------
  describe('Correction B: Ambiguous Database Commit Outcomes', () => {
    it('Subcase B1: update throws network error but re-read confirms commit succeeded -> returns 200 and preserves object', async () => {
      // Setup: DB update returns error, but re-read confirms the row was updated to the new logo
      const { client, mockStorageFrom } = createMockSupabase({
        dbUpdateError: new Error('connection closed by peer'),
        // In the handler, the re-read will compare against the generated logoUrl
        // We simulate that currentBiz has the committed URL by intercepting via a custom recheck mock
      });

      // Override the second select call to return the new logoUrl
      let selectCount = 0;
      let committedUrl = '';
      client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'businesses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => {
                  selectCount++;
                  if (selectCount === 1) {
                    return {
                      data: { id: MOCK_BUSINESS_ID, owner_id: MOCK_USER_ID, logo_url: null },
                      error: null,
                    };
                  }
                  // Authoritative re-read: returns the committed URL!
                  return {
                    data: { id: MOCK_BUSINESS_ID, owner_id: MOCK_USER_ID, logo_url: committedUrl },
                    error: null,
                  };
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: { logo_url: string }) => {
              committedUrl = payload.logo_url;
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: null,
                          error: new Error('PostgREST HTTP gateway timeout 504'),
                        }),
                      }),
                    }),
                  }),
                }),
              };
            }),
          };
        }
        return {};
      });

      const formData = new FormData();
      formData.append('businessId', MOCK_BUSINESS_ID);
      formData.append('file', new File([createValidPngBytes(100, 100)], 'logo.png', { type: 'image/png' }));

      const req = makeUploadRequest(formData);
      const res = await handler(req, client as unknown as SupabaseClient);

      // Successfully recovers!
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('uploaded');
      expect(body.logoUrl).toBe(committedUrl);

      // Crucial: The uploaded object was NOT deleted!
      expect(mockStorageFrom.remove).not.toHaveBeenCalled();
    });

    it('Subcase B2: update fails AND re-read fails -> returns 500 indeterminate and PRESERVES object', async () => {
      const { client, mockStorageFrom } = createMockSupabase({
        dbUpdateError: new Error('Database connection dropped'),
        recheckError: new Error('DB cluster unreachable'),
      });

      const formData = new FormData();
      formData.append('businessId', MOCK_BUSINESS_ID);
      formData.append('file', new File([createValidPngBytes(100, 100)], 'logo.png', { type: 'image/png' }));

      const req = makeUploadRequest(formData);
      const res = await handler(req, client as unknown as SupabaseClient);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_DATABASE_ERROR');
      expect(body.error.message).toContain('indeterminate');
      expect(body.error.retryable).toBe(true);

      // Invariant: Unreachable DB preserves object to avoid deleting a potentially referenced logo
      expect(mockStorageFrom.remove).not.toHaveBeenCalled();
    });

    it('Subcase B3: update returns 0 rows due to concurrent winner committing first (CAS conflict) -> returns 409 and deletes uncommitted file', async () => {
      const concurrentWinnerUrl = `http://localhost:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_BUSINESS_ID}/logos/logo_concurrent.png`;
      const { client, mockStorageFrom } = createMockSupabase({
        updateReturnsNoRows: true, // 0 rows matched
        recheckBusiness: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_USER_ID,
          logo_url: concurrentWinnerUrl, // Concurrent winner committed!
        },
      });

      const formData = new FormData();
      formData.append('businessId', MOCK_BUSINESS_ID);
      formData.append('file', new File([createValidPngBytes(100, 100)], 'logo.png', { type: 'image/png' }));

      const req = makeUploadRequest(formData);
      const res = await handler(req, client as unknown as SupabaseClient);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_CONFLICT');
      expect(body.error.retryable).toBe(true);

      // Deletes only this request's uncommitted unique file
      expect(mockStorageFrom.remove).toHaveBeenCalledWith([
        expect.stringMatching(new RegExp(`^${MOCK_BUSINESS_ID}/logos/logo_[0-9a-f-]+\\.png$`)),
      ]);
    });

    it('Subcase B4: ownership changed during in-flight upload -> returns 403 and cleans up uploaded file', async () => {
      const { client, mockStorageFrom } = createMockSupabase({
        updateReturnsNoRows: true,
        recheckBusiness: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_OTHER_USER_ID, // Ownership transferred!
          logo_url: null,
        },
      });

      const formData = new FormData();
      formData.append('businessId', MOCK_BUSINESS_ID);
      formData.append('file', new File([createValidPngBytes(100, 100)], 'logo.png', { type: 'image/png' }));

      const req = makeUploadRequest(formData);
      const res = await handler(req, client as unknown as SupabaseClient);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_PERMISSION_DENIED');

      // Object removed since caller is not the owner
      expect(mockStorageFrom.remove).toHaveBeenCalledWith([
        expect.stringMatching(new RegExp(`^${MOCK_BUSINESS_ID}/logos/logo_[0-9a-f-]+\\.png$`)),
      ]);
    });

    it('Subcase B5: genuine DB rejection without concurrent update -> returns 500 and cleans up uncommitted file', async () => {
      const { client, mockStorageFrom } = createMockSupabase({
        dbUpdateError: new Error('Transaction deadlock aborted'),
        recheckBusiness: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_USER_ID,
          logo_url: null, // logo_url remained initial value; write did not commit
        },
      });

      const formData = new FormData();
      formData.append('businessId', MOCK_BUSINESS_ID);
      formData.append('file', new File([createValidPngBytes(100, 100)], 'logo.png', { type: 'image/png' }));

      const req = makeUploadRequest(formData);
      const res = await handler(req, client as unknown as SupabaseClient);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_DATABASE_ERROR');

      // Uncommitted object is cleaned up
      expect(mockStorageFrom.remove).toHaveBeenCalledWith([
        expect.stringMatching(new RegExp(`^${MOCK_BUSINESS_ID}/logos/logo_[0-9a-f-]+\\.png$`)),
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // CORRECTION C — Safe Retention & Bounded Pruning
  // --------------------------------------------------------------------------
  describe('Correction C: Safe Retention & URL Parsing', () => {
    it('extractTenantStoragePath: parses valid tenant logo URL correctly', () => {
      const url = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_BUSINESS_ID}/logos/logo_abcd.png?v=123`;
      const path = extractTenantStoragePath(url, MOCK_BUSINESS_ID);
      expect(path).toBe(`${MOCK_BUSINESS_ID}/logos/logo_abcd.png`);
    });

    it('extractTenantStoragePath: parses legacy fixed-path logo URL correctly', () => {
      const url = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_BUSINESS_ID}/logo.png`;
      const path = extractTenantStoragePath(url, MOCK_BUSINESS_ID);
      expect(path).toBe(`${MOCK_BUSINESS_ID}/logo.png`);
    });

    it('extractTenantStoragePath: strictly rejects URL pointing to another tenant (cross-tenant safety)', () => {
      const url = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_OTHER_USER_ID}/logos/logo_other.png`;
      const path = extractTenantStoragePath(url, MOCK_BUSINESS_ID);
      expect(path).toBeNull();
    });

    it('extractTenantStoragePath: strictly rejects directory traversal attempts', () => {
      const url = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_BUSINESS_ID}/../other/secret.txt`;
      const path = extractTenantStoragePath(url, MOCK_BUSINESS_ID);
      expect(path).toBeNull();
    });

    it('extractTenantStoragePath: safely returns null for null, undefined, or empty string', () => {
      expect(extractTenantStoragePath(null, MOCK_BUSINESS_ID)).toBeNull();
      expect(extractTenantStoragePath(undefined, MOCK_BUSINESS_ID)).toBeNull();
      expect(extractTenantStoragePath('', MOCK_BUSINESS_ID)).toBeNull();
    });

    it('pruneSupersededLogos: NEVER deletes currently referenced active logo in DB', async () => {
      const activePath = `${MOCK_BUSINESS_ID}/logos/logo_active.png`;
      const activeUrl = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${activePath}`;

      const mockStorage = {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              name: 'logo_active.png',
              created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour old
            },
          ],
          error: null,
        }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const mockClient = {
        storage: { from: vi.fn().mockReturnValue(mockStorage) },
      } as unknown as SupabaseClient;

      const result = await pruneSupersededLogos(
        mockClient,
        MOCK_BUSINESS_ID,
        activeUrl,
        null,
        0, // Grace period 0 to test retention override
      );

      // Active file was retained and NOT removed
      expect(result.retained).toContain(activePath);
      expect(result.pruned).not.toContain(activePath);
      expect(mockStorage.remove).not.toHaveBeenCalled();
    });

    it('pruneSupersededLogos: retains superseded files younger than grace period', async () => {
      const activePath = `${MOCK_BUSINESS_ID}/logos/logo_active.png`;
      const supersededRecentPath = `${MOCK_BUSINESS_ID}/logos/logo_recent.png`;
      const activeUrl = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${activePath}`;

      const mockStorage = {
        list: vi.fn().mockResolvedValue({
          data: [
            { name: 'logo_active.png', created_at: new Date().toISOString() },
            {
              name: 'logo_recent.png',
              created_at: new Date(Date.now() - 60000).toISOString(), // 1 minute old
            },
          ],
          error: null,
        }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const mockClient = {
        storage: { from: vi.fn().mockReturnValue(mockStorage) },
      } as unknown as SupabaseClient;

      const result = await pruneSupersededLogos(
        mockClient,
        MOCK_BUSINESS_ID,
        activeUrl,
        null,
        15 * 60 * 1000, // 15 minute grace period
      );

      // Both active and recent superseded file retained!
      expect(result.retained).toContain(supersededRecentPath);
      expect(result.pruned).not.toContain(supersededRecentPath);
      expect(mockStorage.remove).not.toHaveBeenCalled();
    });

    it('pruneSupersededLogos: prunes superseded files older than grace period', async () => {
      const activePath = `${MOCK_BUSINESS_ID}/logos/logo_active.png`;
      const supersededOldPath = `${MOCK_BUSINESS_ID}/logos/logo_old.png`;
      const activeUrl = `http://127.0.0.1:54321/storage/v1/object/public/${BUCKET_NAME}/${activePath}`;

      const mockStorage = {
        list: vi.fn().mockImplementation((path: string) => {
          if (path.includes('/logos')) {
            return Promise.resolve({
              data: [
                { name: 'logo_active.png', created_at: new Date().toISOString() },
                {
                  name: 'logo_old.png',
                  created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour old
                },
              ],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const mockClient = {
        storage: { from: vi.fn().mockReturnValue(mockStorage) },
      } as unknown as SupabaseClient;

      const result = await pruneSupersededLogos(
        mockClient,
        MOCK_BUSINESS_ID,
        activeUrl,
        null,
        15 * 60 * 1000, // 15 minute grace period
      );

      expect(result.pruned).toContain(supersededOldPath);
      expect(result.retained).toContain(activePath);
      expect(mockStorage.remove).toHaveBeenCalledWith([supersededOldPath]);
    });
  });

  // --------------------------------------------------------------------------
  // DELETE METHOD TESTS (API-OWN-08)
  // --------------------------------------------------------------------------
  describe('DELETE handler (API-OWN-08)', () => {
    it('DELETE: rejects missing businessId with HTTP 400', async () => {
      const { client } = createMockSupabase({});
      const req = new Request('http://localhost:54321/functions/v1/upload-logo', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid-token' },
      });
      const res = await handler(req, client as unknown as SupabaseClient);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_BAD_REQUEST');
    });

    it('DELETE: returns HTTP 403 when caller is not the business owner', async () => {
      const { client } = createMockSupabase({
        business: { id: MOCK_BUSINESS_ID, owner_id: MOCK_OTHER_USER_ID, logo_url: 'https://...' },
      });
      const req = new Request(
        `http://localhost:54321/functions/v1/upload-logo?businessId=${MOCK_BUSINESS_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid-token' },
        },
      );
      const res = await handler(req, client as unknown as SupabaseClient);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
    });

    it('DELETE: successfully clears database logo_url and invokes bounded pruning', async () => {
      const existingLogoPath = `${MOCK_BUSINESS_ID}/logos/logo_abcd.png`;
      const existingLogoUrl = `http://localhost:54321/storage/v1/object/public/business-logos/${existingLogoPath}`;
      const { client } = createMockSupabase({
        business: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_USER_ID,
          logo_url: existingLogoUrl,
        },
      });

      const req = new Request(
        `http://localhost:54321/functions/v1/upload-logo?businessId=${MOCK_BUSINESS_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid-token' },
        },
      );

      const res = await handler(req, client as unknown as SupabaseClient);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('deleted');
      expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    });

    it('DELETE Decision M5-T05-D02: storage removal failure does NOT restore DB pointer (fail-safe avatar fallback)', async () => {
      const existingLogoPath = `${MOCK_BUSINESS_ID}/logos/logo_abcd.png`;
      const existingLogoUrl = `http://localhost:54321/storage/v1/object/public/business-logos/${existingLogoPath}`;
      const { client, mockFrom } = createMockSupabase({
        business: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_USER_ID,
          logo_url: existingLogoUrl,
        },
        storageRemoveError: new Error('Storage cluster unreachable'),
      });
      const req = new Request(
        `http://localhost:54321/functions/v1/upload-logo?businessId=${MOCK_BUSINESS_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid-token' },
        },
      );
      const res = await handler(req, client as unknown as SupabaseClient);

      // Decision D02: DELETE returns 200 even if Storage removal fails —
      // DB is already NULL, client gets monogram avatar. No false restoration.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('deleted');

      // Verify DB was cleared (businesses table was updated)
      expect(mockFrom).toHaveBeenCalledWith('businesses');
    });

    it('DELETE: returns HTTP 409 if a new logo was uploaded concurrently', async () => {
      const newLogoUrl = `http://localhost:54321/storage/v1/object/public/${BUCKET_NAME}/${MOCK_BUSINESS_ID}/logos/logo_new.png`;
      const { client } = createMockSupabase({
        updateReturnsNoRows: true, // CAS clear failed because row changed
        recheckBusiness: {
          id: MOCK_BUSINESS_ID,
          owner_id: MOCK_USER_ID,
          logo_url: newLogoUrl, // A new logo was committed concurrently!
        },
      });

      const req = new Request(
        `http://localhost:54321/functions/v1/upload-logo?businessId=${MOCK_BUSINESS_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid-token' },
        },
      );

      const res = await handler(req, client as unknown as SupabaseClient);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_CONFLICT');
      expect(body.error.message).toContain('uploaded concurrently');
    });
  });
});
