-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261029160000_admin_stored_procedures.sql
-- Task: M2-T06 — Implement Super-Admin Operational Procedures & MFA Validation
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M2-T06
--   docs/API_SPEC.md (v1.2) §12 (Admin Operations) & §13 (RPC-INT-06)
--   docs/DATABASE_SCHEMA.md (v1.1) §5.11 (admin_users) & §5.12 (admin_audit_logs)
--   docs/SECURITY.md (v1.1) §7 & §8 (Admin Architecture & Option A Gateway)
--   docs/TEST_PLAN.md (v1.1) TC-ADM-06, TC-ADM-08, TC-ADM-10, TC-ADM-11, TC-SEC-05, TC-SEC-07
--   AGENTS.md §9, §10 & Approved Founder Decisions M0-06, M0-09, M0-10, M0-13
--
-- Security Model & Architecture (Option A Backend-Mediated Gateway):
--   1. Direct execution of administrative procedures is strictly REVOKED from
--      PUBLIC, anon, and authenticated roles.
--   2. Granted exclusively to service_role (and postgres), ensuring all client
--      requests must pass through the hardened admin-operations Edge Function.
--   3. Procedures execute as SECURITY DEFINER with fixed empty search_path
--      (SET search_path = '') and fully schema-qualified object references.
--   4. Procedures authoritatively verify p_admin_user_id against public.admin_users
--      (role = 'super_admin' AND is_active = TRUE).
--   5. When executed in an authenticated caller session (auth.uid() is not null),
--      procedures strictly require caller identity match and verified aal2 TOTP MFA.
--   6. Transaction-scoped context (app.current_admin_id) is set via set_config(..., true)
--      for downstream trigger awareness (M2-T07).
--   7. Every mutation writes an atomic, immutable audit record to public.admin_audit_logs
--      capturing actor_user_id, actor_role ('super_admin'), target_business_id, action,
--      payload_before, and payload_after within the exact same transaction.
--   8. Hardware token (businesses.public_qr_id) is permanently immutable and locked.
-- ============================================================================

-- ============================================================================
-- 1. Helper Function: private.validate_admin_session
-- ============================================================================
-- Purpose: Authoritatively verifies that a given admin user ID represents an
--          active super-administrator, and if called in an authenticated session,
--          verifies identity match and Level 2 Authenticator Assurance (aal2 TOTP).
-- Placement: private schema (unexposed to PostgREST Data API).
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
BEGIN
    IF p_admin_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Query authoritative admin registry in public schema
    SELECT role, is_active, mfa_enforced
    INTO v_role, v_active, v_mfa
    FROM public.admin_users
    WHERE user_id = p_admin_user_id;

    IF NOT FOUND OR v_role IS DISTINCT FROM 'super_admin' OR v_active IS NOT TRUE THEN
        RETURN FALSE;
    END IF;

    -- If executed within an authenticated caller context, enforce identity & MFA claims
    IF auth.uid() IS NOT NULL THEN
        -- Identity spoofing prevention
        IF auth.uid() != p_admin_user_id THEN
            RETURN FALSE;
        END IF;

        -- Mandatory Level 2 Assurance (aal2) with TOTP method verification
        IF v_mfa IS TRUE THEN
            IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' OR
               NOT ((auth.jwt() -> 'amr') @> '[{"method": "totp"}]'::jsonb) THEN
                RETURN FALSE;
            END IF;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION private.validate_admin_session(UUID) IS
    'Verifies that target user is an active super-admin and satisfies aal2 TOTP MFA requirements.';

REVOKE ALL ON FUNCTION private.validate_admin_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.validate_admin_session(UUID) TO authenticated, service_role;


