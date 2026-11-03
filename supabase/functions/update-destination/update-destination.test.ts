import { describe, it, expect, vi } from 'vitest';
import { handler } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';

function createMockSupabase(options: {
  user?: { id: string } | null;
  authError?: Error | null;
  rpcResult?: Record<string, unknown> | null;
  rpcError?: { message: string } | null;
}): { client: SupabaseClient; mockRpc: ReturnType<typeof vi.fn> } {
  const {
    user = { id: MOCK_USER_ID },
    authError = null,
    rpcResult = {
      status: 'updated',
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      googlePlaceId: 'ChIJLUXE00000001',
    },
    rpcError = null,
  } = options;

  const mockRpc = vi.fn().mockImplementation((fnName: string, params: Record<string, unknown>) => {
    if (fnName === 'update_merchant_destination') {
      if (rpcError) {
        return Promise.resolve({ data: null, error: rpcError });
      }
      return Promise.resolve({
        data: rpcResult || {
          status: 'updated',
          businessId: params.p_business_id,
          googleReviewUrl: params.p_google_review_url,
          googlePlaceId: params.p_google_place_id,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: { message: `Unknown function ${fnName}` } });
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
    rpc: mockRpc,
  } as unknown as SupabaseClient;

  return { client, mockRpc };
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

describe('update-destination Edge Function (API-OWN-03 / Option B RPC)', () => {
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
    const { client } = createMockSupabase({
      user: null,
      authError: new Error('Token expired'),
    });

    const req = makeRequest('POST', { businessId: MOCK_BUSINESS_ID });
    const res = await handler(req, client);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects malformed JSON body with HTTP 400', async () => {
    const { client } = createMockSupabase({});
    const req = new Request('https://test.supabase.co/functions/v1/update-destination', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
      body: 'invalid-json-body',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BAD_REQUEST');
  });

  it('rejects payload with invalid UUID with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: 'not-a-uuid',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
  });

  it('TC-API-16 & TC-OWN-09: rejects unapproved lookalike domain with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://google.com.attacker.com/local/writereview?placeid=ChIJ123',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
  });

  it('rejects insecure HTTP destination URL with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'http://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_DESTINATION_URL');
    expect(body.error.message).toContain('HTTPS');
  });

  it('TC-DST-09: rejects Place ID mismatch between URL and explicit parameter with HTTP 422', async () => {
    const { client } = createMockSupabase({});
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE0000000100000000',
      googlePlaceId: 'ChIJDIFFERENT00000000000',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PLACE_ID_MISMATCH');
  });

  it('maps ERR_BUSINESS_NOT_FOUND from RPC to HTTP 404', async () => {
    const { client, mockRpc } = createMockSupabase({
      rpcError: { message: 'ERR_BUSINESS_NOT_FOUND: Business record not found' },
    });

    const req = makeRequest('POST', {
      businessId: 'c0000000-0000-4000-8000-000000000099',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_NOT_FOUND');
    expect(mockRpc).toHaveBeenCalledWith('update_merchant_destination', expect.any(Object));
  });

  it('maps ERR_PERMISSION_DENIED from RPC to HTTP 403', async () => {
    const { client } = createMockSupabase({
      rpcError: { message: 'ERR_PERMISSION_DENIED: Caller does not own this business' },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345678901234567890',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
  });

  it('maps ERR_PLACE_ID_MISMATCH from unique index collision to HTTP 422', async () => {
    const { client } = createMockSupabase({
      rpcError: {
        message: 'ERR_PLACE_ID_MISMATCH: This Google Place ID is already associated with another registered business',
      },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJDAILY000000100000000',
    });

    const res = await handler(req, client);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PLACE_ID_MISMATCH');
    expect(body.error.message).toContain('associated with another registered business');
  });

  it('TC-API-17 & TC-OWN-08: successfully delegates atomic update to RPC with verified owner identity', async () => {
    const newUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE_NEW_000000000001';
    const { client, mockRpc } = createMockSupabase({
      rpcResult: {
        status: 'updated',
        businessId: MOCK_BUSINESS_ID,
        googleReviewUrl: newUrl,
        googlePlaceId: 'ChIJLUXE_NEW_000000000001',
      },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: newUrl,
    });

    const res = await handler(req, client);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('updated');
    expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    expect(body.googleReviewUrl).toBe(newUrl);
    expect(body.googlePlaceId).toBe('ChIJLUXE_NEW_000000000001');

    // Security Check: Verify owner ID passed to RPC is derived strictly from auth user
    expect(mockRpc).toHaveBeenCalledWith('update_merchant_destination', {
      p_business_id: MOCK_BUSINESS_ID,
      p_owner_id: MOCK_USER_ID,
      p_google_review_url: newUrl,
      p_google_place_id: 'ChIJLUXE_NEW_000000000001',
      p_ip_hash: expect.any(String),
    });
  });

  it('returns status unmodified when RPC reports no-op payload', async () => {
    const existingUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001';
    const { client, mockRpc } = createMockSupabase({
      rpcResult: {
        status: 'unmodified',
        businessId: MOCK_BUSINESS_ID,
        googleReviewUrl: existingUrl,
        googlePlaceId: 'ChIJLUXE00000001',
      },
    });

    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: existingUrl,
    });

    const res = await handler(req, client);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('unmodified');
    expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    expect(mockRpc).toHaveBeenCalledWith('update_merchant_destination', expect.any(Object));
  });

  it('maps generic internal database error to HTTP 500 without leaking SQL details', async () => {
    const { client } = createMockSupabase({
      rpcError: { message: 'relation "admin_audit_logs" does not exist (SQLSTATE 42P01)' },
    });

    const newUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE_NEW_000000000001';
    const req = makeRequest('POST', {
      businessId: MOCK_BUSINESS_ID,
      googleReviewUrl: newUrl,
    });

    const res = await handler(req, client);
    expect(res.status).toBe(500);
    const body = await res.json();

    expect(body.error.code).toBe('ERR_INTERNAL_SERVER_ERROR');
    expect(body.error.message).toBe('Failed to update business destination in database.');
    expect(body.error.message).not.toContain('42P01');
    expect(body.error.message).not.toContain('admin_audit_logs');
  });
});
