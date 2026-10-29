-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261030020000_integrity_triggers.sql
-- Task: M2-T07 — Database Triggers and Integrity Guards
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M2-T07 (006_triggers.sql)
--   docs/DATABASE_SCHEMA.md (v1.1) §5.2, §5.5, §5.6, §5.12, §6.1, §6.2, §16
--   docs/SECURITY.md (v1.1) §8.1, §8.2, §3.1.5 (Mandatory MFA & Admin Boundaries)
--   docs/TEST_PLAN.md (v1.1) TC-DB-03, TC-DB-08, REG-06B
--   AGENTS.md §5 Invariant 3 & 9, §9 (Hardware Lock & Privileged Triggers)
--
-- Integrity Guards Implemented:
--   1. Audit Log Immutability (public.admin_audit_logs):
--      - Append-only enforcement via BEFORE UPDATE OR DELETE trigger.
--      - Statement-level BEFORE TRUNCATE trigger blocking table truncation.
--      - INSERT remains fully functional for authorized operations.
--   2. Business Field Protection (public.businesses):
--      - Universal hardware token lock: public_qr_id permanently immutable for all callers (TC-DB-03).
--      - Universal primary key (id) and creation timestamp (created_at) immutability.
--      - Business category (category_id) permanently locked after creation.
--      - Privileged administrative fields (owner_id, account_status, is_active) blocked
--        from alteration by non-admin callers, while permitting authorized super-admin
--        workflows via transaction-scoped app.current_admin_id or verified aal2 TOTP session.
--      - Statement-level TRUNCATE protection.
--   3. Automatic Modification Timestamp Maintenance:
--      - System-managed updated_at maintained on public.businesses, public.subscriptions,
--        public.tenant_quotas, and public.quota_reservations.
--   4. Historical Analytics Events Immutability (public.analytics_events):
--      - Append-only event log: BEFORE UPDATE trigger rejects modifications.
--      - Statement-level TRUNCATE protection.
--   5. Survey Responses Answer & Core Data Protection (public.survey_responses):
--      - Protects customer-affirmed answers, snapshots, and session correlation from alteration.
--      - Preserves legitimate quota commitment (is_generated, generation_attempts) and
--        scheduled 30-day privacy note scrubbing (optional_note -> NULL, purged_at).
--      - Statement-level TRUNCATE protection.
--   6. Questionnaire Versioning and Reference Data Protection:
--      - Enforces M0-07 / M0-08 immutability of question and option text, requiring soft retirement
--        (is_active = FALSE) rather than in-place mutation, preserving historical response integrity.
--      - Statement-level TRUNCATE protection on reference tables.
-- ============================================================================

-- ============================================================================
-- 1. Audit Log Immutability Protection (public.admin_audit_logs)
-- ============================================================================

-- Function: private.enforce_audit_log_immutability()
-- Purpose: Guarantees that audit records are strictly append-only.
--          Rejects any row-level UPDATE or DELETE attempt (TC-DB-08).
CREATE OR REPLACE FUNCTION private.enforce_audit_log_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'ERR_AUDIT_LOG_IMMUTABLE: admin_audit_logs records are append-only and cannot be updated';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ERR_AUDIT_LOG_IMMUTABLE: admin_audit_logs records are append-only and cannot be deleted';
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION private.enforce_audit_log_immutability() IS
    'Blocks UPDATE and DELETE on admin_audit_logs to enforce append-only audit trail immutability (TC-DB-08).';

REVOKE ALL ON FUNCTION private.enforce_audit_log_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_audit_log_immutability() TO authenticated, service_role;

-- Function: private.prevent_audit_log_truncate()
-- Purpose: Statement-level trigger blocking TRUNCATE on admin_audit_logs.
CREATE OR REPLACE FUNCTION private.prevent_audit_log_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_AUDIT_LOG_IMMUTABLE: TRUNCATE is strictly prohibited on admin_audit_logs';
END;
$$;

COMMENT ON FUNCTION private.prevent_audit_log_truncate() IS
    'Blocks TRUNCATE statements on admin_audit_logs.';

REVOKE ALL ON FUNCTION private.prevent_audit_log_truncate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_audit_log_truncate() TO authenticated, service_role;

-- Attach Audit Log Triggers
DROP TRIGGER IF EXISTS trig_audit_log_immutable ON public.admin_audit_logs;
CREATE TRIGGER trig_audit_log_immutable
    BEFORE UPDATE OR DELETE ON public.admin_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_audit_log_immutability();

