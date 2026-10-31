-- ============================================================================
-- Migration: 20261101000000_public_qr_resolver_and_exact_rate_limit.sql
-- Task: M3-T01 — Public Business QR Token Resolver (API-PUB-01)
-- Gate: A — Forward-Only SQL Migration Authoring
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M3-T01
--   docs/API_SPEC.md (v1.2) §7.1 (API-PUB-01: Public Business QR Resolver), §12 (RPC-INT-01)
--   docs/DATABASE_SCHEMA.md (v1.1) §7.2 (Restricted Internal Projection RPC)
--   docs/SECURITY.md (v1.1) §8 (Rate Limiting & Privileged SQL Security)
--   Founder Decisions:
--     - DEC-M3-01: Exact rolling 60-req / 600-second window rate limiting
--     - DEC-M3-02: Restricted database projection RPC get_public_business_by_qr
--     - DEC-M3-03: Immutable 10-char lowercase alphanumeric public_qr_id (^[a-z0-9]{10}$)
--     - DEC-M3-04: Preserve existing CustomerPageShell component structure
--     - DEC-M3-05: Strict destination URL suppression for suspended merchants (HTTP 403)
--
-- Invariants Enforced:
--   1. Zero Private Data Leaks: owner_id, google_place_id, surrogate UUIDs are not projected.
--   2. Atomic Exact Rate Limiting: Dedicated rate_limit_events table with transaction-level advisory locks.
--   3. Cross-Midnight Continuity: Dual-key overlap support without resetting rolling limits at 00:00 UTC.
--   4. Non-Destructive / Forward-Only: Strictly preserves existing M1/M2/M3-T03 schema and functions.
-- ============================================================================

-- 1. Create Dedicated Exact Rolling-Window Rate-Limit Events Table
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

COMMENT ON TABLE public.rate_limit_events IS
    'High-velocity transient events table for exact rolling-window rate limiting per pseudonymized client IP (M3-T01).';

