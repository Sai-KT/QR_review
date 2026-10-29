-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261029180000_enforce_mandatory_admin_totp.sql
-- Task: M2-T06 — Administrative Stored Procedures (Mandatory MFA Hardening)
-- Remediation: Option B (Database Constraint + Unconditional TOTP)
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M2-T06
--   docs/DATABASE_SCHEMA.md (v1.1) §5.11 (admin_users.mfa_enforced: Always TRUE)
--   docs/SECURITY.md (v1.1) §3.1.5 & §7 (Mandatory aal2 TOTP for all super-admin actions)
--   docs/PRD.md FR-ADMIN-001 (Zero admin access without verified second factor)
--   AGENTS.md §5 Invariant 9 (Hardened Super-Admin: active = true AND aal2 TOTP)
--
-- Security Corrections Implemented:
--   1. Database Level (Constraint Invariant):
--      Adds CHECK constraint `chk_admin_users_mfa_enforced` ensuring that
--      mfa_enforced IS TRUE for all records in public.admin_users.
--   2. Procedural Level (Unconditional TOTP Enforcement):
--      Updates private.validate_admin_session() to eliminate the conditional
--      `IF v_mfa IS TRUE THEN` check. Any authenticated user caller session
--      is unconditionally required to present matching identity, Level 2
--      assurance ('aal2'), and explicit TOTP authentication method ('totp') in amr.
--   3. Backend Boundary Preservation:
--      Maintains trusted service_role and direct postgres execution for
--      backend-brokered operations following admin registry verification.
--   4. Fail Closed:
--      Denies null identities, mismatched callers, unexpected roles, and anon.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Database-Level Invariant: Enforce mfa_enforced IS TRUE
-- ----------------------------------------------------------------------------
ALTER TABLE public.admin_users
    ADD CONSTRAINT chk_admin_users_mfa_enforced
    CHECK (mfa_enforced IS TRUE);

COMMENT ON CONSTRAINT chk_admin_users_mfa_enforced ON public.admin_users IS
    'Enforces the non-negotiable security invariant that MFA must always be enforced for super-administrators.';

-- ----------------------------------------------------------------------------
-- 2. Procedural Hardening: Unconditional aal2 TOTP Session Verification
-- ----------------------------------------------------------------------------
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

    -- Branch A: Authenticated user caller context (MANDATORY UNCONDITIONAL TOTP)
    IF v_calling_role = 'authenticated' OR v_jwt_role = 'authenticated' THEN
        -- Mandatory caller identity verification (must not be NULL and must match target admin)
        IF auth.uid() IS NULL OR auth.uid() != p_admin_user_id THEN
            RETURN FALSE;
        END IF;

        -- Mandatory Level 2 Assurance (aal2) with verified TOTP factor (UNCONDITIONAL)
        IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' OR
           NOT ((auth.jwt() -> 'amr') @> '[{"method": "totp"}]'::jsonb) THEN
            RETURN FALSE;
        END IF;

        RETURN TRUE;
    END IF;

    -- Branch B: Trusted backend execution context (service_role or direct postgres)
    IF v_calling_role = 'service_role' OR 
       (v_calling_role IN ('none', 'postgres') AND session_user = 'postgres' AND (v_jwt_role IS NULL OR v_jwt_role IN ('service_role', 'postgres', ''))) THEN
        -- Trusted backend execution: admin registry verified
        RETURN TRUE;
    END IF;

    -- Branch C: Fail closed on any other / unknown / unsupported role context
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION private.validate_admin_session(UUID) IS
    'Verifies that target user is an active super-admin and unconditionally enforces aal2 TOTP MFA for authenticated sessions. Fails closed on unauthenticated or identity-mismatched callers.';

REVOKE ALL ON FUNCTION private.validate_admin_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.validate_admin_session(UUID) TO authenticated, service_role;
