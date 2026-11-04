import { describe, it, expect, vi } from 'vitest';
import { handler, CANONICAL_ATTRIBUTION_DISCLAIMER } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

function createMockSupabase(options: {
  user?: { id: string } | null;
  authError?: Error | null;
  businessOwnerId?: string | null;
  bizError?: Error | null;
  events?: Array<{ event_name: string; created_at?: string }>;
  eventsError?: Error | null;
  quota?: {
    billing_cycle: string;
    max_limit: number;
    used_count: number;
    reserved_count: number;
    reset_at: string;
  } | null;
  quotaError?: Error | null;
}): SupabaseClient {
  const {
    user = { id: MOCK_USER_ID },
    authError = null,
    businessOwnerId = MOCK_USER_ID,
    bizError = null,
    events = [],
    eventsError = null,
    quota = {
      billing_cycle: '2026-10',
      max_limit: 150,
      used_count: 50,
      reserved_count: 2,
      reset_at: '2026-11-01T00:00:00Z',
    },
    quotaError = null,
  } = options;

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'businesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  businessOwnerId !== null
                    ? { id: MOCK_BUSINESS_ID, owner_id: businessOwnerId }
                    : null,
                error: bizError,
              }),
            }),
          }),
        };
      }

      if (table === 'analytics_events') {
        const queryBuilder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({
            data: events,
            error: eventsError,
          }),
        };
        // In case gte is not called (period = 'all')
        (queryBuilder as unknown as { then: (fn: (res: unknown) => void) => void }).then = (
          resolve: (res: unknown) => void,
        ) => resolve({ data: events, error: eventsError });
        return queryBuilder;
      }

      if (table === 'tenant_quotas') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: quota,
                    error: quotaError,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      return {};
    }),
  } as unknown as SupabaseClient;

  return mockClient;
}

function makeRequest(
  method: string,
  params: { businessId?: string | null; period?: string | null } = {},
  token: string | null = 'valid-jwt-token',
): Request {
  const query = new URLSearchParams();
  const businessId = 'businessId' in params ? params.businessId : MOCK_BUSINESS_ID;
  const period = 'period' in params ? params.period : '30d';

  if (businessId !== null && businessId !== undefined) {
    query.set('businessId', businessId);
  }
  if (period !== null && period !== undefined) {
    query.set('period', period);
  }

  const url = `http://localhost:54321/functions/v1/get-owner-dashboard?${query.toString()}`;
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return new Request(url, { method, headers });
}

