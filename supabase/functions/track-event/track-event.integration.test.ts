/**
 * PostgreSQL Integration Test Suite: track-event Edge Function (API-PUB-05)
 *
 * Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
 * Specifications:
 *   - docs/API_SPEC.md (v1.2) §7.5, §18 (TC-API-13)
 *   - docs/TEST_PLAN.md (v1.1) TC-ANA-01..06, TC-API-13
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.6 (analytics_events)
 *   - docs/SECURITY.md (v1.1) §7, §16
 *
 * Runs against the live local development database at 127.0.0.1:54322 / Kong 54321.
 * Uses isolated test session UUIDs and cleans up test rows in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleTrackEvent } from './index.ts';

const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const LOCAL_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Seeded businesses from reference data (supabase/migrations/20261030030000_reference_data.sql)
const SALON_QR_ID = 'luxe000001';
const SALON_BIZ_ID = 'b0000000-0000-4000-8000-000000000001';
const CAFE_QR_ID = 'daily00001';
const CAFE_BIZ_ID = 'b0000000-0000-4000-8000-000000000002';

// Unique session prefix for test isolation and clean pruning
const TEST_SESSION_PREFIX = 'ffffffff-0000-4000-8000';

function makeTestSessionUuid(suffix: string): string {
  const padded = suffix.padStart(12, '0');
  return `${TEST_SESSION_PREFIX}-${padded}`;
}

describe('M3-T04: Live PostgreSQL Integration Suite (track-event)', () => {
  let adminSupabase: SupabaseClient;
  let anonSupabase: SupabaseClient;

  beforeAll(async () => {
    adminSupabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    anonSupabase = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });

    // Clean up any lingering test session rows from previous runs
    await adminSupabase
      .from('analytics_events')
      .delete()
      .gte('session_uuid', `${TEST_SESSION_PREFIX}-000000000000`)
      .lte('session_uuid', `${TEST_SESSION_PREFIX}-ffffffffffff`);
  });

  afterAll(async () => {
    // Clean up all test rows created by this suite
    await adminSupabase
      .from('analytics_events')
      .delete()
      .gte('session_uuid', `${TEST_SESSION_PREFIX}-000000000000`)
      .lte('session_uuid', `${TEST_SESSION_PREFIX}-ffffffffffff`);
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Basic Ingestion & Database Row Persistence                            */
  /* ------------------------------------------------------------------------ */

  it('INT-01: ingests valid EVENT_QR_PAGE_VIEW and persists expected columns to PostgreSQL', async () => {
    const sessionUuid = makeTestSessionUuid('1001');

    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');

    // Query PostgreSQL to verify row was persisted correctly
    const { data: rows, error: qErr } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid);

    expect(qErr).toBeNull();
    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    expect(row.business_id).toBe(SALON_BIZ_ID);
    expect(row.event_name).toBe('EVENT_QR_PAGE_VIEW');
    expect(row.session_uuid).toBe(sessionUuid);
    expect(row.user_agent_category).toBe('mobile');
    expect(row.deduplication_key).toBeDefined();
    expect(row.deduplication_key).toMatch(/^[a-f0-9]{64}$/);
    expect(row.created_at).toBeDefined();
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Server-Side Deduplication & Idempotency (TC-ANA-04, TC-API-13)        */
  /* ------------------------------------------------------------------------ */

  it('INT-02: deduplicates identical event within 60s window (TC-ANA-04, TC-API-13)', async () => {
    const sessionUuid = makeTestSessionUuid('1002');

    // First emission
    const req1 = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    const res1 = await handleTrackEvent(req1, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(res1.status).toBe(202);

    // Second emission 100ms later (rapid double-tap)
    const req2 = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    const res2 = await handleTrackEvent(req2, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    // Must return HTTP 202 Accepted
    expect(res2.status).toBe(202);
    const body2 = await res2.json();
    expect(body2.status).toBe('accepted');
    expect(body2.deduplicated).toBe(true);

    // Query PostgreSQL: exactly 1 row must be stored for this event
    const { data: rows, error: qErr } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_COPY_SUCCESS');

    expect(qErr).toBeNull();
    expect(rows).toHaveLength(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Concurrency Safety: 10 Simultaneous Requests                          */
  /* ------------------------------------------------------------------------ */

  it('INT-03: handles 10 simultaneous identical requests with exactly 1 row persisted', async () => {
    const sessionUuid = makeTestSessionUuid('1003');

    const makeRequest = () =>
      new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          publicQrId: SALON_QR_ID,
          eventName: 'EVENT_GENERATION_REQUESTED',
          sessionUuid,
          userAgentCategory: 'mobile',
        }),
      });

    // Fire 10 simultaneous requests in parallel
    const promises = Array.from({ length: 10 }, () =>
      handleTrackEvent(makeRequest(), {
        supabaseClient: adminSupabase,
        expectedApiKey: LOCAL_PUBLISHABLE_KEY,
        skipRateLimit: true,
      }),
    );

    const responses = await Promise.all(promises);

    // All 10 requests must receive HTTP 202 Accepted
    for (const res of responses) {
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.status).toBe('accepted');
    }

    // Exactly 1 row must exist in PostgreSQL
    const { data: rows, error: qErr } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_GENERATION_REQUESTED');

    expect(qErr).toBeNull();
    expect(rows).toHaveLength(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Event Isolation: Different Events in Same Session                     */
  /* ------------------------------------------------------------------------ */

  it('INT-04: allows different event types in the same session without false deduplication', async () => {
    const sessionUuid = makeTestSessionUuid('1004');

    // Event 1: COPY_ATTEMPTED
    const req1 = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_ATTEMPTED',
        sessionUuid,
      }),
    });
    const res1 = await handleTrackEvent(req1, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(res1.status).toBe(202);

    // Event 2: COPY_SUCCESS
    const req2 = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
      }),
    });
    const res2 = await handleTrackEvent(req2, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(res2.status).toBe(202);

    // Event 3: GOOGLE_REDIRECT_CLICK
    const req3 = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_GOOGLE_REDIRECT_CLICK',
        sessionUuid,
      }),
    });
    const res3 = await handleTrackEvent(req3, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(res3.status).toBe(202);

    // All 3 distinct events must be stored in PostgreSQL
    const { data: rows, error: qErr } = await adminSupabase
      .from('analytics_events')
      .select('event_name')
      .eq('session_uuid', sessionUuid);

    expect(qErr).toBeNull();
    expect(rows).toHaveLength(3);
    const eventNames = rows!.map((r) => r.event_name).sort();
    expect(eventNames).toEqual([
      'EVENT_COPY_ATTEMPTED',
      'EVENT_COPY_SUCCESS',
      'EVENT_GOOGLE_REDIRECT_CLICK',
    ]);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Cross-Tenant Isolation: Different Businesses Remain Independent       */
  /* ------------------------------------------------------------------------ */

  it('INT-05: keeps identical events for different businesses completely isolated', async () => {
    const sessionUuid = makeTestSessionUuid('1005');

    // Event for Salon
    const reqSalon = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid,
      }),
    });
    const resSalon = await handleTrackEvent(reqSalon, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(resSalon.status).toBe(202);

    // Event for Cafe (same sessionUuid, same eventName)
    const reqCafe = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: CAFE_QR_ID,
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid,
      }),
    });
    const resCafe = await handleTrackEvent(reqCafe, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(resCafe.status).toBe(202);

    // Query PostgreSQL: 2 separate rows with distinct business_ids
    const { data: rows, error: qErr } = await adminSupabase
      .from('analytics_events')
      .select('business_id, event_name')
      .eq('session_uuid', sessionUuid);

    expect(qErr).toBeNull();
    expect(rows).toHaveLength(2);
    const bizIds = rows!.map((r) => r.business_id);
    expect(bizIds).toContain(SALON_BIZ_ID);
    expect(bizIds).toContain(CAFE_BIZ_ID);
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Server-Owned Event Rejection at Live Boundary (TC-ANA-02, TC-ANA-03)  */
  /* ------------------------------------------------------------------------ */

  it('INT-06: rejects EVENT_SURVEY_COMPLETED and writes zero rows to PostgreSQL (TC-ANA-02)', async () => {
    const sessionUuid = makeTestSessionUuid('1006');

    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_SURVEY_COMPLETED',
        sessionUuid,
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');

    // Confirm zero rows persisted
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid);

    expect(rows).toHaveLength(0);
  });

  it('INT-07: rejects EVENT_GENERATION_SUCCESS and writes zero rows to PostgreSQL (TC-ANA-03)', async () => {
    const sessionUuid = makeTestSessionUuid('1007');

    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_GENERATION_SUCCESS',
        sessionUuid,
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FORBIDDEN_EVENT');

    // Confirm zero rows persisted
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid);

    expect(rows).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 7. Security: Direct PostgREST Anonymous Access Denied                    */
  /* ------------------------------------------------------------------------ */

  it('INT-08: verifies anonymous direct PostgREST INSERT on analytics_events is denied by RLS', async () => {
    const sessionUuid = makeTestSessionUuid('1008');

    // Attempt direct insert using anonSupabase
    const { error: insertError } = await anonSupabase
      .from('analytics_events')
      .insert({
        business_id: SALON_BIZ_ID,
        event_name: 'EVENT_QR_PAGE_VIEW',
        session_uuid: sessionUuid,
        user_agent_category: 'mobile',
        deduplication_key: 'malicious_direct_insert_attempt',
      });

    // Must fail due to REVOKE INSERT on analytics_events from anon
    expect(insertError).not.toBeNull();

    // Confirm no row was written
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid);

    expect(rows).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 8. Immutability: UPDATE on analytics_events Blocked by Trigger           */
  /* ------------------------------------------------------------------------ */

  it('INT-09: verifies trig_analytics_events_immutable blocks UPDATE on analytics_events', async () => {
    const sessionUuid = makeTestSessionUuid('1009');

    // First insert a legitimate row via adminSupabase
    const { data: insertData, error: insErr } = await adminSupabase
      .from('analytics_events')
      .insert({
        business_id: SALON_BIZ_ID,
        event_name: 'EVENT_QR_PAGE_VIEW',
        session_uuid: sessionUuid,
        user_agent_category: 'mobile',
        deduplication_key: `dedup_${sessionUuid}`,
      })
      .select('id')
      .single();

    expect(insErr).toBeNull();
    expect(insertData).toBeDefined();

    // Attempt to mutate the row
    const { error: updateError } = await adminSupabase
      .from('analytics_events')
      .update({ user_agent_category: 'desktop' })
      .eq('id', insertData!.id);

    // Trigger must raise exception
    expect(updateError).not.toBeNull();
    expect(updateError?.message).toContain('ERR_ANALYTICS_EVENT_IMMUTABLE');
  });

  /* ------------------------------------------------------------------------ */
  /* 9. Direct Google Review Bypass Tracking (TC-ANA-06)                      */
  /* ------------------------------------------------------------------------ */

  it('INT-10: ingests EVENT_GOOGLE_BYPASS_CLICK (SCR-CUST-01 anti-gating bypass link)', async () => {
    const sessionUuid = makeTestSessionUuid('1010');

    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid,
        userAgentCategory: 'mobile',
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    expect(res.status).toBe(202);

    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid);

    expect(rows).toHaveLength(1);
    expect(rows![0]!.event_name).toBe('EVENT_GOOGLE_BYPASS_CLICK');
  });

  /* ------------------------------------------------------------------------ */
  /* 10. Window Expiration: Identical Event After 60s Window Inserts Fresh Row*/
  /* ------------------------------------------------------------------------ */

  it('INT-11: verifies window expiration: identical event after 60s window inserts a second row', async () => {
    const sessionUuid = makeTestSessionUuid('1011');
    const pastTimestamp = new Date(Date.now() - 70000); // 70 seconds ago

    // Insert historical event directly with past timestamp and past deduplication key
    const pastMinuteIso = new Date(Math.floor(pastTimestamp.getTime() / 60000) * 60000).toISOString();
    const pastDedupKey = `dedup_${sessionUuid}_past`;

    const { error: insErr } = await adminSupabase.from('analytics_events').insert({
      business_id: SALON_BIZ_ID,
      event_name: 'EVENT_COPY_SUCCESS',
      session_uuid: sessionUuid,
      user_agent_category: 'mobile',
      deduplication_key: pastDedupKey,
      created_at: pastMinuteIso,
    });
    expect(insErr).toBeNull();

    // Now emit identical event now (70s later)
    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');
    expect(body.deduplicated).toBeUndefined();

    // Exactly 2 rows must exist in PostgreSQL (the historical one + new one)
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_COPY_SUCCESS');

    expect(rows).toHaveLength(2);
  });

  /* ------------------------------------------------------------------------ */
  /* 11. Existing Server-Owned Event Rows Remain Intact                       */
  /* ------------------------------------------------------------------------ */

  it('INT-12: verifies existing server-owned event rows in analytics_events remain intact', async () => {
    const sessionUuid = makeTestSessionUuid('1012');

    // Insert server-owned EVENT_SURVEY_COMPLETED row (emulating submit-feedback)
    const { error: insErr } = await adminSupabase.from('analytics_events').insert({
      business_id: SALON_BIZ_ID,
      event_name: 'EVENT_SURVEY_COMPLETED',
      session_uuid: sessionUuid,
      user_agent_category: 'mobile',
      deduplication_key: `dedup_${sessionUuid}_server`,
    });
    expect(insErr).toBeNull();

    // Emit a client event for the same session (e.g. EVENT_COPY_SUCCESS)
    const req = new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: LOCAL_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        publicQrId: SALON_QR_ID,
        eventName: 'EVENT_COPY_SUCCESS',
        sessionUuid,
      }),
    });

    const res = await handleTrackEvent(req, {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      skipRateLimit: true,
    });
    expect(res.status).toBe(202);

    // Verify both server-owned event and client event exist unharmed
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('event_name')
      .eq('session_uuid', sessionUuid);

    expect(rows).toHaveLength(2);
    const names = rows!.map((r) => r.event_name);
    expect(names).toContain('EVENT_SURVEY_COMPLETED');
    expect(names).toContain('EVENT_COPY_SUCCESS');
  });

  /* ------------------------------------------------------------------------ */
  /* 12. Cross-Minute Rolling Concurrency & Advisory Lock Serialization       */
  /* ------------------------------------------------------------------------ */

  it('INT-13: cross-minute concurrency: transaction advisory lock prevents race conditions and persists exactly 1 row', async () => {
    const sessionUuid = makeTestSessionUuid('1013');

    // Fire two concurrent calls to ingest_analytics_event_atomic simultaneously
    const [res1, res2] = await Promise.all([
      adminSupabase.rpc('ingest_analytics_event_atomic', {
        p_public_qr_id: SALON_QR_ID,
        p_event_name: 'EVENT_QR_PAGE_VIEW',
        p_session_uuid: sessionUuid,
        p_user_agent_category: 'mobile',
        p_window_seconds: 60,
      }),
      adminSupabase.rpc('ingest_analytics_event_atomic', {
        p_public_qr_id: SALON_QR_ID,
        p_event_name: 'EVENT_QR_PAGE_VIEW',
        p_session_uuid: sessionUuid,
        p_user_agent_category: 'mobile',
        p_window_seconds: 60,
      }),
    ]);

    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    const status1 = res1.data?.[0]?.status;
    const status2 = res2.data?.[0]?.status;

    // One must have inserted, and the other must have deduplicated under lock
    const statuses = [status1, status2].sort();
    expect(statuses).toEqual(['deduplicated', 'inserted']);

    // Exactly 1 row persisted in database
    const { data: rows } = await adminSupabase
      .from('analytics_events')
      .select('*')
      .eq('session_uuid', sessionUuid)
      .eq('event_name', 'EVENT_QR_PAGE_VIEW');

    expect(rows).toHaveLength(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 13. RPC Least Privilege & Access Control Defense                         */
  /* ------------------------------------------------------------------------ */

  it('INT-14: direct execution of ingest_analytics_event_atomic by anon role is rejected with permission denied (42501)', async () => {
    const sessionUuid = makeTestSessionUuid('1014');

    const { data, error } = await anonSupabase.rpc('ingest_analytics_event_atomic', {
      p_public_qr_id: SALON_QR_ID,
      p_event_name: 'EVENT_QR_PAGE_VIEW',
      p_session_uuid: sessionUuid,
      p_user_agent_category: 'mobile',
      p_window_seconds: 60,
    });

    expect(data).toBeNull();
    expect(error).toBeDefined();
    // PostgreSQL error 42501: insufficient_privilege / permission denied
    expect(error!.code).toBe('42501');
  });

  /* ------------------------------------------------------------------------ */
  /* 14. Server-Owned Event Rejection at Database RPC Level                   */
  /* ------------------------------------------------------------------------ */

  it('INT-15: ingest_analytics_event_atomic RPC strictly rejects server-owned events at database level', async () => {
    const sessionUuid = makeTestSessionUuid('1015');

    // 1. Attempt EVENT_SURVEY_COMPLETED via RPC
    const { data: dataSurvey, error: errSurvey } = await adminSupabase.rpc(
      'ingest_analytics_event_atomic',
      {
        p_public_qr_id: SALON_QR_ID,
        p_event_name: 'EVENT_SURVEY_COMPLETED',
        p_session_uuid: sessionUuid,
        p_user_agent_category: 'mobile',
        p_window_seconds: 60,
      },
    );

    expect(errSurvey).toBeNull();
    expect(dataSurvey?.[0]?.status).toBe('forbidden_event');

    // 2. Attempt EVENT_GENERATION_SUCCESS via RPC
    const { data: dataGen, error: errGen } = await adminSupabase.rpc(
      'ingest_analytics_event_atomic',
      {
        p_public_qr_id: SALON_QR_ID,
        p_event_name: 'EVENT_GENERATION_SUCCESS',
        p_session_uuid: sessionUuid,
        p_user_agent_category: 'mobile',
        p_window_seconds: 60,
      },
    );

    expect(errGen).toBeNull();
    expect(dataGen?.[0]?.status).toBe('forbidden_event');

    // Zero rows written to table
    const { count } = await adminSupabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);

    expect(count).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 15. Ingress Abuse Rate Limiting Defense                                  */
  /* ------------------------------------------------------------------------ */

  it('INT-16: rate limits excessive telemetry requests from same hashed IP (429 ERR_RATE_LIMITED)', async () => {
    const testIp = '198.51.100.99';
    const makeIpRequest = (suffix: string) =>
      new Request(`${LOCAL_SUPABASE_URL}/functions/v1/track-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: LOCAL_PUBLISHABLE_KEY,
          'x-real-ip': testIp,
        },
        body: JSON.stringify({
          publicQrId: SALON_QR_ID,
          eventName: 'EVENT_QR_PAGE_VIEW',
          sessionUuid: makeTestSessionUuid(suffix),
          userAgentCategory: 'mobile',
        }),
      });

    // Prune any existing rate limit records for this test IP hash
    const today = new Date().toISOString().slice(0, 10);
    const salt = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const { createHmac } = await import('node:crypto');
    const todaySalt = createHmac('sha256', Buffer.from(salt, 'hex'))
      .update(`qr_rate_limit_salt:${today}`)
      .digest('hex');
    const testIpHash = createHmac('sha256', Buffer.from(todaySalt, 'hex'))
      .update(`qr_ip:${testIp}`)
      .digest('hex');

    await adminSupabase.from('rate_limit_events').delete().eq('key_hash', testIpHash);

    // Consume the 60-request allowance by populating 60 entries
    const rateLimitRows = Array.from({ length: 60 }, () => ({
      key_hash: testIpHash,
      created_at: new Date().toISOString(),
    }));
    await adminSupabase.from('rate_limit_events').insert(rateLimitRows);

    // 61st request from same IP must be rejected with 429 ERR_RATE_LIMITED
    const resOverLimit = await handleTrackEvent(makeIpRequest('1016'), {
      supabaseClient: adminSupabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });

    expect(resOverLimit.status).toBe(429);
    const body = await resOverLimit.json();
    expect(body.error.code).toBe('ERR_RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
    expect(resOverLimit.headers.get('Retry-After')).toBe('60');

    // Clean up rate limit events
    await adminSupabase.from('rate_limit_events').delete().eq('key_hash', testIpHash);
  });
});