DROP TRIGGER IF EXISTS trig_audit_log_prevent_truncate ON public.admin_audit_logs;
CREATE TRIGGER trig_audit_log_prevent_truncate
    BEFORE TRUNCATE ON public.admin_audit_logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_audit_log_truncate();


-- ============================================================================
-- 2. Business Field Protection & Immutability Trigger (public.businesses)
-- ============================================================================

-- Function: public.enforce_business_field_protection()
-- Purpose: Enforces universal immutability on hardware QR tokens (public_qr_id),
--          primary keys, categories, and timestamps.
--          Enforces administrative authorization checks for privileged fields
--          (owner_id, account_status, is_active), while maintaining updated_at.
CREATE OR REPLACE FUNCTION public.enforce_business_field_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_is_authorized_admin BOOLEAN := FALSE;
    v_admin_id_text TEXT;
    v_admin_id UUID;
BEGIN
    -- 1. Universal Hardware Token Lock (public_qr_id is permanently immutable for all callers)
    --    Satisfies AGENTS.md Invariant 3, docs/SECURITY.md §8.2, and TC-DB-03.
    IF NEW.public_qr_id IS DISTINCT FROM OLD.public_qr_id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: public_qr_id is hardware-locked and permanently immutable';
    END IF;

    -- 2. Universal Primary Key and Creation Timestamp Lock
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Primary key id cannot be modified';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: created_at timestamp cannot be modified';
    END IF;

    -- 3. Universal Category Lock (category cannot be altered once created)
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: Business category cannot be modified';
    END IF;

    -- 4. Privileged Field Boundaries (owner_id, account_status, is_active)
    IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id) OR
       (NEW.account_status IS DISTINCT FROM OLD.account_status) OR
       (NEW.is_active IS DISTINCT FROM OLD.is_active) THEN

        -- Context A: Check transaction-scoped admin context set by admin_execute_operation
        v_admin_id_text := current_setting('app.current_admin_id', true);
        IF v_admin_id_text IS NOT NULL AND trim(v_admin_id_text) != '' THEN
            BEGIN
                v_admin_id := trim(v_admin_id_text)::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_admin_id := NULL;
            END;

            IF v_admin_id IS NOT NULL AND private.validate_admin_session(v_admin_id) THEN
                v_is_authorized_admin := TRUE;
            END IF;
        END IF;

        -- Context B: Check direct super-admin caller session with verified aal2 TOTP
        IF NOT v_is_authorized_admin AND private.is_super_admin() THEN
            v_is_authorized_admin := TRUE;
        END IF;

        -- If not authorized as super-admin, reject privileged field modifications
        IF NOT v_is_authorized_admin THEN
            IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
                RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: Cannot modify business owner_id without administrator authorization';
            END IF;

            IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
                RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: account_status can only be altered by an administrator';
            END IF;

            IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
                RAISE EXCEPTION 'ERR_PRIVILEGED_FIELD: is_active can only be altered by an administrator';
            END IF;
        END IF;
    END IF;

    -- 5. Automatically maintain system-managed updated_at timestamp
    NEW.updated_at := clock_timestamp();

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_business_field_protection() IS
    'Guarantees hardware public_qr_id immutability, protects privileged tenant fields, and maintains updated_at.';

REVOKE ALL ON FUNCTION public.enforce_business_field_protection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_business_field_protection() TO authenticated, service_role;

-- Function: private.prevent_business_truncate()
-- Purpose: Statement-level trigger blocking TRUNCATE on businesses.
CREATE OR REPLACE FUNCTION private.prevent_business_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_OPERATION_PROHIBITED: TRUNCATE is strictly prohibited on businesses';
END;
$$;

COMMENT ON FUNCTION private.prevent_business_truncate() IS
    'Blocks TRUNCATE statements on businesses table.';

REVOKE ALL ON FUNCTION private.prevent_business_truncate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_business_truncate() TO authenticated, service_role;

-- Attach Businesses Triggers
DROP TRIGGER IF EXISTS trig_protect_business_fields ON public.businesses;
CREATE TRIGGER trig_protect_business_fields
    BEFORE UPDATE ON public.businesses
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_business_field_protection();

DROP TRIGGER IF EXISTS trig_businesses_prevent_truncate ON public.businesses;
CREATE TRIGGER trig_businesses_prevent_truncate
    BEFORE TRUNCATE ON public.businesses
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_business_truncate();


-- ============================================================================
-- 3. Automatic Modification Timestamp Maintenance (updated_at)
-- ============================================================================

-- Function: private.set_updated_at()
-- Purpose: Generic trigger function keeping updated_at aligned with clock_timestamp().
CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.set_updated_at() IS
    'Maintains system modification timestamp (updated_at) on row update.';

REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_updated_at() TO authenticated, service_role;

-- Attach updated_at Triggers on Supporting Managed Tables
DROP TRIGGER IF EXISTS trig_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trig_subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.set_updated_at();

DROP TRIGGER IF EXISTS trig_tenant_quotas_updated_at ON public.tenant_quotas;
CREATE TRIGGER trig_tenant_quotas_updated_at
    BEFORE UPDATE ON public.tenant_quotas
    FOR EACH ROW
    EXECUTE FUNCTION private.set_updated_at();

DROP TRIGGER IF EXISTS trig_quota_reservations_updated_at ON public.quota_reservations;
CREATE TRIGGER trig_quota_reservations_updated_at
    BEFORE UPDATE ON public.quota_reservations
    FOR EACH ROW
    EXECUTE FUNCTION private.set_updated_at();


-- ============================================================================
-- 4. Historical Analytics Events Immutability (public.analytics_events)
-- ============================================================================

-- Function: private.prevent_analytics_event_mutation()
-- Purpose: Rejects row-level UPDATE on analytics_events; data is strictly append-only.
CREATE OR REPLACE FUNCTION private.prevent_analytics_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_ANALYTICS_EVENT_IMMUTABLE: analytics_events records are append-only and cannot be updated';
END;
$$;

COMMENT ON FUNCTION private.prevent_analytics_event_mutation() IS
    'Enforces append-only immutability by blocking UPDATE on analytics_events.';

REVOKE ALL ON FUNCTION private.prevent_analytics_event_mutation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_analytics_event_mutation() TO authenticated, service_role;

-- Function: private.prevent_analytics_event_truncate()
-- Purpose: Statement-level trigger blocking TRUNCATE on analytics_events.
CREATE OR REPLACE FUNCTION private.prevent_analytics_event_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_ANALYTICS_EVENT_IMMUTABLE: TRUNCATE is strictly prohibited on analytics_events';
END;
$$;

COMMENT ON FUNCTION private.prevent_analytics_event_truncate() IS
    'Blocks TRUNCATE statements on analytics_events table.';

REVOKE ALL ON FUNCTION private.prevent_analytics_event_truncate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_analytics_event_truncate() TO authenticated, service_role;

-- Attach Analytics Events Triggers
DROP TRIGGER IF EXISTS trig_analytics_events_immutable ON public.analytics_events;
CREATE TRIGGER trig_analytics_events_immutable
    BEFORE UPDATE ON public.analytics_events
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_analytics_event_mutation();

DROP TRIGGER IF EXISTS trig_analytics_events_prevent_truncate ON public.analytics_events;
CREATE TRIGGER trig_analytics_events_prevent_truncate
    BEFORE TRUNCATE ON public.analytics_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_analytics_event_truncate();


-- ============================================================================
-- 5. Survey Responses Answer & Core Data Protection (public.survey_responses)
-- ============================================================================

-- Function: private.enforce_survey_response_immutability()
-- Purpose: Protects customer answers (selected_options), historical snapshots,
--          tenant identity, and session binding from subsequent modification.
--          Allows authorized quota transitions (is_generated, generation_attempts)
--          and automated 30-day privacy purging (optional_note -> NULL, purged_at).
CREATE OR REPLACE FUNCTION private.enforce_survey_response_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Primary key id cannot be modified on survey_responses';
    END IF;

    IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: business_id cannot be modified on survey_responses';
    END IF;

    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: category_id cannot be modified on survey_responses';
    END IF;

    IF NEW.selected_options IS DISTINCT FROM OLD.selected_options THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: selected_options cannot be modified on survey_responses';
    END IF;

    IF NEW.affirmed_facts_snapshot IS DISTINCT FROM OLD.affirmed_facts_snapshot THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: affirmed_facts_snapshot cannot be modified on survey_responses';
    END IF;

    IF NEW.session_uuid IS DISTINCT FROM OLD.session_uuid THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: session_uuid cannot be modified on survey_responses';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: created_at timestamp cannot be modified on survey_responses';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_survey_response_immutability() IS
    'Protects historical customer survey affirmations while permitting generation state transitions and privacy purges.';

REVOKE ALL ON FUNCTION private.enforce_survey_response_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_survey_response_immutability() TO authenticated, service_role;

-- Function: private.prevent_survey_response_truncate()
-- Purpose: Statement-level trigger blocking TRUNCATE on survey_responses.
CREATE OR REPLACE FUNCTION private.prevent_survey_response_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_OPERATION_PROHIBITED: TRUNCATE is strictly prohibited on survey_responses';
END;
$$;

