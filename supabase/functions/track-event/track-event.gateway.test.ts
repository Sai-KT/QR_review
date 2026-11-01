/**
 * Live Kong Gateway Test Suite: track-event (API-PUB-05)
 *
 * Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
 * Specifications:
 *   - docs/API_SPEC.md (v1.2) §7.5, §18 (TC-API-13)
 *   - docs/TEST_PLAN.md (v1.1) TC-ANA-01..06, TC-API-13
 *
 * Tests the real HTTP endpoint running through the local Kong gateway:
 *   http://127.0.0.1:54321/functions/v1/track-event
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const GATEWAY_URL = 'http://127.0.0.1:54321/functions/v1/track-event';
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TEST_SESSION_PREFIX = 'dddddddd-0000-4000-8000';

function makeGatewaySessionUuid(suffix: string): string {
  const padded = suffix.padStart(12, '0');
  return `${TEST_SESSION_PREFIX}-${padded}`;
}

describe('M3-T04: Live Kong Gateway HTTP Suite (API-PUB-05)', () => {
  let adminSupabase: SupabaseClient;

  beforeAll(async () => {
    adminSupabase = createClient('http://127.0.0.1:54321', SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Prune any previous gateway test records
    await adminSupabase
      .from('analytics_events')
      .delete()
      .gte('session_uuid', `${TEST_SESSION_PREFIX}-000000000000`)
      .lte('session_uuid', `${TEST_SESSION_PREFIX}-ffffffffffff`);
  });

  afterAll(async () => {
    // Prune all gateway test records
    await adminSupabase
      .from('analytics_events')
      .delete()
      .gte('session_uuid', `${TEST_SESSION_PREFIX}-000000000000`)
      .lte('session_uuid', `${TEST_SESSION_PREFIX}-ffffffffffff`);
  });

  /* ------------------------------------------------------------------------ */
  /* 1. OPTIONS CORS Preflight                                                */
  /* ------------------------------------------------------------------------ */

  it('GW-01: OPTIONS preflight returns HTTP 200/204 with CORS headers', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Initial Valid Ingestion & Deduplication                               */
  /* ------------------------------------------------------------------------ */

  it('GW-02 & GW-03: initial valid EVENT_QR_PAGE_VIEW succeeds (202), duplicate is acknowledged without second row', async () => {
    const sessionUuid = makeGatewaySessionUuid('2001');

    // 1. Initial emission
    const res1 = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    expect(res1.status).toBe(202);
    const body1 = await res1.json();
    expect(body1.status).toBe('accepted');

    // Verify 1 row stored in PostgreSQL
    const { count: count1 } = await adminSupabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);
    expect(count1).toBe(1);

    // 2. Duplicate emission within window
    const res2 = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    expect(res2.status).toBe(202);
    const body2 = await res2.json();
    expect(body2.status).toBe('accepted');
    expect(body2.deduplicated).toBe(true);

    // Verify still exactly 1 row stored in PostgreSQL
    const { count: count2 } = await adminSupabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);
    expect(count2).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Copy Success Ingestion & Deduplication                                */
  /* ------------------------------------------------------------------------ */

  it('GW-04 & GW-05: EVENT_COPY_SUCCESS succeeds (202) and duplicate within 60s is deduplicated (TC-ANA-04, TC-API-13)', async () => {
    const sessionUuid = makeGatewaySessionUuid('2002');

    // Initial copy event
    const res1 = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    expect(res1.status).toBe(202);

    // Duplicate copy event
    const res2 = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    expect(res2.status).toBe(202);
    const body2 = await res2.json();
    expect(body2.status).toBe('accepted');
    expect(body2.deduplicated).toBe(true);

    // Exactly 1 row in DB
    const { count } = await adminSupabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_COPY_SUCCESS');
    expect(count).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Direct Google Review Bypass Click (TC-ANA-06)                         */
  /* ------------------------------------------------------------------------ */

  it('GW-06: EVENT_GOOGLE_BYPASS_CLICK succeeds (202)', async () => {
    const sessionUuid = makeGatewaySessionUuid('2003');

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid,
        userAgentCategory: 'desktop',
      }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');

    const { count } = await adminSupabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);
    expect(count).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Request Validation & Business Resolution at Kong Gateway              */
  /* ------------------------------------------------------------------------ */

  it('GW-07: invalid publicQrId format returns HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'BAD QR!',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: makeGatewaySessionUuid('2004'),
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('GW-08: non-existent publicQrId returns HTTP 404 ERR_QR_NOT_FOUND', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'notexist99',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: makeGatewaySessionUuid('2005'),
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_QR_NOT_FOUND');
  });

  it('GW-09: invalid sessionUuid returns HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: 'not-a-valid-uuid',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  it('GW-10: unsupported arbitrary eventName returns HTTP 400 ERR_INVALID_PAYLOAD', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_FAKE_CLICK',
        sessionUuid: makeGatewaySessionUuid('2006'),
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Server-Owned Event Rejection at Kong Gateway                          */
  /* ------------------------------------------------------------------------ */

  it('GW-11: forbidden server-owned EVENT_SURVEY_COMPLETED returns HTTP 403 ERR_FORBIDDEN_EVENT', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_SURVEY_COMPLETED',
        sessionUuid: makeGatewaySessionUuid('2007'),
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');
  });

  it('GW-12: forbidden server-owned EVENT_GENERATION_SUCCESS returns HTTP 403 ERR_FORBIDDEN_EVENT', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_GENERATION_SUCCESS',
        sessionUuid: makeGatewaySessionUuid('2008'),
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');
  });

  /* ------------------------------------------------------------------------ */
  /* 7. Authentication & Method Handling at Kong Gateway                      */
  /* ------------------------------------------------------------------------ */

  it('GW-13: missing API key returns HTTP 401 ERR_UNAUTHORIZED', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: makeGatewaySessionUuid('2009'),
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('GW-14: forged API key returns HTTP 401 ERR_UNAUTHORIZED', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: 'forged_publishable_key_12345',
      },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: makeGatewaySessionUuid('2010'),
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('GW-15: unsupported HTTP method GET returns HTTP 405 ERR_METHOD_NOT_ALLOWED', async () => {
    const res = await fetch(GATEWAY_URL, {
      method: 'GET',
      headers: {
        apikey: PUBLISHABLE_KEY,
      },
    });

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
  });
});
