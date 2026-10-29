-- Migration: 20261028221500_rls_policies.sql
-- Task: M2-T04 Implement Strict Tenant Isolation RLS Policies Across All Tables
-- Milestone: M2 — Database, Security & Core Stored Procedures
-- Operating Mode: Founder-Authorized Gate A (SQL Authoring & Static Verification Only)
-- Canonical References:
--   docs/DATABASE_SCHEMA.md (v1.1) §16 (RLS Matrix)
--   docs/SECURITY.md (v1.1) §7 & §8 (Admin Architecture & Tenant Isolation)
--   docs/API_SPEC.md (v1.2) §6 & §12 (Admin Operations Gateway)
--   docs/ROADMAP.md (v1.1) M2-T04
-- Approved Founder Decisions 1–10 & Mandatory Corrections (Option A Backend Gateway)

-- ============================================================================
-- 1. INTERNAL SCHEMA MANAGEMENT (DATA API ISOLATION)
-- ============================================================================

-- Schema `private` is deliberately omitted from `supabase/config.toml` [api.schemas].
-- Functions defined in this schema cannot be reflected or called via PostgREST HTTP RPC endpoints.
CREATE SCHEMA IF NOT EXISTS private;

COMMENT ON SCHEMA private IS
    'Internal security schema unexposed to PostgREST Data API for privileged helpers and state.';

-- Restrict schema usage: deny anonymous callers, permit authenticated sessions and service_role.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;


-- ============================================================================
-- 2. HARDENED SUPER-ADMIN MFA HELPER FUNCTION
-- ============================================================================

-- Function: private.is_super_admin()
-- Purpose: Authoritative database-level check for active super-admin status and verified TOTP MFA.
-- Architectural Placement:
--   - Under the approved backend-mediated administrative architecture (Option A), browser roles
--     never read or mutate cross-tenant records directly via PostgREST RLS.
--   - This helper is preserved in the non-exposed `private` schema for future administrative RPCs
--     (M2-T06 admin_execute_operation) and field protection triggers (M2-T07).
-- Security Properties:
--   - SECURITY DEFINER: Executes with database owner privileges (postgres / BYPASSRLS) to read admin_users without RLS recursion.
--   - SET search_path = '': Prevents search-path hijacking attacks (Gate M0-09, AGENTS.md §9).
--   - STABLE: Pure query-time evaluation within transaction snapshot.
--   - TOTP Verification: Verifies Level 2 assurance (aal2) AND explicit 'totp' authentication method in JWT amr claims.
-- Note on Factor Revocation: In-flight stateless JWTs are bounded by 1h expiry; real-time enrolled factor revocation
--   is actively enforced at the Edge Function gateway via supabase.auth.getUser() before executing privileged procedures.
CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Fast path: reject unauthenticated calls
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Verify:
    -- 1. User exists in public.admin_users with active status and super_admin role.
    -- 2. JWT claims reflect Level 2 Authenticator Assurance (aal2).
    -- 3. JWT amr (Authentication Methods Reference) array explicitly confirms TOTP method usage.
    RETURN EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.user_id = auth.uid()
          AND au.role = 'super_admin'
          AND au.is_active = TRUE
          AND (auth.jwt() ->> 'aal') = 'aal2'
          AND (auth.jwt() -> 'amr') @> '[{"method": "totp"}]'::jsonb
    );
END;
$$;

COMMENT ON FUNCTION private.is_super_admin() IS
    'Authoritatively verifies caller has active super_admin record and verified TOTP aal2 session without Data API exposure.';

-- Restrict execution: deny PUBLIC and anon; grant strictly to authenticated and service_role.
REVOKE ALL ON FUNCTION private.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_super_admin() TO authenticated, service_role;


-- ============================================================================
-- 3. ROW LEVEL SECURITY ENABLEMENT & FORCED EXECUTION (ALL 12 TABLES)
-- ============================================================================

-- Row Level Security is explicitly enabled AND forced on every canonical application table.
-- FORCE ROW LEVEL SECURITY ensures table owners and session users are subjected to RLS policies.
ALTER TABLE public.business_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_questions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.survey_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_options FORCE ROW LEVEL SECURITY;

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_quotas FORCE ROW LEVEL SECURITY;