-- Indexes for high-velocity exact window counts and automated maintenance pruning
CREATE INDEX IF NOT EXISTS rate_limit_events_key_created_idx
    ON public.rate_limit_events (key_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS rate_limit_events_cleanup_idx
    ON public.rate_limit_events (created_at);

-- Enable and Force Row Level Security (Zero access for anon/authenticated)
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_events TO service_role;


-- 2. Stored Procedure: public.check_exact_rate_limit
CREATE OR REPLACE FUNCTION public.check_exact_rate_limit(
    p_key_hash TEXT,
    p_prev_key_hash TEXT DEFAULT NULL,
    p_max_requests INT DEFAULT 60,
    p_window_seconds INT DEFAULT 600
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
    v_now TIMESTAMPTZ := CLOCK_TIMESTAMP();
    v_window_start TIMESTAMPTZ;
    v_count INT := 0;
BEGIN
    -- Input Validation
    IF p_key_hash IS NULL OR p_max_requests IS NULL OR p_max_requests <= 0 OR p_window_seconds <= 0 THEN
        RETURN FALSE;
    END IF;

    -- Acquire PostgreSQL transaction-level advisory locks deterministically to eliminate deadlocks and race conditions
    IF p_prev_key_hash IS NOT NULL AND p_prev_key_hash != p_key_hash THEN
        IF p_key_hash < p_prev_key_hash THEN
            PERFORM pg_advisory_xact_lock(hashtext(p_key_hash));
            PERFORM pg_advisory_xact_lock(hashtext(p_prev_key_hash));
        ELSE
            PERFORM pg_advisory_xact_lock(hashtext(p_prev_key_hash));
            PERFORM pg_advisory_xact_lock(hashtext(p_key_hash));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(hashtext(p_key_hash));
    END IF;

    -- Calculate window start based on exact rolling interval
    v_window_start := v_now - (p_window_seconds * INTERVAL '1 second');

    -- Count admitted requests within the exact rolling window across active key hashes
    IF p_prev_key_hash IS NOT NULL AND p_prev_key_hash != p_key_hash THEN
        SELECT COUNT(*) INTO v_count
        FROM public.rate_limit_events
        WHERE key_hash IN (p_key_hash, p_prev_key_hash)
          AND created_at >= v_window_start;
    ELSE
        SELECT COUNT(*) INTO v_count
        FROM public.rate_limit_events
        WHERE key_hash = p_key_hash
          AND created_at >= v_window_start;
    END IF;

    -- Atomic decision: admit if strictly under threshold, reject otherwise
    IF v_count < p_max_requests THEN
        INSERT INTO public.rate_limit_events (key_hash, created_at)
        VALUES (p_key_hash, v_now);
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.check_exact_rate_limit(TEXT, TEXT, INT, INT) IS
    'Atomic exact rolling-window rate limiter with deterministic advisory locking and cross-midnight overlap support (M3-T01).';

REVOKE ALL ON FUNCTION public.check_exact_rate_limit(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_exact_rate_limit(TEXT, TEXT, INT, INT) TO service_role;


-- 3. Stored Procedure: public.purge_expired_rate_limit_events
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limit_events(
    p_retention_seconds INT DEFAULT 3600,
    p_batch_limit INT DEFAULT 5000
)
RETURNS INT
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INT := 0;
BEGIN
    WITH to_delete AS (
        SELECT id
        FROM public.rate_limit_events
        WHERE created_at < CLOCK_TIMESTAMP() - (p_retention_seconds * INTERVAL '1 second')
        LIMIT p_batch_limit
    )
    DELETE FROM public.rate_limit_events
    WHERE id IN (SELECT id FROM to_delete);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_rate_limit_events(INT, INT) IS
    'Maintenance sweep pruning expired rate limit events older than retention window in bounded batches (M3-T01).';

REVOKE ALL ON FUNCTION public.purge_expired_rate_limit_events(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limit_events(INT, INT) TO service_role;


-- 4. Stored Procedure: public.get_public_business_by_qr (RPC-INT-01 / DEC-M3-02)
CREATE OR REPLACE FUNCTION public.get_public_business_by_qr(p_qr_id TEXT)
RETURNS TABLE (
    public_qr_id TEXT,
    name TEXT,
    logo_url TEXT,
    category_id TEXT,
    google_review_url TEXT,
    whatsapp_number TEXT,
    is_active BOOLEAN,
    account_status TEXT,
    subscription_status TEXT,
    is_direct_google_only BOOLEAN,
    is_suspended BOOLEAN
)
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
    -- Strict input validation: must be exact 10-char lowercase alphanumeric (DEC-M3-03)
    IF p_qr_id IS NULL OR NOT (p_qr_id ~ '^[a-z0-9]{10}$') THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        b.public_qr_id,
        b.name,
        b.logo_url,
        b.category_id,
        -- Strictly suppress outbound URLs if account is suspended or inactive (DEC-M3-05)
        CASE
            WHEN b.account_status = 'suspended' OR b.is_active IS NOT TRUE THEN NULL
            ELSE b.google_review_url
        END AS google_review_url,
        CASE
            WHEN b.account_status = 'suspended' OR b.is_active IS NOT TRUE THEN NULL
            ELSE b.whatsapp_number
        END AS whatsapp_number,
        b.is_active,
        b.account_status::TEXT,
        COALESCE(s.subscription_status::TEXT, 'past_due') AS subscription_status,
        -- Lapsed subscription or past_due triggers direct-Google-only mode (DEC-M3-04)
        (COALESCE(s.subscription_status::TEXT, 'past_due') IN ('past_due', 'canceled')) AS is_direct_google_only,
        -- Suspended account flag
        (b.account_status = 'suspended' OR b.is_active IS NOT TRUE) AS is_suspended
    FROM public.businesses b
    LEFT JOIN LATERAL (
        SELECT sub.subscription_status
        FROM public.subscriptions sub
        WHERE sub.business_id = b.id
        ORDER BY sub.created_at DESC
        LIMIT 1
    ) s ON TRUE
    WHERE b.public_qr_id = p_qr_id;
END;
$$;

COMMENT ON FUNCTION public.get_public_business_by_qr(TEXT) IS
    'Restricted public projection resolving public business profile and commercial status by public_qr_id (M3-T01).';

REVOKE ALL ON FUNCTION public.get_public_business_by_qr(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_by_qr(TEXT) TO service_role;


-- 5. Automated Rate Limit Event Cleanup Scheduling via pg_cron
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate_limit_events_cleanup') THEN
        PERFORM cron.unschedule('rate_limit_events_cleanup');
    END IF;

    PERFORM cron.schedule(
        'rate_limit_events_cleanup',
        '*/10 * * * *',
        'SELECT public.purge_expired_rate_limit_events();'
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron job scheduling deferred: %', SQLERRM;
END $$;
