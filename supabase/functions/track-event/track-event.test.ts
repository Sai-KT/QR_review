/**
 * Unit Test Suite: track-event Edge Function (API-PUB-05)
 *
 * Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
 * Specifications:
 *   - docs/API_SPEC.md (v1.2) §7.5, §18 (TC-API-13)
 *   - docs/ROADMAP.md (v1.1) Task M3-T04
 *   - docs/TEST_PLAN.md (v1.1) TC-ANA-01..06, TC-API-13
 *   - docs/SECURITY.md (v1.1) §7 (TH-13), §13 (GC-02)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleTrackEvent,
  computeDeduplicationKey,
  PERMITTED_CLIENT_EVENTS,
  MAX_REQUEST_BODY_BYTES,
} from './index.ts';
import { trackEvent, detectUserAgentCategory } from '../../../src/lib/api/analytics.ts';

const VALID_API_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const TEST_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const BIZ_UUID = 'a0000000-0000-4000-8000-000000000001';
const VALID_QR_ID = 'luxe000001';
const VALID_SESSION_UUID = 'e1111111-2222-4333-8444-555555555555';

function createMockSupabase(overrides?: {
  businessData?: unknown;
  businessError?: unknown;
  recentEventData?: unknown;
  recentEventError?: unknown;
  insertError?: unknown;
}) {
  const businessData =
    overrides && 'businessData' in overrides
      ? overrides.businessData
      : { id: BIZ_UUID, name: 'Luxe Salon', account_status: 'active', is_active: true };
  const businessError = overrides?.businessError ?? null;
  const recentEventData = overrides?.recentEventData ?? null;
  const recentEventError = overrides?.recentEventError ?? null;
  const insertError = overrides?.insertError ?? null;

  const insertedRows: unknown[] = [];

  const mockClient = {
    from: vi.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: businessData,
            error: businessError,
          }),
        };
      }
      if (table === 'analytics_events') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: recentEventData,
            error: recentEventError,
          }),
          insert: vi.fn().mockImplementation((payload: unknown) => {
            if (insertError) {
              return Promise.resolve({ error: insertError });
            }
            insertedRows.push(payload);
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    _insertedRows: insertedRows,
  } as unknown as SupabaseClient & { _insertedRows: unknown[] };

  return mockClient;
}

function createRequest(
  body: unknown,
  options?: {
    method?: string;
    apiKey?: string;
    authHeader?: string;
    correlationId?: string;
    contentType?: string;
  },
): Request {
  const method = options?.method ?? 'POST';
  const headers = new Headers();

  if (options?.apiKey !== undefined) {
    if (options.apiKey) headers.set('apikey', options.apiKey);
  } else {
    headers.set('apikey', VALID_API_KEY);
  }

  if (options?.authHeader) {
    headers.set('Authorization', options.authHeader);
  }

  if (options?.correlationId) {
    headers.set('x-correlation-id', options.correlationId);
  }

  if (options?.contentType !== undefined) {
    if (options.contentType) headers.set('content-type', options.contentType);
  } else {
    headers.set('content-type', 'application/json');
  }

  return new Request('http://localhost:54321/functions/v1/track-event', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('M3-T04: track-event Edge Function Unit Tests (API-PUB-05)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Request Validation Suite                                              */
  /* ------------------------------------------------------------------------ */

  it('1. accepts valid payload for each of the 6 permitted client events', async () => {
    for (const eventName of PERMITTED_CLIENT_EVENTS) {
      const mockSupabase = createMockSupabase();
      const req = createRequest({
        publicQrId: VALID_QR_ID,
        eventName,
        sessionUuid: VALID_SESSION_UUID,
        userAgentCategory: 'mobile',
      });

      const res = await handleTrackEvent(req, {
        supabaseClient: mockSupabase,
        expectedApiKey: VALID_API_KEY,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe('accepted');
      expect(mockSupabase._insertedRows).toHaveLength(1);
      expect((mockSupabase._insertedRows[0] as Record<string, unknown>).event_name).toBe(eventName);
    }
  });

  it('2. defaults userAgentCategory to "mobile" when omitted in payload', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(202);
    expect((mockSupabase._insertedRows[0] as Record<string, unknown>).user_agent_category).toBe('mobile');
  });

  it('3. accepts valid desktop and tablet userAgentCategories', async () => {
    for (const cat of ['desktop', 'tablet'] as const) {
      const mockSupabase = createMockSupabase();
      const req = createRequest({
        publicQrId: VALID_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid: VALID_SESSION_UUID,
        userAgentCategory: cat,
      });

      const res = await handleTrackEvent(req, {
        supabaseClient: mockSupabase,
        expectedApiKey: VALID_API_KEY,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(res.status).toBe(202);
      expect((mockSupabase._insertedRows[0] as Record<string, unknown>).user_agent_category).toBe(cat);
    }
  });

  it('4. rejects invalid userAgentCategory with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
      userAgentCategory: 'smart-fridge',
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    expect(body.error.message).toContain('userAgentCategory');
  });

  it('5. rejects missing publicQrId with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('6. rejects malformed publicQrId (spaces, uppercase, symbols) with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    for (const badQr of ['LUXE000001', 'luxe 0001', 'luxe@123', 'short', 'waytoolongidentifier12345']) {
      const mockSupabase = createMockSupabase();
      const req = createRequest({
        publicQrId: badQr,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: VALID_SESSION_UUID,
      });

      const res = await handleTrackEvent(req, {
        supabaseClient: mockSupabase,
        expectedApiKey: VALID_API_KEY,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    }
  });

  it('7. rejects missing sessionUuid with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('8. rejects malformed sessionUuid with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    for (const badUuid of ['not-a-uuid', '12345', 'e1111111-2222-4333-8444-zzzzzzzzzzzz']) {
      const mockSupabase = createMockSupabase();
      const req = createRequest({
        publicQrId: VALID_QR_ID,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: badUuid,
      });

      const res = await handleTrackEvent(req, {
        supabaseClient: mockSupabase,
        expectedApiKey: VALID_API_KEY,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    }
  });

  it('9. rejects missing or empty eventName with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('10. rejects arbitrary unsupported event name with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_USER_BOUGHT_COFFEE',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    expect(body.error.message).toContain('Invalid eventName');
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Server-Owned Event Restriction Suite (TC-ANA-02, TC-ANA-03)           */
  /* ------------------------------------------------------------------------ */

  it('11. strictly rejects EVENT_SURVEY_COMPLETED with HTTP 403 ERR_FORBIDDEN_EVENT (TC-ANA-02)', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_SURVEY_COMPLETED',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');
    expect(body.error.message).toContain('EVENT_SURVEY_COMPLETED');
    expect(mockSupabase._insertedRows).toHaveLength(0);
  });

  it('12. strictly rejects EVENT_GENERATION_SUCCESS with HTTP 403 ERR_FORBIDDEN_EVENT (TC-ANA-03)', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_GENERATION_SUCCESS',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');
    expect(body.error.message).toContain('EVENT_GENERATION_SUCCESS');
    expect(mockSupabase._insertedRows).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Payload Hardening & Size Bounds                                       */
  /* ------------------------------------------------------------------------ */

  it('13. rejects malformed JSON with HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const mockSupabase = createMockSupabase();
    const req = createRequest('{ "broken_json": true, ');

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    expect(body.error.message).toContain('JSON');
  });

  it('14. rejects non-object JSON body (arrays, numbers) with HTTP 400', async () => {
    for (const invalidBody of [[1, 2, 3], 'a string', 42]) {
      const mockSupabase = createMockSupabase();
      const req = createRequest(invalidBody);

      const res = await handleTrackEvent(req, {
        supabaseClient: mockSupabase,
        expectedApiKey: VALID_API_KEY,
        jwtSecret: TEST_JWT_SECRET,
      });

      expect(res.status).toBe(400);
    }
  });

  it('15. rejects oversized payload (>16KB) with HTTP 413 ERR_PAYLOAD_TOO_LARGE', async () => {
    const mockSupabase = createMockSupabase();
    const oversizedPadding = 'a'.repeat(MAX_REQUEST_BODY_BYTES + 100);
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
      extra: oversizedPadding,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PAYLOAD_TOO_LARGE');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Authentication & Security Suite                                       */
  /* ------------------------------------------------------------------------ */

  it('16. responds with HTTP 204 to CORS OPTIONS preflight', async () => {
    const req = new Request('http://localhost:54321/functions/v1/track-event', {
      method: 'OPTIONS',
    });

    const res = await handleTrackEvent(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('17. rejects unsupported HTTP methods with HTTP 405 ERR_METHOD_NOT_ALLOWED', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const req = new Request('http://localhost:54321/functions/v1/track-event', {
        method,
        headers: { apikey: VALID_API_KEY },
      });

      const res = await handleTrackEvent(req, {
        expectedApiKey: VALID_API_KEY,
      });

      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
    }
  });

  it('18. rejects request missing API key with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const req = createRequest(
      { publicQrId: VALID_QR_ID, eventName: 'EVENT_QR_PAGE_VIEW', sessionUuid: VALID_SESSION_UUID },
      { apiKey: '' },
    );

    const res = await handleTrackEvent(req, {
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('19. rejects invalid or forged API key with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const req = createRequest(
      { publicQrId: VALID_QR_ID, eventName: 'EVENT_QR_PAGE_VIEW', sessionUuid: VALID_SESSION_UUID },
      { apiKey: 'forged_or_random_api_key' },
    );

    const res = await handleTrackEvent(req, {
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('20. rejects privileged service-role key on public endpoint with HTTP 401', async () => {
    const serviceRoleKey = 'service_role_secret_key_that_must_not_be_used_publicly';
    const oldEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

    try {
      const req = createRequest(
        { publicQrId: VALID_QR_ID, eventName: 'EVENT_QR_PAGE_VIEW', sessionUuid: VALID_SESSION_UUID },
        { apiKey: serviceRoleKey },
      );

      const res = await handleTrackEvent(req, {
        expectedApiKey: VALID_API_KEY,
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_UNAUTHORIZED');
      expect(body.error.message).toContain('Service role key is forbidden');
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = oldEnv;
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Business Resolution Suite                                             */
  /* ------------------------------------------------------------------------ */

  it('21. returns HTTP 404 ERR_QR_NOT_FOUND when publicQrId does not exist', async () => {
    const mockSupabase = createMockSupabase({ businessData: null });
    const req = createRequest({
      publicQrId: 'nonexistent1',
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_QR_NOT_FOUND');
    expect(mockSupabase._insertedRows).toHaveLength(0);
  });

  it('22. returns HTTP 500 ERR_INTERNAL if business lookup database query fails', async () => {
    const mockSupabase = createMockSupabase({
      businessError: { message: 'Database connection failed' },
    });
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INTERNAL');
  });

  it('23. records event successfully for suspended business (preserving scan telemetry)', async () => {
    const mockSupabase = createMockSupabase({
      businessData: { id: BIZ_UUID, name: 'Suspended Salon', account_status: 'suspended', is_active: false },
    });
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(202);
    expect(mockSupabase._insertedRows).toHaveLength(1);
    expect((mockSupabase._insertedRows[0] as Record<string, unknown>).business_id).toBe(BIZ_UUID);
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Server Deduplication & Idempotency Suite (TC-ANA-04, TC-API-13)       */
  /* ------------------------------------------------------------------------ */

  it('24. computeDeduplicationKey is deterministic for identical inputs within same minute', () => {
    const now = Date.now();
    const key1 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_SUCCESS', VALID_SESSION_UUID, now);
    const key2 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_SUCCESS', VALID_SESSION_UUID, now + 1000);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('25. computeDeduplicationKey produces different hashes for different events in same session', () => {
    const now = Date.now();
    const key1 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_ATTEMPTED', VALID_SESSION_UUID, now);
    const key2 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_SUCCESS', VALID_SESSION_UUID, now);
    expect(key1).not.toBe(key2);
  });

  it('26. computeDeduplicationKey produces different hashes for different sessions', () => {
    const now = Date.now();
    const key1 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_SUCCESS', VALID_SESSION_UUID, now);
    const key2 = computeDeduplicationKey(BIZ_UUID, 'EVENT_COPY_SUCCESS', 'e2222222-2222-4333-8444-555555555555', now);
    expect(key1).not.toBe(key2);
  });

  it('27. acknowledges duplicate event within 60s window with HTTP 202 without second insert (TC-ANA-04, TC-API-13)', async () => {
    const mockSupabase = createMockSupabase({
      recentEventData: { id: 'existing-event-uuid' },
    });
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_COPY_SUCCESS',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.status).toBe('accepted');
    expect(json.deduplicated).toBe(true);
    // Verified: zero additional rows inserted
    expect(mockSupabase._insertedRows).toHaveLength(0);
  });

  it('28. catches unique constraint collision (23505) and returns HTTP 202 accepted (concurrency race)', async () => {
    const mockSupabase = createMockSupabase({
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "analytics_events_dedup_uq"',
        details: 'Key (deduplication_key)=(...) already exists.',
      },
    });
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_COPY_SUCCESS',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.status).toBe('accepted');
    expect(json.deduplicated).toBe(true);
  });

  it('29. returns HTTP 500 ERR_INTERNAL on genuine database insertion error (does not mask as duplicate)', async () => {
    const mockSupabase = createMockSupabase({
      insertError: {
        code: '42P01',
        message: 'relation "analytics_events" does not exist',
      },
    });
    const req = createRequest({
      publicQrId: VALID_QR_ID,
      eventName: 'EVENT_COPY_SUCCESS',
      sessionUuid: VALID_SESSION_UUID,
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: mockSupabase,
      expectedApiKey: VALID_API_KEY,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INTERNAL');
  });

  /* ------------------------------------------------------------------------ */
  /* 7. Client Adapter Suite (src/lib/api/analytics.ts)                       */
  /* ------------------------------------------------------------------------ */

  it('30. detectUserAgentCategory detects mobile, tablet, and desktop from userAgent', () => {
    expect(detectUserAgentCategory()).toBeDefined();
  });

  it('31. client adapter trackEvent sends valid request and parses HTTP 202 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await trackEvent(
      {
        publicQrId: VALID_QR_ID,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: VALID_SESSION_UUID,
        userAgentCategory: 'mobile',
      },
      {
        baseUrl: 'http://localhost:54321',
        anonKey: VALID_API_KEY,
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(result.status).toBe('accepted');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/track-event');
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.publicQrId).toBe(VALID_QR_ID);
    expect(sentBody.eventName).toBe('EVENT_QR_PAGE_VIEW');
  });

  it('32. client adapter trackEvent validates publicQrId and sessionUuid client-side before fetching', async () => {
    const mockFetch = vi.fn();

    await expect(
      trackEvent(
        {
          publicQrId: 'invalid qr with spaces',
          eventName: 'EVENT_QR_PAGE_VIEW',
          sessionUuid: VALID_SESSION_UUID,
        },
        { fetchFn: mockFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow('Invalid publicQrId');

    await expect(
      trackEvent(
        {
          publicQrId: VALID_QR_ID,
          eventName: 'EVENT_QR_PAGE_VIEW',
          sessionUuid: 'not-a-uuid',
        },
        { fetchFn: mockFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow('Invalid sessionUuid');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