ALTER TABLE public.quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quota_reservations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs FORCE ROW LEVEL SECURITY;


-- ============================================================================
-- 4. BASELINE PRIVILEGE REVOCATIONS (ELIMINATE INHERITED DEFAULTS)
-- ============================================================================

-- Revoke all inherited default privileges from PUBLIC across all 12 application tables.
REVOKE ALL ON TABLE public.business_categories FROM PUBLIC;
REVOKE ALL ON TABLE public.businesses FROM PUBLIC;
REVOKE ALL ON TABLE public.survey_questions FROM PUBLIC;
REVOKE ALL ON TABLE public.survey_options FROM PUBLIC;
REVOKE ALL ON TABLE public.survey_responses FROM PUBLIC;
REVOKE ALL ON TABLE public.analytics_events FROM PUBLIC;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_quotas FROM PUBLIC;
REVOKE ALL ON TABLE public.quota_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_users FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC;

-- Revoke all table-level privileges from anon and authenticated roles across all 12 tables to establish clean slate.
REVOKE ALL ON TABLE public.business_categories FROM anon, authenticated;
REVOKE ALL ON TABLE public.businesses FROM anon, authenticated;
REVOKE ALL ON TABLE public.survey_questions FROM anon, authenticated;
REVOKE ALL ON TABLE public.survey_options FROM anon, authenticated;
REVOKE ALL ON TABLE public.survey_responses FROM anon, authenticated;
REVOKE ALL ON TABLE public.analytics_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.tenant_quotas FROM anon, authenticated;
REVOKE ALL ON TABLE public.quota_reservations FROM anon, authenticated;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_audit_logs FROM anon, authenticated;


-- ============================================================================
-- 5. SELECTIVE GRANULAR TABLE & COLUMN PRIVILEGE GRANTS
-- ============================================================================

-- 5.1 Public Reference Tables (Questionnaire Metadata)
-- Read-only SELECT granted to anon and authenticated; mutations revoked from all browser roles.
GRANT SELECT ON TABLE public.business_categories TO anon, authenticated;
GRANT SELECT ON TABLE public.survey_questions TO anon, authenticated;
GRANT SELECT ON TABLE public.survey_options TO anon, authenticated;

-- 5.2 Tenant Root Table (businesses)
-- SELECT granted to anon (returns 0 rows via RLS default-deny) and authenticated (filtered to owned row).
GRANT SELECT ON TABLE public.businesses TO anon, authenticated;

-- Safe profile UPDATE granted strictly to authenticated merchants on approved profile columns only.
-- Protected administrative and immutable hardware columns (id, owner_id, public_qr_id, account_status, is_active, category_id)
-- are deliberately omitted from this GRANT, causing unauthorized alteration attempts to fail with SQLSTATE 42501.
GRANT UPDATE (name, vanity_slug, whatsapp_number) ON TABLE public.businesses TO authenticated;

-- 5.3 Tenant Child Tables (Customer Feedback, Telemetry, Billing & Quotas)
-- SELECT granted to anon (returns 0 rows via RLS default-deny) and authenticated (filtered to owned business).
-- All INSERT, UPDATE, and DELETE privileges remain permanently REVOKED from browser roles.
GRANT SELECT ON TABLE public.survey_responses TO anon, authenticated;
GRANT SELECT ON TABLE public.analytics_events TO anon, authenticated;
GRANT SELECT ON TABLE public.subscriptions TO anon, authenticated;
GRANT SELECT ON TABLE public.tenant_quotas TO anon, authenticated;

-- 5.4 Protected Internal & Operational Tables
-- quota_reservations, rate_limit_buckets, admin_users, and admin_audit_logs have ZERO grants to anon or authenticated.
-- All operations on these relations occur strictly via server-side service_role execution.


-- ============================================================================
-- 6. PUBLIC QUESTIONNAIRE ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- 6.1 business_categories: Active categories only
CREATE POLICY business_categories_select_active
ON public.business_categories
FOR SELECT TO anon, authenticated
USING (is_active = TRUE);

COMMENT ON POLICY business_categories_select_active ON public.business_categories IS
    'Allows anonymous and authenticated users to read active business categories.';