-- ============================================================================
-- 2. Master Administrative Mutator: public.admin_execute_operation (RPC-INT-06)
-- ============================================================================
-- Purpose: Atomic transaction mutator executing approved administrative actions
--          with mandatory caller validation and immutable audit logging.
-- Supported Actions:
--   1. CREATE_BUSINESS: Provisions business, quota, and subscription atomically.
--   2. SET_BUSINESS_STATUS: Updates business account status (pilot/active/suspended).
--   3. ADJUST_QUOTA: Adjusts monthly quota cap or resets used count.
--   4. UPDATE_SUBSCRIPTION: Updates commercial plan, billing dates, or payment logs.
--   5. REASSIGN_OWNER: Transfers business ownership to new auth.users account.
--   6. UPDATE_BUSINESS_PROFILE: Updates merchant-editable profile details safely.
CREATE OR REPLACE FUNCTION public.admin_execute_operation(
    p_admin_user_id UUID,
    p_action TEXT,
    p_target_business_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin_role TEXT;
    v_admin_is_active BOOLEAN;
    v_admin_mfa_enforced BOOLEAN;
    v_final_target_id UUID := p_target_business_id;
    v_before JSONB := NULL;
    v_after JSONB := NULL;
    v_audit_id UUID;
    v_payload JSONB := COALESCE(p_payload, '{}'::jsonb);

    -- Operation-specific variables
    v_qr TEXT;
    v_new_biz_id UUID;
    v_owner_id UUID;
    v_cat_id TEXT;
    v_name TEXT;
    v_slug TEXT;
    v_plan_tier public.plan_tier_type;
    v_initial_quota INT;

    v_new_status public.account_status_type;
    v_reason TEXT;

    v_cycle TEXT;
    v_new_max INT;
    v_used_count INT;
    v_reserved_count INT;

    v_new_owner_id UUID;
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. Input Validation
    -- ------------------------------------------------------------------------
    IF p_admin_user_id IS NULL OR p_action IS NULL OR trim(p_action) = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: admin_user_id and action are required';
    END IF;

    -- ------------------------------------------------------------------------
    -- 2. Authoritative Admin Identity & Status Verification
    -- ------------------------------------------------------------------------
    SELECT role, is_active, mfa_enforced
    INTO v_admin_role, v_admin_is_active, v_admin_mfa_enforced
    FROM public.admin_users
    WHERE user_id = p_admin_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ADMIN_NOT_FOUND: Actor is not registered as an administrator';
    END IF;

    IF v_admin_role IS DISTINCT FROM 'super_admin' OR v_admin_is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'ERR_ADMIN_UNAUTHORIZED: Actor is not an active super administrator';
    END IF;

    -- If executed within an authenticated caller session, enforce identity & MFA claims
    IF auth.uid() IS NOT NULL THEN
        IF auth.uid() != p_admin_user_id THEN
            RAISE EXCEPTION 'ERR_ADMIN_IDENTITY_MISMATCH: Caller does not match specified admin user id';
        END IF;

        IF v_admin_mfa_enforced IS TRUE THEN
            IF (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' OR
               NOT ((auth.jwt() -> 'amr') @> '[{"method": "totp"}]'::jsonb) THEN
                RAISE EXCEPTION 'ERR_ADMIN_MFA_REQUIRED: aal2 TOTP session verification required';
            END IF;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 3. Transaction-Scoped Admin Setting for Downstream Triggers
    -- ------------------------------------------------------------------------
    PERFORM set_config('app.current_admin_id', p_admin_user_id::text, true);

    -- ------------------------------------------------------------------------
    -- 4. Target Business Validation for Tenant-Scoped Actions
    -- ------------------------------------------------------------------------
    IF p_action != 'CREATE_BUSINESS' AND p_target_business_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: target_business_id is required for action %', p_action;
    END IF;

    -- ------------------------------------------------------------------------
    -- 5. Execute Action within Atomic Transaction
    -- ------------------------------------------------------------------------
    CASE p_action

        -- ====================================================================
        -- ACTION: CREATE_BUSINESS (Onboard Merchant)
        -- ====================================================================
        WHEN 'CREATE_BUSINESS' THEN
            -- Validate owner exists in auth.users
            IF v_payload->>'ownerId' IS NULL THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: ownerId is required for CREATE_BUSINESS';
            END IF;
            v_owner_id := (v_payload->>'ownerId')::uuid;

            IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner_id) THEN
                RAISE EXCEPTION 'ERR_USER_NOT_FOUND: Specified owner does not exist in auth.users';
            END IF;

            -- Validate category
            v_cat_id := v_payload->>'categoryId';
            IF v_cat_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.business_categories WHERE id = v_cat_id) THEN
                RAISE EXCEPTION 'ERR_INVALID_CATEGORY: Category does not exist';
            END IF;

            -- Validate name
            v_name := trim(COALESCE(v_payload->>'name', ''));
            IF v_name = '' THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: Business name cannot be empty';
            END IF;

            -- Validate vanity slug format
            v_slug := v_payload->>'vanitySlug';
            IF v_slug IS NULL OR NOT (v_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
                RAISE EXCEPTION 'ERR_INVALID_SLUG: Vanity slug must be lowercase alphanumeric with single hyphens';
            END IF;

            IF EXISTS (SELECT 1 FROM public.businesses WHERE vanity_slug = v_slug) THEN
                RAISE EXCEPTION 'ERR_SLUG_ALREADY_EXISTS: Vanity slug is already in use';
            END IF;

            -- Generate unique 10-char lowercase alphanumeric public_qr_id
            LOOP
                v_qr := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.businesses WHERE public_qr_id = v_qr);
            END LOOP;

            v_new_biz_id := COALESCE((v_payload->>'businessId')::uuid, gen_random_uuid());
            v_plan_tier := COALESCE((v_payload->>'planTier')::public.plan_tier_type, 'setup_package');
            v_initial_quota := COALESCE((v_payload->>'initialQuota')::int, 150);

            -- 5a. Insert Business
            INSERT INTO public.businesses (
                id, owner_id, category_id, public_qr_id, vanity_slug, name, account_status, is_active
            ) VALUES (
                v_new_biz_id,
                v_owner_id,
                v_cat_id,
                v_qr,
                v_slug,
                v_name,
                'pilot',
                TRUE
            );

            -- 5b. Insert Initial Subscription
            INSERT INTO public.subscriptions (
                business_id, plan_tier, subscription_status, current_period_starts_at, current_period_ends_at
            ) VALUES (
                v_new_biz_id,
                v_plan_tier,
                'pilot',
                CURRENT_DATE,
                CURRENT_DATE + INTERVAL '30 days'
            );

            -- 5c. Insert Initial Tenant Quota Ledger
            INSERT INTO public.tenant_quotas (
                business_id, billing_cycle, max_limit, used_count, reserved_count, reset_at
            ) VALUES (
                v_new_biz_id,
                to_char(CURRENT_DATE, 'YYYY-MM'),
                v_initial_quota,
                0,
                0,
                date_trunc('month', NOW() + INTERVAL '1 month')
            );

            v_final_target_id := v_new_biz_id;
            v_before := NULL;
            v_after := jsonb_build_object(
                'business_id', v_new_biz_id,
                'public_qr_id', v_qr,
                'owner_id', v_owner_id,
                'vanity_slug', v_slug,
                'name', v_name,
                'category_id', v_cat_id,
                'account_status', 'pilot',
                'plan_tier', v_plan_tier,
                'initial_quota', v_initial_quota
            );

        -- ====================================================================
        -- ACTION: SET_BUSINESS_STATUS (Suspend / Reactivate)
        -- ====================================================================
        WHEN 'SET_BUSINESS_STATUS' THEN
            v_new_status := (v_payload->>'accountStatus')::public.account_status_type;
            IF v_new_status IS NULL THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: accountStatus is required';
            END IF;

            v_reason := trim(COALESCE(v_payload->>'reason', ''));
            IF v_reason = '' THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: A mandatory reason is required for setting business status';
            END IF;

            SELECT to_jsonb(b) INTO v_before
            FROM public.businesses b
            WHERE id = p_target_business_id
            FOR UPDATE;

            IF v_before IS NULL THEN
                RAISE EXCEPTION 'ERR_BUSINESS_NOT_FOUND: Target business does not exist';
            END IF;

            UPDATE public.businesses
            SET account_status = v_new_status,
                is_active = (v_new_status != 'suspended'),
                updated_at = CLOCK_TIMESTAMP()
            WHERE id = p_target_business_id;

            SELECT to_jsonb(b) INTO v_after
            FROM public.businesses b
            WHERE id = p_target_business_id;

            v_after := v_after || jsonb_build_object('reason', v_reason);

        -- ====================================================================
        -- ACTION: ADJUST_QUOTA (Manual Cap Override / Reset)
        -- ====================================================================
        WHEN 'ADJUST_QUOTA' THEN
            v_cycle := COALESCE(v_payload->>'billingCycle', to_char(CLOCK_TIMESTAMP(), 'YYYY-MM'));
            v_new_max := (v_payload->>'maxLimit')::int;

            IF v_new_max IS NULL OR v_new_max <= 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: maxLimit must be a positive integer';
            END IF;

            -- Check business exists
            IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_target_business_id) THEN
                RAISE EXCEPTION 'ERR_BUSINESS_NOT_FOUND: Target business does not exist';
            END IF;

            -- Auto-provision quota row if missing for specified cycle
            INSERT INTO public.tenant_quotas (
                business_id, billing_cycle, max_limit, used_count, reserved_count, reset_at
            ) VALUES (
                p_target_business_id,
                v_cycle,
                150,
                0,
                0,
                date_trunc('month', NOW() + INTERVAL '1 month')
            ) ON CONFLICT (business_id, billing_cycle) DO NOTHING;

            SELECT to_jsonb(q) INTO v_before
            FROM public.tenant_quotas q
            WHERE business_id = p_target_business_id AND billing_cycle = v_cycle
            FOR UPDATE;

            v_used_count := (v_before->>'used_count')::int;
            v_reserved_count := (v_before->>'reserved_count')::int;

            -- Ceiling check: new limit cannot be lower than in-flight + used count
            IF (v_used_count + v_reserved_count) > v_new_max THEN
                RAISE EXCEPTION 'ERR_QUOTA_BELOW_USAGE: New maxLimit (%) cannot be lower than current in-use quota (%)',
                    v_new_max, (v_used_count + v_reserved_count);
            END IF;

            UPDATE public.tenant_quotas
            SET max_limit = v_new_max,
                used_count = CASE WHEN (v_payload->>'resetUsedCount')::boolean IS TRUE THEN 0 ELSE used_count END,
                updated_at = CLOCK_TIMESTAMP()
            WHERE business_id = p_target_business_id AND billing_cycle = v_cycle;

            SELECT to_jsonb(q) INTO v_after
            FROM public.tenant_quotas q
            WHERE business_id = p_target_business_id AND billing_cycle = v_cycle;

            IF v_payload ? 'reason' THEN
                v_after := v_after || jsonb_build_object('reason', trim(v_payload->>'reason'));
            END IF;

        -- ====================================================================
        -- ACTION: UPDATE_SUBSCRIPTION (Commercial Billing Management)
        -- ====================================================================
        WHEN 'UPDATE_SUBSCRIPTION' THEN
            SELECT to_jsonb(s) INTO v_before
            FROM public.subscriptions s
            WHERE business_id = p_target_business_id
            FOR UPDATE;

            IF v_before IS NULL THEN
                RAISE EXCEPTION 'ERR_SUBSCRIPTION_NOT_FOUND: Subscription record not found for target business';
            END IF;

            IF v_payload ? 'lastPaymentAmount' THEN
                IF (v_payload->>'lastPaymentAmount')::numeric < 0 THEN
                    RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: lastPaymentAmount cannot be negative';
                END IF;
            END IF;

            UPDATE public.subscriptions
            SET subscription_status = COALESCE((v_payload->>'subscriptionStatus')::public.subscription_status_type, subscription_status),
                plan_tier = COALESCE((v_payload->>'planTier')::public.plan_tier_type, plan_tier),
                current_period_starts_at = COALESCE((v_payload->>'currentPeriodStartsAt')::date, current_period_starts_at),
                current_period_ends_at = COALESCE((v_payload->>'currentPeriodEndsAt')::date, current_period_ends_at),
                last_payment_amount = COALESCE((v_payload->>'lastPaymentAmount')::numeric, last_payment_amount),
                payment_reference = COALESCE(v_payload->>'paymentReference', payment_reference),
                last_payment_recorded_at = CASE WHEN v_payload ? 'lastPaymentAmount' THEN CLOCK_TIMESTAMP() ELSE last_payment_recorded_at END,
                updated_at = CLOCK_TIMESTAMP()
            WHERE business_id = p_target_business_id;

            SELECT to_jsonb(s) INTO v_after
            FROM public.subscriptions s
            WHERE business_id = p_target_business_id;

        -- ====================================================================
        -- ACTION: REASSIGN_OWNER (Tenant Ownership Transfer)
        -- ====================================================================
        WHEN 'REASSIGN_OWNER' THEN
            IF v_payload->>'newOwnerId' IS NULL THEN
                RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: newOwnerId is required for REASSIGN_OWNER';
            END IF;
            v_new_owner_id := (v_payload->>'newOwnerId')::uuid;

            IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_new_owner_id) THEN
                RAISE EXCEPTION 'ERR_USER_NOT_FOUND: New owner user does not exist in auth.users';
            END IF;

            SELECT to_jsonb(b) INTO v_before
            FROM public.businesses b
            WHERE id = p_target_business_id
            FOR UPDATE;

            IF v_before IS NULL THEN
                RAISE EXCEPTION 'ERR_BUSINESS_NOT_FOUND: Target business does not exist';
            END IF;

            UPDATE public.businesses
            SET owner_id = v_new_owner_id,
                updated_at = CLOCK_TIMESTAMP()
            WHERE id = p_target_business_id;

            SELECT to_jsonb(b) INTO v_after
            FROM public.businesses b
            WHERE id = p_target_business_id;

            IF v_payload ? 'reason' THEN
                v_after := v_after || jsonb_build_object('reason', trim(v_payload->>'reason'));
            END IF;

        -- ====================================================================
        -- ACTION: UPDATE_BUSINESS_PROFILE (Merchant Profile Admin Maintenance)
        -- ====================================================================
        WHEN 'UPDATE_BUSINESS_PROFILE' THEN
            SELECT to_jsonb(b) INTO v_before
            FROM public.businesses b
            WHERE id = p_target_business_id
            FOR UPDATE;

            IF v_before IS NULL THEN
                RAISE EXCEPTION 'ERR_BUSINESS_NOT_FOUND: Target business does not exist';
            END IF;

            -- Protect hardware-locked and privileged fields
            IF v_payload ? 'public_qr_id' OR v_payload ? 'publicQrId' THEN
                RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: public_qr_id is hardware-locked and permanently immutable';
            END IF;
            IF v_payload ? 'owner_id' OR v_payload ? 'ownerId' THEN
                RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: owner_id must be updated via REASSIGN_OWNER action';
            END IF;
            IF v_payload ? 'category_id' OR v_payload ? 'categoryId' THEN
                RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: category_id cannot be altered after creation';
            END IF;

            -- Validate vanity slug if updated
            IF v_payload ? 'vanitySlug' THEN
                IF NOT ((v_payload->>'vanitySlug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
                    RAISE EXCEPTION 'ERR_INVALID_SLUG: Vanity slug must be lowercase alphanumeric with single hyphens';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM public.businesses
                    WHERE vanity_slug = v_payload->>'vanitySlug' AND id != p_target_business_id
                ) THEN
                    RAISE EXCEPTION 'ERR_SLUG_ALREADY_EXISTS: Vanity slug is already in use by another business';
                END IF;
            END IF;

            UPDATE public.businesses
            SET name = COALESCE(NULLIF(trim(v_payload->>'name'), ''), name),
                vanity_slug = COALESCE(v_payload->>'vanitySlug', vanity_slug),
                logo_url = CASE WHEN v_payload ? 'logoUrl' THEN v_payload->>'logoUrl' ELSE logo_url END,
                google_place_id = CASE WHEN v_payload ? 'googlePlaceId' THEN v_payload->>'googlePlaceId' ELSE google_place_id END,
                google_review_url = CASE WHEN v_payload ? 'googleReviewUrl' THEN v_payload->>'googleReviewUrl' ELSE google_review_url END,
                whatsapp_number = CASE WHEN v_payload ? 'whatsappNumber' THEN v_payload->>'whatsappNumber' ELSE whatsapp_number END,
                updated_at = CLOCK_TIMESTAMP()
            WHERE id = p_target_business_id;

            SELECT to_jsonb(b) INTO v_after
            FROM public.businesses b
            WHERE id = p_target_business_id;

        ELSE
            RAISE EXCEPTION 'ERR_UNKNOWN_ADMIN_ACTION: Unknown administrative action %', p_action;
    END CASE;

    -- ------------------------------------------------------------------------
    -- 6. Insert Immutable Audit Log Record in Same Transaction
    -- ------------------------------------------------------------------------
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
        p_admin_user_id,
        'super_admin',
        v_final_target_id,
        p_action,
        v_before,
        v_after,
        COALESCE(v_payload->>'ipHash', 'internal_gateway'),
        CLOCK_TIMESTAMP()
    ) RETURNING id INTO v_audit_id;

    -- ------------------------------------------------------------------------
    -- 7. Return Standardized Operation Result
    -- ------------------------------------------------------------------------
    RETURN jsonb_build_object(
        'status', 'success',
        'action', p_action,
        'businessId', v_final_target_id,
        'auditId', v_audit_id
    );
