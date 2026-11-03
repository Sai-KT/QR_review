import { describe, it, expect, vi } from 'vitest';
import { handler } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_OTHER_USER_ID = '99999999-9999-4000-8000-999999999999';
const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';
const MOCK_OTHER_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000002';

function createMockSupabase(options: {
  user?: { id: string } | null;
  authError?: Error | null;
  business?: {
    id: string;
    owner_id: string;
    google_review_url: string | null;
    google_place_id: string | null;
  } | null;
  collision?: { id: string } | null;
  updateError?: Error | null;
  auditInsertError?: Error | null;
}): SupabaseClient {
  const {
    user = { id: MOCK_USER_ID },
    authError = null,
    business = {
      id: MOCK_BUSINESS_ID,
      owner_id: MOCK_USER_ID,
      google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      google_place_id: 'ChIJLUXE00000001',
    },
    collision = null,
    updateError = null,
    auditInsertError = null,
  } = options;

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'businesses') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            if (col === 'id') {
              return {
                maybeSingle: vi.fn().mockResolvedValue({
                  data: business && business.id === val ? business : null,
                  error: null,
                }),
              };
            }
            if (col === 'google_place_id') {
              return {
                neq: vi.fn().mockImplementation(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: collision,
                    error: null,
                  }),
                })),
              };
            }
            return {
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
        }),
        update: vi.fn().mockImplementation(() => {
          const builder: Record<string, unknown> = {
            then(onFulfilled?: (value: unknown) => unknown) {
              const res = {
                data: updateError ? null : [{ id: business?.id || MOCK_BUSINESS_ID }],
                error: updateError,
              };
              return Promise.resolve(res).then(onFulfilled);
            },
            select: vi.fn().mockImplementation(() => ({
              then(onFulfilled?: (value: unknown) => unknown) {
                const res = {
                  data: updateError ? null : [{ id: business?.id || MOCK_BUSINESS_ID }],
                  error: updateError,
                };
                return Promise.resolve(res).then(onFulfilled);
              },
            })),
          };
          builder.eq = vi.fn().mockReturnValue(builder);
          return builder;
        }),
      };
    }

    if (table === 'admin_audit_logs') {
      return {
        insert: vi.fn().mockResolvedValue({
          error: auditInsertError,
        }),
      };
    }

    return {};
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
    from: mockFrom,
  } as unknown as SupabaseClient;
}