-- 6.2 survey_questions: Active questions in active categories only (hierarchical protection)
CREATE POLICY survey_questions_select_active
ON public.survey_questions
FOR SELECT TO anon, authenticated
USING (
    is_active = TRUE
    AND EXISTS (
        SELECT 1 
        FROM public.business_categories bc
        WHERE bc.id = survey_questions.category_id
          AND bc.is_active = TRUE
    )
);

COMMENT ON POLICY survey_questions_select_active ON public.survey_questions IS
    'Allows public read access to active questions whose parent category is also active.';

-- 6.3 survey_options: Active options belonging to active questions in active categories
CREATE POLICY survey_options_select_active
ON public.survey_options
FOR SELECT TO anon, authenticated
USING (
    is_active = TRUE
    AND EXISTS (
        SELECT 1 
        FROM public.survey_questions sq
        JOIN public.business_categories bc ON bc.id = sq.category_id
        WHERE sq.id = survey_options.question_id
          AND sq.is_active = TRUE
          AND bc.is_active = TRUE
    )
);

COMMENT ON POLICY survey_options_select_active ON public.survey_options IS
    'Allows public read access to active options whose parent question and grandparent category are active.';


-- ============================================================================
-- 7. TENANT ROOT TABLE (businesses) ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- 7.1 Owner Read: Merchants read strictly their own business profile
-- Note on Administrative Access: Super-admin inspection of other merchants' profiles routes strictly through
-- the audited Edge Function gateway (POST /functions/v1/admin-operations) via service_role to ensure mandatory audit trails.
CREATE POLICY businesses_select_owner
ON public.businesses
FOR SELECT TO authenticated
USING (owner_id = auth.uid());

COMMENT ON POLICY businesses_select_owner ON public.businesses IS
    'Enforces merchant tenant isolation: authenticated owners read strictly their own business profile.';

-- 7.2 Owner Update: Merchants update safe profile columns strictly for their own business
CREATE POLICY businesses_update_owner
ON public.businesses
FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

COMMENT ON POLICY businesses_update_owner ON public.businesses IS
    'Restricts merchant profile updates to owned businesses; pairs with column grants on name, vanity_slug, whatsapp_number.';


-- ============================================================================
-- 8. TENANT CHILD TABLES ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- 8.1 survey_responses: Customer feedback records
CREATE POLICY survey_responses_select_owner
ON public.survey_responses
FOR SELECT TO authenticated
USING (
    business_id IN (
        SELECT b.id 
        FROM public.businesses b 
        WHERE b.owner_id = auth.uid()
    )
);

COMMENT ON POLICY survey_responses_select_owner ON public.survey_responses IS
    'Merchants read customer feedback records strictly for their own business; cross-tenant access returns 0 rows.';

-- 8.2 analytics_events: Telemetry & conversion events
CREATE POLICY analytics_events_select_owner
ON public.analytics_events
FOR SELECT TO authenticated
USING (
    business_id IN (
        SELECT b.id 
        FROM public.businesses b 
        WHERE b.owner_id = auth.uid()
    )
);

COMMENT ON POLICY analytics_events_select_owner ON public.analytics_events IS
    'Merchants read analytics milestone events strictly for their own business funnel metrics.';

-- 8.3 subscriptions: Commercial billing & subscription status
CREATE POLICY subscriptions_select_owner
ON public.subscriptions
FOR SELECT TO authenticated
USING (
    business_id IN (
        SELECT b.id 
        FROM public.businesses b 
        WHERE b.owner_id = auth.uid()
    )
);

COMMENT ON POLICY subscriptions_select_owner ON public.subscriptions IS
    'Merchants read commercial subscription records strictly for their own business.';

-- 8.4 tenant_quotas: Monthly quota ledger
CREATE POLICY tenant_quotas_select_owner
ON public.tenant_quotas
FOR SELECT TO authenticated
USING (
    business_id IN (
        SELECT b.id 
        FROM public.businesses b 
        WHERE b.owner_id = auth.uid()
    )
);

COMMENT ON POLICY tenant_quotas_select_owner ON public.tenant_quotas IS
    'Merchants read monthly quota usage ledgers strictly for their own business.';
