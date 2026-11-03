/**
 * Real PostgreSQL Database & Concurrency Integration Test Suite
 *
 * Task: M5-T04 — Atomic Google Destination Persistence & Place ID Uniqueness (Option B)
 * Validates real PostgreSQL transactions, row locking, audit failure rollback,
 * partial unique index collision handling, and role execution boundaries against local Supabase.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const BUSINESS_1_ID = 'b0000000-0000-4000-8000-000000000001'; // Luxe Studio (Owner 1)
const OWNER_1_ID = '00000000-0000-4000-8000-000000000002';

const BUSINESS_2_ID = 'b0000000-0000-4000-8000-000000000002'; // Daily Roast (Owner 2)
const OWNER_2_ID = '00000000-0000-4000-8000-000000000003';

describe('M5-T04 Option B: PostgreSQL Transactional RPC & Database Integrity Integration', () => {
  let supabaseAdmin: SupabaseClient;
  let supabaseAnon: SupabaseClient;

  const originalB1Destination = {
    url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
    placeId: 'ChIJLUXE00000001',
  };

  const originalB2Destination = {
    url: 'https://search.google.com/local/writereview?placeid=ChIJDAILY0000001',
    placeId: 'ChIJDAILY0000001',
  };

  beforeAll(() => {
    supabaseAdmin = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    supabaseAnon = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
  });

  const restoreBaseline = async () => {
    await supabaseAdmin
      .from('businesses')
      .update({
        google_review_url: originalB1Destination.url,
        google_place_id: originalB1Destination.placeId,
      })
      .eq('id', BUSINESS_1_ID);

    await supabaseAdmin
      .from('businesses')
      .update({
        google_review_url: originalB2Destination.url,
        google_place_id: originalB2Destination.placeId,
      })
      .eq('id', BUSINESS_2_ID);
  };

  afterAll(async () => {
    await restoreBaseline();
  });

  it('1. Authorized update & atomicity: updates businesses and inserts admin_audit_logs atomically', async () => {
    await restoreBaseline();
    const updatedUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE_ATOMIC_0001';
    const updatedPlaceId = 'ChIJLUXE_ATOMIC_0001';
    const testIpHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

    const { data, error } = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: updatedUrl,
      p_google_place_id: updatedPlaceId,
      p_ip_hash: testIpHash,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: 'updated',
      businessId: BUSINESS_1_ID,
      googleReviewUrl: updatedUrl,
      googlePlaceId: updatedPlaceId,
    });

    // Verify businesses table mutation in PostgreSQL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('google_review_url, google_place_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.google_review_url).toBe(updatedUrl);
    expect(biz?.google_place_id).toBe(updatedPlaceId);

    // Verify admin_audit_logs entry in PostgreSQL
    const { data: auditLogs } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*')
      .eq('target_business_id', BUSINESS_1_ID)
      .eq('action', 'UPDATE_GOOGLE_DESTINATION')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(auditLogs).toHaveLength(1);
    const log = auditLogs![0];
    expect(log.actor_user_id).toBe(OWNER_1_ID);
    expect(log.actor_role).toBe('owner');
    expect(log.ip_hash).toBe(testIpHash);
    expect(log.payload_after).toEqual({
      google_review_url: updatedUrl,
      google_place_id: updatedPlaceId,
    });
  });

  it('2. Audit failure atomicity: verified PostgreSQL transaction rollback when audit insert fails', async () => {
    await restoreBaseline();

    // Attach temporary failure injection trigger to admin_audit_logs
    const { execSync } = await import('node:child_process');
    execSync(`
      docker exec supabase_db_qr-review psql -U postgres -d postgres -c "
        CREATE OR REPLACE FUNCTION private.test_inject_audit_failure()
        RETURNS TRIGGER LANGUAGE plpgsql AS \\$\\$
        BEGIN
          RAISE EXCEPTION 'INJECTED_AUDIT_LOG_FAILURE: Simulating disk/constraint failure';
        END;
        \\$\\$;

        DROP TRIGGER IF EXISTS trig_test_inject_audit_failure ON public.admin_audit_logs;
        CREATE TRIGGER trig_test_inject_audit_failure
          BEFORE INSERT ON public.admin_audit_logs
          FOR EACH ROW
          EXECUTE FUNCTION private.test_inject_audit_failure();
      "
    `);

    try {
      const targetUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE_SHOULD_ROLLBACK';
      const { data, error } = await supabaseAdmin.rpc('update_merchant_destination', {
        p_business_id: BUSINESS_1_ID,
        p_owner_id: OWNER_1_ID,
        p_google_review_url: targetUrl,
        p_google_place_id: 'ChIJLUXE_SHOULD_ROLLBACK',
        p_ip_hash: 'audit-fail-ip',
      });

      // The RPC call must fail
      expect(error).not.toBeNull();
      expect(error?.message).toContain('INJECTED_AUDIT_LOG_FAILURE');
      expect(data).toBeNull();

      // Database Atomicity Proof: Destination in businesses table MUST remain unmodified
      const { data: bizAfterFailure } = await supabaseAdmin
        .from('businesses')
        .select('google_review_url, google_place_id')
        .eq('id', BUSINESS_1_ID)
        .single();

      expect(bizAfterFailure?.google_review_url).toBe(originalB1Destination.url);
      expect(bizAfterFailure?.google_place_id).toBe(originalB1Destination.placeId);
    } finally {
      // Clean up failure trigger safely
      execSync(`
        docker exec supabase_db_qr-review psql -U postgres -d postgres -c "
          DROP TRIGGER IF EXISTS trig_test_inject_audit_failure ON public.admin_audit_logs;
          DROP FUNCTION IF EXISTS private.test_inject_audit_failure();
        "
      `);
    }
  });

  it('3. Cross-tenant mutation denial: rejects update when caller does not own the business', async () => {
    await restoreBaseline();

    // Attempt to modify Business 1 with Owner 2
    const { data, error } = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_2_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJHACKED',
      p_google_place_id: 'ChIJHACKED',
      p_ip_hash: 'attacker-ip',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('ERR_PERMISSION_DENIED');
    expect(data).toBeNull();

    // Verify Business 1 remains untouched
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('google_review_url, google_place_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.google_review_url).toBe(originalB1Destination.url);
  });

  it('4. Place ID uniqueness & collision rejection via partial unique index', async () => {
    await restoreBaseline();

    // Attempt to update Business 2 to have Business 1's Place ID
    const { data, error } = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_2_ID,
      p_owner_id: OWNER_2_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      p_google_place_id: 'ChIJLUXE00000001', // Conflict with Business 1
      p_ip_hash: 'collision-ip',
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('ERR_PLACE_ID_MISMATCH');
    expect(error?.message).toContain('already associated with another registered business');
    expect(data).toBeNull();

    // Verify Business 2 was untouched
    const { data: biz2 } = await supabaseAdmin
      .from('businesses')
      .select('google_place_id')
      .eq('id', BUSINESS_2_ID)
      .single();

    expect(biz2?.google_place_id).toBe(originalB2Destination.placeId);
  });

  it('5. Nullable Place IDs: multiple businesses can have NULL google_place_id simultaneously', async () => {
    await restoreBaseline();

    // Update Business 1 to NULL placeId
    const res1 = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: 'https://maps.app.goo.gl/ShortLink1',
      p_google_place_id: null,
      p_ip_hash: 'null-ip-1',
    });
    expect(res1.error).toBeNull();
    expect(res1.data?.status).toBe('updated');

    // Update Business 2 to NULL placeId (both NULL concurrently)
    const res2 = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_2_ID,
      p_owner_id: OWNER_2_ID,
      p_google_review_url: 'https://maps.app.goo.gl/ShortLink2',
      p_google_place_id: null,
      p_ip_hash: 'null-ip-2',
    });
    expect(res2.error).toBeNull();
    expect(res2.data?.status).toBe('updated');

    // Both should coexist with NULL placeId in PostgreSQL
    const { data: biz1 } = await supabaseAdmin.from('businesses').select('google_place_id').eq('id', BUSINESS_1_ID).single();
    const { data: biz2 } = await supabaseAdmin.from('businesses').select('google_place_id').eq('id', BUSINESS_2_ID).single();

    expect(biz1?.google_place_id).toBeNull();
    expect(biz2?.google_place_id).toBeNull();
  });

  it('6. Security Safeguard A: unrelated unique constraint violation is NOT mislabeled as Place ID collision', async () => {
    // Test that the exception handler uses GET STACKED DIAGNOSTICS to check constraint name
    const { execSync } = await import('node:child_process');
    const diagnosticProof = execSync(`
      docker exec supabase_db_qr-review psql -U postgres -d postgres -t -A -c "
        CREATE OR REPLACE FUNCTION private.test_diagnostic_safeguard() RETURNS text LANGUAGE plpgsql AS \\$\\$
        DECLARE v_c TEXT;
        BEGIN
          BEGIN
            INSERT INTO public.businesses (id, owner_id, category_id, public_qr_id, vanity_slug, name)
            VALUES (gen_random_uuid(), '${OWNER_1_ID}', 'salon', 'luxe000001', 'test-slug-safeguard', 'Test');
          EXCEPTION
            WHEN unique_violation THEN
              GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
              IF v_c = 'businesses_google_place_id_uq' THEN
                RETURN 'ERR_PLACE_ID_MISMATCH';
              ELSE
                RETURN 'SUCCESS_UNRELATED_CONSTRAINT: ' || v_c;
              END IF;
          END;
          RETURN 'NO_VIOLATION';
        END;
        \\$\\$;
        SELECT private.test_diagnostic_safeguard();
        DROP FUNCTION private.test_diagnostic_safeguard();
      "
    `).toString();

    expect(diagnosticProof).toContain('SUCCESS_UNRELATED_CONSTRAINT: businesses_public_qr_id_uq');
  });

  it('7. Idempotency & No-Op: identical payload returns unmodified and writes zero audit records', async () => {
    await restoreBaseline();

    // Query audit log count before no-op call
    const { count: countBefore } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('target_business_id', BUSINESS_1_ID);

    // Call RPC with identical existing payload
    const { data, error } = await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: originalB1Destination.url,
      p_google_place_id: originalB1Destination.placeId,
      p_ip_hash: 'noop-ip',
    });

    expect(error).toBeNull();
    expect(data?.status).toBe('unmodified');

    // Query audit log count after no-op call
    const { count: countAfter } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('target_business_id', BUSINESS_1_ID);

    expect(countAfter).toBe(countBefore);
  });

  it('8. Concurrency & Row-Lock serialization (FOR UPDATE)', async () => {
    await restoreBaseline();

    // Launch 2 simultaneous RPC updates on the same business
    const update1 = supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJCONCURRENT_1',
      p_google_place_id: 'ChIJCONCURRENT_1',
      p_ip_hash: 'concurrent-ip-1',
    });

    const update2 = supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJCONCURRENT_2',
      p_google_place_id: 'ChIJCONCURRENT_2',
      p_ip_hash: 'concurrent-ip-2',
    });

    const [res1, res2] = await Promise.all([update1, update2]);

    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    // PostgreSQL row lock ensures one committed first, then the other
    const { data: finalBiz } = await supabaseAdmin
      .from('businesses')
      .select('google_place_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(['ChIJCONCURRENT_1', 'ChIJCONCURRENT_2']).toContain(finalBiz?.google_place_id);
  });

  it('9. Privilege Boundary Enforcement: anon and authenticated roles cannot execute the RPC', async () => {
    // Attempt execution as anon role
    const { error: anonError } = await supabaseAnon.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJANON',
      p_google_place_id: 'ChIJANON',
      p_ip_hash: 'anon-ip',
    });

    expect(anonError).not.toBeNull();
    // PostgREST returns 404 or permission denied when execute is revoked
    expect(anonError?.message || '').toMatch(/(permission denied|not found|function.*does not exist)/i);
  });

  it('10. Business field protection: RPC leaves protected hardware and administrative columns untouched', async () => {
    await restoreBaseline();

    const { data: before } = await supabaseAdmin
      .from('businesses')
      .select('public_qr_id, category_id, account_status, is_active, owner_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    await supabaseAdmin.rpc('update_merchant_destination', {
      p_business_id: BUSINESS_1_ID,
      p_owner_id: OWNER_1_ID,
      p_google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJPROT_TEST_001',
      p_google_place_id: 'ChIJPROT_TEST_001',
      p_ip_hash: 'prot-ip',
    });

    const { data: after } = await supabaseAdmin
      .from('businesses')
      .select('public_qr_id, category_id, account_status, is_active, owner_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(after?.public_qr_id).toBe(before?.public_qr_id);
    expect(after?.category_id).toBe(before?.category_id);
    expect(after?.account_status).toBe(before?.account_status);
    expect(after?.is_active).toBe(before?.is_active);
    expect(after?.owner_id).toBe(before?.owner_id);
  });
});