describe('Edge Function: get-owner-dashboard (API-OWN-04)', () => {
  it('handles CORS OPTIONS preflight request with HTTP 204', async () => {
    const req = makeRequest('OPTIONS');
    const res = await handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects non-GET HTTP methods with HTTP 405', async () => {
    const req = makeRequest('POST');
    const res = await handler(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
  });

  it('rejects missing Authorization header with HTTP 401', async () => {
    const req = makeRequest('GET', {}, null);
    const res = await handler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects invalid or expired session JWT with HTTP 401', async () => {
    const client = createMockSupabase({
      authError: new Error('Token expired or signature invalid'),
      user: null,
    });
    const req = makeRequest('GET');
    const res = await handler(req, client);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects missing businessId parameter with HTTP 400', async () => {
    const client = createMockSupabase({});
    const req = makeRequest('GET', { businessId: null, period: '30d' });
    const res = await handler(req, client);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_INPUT');
  });

  it('rejects malformed businessId format (non-UUID) with HTTP 400', async () => {
    const client = createMockSupabase({});
    const req = makeRequest('GET', { businessId: 'not-a-uuid' });
    const res = await handler(req, client);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_INPUT');
  });

  it('rejects unsupported period interval with HTTP 400', async () => {
    const client = createMockSupabase({});
    const req = makeRequest('GET', { businessId: MOCK_BUSINESS_ID, period: '14d' });
    const res = await handler(req, client);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_INPUT');
  });

  it('enforces tenant isolation and returns HTTP 403 on cross-tenant access attempt', async () => {
    // Business is owned by OTHER_USER_ID, but caller is MOCK_USER_ID
    const client = createMockSupabase({
      user: { id: MOCK_USER_ID },
      businessOwnerId: OTHER_USER_ID,
    });
    const req = makeRequest('GET');
    const res = await handler(req, client);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN');
    expect(body.error.message).toContain('Access denied');
  });

  it('computes exact canonical conversion metrics matching TC-ANA-07', async () => {
    // Fixture matching TC-ANA-07: 100 scans, 70 surveys, 50 drafts, 40 copies
    // plus 30 assisted handoffs and 10 direct bypasses
    const events = [
      ...Array(100).fill({ event_name: 'EVENT_QR_PAGE_VIEW' }),
      ...Array(70).fill({ event_name: 'EVENT_SURVEY_COMPLETED' }),
      ...Array(60).fill({ event_name: 'EVENT_GENERATION_REQUESTED' }),
      ...Array(50).fill({ event_name: 'EVENT_GENERATION_SUCCESS' }),
      ...Array(40).fill({ event_name: 'EVENT_COPY_SUCCESS' }),
      ...Array(30).fill({ event_name: 'EVENT_GOOGLE_REDIRECT_CLICK' }),
      ...Array(10).fill({ event_name: 'EVENT_GOOGLE_BYPASS_CLICK' }),
    ];

    const client = createMockSupabase({ events });
    const req = makeRequest('GET', { businessId: MOCK_BUSINESS_ID, period: '30d' });
    const res = await handler(req, client);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.businessId).toBe(MOCK_BUSINESS_ID);
    expect(body.period).toBe('30d');

    // Counts
    expect(body.metrics.qrVisits).toBe(100);
    expect(body.metrics.surveysCompleted).toBe(70);
    expect(body.metrics.reviewsDrafted).toBe(50);
    expect(body.metrics.clipboardCopies).toBe(40);
    expect(body.metrics.googleHandoffClicks).toBe(30);
    expect(body.metrics.directBypassClicks).toBe(10);

    // Canonical Formulas (TC-ANA-07):
    // Completion: 70 / 100 = 70.0%
    expect(body.metrics.surveyCompletionRate).toBe(0.7);
    // Draft Success: 50 / 70 ≈ 71.43%
    expect(body.metrics.draftSuccessRate).toBe(0.7143);
    // Copy Rate: 40 / 50 = 80.0%
    expect(body.metrics.copyRate).toBe(0.8);
    // Assisted Handoff: 30 / 40 = 75.0%
    expect(body.metrics.handoffRate).toBe(0.75);
    // Direct Bypass: 10 / 100 = 10.0%
    expect(body.metrics.directBypassRate).toBe(0.1);
    // Total Handoff Rate: (30 + 10) / 100 = 40.0%
    expect(body.metrics.totalHandoffRate).toBe(0.4);

    // Mandatory Disclaimer Verification (FR-ANALYTICS-002)
    expect(body.disclaimer).toBe(CANONICAL_ATTRIBUTION_DISCLAIMER);
    expect(body.disclaimer).toContain('Google Maps does not notify third-party platforms');

    // Quota metadata
    expect(body.quota.monthlyQuotaLimit).toBe(150);
    expect(body.quota.generationsUsed).toBe(50);
    expect(body.quota.generationsRemaining).toBe(98); // 150 - 50 - 2
  });

  it('protects against division by zero when event counts are 0', async () => {
    const client = createMockSupabase({ events: [] });
    const req = makeRequest('GET', { businessId: MOCK_BUSINESS_ID, period: '7d' });
    const res = await handler(req, client);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.metrics.qrVisits).toBe(0);
    expect(body.metrics.surveysCompleted).toBe(0);
    expect(body.metrics.surveyCompletionRate).toBe(0);
    expect(body.metrics.draftSuccessRate).toBe(0);
    expect(body.metrics.copyRate).toBe(0);
    expect(body.metrics.handoffRate).toBe(0);
    expect(body.metrics.directBypassRate).toBe(0);
    expect(body.metrics.totalHandoffRate).toBe(0);
  });

  it('supports 7d, 90d, and all period filters', async () => {
    for (const period of ['7d', '90d', 'all'] as const) {
      const client = createMockSupabase({ events: [] });
      const req = makeRequest('GET', { businessId: MOCK_BUSINESS_ID, period });
      const res = await handler(req, client);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.period).toBe(period);
    }
  });
});
