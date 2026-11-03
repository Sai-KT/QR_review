-- Migration: 20261103130000_atomic_destination_update_and_place_id_unique.sql
-- Task: M5-T04 Database Integrity Remediation: Atomic Destination Update & Place ID Uniqueness
-- Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
-- Operating Mode: Authorized Option B Implementation (Transactional RPC + Partial Unique Index)
-- Canonical References:
--   docs/DATABASE_SCHEMA.md (v1.1) §5.2, §5.12
--   docs/API_SPEC.md (v1.2) §11.3 (API-OWN-03)
--   docs/SECURITY.md (v1.1) §7, §8
--   AGENTS.md Invariant 8, Founder Decisions M0-02, M0-06, M0-13

-- ============================================================================
-- 1. PARTIAL UNIQUE INDEX: public.businesses (google_place_id)
-- ============================================================================
-- Enforces cross-tenant Place ID uniqueness at the PostgreSQL engine level,
-- replacing race-prone application pre-checks while allowing NULL for unconfigured businesses.
CREATE UNIQUE INDEX IF NOT EXISTS businesses_google_place_id_uq
    ON public.businesses (google_place_id)
    WHERE google_place_id IS NOT NULL;

COMMENT ON INDEX public.businesses_google_place_id_uq IS
    'Enforces global uniqueness of Google Place IDs across registered merchants while allowing NULL for unconfigured businesses.';

-- ============================================================================
-- 2. TRANSACTIONAL STORED PROCEDURE: public.update_merchant_destination
-- ============================================================================
-- Provides true ACID atomicity: updates businesses and inserts an immutable audit log
-- in a single PostgreSQL transaction. Automatically rolls back all mutations if any
-- part fails. Serializes concurrent requests per business using row-level FOR UPDATE lock.
CREATE OR REPLACE FUNCTION public.update_merchant_destination(
    p_business_id UUID,
    p_owner_id UUID,
    p_google_review_url TEXT,
    p_google_place_id TEXT,
    p_ip_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old_url TEXT;
    v_old_place_id TEXT;
    v_owner_id UUID;
    v_constraint_name TEXT;
BEGIN
    -- 1. Parameter Validation
    IF p_business_id IS NULL OR p_owner_id IS NULL OR p_google_review_url IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: business_id, owner_id, and google_review_url are required';
    END IF;

    -- 2. Concurrency Row Lock & Retrieve Current State
    -- FOR UPDATE serializes concurrent updates against the same tenant business
    SELECT google_review_url, google_place_id, owner_id
    INTO v_old_url, v_old_place_id, v_owner_id
    FROM public.businesses
    WHERE id = p_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_BUSINESS_NOT_FOUND: Business record not found';
    END IF;

    -- 3. Strict Tenant Ownership Enforcement
    IF v_owner_id IS DISTINCT FROM p_owner_id THEN
        RAISE EXCEPTION 'ERR_PERMISSION_DENIED: You do not have permission to modify this business review destination';
    END IF;

    -- 4. Idempotency Check (No-Op Mutation)
    IF (v_old_url IS NOT DISTINCT FROM p_google_review_url) AND
       (v_old_place_id IS NOT DISTINCT FROM p_google_place_id) THEN
        RETURN jsonb_build_object(
            'status', 'unmodified',
            'businessId', p_business_id,
            'googleReviewUrl', p_google_review_url,
            'googlePlaceId', p_google_place_id
        );
    END IF;

    -- 5. Mutate Destination Fields in public.businesses
    -- Note: trigger enforce_business_field_protection() automatically maintains updated_at
    -- and prevents unauthorized tampering with protected hardware or administrative columns.
    UPDATE public.businesses
    SET google_review_url = p_google_review_url,
        google_place_id = p_google_place_id
    WHERE id = p_business_id;

    -- 6. Insert Immutable Audit Log in public.admin_audit_logs
    -- Enforces M0-06 / M0-13 actor integrity: actor_role = 'owner', non-null actor_user_id.
    INSERT INTO public.admin_audit_logs (
        actor_user_id,
        actor_role,
        target_business_id,
        action,
        payload_before,
        payload_after,
        ip_hash,
        created_at
    ) VALUES (
        p_owner_id,
        'owner',
        p_business_id,
        'UPDATE_GOOGLE_DESTINATION',
        jsonb_build_object(
            'google_review_url', v_old_url,
            'google_place_id', v_old_place_id
        ),
        jsonb_build_object(
            'google_review_url', p_google_review_url,
            'google_place_id', p_google_place_id
        ),
        p_ip_hash,
        clock_timestamp()
    );

    -- 7. Return Verified Response DTO
    RETURN jsonb_build_object(
        'status', 'updated',
        'businessId', p_business_id,
        'googleReviewUrl', p_google_review_url,
        'googlePlaceId', p_google_place_id
    );

EXCEPTION
    WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'businesses_google_place_id_uq' THEN
            RAISE EXCEPTION 'ERR_PLACE_ID_MISMATCH: This Google Place ID is already associated with another registered business';
        ELSE
            -- Preserve exact distinct handling for unrelated unique violations (Security Safeguard A)
            RAISE EXCEPTION 'ERR_DATABASE_ERROR: Unique constraint violation on %', v_constraint_name;
        END IF;
END;
$$;

COMMENT ON FUNCTION public.update_merchant_destination(UUID, UUID, TEXT, TEXT, TEXT) IS
    'Atomically updates business Google destination fields and records immutable audit log in a single transaction.';

-- ============================================================================
-- 3. PRIVILEGED ACCESS GOVERNANCE & LEAST PRIVILEGE ENFORCEMENT
-- ============================================================================
-- Explicitly revoke execute from public, anon, and authenticated roles to ensure
-- this procedure can NEVER be called directly from browser PostgREST clients.
REVOKE ALL ON FUNCTION public.update_merchant_destination(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_merchant_destination(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

