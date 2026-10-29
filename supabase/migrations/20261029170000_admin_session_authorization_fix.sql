-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261029170000_admin_session_authorization_fix.sql
-- Task: M2-T06 — Administrative Stored Procedures (Targeted Security Fix)
-- Defect Addressed: AUTH-07 (Bypass of Identity & MFA Checks when auth.uid() is NULL)
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M2-T06
--   docs/SECURITY.md (v1.1) §7 & §8 (Admin Architecture & Option A Gateway)
--   docs/TEST_PLAN.md (v1.1) TC-ADM-06, TC-ADM-08, TC-ADM-10, TC-SEC-05, TC-SEC-07
--   AGENTS.md §9, §10 & Founder Authorization for M2-T06 Security Defect Correction
--
-- Defect Analysis (AUTH-07):
--   In 20261029160000_admin_stored_procedures.sql, private.validate_admin_session()
--   evaluated caller identity and MFA only inside:
--     IF auth.uid() IS NOT NULL THEN ... END IF;
--   When called by an 'authenticated' role context where auth.uid() was NULL (e.g.
--   missing, unpopulated, or manipulated JWT sub claims), this condition skipped
--   identity matching and MFA verification, incorrectly returning TRUE for any
--   valid active administrator UUID passed in the arguments.
--
-- Corrective Security Architecture:
--   1. Authoritatively inspects active caller execution role context:
--      - Calling PostgreSQL role via current_setting('role', true)
--      - Supabase JWT role claim via auth.role() / (auth.jwt() ->> 'role')
--   2. In any authenticated role context ('authenticated'):
--      - Caller identity MUST NOT be NULL (auth.uid() IS NOT NULL).
--      - Caller identity MUST match target administrator (auth.uid() = p_admin_user_id).
--      - Level 2 Authenticator Assurance (aal2) with TOTP method verification is
--        strictly enforced when mfa_enforced is TRUE.
--      - Returns FALSE immediately if any requirement is unfulfilled.
--   3. In trusted backend execution context ('service_role' or 'postgres'):
--      - Verifies that target user is an active super_admin in public.admin_users.
--   4. Any unknown, null, unauthenticated, or unsupported role context fails closed (FALSE).
--   5. Least-privilege permissions: REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.validate_admin_session(
    p_admin_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_active BOOLEAN;
    v_mfa BOOLEAN;
    v_calling_role TEXT;
    v_jwt_role TEXT;
BEGIN
    -- 1. Argument validation: fail closed on NULL argument
    IF p_admin_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 2. Authoritative registry lookup: must be active super_admin
    SELECT role, is_active, mfa_enforced
    INTO v_role, v_active, v_mfa
    FROM public.admin_users
    WHERE user_id = p_admin_user_id;

    IF NOT FOUND OR v_role IS DISTINCT FROM 'super_admin' OR v_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- 3. Detect effective caller execution role context
    v_calling_role := current_setting('role', true);
    v_jwt_role := coalesce(auth.role(), auth.jwt() ->> 'role');

    -- Branch A: Authenticated user caller context
    IF v_calling_role = 'authenticated' OR v_jwt_role = 'authenticated' THEN
        -- Mandatory caller identity verification (must not be NULL and must match target admin)
        IF auth.uid() IS NULL OR auth.uid() != p_admin_user_id THEN
            RETURN FALSE;
        END IF;

        -- Mandatory Level 2 Assurance (aal2) with TOTP method verification
        IF v_mfa IS TRUE THEN
            IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' OR
               NOT ((auth.jwt() -> 'amr') @> '[{"method": "totp"}]'::jsonb) THEN
                RETURN FALSE;
            END IF;
        END IF;

        RETURN TRUE;
    END IF;

    -- Branch B: Trusted backend execution context (service_role or postgres)
    IF v_calling_role = 'service_role' OR 
       (v_calling_role IN ('none', 'postgres') AND session_user = 'postgres' AND (v_jwt_role IS NULL OR v_jwt_role IN ('service_role', 'postgres', ''))) THEN
        -- Trusted service_role execution: admin registry verified
        RETURN TRUE;
    END IF;

    -- Branch C: Fail closed on any other / unknown / unsupported role context
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION private.validate_admin_session(UUID) IS
    'Verifies that target user is an active super-admin and satisfies aal2 TOTP MFA requirements. Fails closed on unauthenticated, identity-mismatched, or missing-claim callers.';

REVOKE ALL ON FUNCTION private.validate_admin_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.validate_admin_session(UUID) TO authenticated, service_role;