END;
$$;

COMMENT ON FUNCTION public.admin_execute_operation(UUID, TEXT, UUID, JSONB) IS
    'Master atomic administrative procedure for merchant onboarding, status changes, quota overrides, and subscription updates.';

REVOKE ALL ON FUNCTION public.admin_execute_operation(UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_execute_operation(UUID, TEXT, UUID, JSONB) TO service_role;


-- ============================================================================
-- 3. Convenience Procedure: public.admin_update_business_profile
-- ============================================================================
-- Purpose: Specific procedure matching docs/SECURITY.md §8.2, delegating to
--          admin_execute_operation under the UPDATE_BUSINESS_PROFILE action.
CREATE OR REPLACE FUNCTION public.admin_update_business_profile(
    p_admin_user_id UUID,
    p_business_id UUID,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public.admin_execute_operation(
        p_admin_user_id,
        'UPDATE_BUSINESS_PROFILE',
        p_business_id,
        p_payload
    );
END;
$$;

COMMENT ON FUNCTION public.admin_update_business_profile(UUID, UUID, JSONB) IS
    'Convenience administrative wrapper for updating merchant profile fields with audit logging.';

REVOKE ALL ON FUNCTION public.admin_update_business_profile(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_business_profile(UUID, UUID, JSONB) TO service_role;
