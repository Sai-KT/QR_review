-- ============================================================================
-- Migration: 20261101020000_atomic_analytics_deduplication.sql
-- Task: M3-T04 — Analytics Ingestion Edge Function with Server Deduplication
-- Milestone: M3 — Public Customer Survey & QR Resolution
-- Authoritative Specifications:
--   - docs/API_SPEC.md (v1.2) §7.5 (API-PUB-05), §18 (TC-API-13)
--   - docs/DATABASE_SCHEMA.md (v1.1) §5.6 (analytics_events)
--   - docs/SECURITY.md (v1.1) §7, §8, §16 (TC-ANA-01..06)
--   - docs/TEST_PLAN.md (v1.1) TC-ANA-04, TC-API-13
--
-- Invariants Enforced:
--   1. Transaction-Scoped Advisory Locking: Eliminates check-then-act race conditions
--      across transaction and calendar-minute boundaries for (business_id, event_name, session_uuid).
--   2. Authoritative Tenant Resolution: Resolves business_id directly from public_qr_id in SQL.
--   3. Exact Rolling-Window Deduplication: Checks match within exact p_window_seconds (default 60s).
--   4. Server-Owned Event Rejection: Blocks public client emission of EVENT_SURVEY_COMPLETED
--      and EVENT_GENERATION_SUCCESS at database level.
--   5. Least Privilege & Hardened Execution: SECURITY DEFINER with empty search_path,
--      fully schema-qualified identifiers, REVOKE from PUBLIC/anon/authenticated,
--      GRANT strictly to service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ingest_analytics_event_atomic(
    p_public_qr_id TEXT,
    p_event_name TEXT,
    p_session_uuid UUID,
    p_user_agent_category TEXT DEFAULT 'mobile',
    p_window_seconds INT DEFAULT 60
)
RETURNS TABLE (
    status TEXT,
    event_id UUID,
    business_id UUID,
    deduplication_key TEXT
)
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
    v_business_id UUID;
    v_event_enum public.event_name_type;
    v_ua_category TEXT;
    v_lock_key BIGINT;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_window_start TIMESTAMPTZ;
    v_recent_id UUID;
    v_minute_bucket TIMESTAMPTZ;
    v_minute_iso TEXT;
    v_dedup_key TEXT;
    v_inserted_id UUID;
BEGIN
    -- 1. Input Validation: Reject null or empty parameters
    IF p_public_qr_id IS NULL OR p_event_name IS NULL OR p_session_uuid IS NULL THEN
        RETURN QUERY SELECT 'invalid_payload'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- 2. Event Taxonomy Gate: Reject Server-Owned Events (TC-ANA-02, TC-ANA-03)
    IF p_event_name IN ('EVENT_SURVEY_COMPLETED', 'EVENT_GENERATION_SUCCESS') THEN
        RETURN QUERY SELECT 'forbidden_event'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- 3. Event Taxonomy Gate: Reject Unsupported Arbitrary Events
    IF p_event_name NOT IN (
        'EVENT_QR_PAGE_VIEW',
        'EVENT_GENERATION_REQUESTED',
        'EVENT_COPY_ATTEMPTED',
        'EVENT_COPY_SUCCESS',
        'EVENT_GOOGLE_REDIRECT_CLICK',
        'EVENT_GOOGLE_BYPASS_CLICK'
    ) THEN
        RETURN QUERY SELECT 'invalid_event'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    v_event_enum := p_event_name::public.event_name_type;

    -- 4. User Agent Category Normalization
    v_ua_category := COALESCE(NULLIF(pg_catalog.btrim(p_user_agent_category), ''), 'mobile');
    IF v_ua_category NOT IN ('mobile', 'desktop', 'tablet') THEN
        v_ua_category := 'mobile';
    END IF;

    -- 5. Authoritative Business Resolution by Immutable public_qr_id
    SELECT b.id INTO v_business_id
    FROM public.businesses b
    WHERE b.public_qr_id = p_public_qr_id;

    IF v_business_id IS NULL THEN
        RETURN QUERY SELECT 'qr_not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- 6. Transaction-Scoped Advisory Lock Serialization
    -- Acquires deterministic transaction-scoped lock for (business_id, event_name, session_uuid).
    -- Serializes concurrent requests for the exact same session milestone, completely
    -- preventing concurrent check-then-act races across calendar-minute boundaries.
    v_lock_key := pg_catalog.hashtext(v_business_id::TEXT || ':' || p_event_name || ':' || p_session_uuid::TEXT);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

    -- 7. Exact Rolling-Window Inspection (executed under lock)
    v_now := pg_catalog.clock_timestamp();
    v_window_start := v_now - (COALESCE(p_window_seconds, 60) * INTERVAL '1 second');

    SELECT ae.id INTO v_recent_id
    FROM public.analytics_events ae
    WHERE ae.business_id = v_business_id
      AND ae.event_name = v_event_enum
      AND ae.session_uuid = p_session_uuid
      AND ae.created_at >= v_window_start
    ORDER BY ae.created_at DESC
    LIMIT 1;

    IF v_recent_id IS NOT NULL THEN
        -- Matching event exists within the rolling 60s window -> safely deduplicated
        RETURN QUERY SELECT 'deduplicated'::TEXT, v_recent_id, v_business_id, NULL::TEXT;
        RETURN;
    END IF;

    -- 8. Compute Canonical Minute Deduplication Key
    -- SHA-256(business_id + ':' + event_name + ':' + session_uuid + ':' + date_trunc('minute', NOW()))
    v_minute_bucket := pg_catalog.date_trunc('minute', v_now);
    v_minute_iso := pg_catalog.to_char(v_minute_bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    v_dedup_key := pg_catalog.encode(
        extensions.digest(
            v_business_id::TEXT || ':' || p_event_name || ':' || p_session_uuid::TEXT || ':' || v_minute_iso,
            'sha256'
        ),
        'hex'
    );

    -- 9. Atomic Insertion with Secondary Unique Constraint Catch
    BEGIN
        INSERT INTO public.analytics_events (
            business_id,
            event_name,
            session_uuid,
            user_agent_category,
            deduplication_key,
            created_at
        ) VALUES (
            v_business_id,
            v_event_enum,
            p_session_uuid,
            v_ua_category,
            v_dedup_key,
            v_now
        )
        RETURNING id INTO v_inserted_id;

        RETURN QUERY SELECT 'inserted'::TEXT, v_inserted_id, v_business_id, v_dedup_key;
        RETURN;
    EXCEPTION WHEN unique_violation THEN
        -- Catch secondary unique collision on analytics_events_dedup_uq
        SELECT ae.id INTO v_recent_id
        FROM public.analytics_events ae
        WHERE ae.deduplication_key = v_dedup_key
        LIMIT 1;

        RETURN QUERY SELECT 'deduplicated'::TEXT, v_recent_id, v_business_id, v_dedup_key;
        RETURN;
    END;
END;
$$;

COMMENT ON FUNCTION public.ingest_analytics_event_atomic(TEXT, TEXT, UUID, TEXT, INT) IS
    'Atomic, advisory-locked analytics ingestion and exact rolling-window deduplication procedure (API-PUB-05).';

-- ============================================================================
-- Access Control & Least Privilege Enforcement
-- ============================================================================

REVOKE ALL ON FUNCTION public.ingest_analytics_event_atomic(TEXT, TEXT, UUID, TEXT, INT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ingest_analytics_event_atomic(TEXT, TEXT, UUID, TEXT, INT)
    TO service_role;