function makeRequest(
  method: string,
  body?: unknown,
  token = 'valid-jwt-token',
  customHeaders: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return new Request('https://test.supabase.co/functions/v1/update-destination', {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('update-destination Edge Function (API-OWN-03)', () => {
  it('handles CORS OPTIONS preflight with HTTP 204', async () => {
    const req = new Request('https://test.supabase.co/functions/v1/update-destination', {
      method: 'OPTIONS',
    });

    const res = await handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects non-POST HTTP methods with HTTP 405', async () => {
    const req = new Request('https://test.supabase.co/functions/v1/update-destination', {
      method: 'GET',
    });

    const res = await handler(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
  });

  it('rejects unauthenticated requests lacking Bearer token with HTTP 401', async () => {
    const req = makeRequest('POST', { businessId: MOCK_BUSINESS_ID }, '');
    const res = await handler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects invalid or expired JWT token with HTTP 401', async () => {
    const mockSupabase = createMockSupabase({
      user: null,
      authError: new Error('Token expired'),
    });

    const req = makeRequest('POST', { businessId: MOCK_BUSINESS_ID });
    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects malformed JSON body with HTTP 400', async () => {
    const mockSupabase = createMockSupabase({});
    const req = new Request('https://test.supabase.co/functions/v1/update-destination', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: 'invalid-json-body',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BAD_REQUEST');
  });

  it('rejects payload with invalid UUID with HTTP 422', async () => {
    const mockSupabase = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: 'not-a-uuid',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
  });

  it('returns HTTP 404 when business record is not found', async () => {
    const mockSupabase = createMockSupabase({
      business: null,
    });

    const req = makeRequest('POST', {
      businessId: 'c0000000-0000-4000-8000-000000000099',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_NOT_FOUND');
  });

  it('enforces tenant boundary: rejects modification of another merchants business with HTTP 403', async () => {
    const mockSupabase = createMockSupabase({
      user: { id: MOCK_OTHER_USER_ID }, // User is NOT the owner
      business: {
        id: MOCK_BUSINESS_ID,
        owner_id: MOCK_USER_ID, // Owner is MOCK_USER_ID
        google_review_url: null,
        google_place_id: null,
      },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
  });

  it('TC-API-16 & TC-OWN-09: rejects unapproved lookalike domain with HTTP 422', async () => {
    const mockSupabase = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://google.com.attacker.com/local/writereview?placeid=ChIJ123',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
  });

  it('rejects insecure HTTP destination URL with HTTP 422', async () => {
    const mockSupabase = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'http://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
    expect(body.error.message).toContain('HTTPS');
  });

  it('TC-DST-09: rejects Place ID mismatch between URL and explicit parameter with HTTP 422', async () => {
    const mockSupabase = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE0000000100000000',
      googlePlaceId: 'ChIJDIFFERENT00000000000',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PLACE_ID_MISMATCH');
  });

  it('rejects cross-tenant Place ID collision with another registered business with HTTP 422', async () => {
    const mockSupabase = createMockSupabase({
      collision: { id: MOCK_OTHER_BUSINESS_ID },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJDAILY000000100000000',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PLACE_ID_MISMATCH');
    expect(body.error.message).toContain('associated with another registered business');
  });

  it('TC-API-17 & TC-OWN-08: successfully updates destination and records audit trail', async () => {
    const mockSupabase = createMockSupabase({});
    const newUrl =
      'https://search.google.com/local/writereview?placeid=ChIJLUXE_NEW_000000000001';

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: newUrl,
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('updated');
    expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    expect(body.googleReviewUrl).toBe(newUrl);
    expect(body.googlePlaceId).toBe('ChIJLUXE_NEW_000000000001');

    // Verify database update was dispatched
    expect(mockSupabase.from).toHaveBeenCalledWith('businesses');
    expect(mockSupabase.from).toHaveBeenCalledWith('admin_audit_logs');
  });

  it('successfully updates shortlink destination without placeid in URL', async () => {
    const mockSupabase = createMockSupabase({});
    const shortlink = 'https://maps.app.goo.gl/AbCd12345';

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: shortlink,
      googlePlaceId: 'ChIJLUXE_MANUAL_00000001',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('updated');
    expect(body.googleReviewUrl).toBe(shortlink);
    expect(body.googlePlaceId).toBe('ChIJLUXE_MANUAL_00000001');
  });

  it('returns status unmodified without writes when payload matches existing destination (no-op)', async () => {
    const mockSupabase = createMockSupabase({
      business: {
        id: MOCK_BUSINESS_ID,
        owner_id: MOCK_USER_ID,
        google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
        google_place_id: 'ChIJLUXE00000001',
      },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('unmodified');
    expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    // Audit log should NOT be written for no-op requests
    expect(mockSupabase.from).not.toHaveBeenCalledWith('admin_audit_logs');
  });

  it('triggers compensating rollback and returns 500 when audit log insertion fails', async () => {
    const mockSupabase = createMockSupabase({
      auditInsertError: { message: 'Database connection dropped while inserting audit log' },
    });

    const newUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE_NEW_000000000001';
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: newUrl,
    });

    const res = await handler(req, mockSupabase);
    expect(res.status).toBe(500);
    const body = await res.json();

    expect(body.error.code).toBe('ERR_INTERNAL_SERVER_ERROR');
    expect(body.error.message).toContain('Failed to record required audit log');
  });
});
