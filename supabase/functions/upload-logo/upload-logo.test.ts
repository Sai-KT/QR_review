// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { handler } from './index';

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000002';
const MOCK_OTHER_USER_ID = '00000000-0000-4000-8000-000000000099';
const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';

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
  storageUploadError?: Error | null;
  storageRemoveError?: Error | null;
  storageMoveError?: Error | null;
  dbUpdateError?: Error | null;
  updateReturnsNoRows?: boolean;
}) {
  const user = overrides.user !== undefined ? overrides.user : { id: MOCK_USER_ID };
  const authError = overrides.authError ?? null;
  const business =
    overrides.business !== undefined
      ? overrides.business
      : { id: MOCK_BUSINESS_ID, owner_id: MOCK_USER_ID, logo_url: null };

  const mockStorageFrom = {
    upload: vi.fn().mockResolvedValue({
      data: overrides.storageUploadError ? null : { path: 'uploaded-path' },
      error: overrides.storageUploadError || null,
    }),
    remove: vi.fn().mockResolvedValue({
      data: overrides.storageRemoveError ? null : [],
      error: overrides.storageRemoveError || null,
    }),
    move: vi.fn().mockResolvedValue({
      data: overrides.storageMoveError ? null : { message: 'Successfully moved' },
      error: overrides.storageMoveError || null,
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
            maybeSingle: vi.fn().mockResolvedValue({
              data: business,
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: overrides.updateReturnsNoRows || overrides.dbUpdateError ? null : business,
                  error: overrides.dbUpdateError || null,
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

  it('TC-UPL-01: successfully uploads valid PNG, cleans old extensions, and updates database', async () => {
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
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logo.png`);

    // Verify storage cleanup of old extensions was dispatched
    expect(mockStorageFrom.remove).toHaveBeenCalledWith([
      `${MOCK_BUSINESS_ID}/logo.jpeg`,
      `${MOCK_BUSINESS_ID}/logo.webp`,
    ]);

    // Verify file upload was dispatched
    expect(mockStorageFrom.upload).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/logo.png`,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    );
  });

  it('TC-UPL-02: successfully uploads valid JPEG and updates database', async () => {
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
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logo.jpeg`);
    expect(mockStorageFrom.upload).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/logo.jpeg`,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
  });

  it('TC-UPL-03: successfully uploads valid WebP and updates database', async () => {
    const { client, mockStorageFrom } = createMockSupabase({});
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
    expect(body.logoUrl).toContain(`business-logos/${MOCK_BUSINESS_ID}/logo.webp`);
    expect(mockStorageFrom.upload).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/logo.webp`,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/webp' }),
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
    const extremePng = createValidPngBytes(100, 500); // 1:5 aspect ratio
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

  // DELETE Method tests (API-OWN-08)
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

  it('DELETE: successfully removes logo files from storage and clears database logo_url', async () => {
    const { client, mockStorageFrom } = createMockSupabase({
      business: {
        id: MOCK_BUSINESS_ID,
        owner_id: MOCK_USER_ID,
        logo_url: `http://localhost:54321/storage/v1/object/public/business-logos/${MOCK_BUSINESS_ID}/logo.png`,
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

    // Verify storage removal was called
    expect(mockStorageFrom.remove).toHaveBeenCalledWith([
      `${MOCK_BUSINESS_ID}/logo.png`,
      `${MOCK_BUSINESS_ID}/logo.jpeg`,
      `${MOCK_BUSINESS_ID}/logo.webp`,
    ]);
  });

  // Check B: Failure-safe replacement tests
  it('Check B: restores safety backup if storage upload fails during same-extension replacement', async () => {
    const { client, mockStorageFrom } = createMockSupabase({
      storageUploadError: new Error('S3 connection drop'),
    });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes(200, 200)], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(500);

    // Verify move to backup was attempted
    expect(mockStorageFrom.move).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/logo.png`,
      `${MOCK_BUSINESS_ID}/.backup_logo.png`,
    );
    // Verify backup restoration was executed
    expect(mockStorageFrom.move).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/.backup_logo.png`,
      `${MOCK_BUSINESS_ID}/logo.png`,
    );
  });

  it('Check B: rolls back new file and restores backup if database update fails', async () => {
    const { client, mockStorageFrom } = createMockSupabase({
      dbUpdateError: new Error('Database transaction lock conflict'),
    });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes(200, 200)], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_DATABASE_ERROR');

    // Verify new file was deleted in rollback
    expect(mockStorageFrom.remove).toHaveBeenCalledWith([`${MOCK_BUSINESS_ID}/logo.png`]);
    // Verify backup was restored
    expect(mockStorageFrom.move).toHaveBeenCalledWith(
      `${MOCK_BUSINESS_ID}/.backup_logo.png`,
      `${MOCK_BUSINESS_ID}/logo.png`,
    );
  });

  // Check C: Honest error handling on DELETE
  it('Check C: returns HTTP 500 when storage remove fails on DELETE', async () => {
    const { client } = createMockSupabase({
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
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_STORAGE_ERROR');
  });

  // Check E: Tenant ownership constraint at mutation time
  it('Check E: returns HTTP 403 if business ownership changed during upload DB update', async () => {
    const { client } = createMockSupabase({
      updateReturnsNoRows: true, // Simulated ownership change
    });
    const formData = new FormData();
    formData.append('businessId', MOCK_BUSINESS_ID);
    formData.append('file', new File([createValidPngBytes(200, 200)], 'logo.png', { type: 'image/png' }));

    const req = makeUploadRequest(formData);
    const res = await handler(req, client as unknown as SupabaseClient);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
  });
});