COMMENT ON FUNCTION private.prevent_survey_response_truncate() IS
    'Blocks TRUNCATE statements on survey_responses table.';

REVOKE ALL ON FUNCTION private.prevent_survey_response_truncate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_survey_response_truncate() TO authenticated, service_role;

-- Attach Survey Responses Triggers
DROP TRIGGER IF EXISTS trig_survey_responses_immutable ON public.survey_responses;
CREATE TRIGGER trig_survey_responses_immutable
    BEFORE UPDATE ON public.survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_survey_response_immutability();

DROP TRIGGER IF EXISTS trig_survey_responses_prevent_truncate ON public.survey_responses;
CREATE TRIGGER trig_survey_responses_prevent_truncate
    BEFORE TRUNCATE ON public.survey_responses
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_survey_response_truncate();


-- ============================================================================
-- 6. Questionnaire Versioning and Reference Data Protection
-- ============================================================================

-- Function: private.enforce_survey_question_immutability()
-- Purpose: Prevents in-place mutation of question text per Founder Decision M0-07.
--          Questions must be retired via is_active = FALSE rather than rewritten,
--          preserving historical response interpretations.
CREATE OR REPLACE FUNCTION private.enforce_survey_question_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Question id cannot be modified';
    END IF;

    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Question category_id cannot be modified';
    END IF;

    IF NEW.question_text IS DISTINCT FROM OLD.question_text THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Question text is immutable; retire question with is_active = FALSE and create new version per M0-07';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Question created_at cannot be modified';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_survey_question_immutability() IS
    'Enforces M0-07 immutable question versioning by blocking in-place mutation of question text.';

REVOKE ALL ON FUNCTION private.enforce_survey_question_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_survey_question_immutability() TO authenticated, service_role;

-- Function: private.enforce_survey_option_immutability()
-- Purpose: Prevents in-place mutation of option text and metadata per Founder Decision M0-08.
--          Options must be retired via is_active = FALSE rather than rewritten.
CREATE OR REPLACE FUNCTION private.enforce_survey_option_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Option id cannot be modified';
    END IF;

    IF NEW.question_id IS DISTINCT FROM OLD.question_id THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Option question_id cannot be modified';
    END IF;

    IF NEW.option_text IS DISTINCT FROM OLD.option_text THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Option text is immutable; retire option with is_active = FALSE per M0-08';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: Option created_at cannot be modified';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_survey_option_immutability() IS
    'Enforces M0-08 immutable option versioning by blocking in-place mutation of option text.';

REVOKE ALL ON FUNCTION private.enforce_survey_option_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_survey_option_immutability() TO authenticated, service_role;

-- Function: private.prevent_reference_data_truncate()
-- Purpose: Statement-level trigger blocking TRUNCATE on reference configuration tables.
CREATE OR REPLACE FUNCTION private.prevent_reference_data_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ERR_OPERATION_PROHIBITED: TRUNCATE is strictly prohibited on reference data tables';
END;
$$;

COMMENT ON FUNCTION private.prevent_reference_data_truncate() IS
    'Blocks TRUNCATE statements on reference tables (business_categories, survey_questions, survey_options).';

REVOKE ALL ON FUNCTION private.prevent_reference_data_truncate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.prevent_reference_data_truncate() TO authenticated, service_role;

-- Attach Questionnaire & Reference Data Triggers
DROP TRIGGER IF EXISTS trig_survey_questions_immutable ON public.survey_questions;
CREATE TRIGGER trig_survey_questions_immutable
    BEFORE UPDATE ON public.survey_questions
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_survey_question_immutability();

DROP TRIGGER IF EXISTS trig_survey_options_immutable ON public.survey_options;
CREATE TRIGGER trig_survey_options_immutable
    BEFORE UPDATE ON public.survey_options
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_survey_option_immutability();

DROP TRIGGER IF EXISTS trig_business_categories_prevent_truncate ON public.business_categories;
CREATE TRIGGER trig_business_categories_prevent_truncate
    BEFORE TRUNCATE ON public.business_categories
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_reference_data_truncate();

DROP TRIGGER IF EXISTS trig_survey_questions_prevent_truncate ON public.survey_questions;
CREATE TRIGGER trig_survey_questions_prevent_truncate
    BEFORE TRUNCATE ON public.survey_questions
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_reference_data_truncate();

DROP TRIGGER IF EXISTS trig_survey_options_prevent_truncate ON public.survey_options;
CREATE TRIGGER trig_survey_options_prevent_truncate
    BEFORE TRUNCATE ON public.survey_options
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_reference_data_truncate();
