import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleGetPublicBusiness, type PublicBusinessRow } from './index';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_RATE_LIMIT_SALT =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('M3-T01: Live PostgreSQL Integration Suite', () => {
  let supabase: SupabaseClient;
  const testKeyHashes: string[] = [];

  beforeAll(() => {
    process.env['SUPABASE_URL'] = LOCAL_SUPABASE_URL;
    process.env['RATE_LIMIT_SALT'] = TEST_RATE_LIMIT_SALT;
    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    // Clean up transient rate limit test events
    if (testKeyHashes.length > 0) {
      await supabase
        .from('rate_limit_events')
        .delete()
        .in('key_hash', testKeyHashes);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Database Projection RPC: public.get_public_business_by_qr (RPC-INT-01) */
  /* ------------------------------------------------------------------------ */

  it('INT-01: resolves active salon Luxe Studio Unisex Salon with all public metadata', async () => {
    const { data, error } = await supabase.rpc('get_public_business_by_qr', {
      p_qr_id: 'luxe000001',
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const biz = (data as PublicBusinessRow[])[0];
    expect(biz.public_qr_id).toBe('luxe000001');
    expect(biz.name).toBe('Luxe Studio Unisex Salon');
    expect(biz.category_id).toBe('salon');
    expect(biz.is_active).toBe(true);
    expect(biz.account_status).toBe('active');
    expect(biz.subscription_status).toBe('active');
    expect(biz.is_direct_google_only).toBe(false);
    expect(biz.is_suspended).toBe(false);
    expect(biz.google_review_url).toContain('google.com');
    expect(biz.whatsapp_number).toBeTruthy();
  });

  it('INT-02: resolves lapsed subscription in direct-Google-only mode', async () => {
    const { data, error } = await supabase.rpc('get_public_business_by_qr', {
      p_qr_id: 'lapse00001',
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const biz = (data as PublicBusinessRow[])[0];
    expect(biz.public_qr_id).toBe('lapse00001');
    expect(biz.name).toBe('Vintage Brews Cafe');
    expect(biz.subscription_status).toBe('past_due');
    expect(biz.is_direct_google_only).toBe(true);
    expect(biz.is_suspended).toBe(false);
    // Outbound review link is preserved for direct Google handoff (SCR-CUST-14)
    expect(biz.google_review_url).toContain('google.com');
  });

  it('INT-03: resolves suspended business and verifies outbound URLs are suppressed (DEC-M3-05)', async () => {
    const { data, error } = await supabase.rpc('get_public_business_by_qr', {
      p_qr_id: 'susp000001',
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const biz = (data as PublicBusinessRow[])[0];
    expect(biz.public_qr_id).toBe('susp000001');
    expect(biz.is_suspended).toBe(true);
    expect(biz.account_status).toBe('suspended');
    expect(biz.is_active).toBe(false);
    // Outbound URLs strictly nullified at the SQL projection boundary
    expect(biz.google_review_url).toBeNull();
    expect(biz.whatsapp_number).toBeNull();
  });

  it('INT-04: returns 0 rows for unknown or invalid format QR identifiers', async () => {
    // Unknown 10-char token
    const { data: unknownData } = await supabase.rpc(
      'get_public_business_by_qr',
      {
        p_qr_id: 'unknown001',
      },
    );
    expect(unknownData).toHaveLength(0);

    // Invalid format (contains hyphen / vanity slug)
    const { data: invalidData } = await supabase.rpc(
      'get_public_business_by_qr',
      {
        p_qr_id: 'luxe-studio',
      },
    );
    expect(invalidData).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Exact Rolling-Window Rate Limiting (DEC-M3-01 / RPC: check_exact_rate_limit) */
  /* ------------------------------------------------------------------------ */

  it('INT-05: admits exactly 60 requests and strictly rejects request 61', async () => {
    const testHash = `test_hash_thresh_${crypto.randomUUID()}`;
    testKeyHashes.push(testHash);

    // Fire 60 sequential admission calls
    for (let i = 1; i <= 60; i++) {
      const { data: allowed, error } = await supabase.rpc(
        'check_exact_rate_limit',
        {
          p_key_hash: testHash,
          p_prev_key_hash: null,
          p_max_requests: 60,
          p_window_seconds: 600,
        },
      );
      expect(error).toBeNull();
      expect(allowed).toBe(true);
    }

    // 61st call must be rejected
    const { data: allowed61, error: err61 } = await supabase.rpc(
      'check_exact_rate_limit',
      {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      },
    );
    expect(err61).toBeNull();
    expect(allowed61).toBe(false);

    // Verify exactly 60 events exist in database
    const { count } = await supabase
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('key_hash', testHash);
    expect(count).toBe(60);
  });

  it('INT-06: eliminates race conditions under high concurrency at threshold boundary', async () => {
    const testHash = `test_hash_race_${crypto.randomUUID()}`;
    testKeyHashes.push(testHash);

    // 1. Pre-fill 59 admissions
    for (let i = 1; i <= 59; i++) {
      const { data: allowed } = await supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      });
      expect(allowed).toBe(true);
    }

    // 2. Fire 5 simultaneous requests with Promise.all
    const concurrentResults = await Promise.all([
      supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      }),
      supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      }),
      supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      }),
      supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      }),
      supabase.rpc('check_exact_rate_limit', {
        p_key_hash: testHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      }),
    ]);

    const successes = concurrentResults.filter((r) => r.data === true);
    const rejections = concurrentResults.filter((r) => r.data === false);

    // Exactly 1 request may succeed to hit the 60 cap; the other 4 must be rejected
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(4);

    // Verify row count in database is strictly 60 (zero double admissions)
    const { count } = await supabase
      .from('rate_limit_events')
      .select('*', { count: 'exact', head: true })
      .eq('key_hash', testHash);
    expect(count).toBe(60);
  });

  it('INT-07: verifies UTC midnight continuity with dual-key overlap (Work Package F)', async () => {
    const yesterdayHash = `yesterday_${crypto.randomUUID()}`;
    const todayHash = `today_${crypto.randomUUID()}`;
    testKeyHashes.push(yesterdayHash, todayHash);

    // 1. Populate 60 events under yesterday's hash
    for (let i = 1; i <= 60; i++) {
      await supabase.rpc('check_exact_rate_limit', {
        p_key_hash: yesterdayHash,
        p_prev_key_hash: null,
        p_max_requests: 60,
        p_window_seconds: 600,
      });
    }

    // 2. Call check_exact_rate_limit with today's hash and yesterday's hash in overlap window
    const { data: allowedInOverlap } = await supabase.rpc(
      'check_exact_rate_limit',
      {
        p_key_hash: todayHash,
        p_prev_key_hash: yesterdayHash,
        p_max_requests: 60,
        p_window_seconds: 600,
      },
    );

    // Must be rejected because 60 requests were made within the 600-second window yesterday
    expect(allowedInOverlap).toBe(false);
  });

  it('INT-08: prunes expired events older than retention period (Work Package G)', async () => {
    const expiredHash = `expired_test_${crypto.randomUUID()}`;
    testKeyHashes.push(expiredHash);

    // Insert an expired event manually with created_at = 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    await supabase.from('rate_limit_events').insert({
      key_hash: expiredHash,
      created_at: twoHoursAgo,
    });

    // Call cleanup stored procedure with 3600s retention
    const { data: deletedCount, error: purgeErr } = await supabase.rpc(
      'purge_expired_rate_limit_events',
      {
        p_retention_seconds: 3600,
        p_batch_limit: 5000,
      },
    );

    expect(purgeErr).toBeNull();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Confirm expired event is gone
    const { data: checkData } = await supabase
      .from('rate_limit_events')
      .select('id')
      .eq('key_hash', expiredHash);
    expect(checkData).toHaveLength(0);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Live Edge Function Request Handler Pipeline                            */
  /* ------------------------------------------------------------------------ */

  it('INT-09: executes full handleGetPublicBusiness pipeline against live database', async () => {
    const req = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-public-business?qrId=luxe000001`,
      {
        method: 'GET',
        headers: {
          apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
          'x-real-ip': '203.0.113.88',
        },
      },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: supabase,
      rateLimitSalt: TEST_RATE_LIMIT_SALT,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicQrId).toBe('luxe000001');
    expect(body.name).toBe('Luxe Studio Unisex Salon');
    expect(body.isActive).toBe(true);
    expect(body.isDirectGoogleOnly).toBe(false);
  });

  it('INT-10: verifies anonymous PostgREST direct RPC access is denied', async () => {
    const anonClient = createClient(
      LOCAL_SUPABASE_URL,
      'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      { auth: { persistSession: false } },
    );

    const { error: rpcErr } = await anonClient.rpc('get_public_business_by_qr', {
      p_qr_id: 'luxe000001',
    });

    // PostgreSQL error 42501 permission denied
    expect(rpcErr).not.toBeNull();
    expect(rpcErr?.message).toContain('permission denied');
  });

  it('INT-11: verifies subscription matrix and default pilot status', async () => {
    // 1. Create a transient business with NO subscription record
    const tempQrId = `t${Date.now().toString().slice(-9)}`;
    const { data: insertedBiz, error: insErr } = await supabase
      .from('businesses')
      .insert({
        owner_id: '00000000-0000-4000-8000-000000000002',
        name: 'Transient Trial Salon',
        category_id: 'salon',
        public_qr_id: tempQrId,
        vanity_slug: tempQrId,
        account_status: 'pilot',
        is_active: true,
      })
      .select('id, public_qr_id')
      .single();

    expect(insErr).toBeNull();
    expect(insertedBiz).toBeTruthy();

    try {
      // 2. Query projection - missing subscription record must resolve to 'pilot'
      const { data: projData, error: projErr } = await supabase.rpc(
        'get_public_business_by_qr',
        { p_qr_id: tempQrId },
      );

      expect(projErr).toBeNull();
      expect(projData).toHaveLength(1);
      const biz = (projData as PublicBusinessRow[])[0];
      expect(biz.subscription_status).toBe('pilot');
      expect(biz.is_direct_google_only).toBe(false);
      expect(biz.is_suspended).toBe(false);
    } finally {
      // Clean up transient business
      if (insertedBiz?.id) {
        await supabase.from('businesses').delete().eq('id', insertedBiz.id);
      }
    }
  });

  it('INT-12: verifies IP spoofing resistance against client-injected cf-connecting-ip', async () => {
    const spoofedReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-public-business?qrId=luxe000001`,
      {
        method: 'GET',
        headers: {
          apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
          'x-real-ip': '198.51.100.77',
          'cf-connecting-ip': 'spoofed.attacker.ip.attempt',
        },
      },
    );

    // Handler must prioritize un-spoofable x-real-ip and succeed
    const res = await handleGetPublicBusiness(spoofedReq, {
      supabaseClient: supabase,
      rateLimitSalt: TEST_RATE_LIMIT_SALT,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publicQrId).toBe('luxe000001');
  });
});
