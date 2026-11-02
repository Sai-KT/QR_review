-- Migration: 20261102140000_survey_responses_authenticity_confirmation.sql
-- Gate: Post-M4 Integration Gate B — M0-16 Authenticity Confirmation
-- Milestone: Post-M4 Customer Journey Integration
-- Canonical References:
--   docs/PRD.md (v1.1) §10.2 (FR-CUST-009)
--   docs/UI_UX.md (v1.1) §7.1 (SCR-CUST-05)
--   docs/API_SPEC.md (v1.2) §7.3, §7.4
--   docs/SECURITY.md (v1.1) §7, §16
--   Founder Decision M0-16 Design B (Enhanced customer authenticity & anti-gating compliance)

-- ============================================================================
-- 1. Add authenticity_confirmed column with safe default for historical rows
-- ============================================================================
ALTER TABLE public.survey_responses
    ADD COLUMN IF NOT EXISTS authenticity_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.survey_responses.authenticity_confirmed IS
    'Founder Decision M0-16 Design B: Customer affirmative self-attestation that feedback reflects genuine personal experience. Required prior to AI review draft generation.';

-- ============================================================================
-- 2. Update Immutability Protection Trigger Function
-- ============================================================================
-- Extends private.enforce_survey_response_immutability() to prevent post-submission
-- mutation of authenticity_confirmed while preserving legitimate quota transitions
-- (is_generated, generation_attempts) and automated 30-day privacy purging.
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

    -- M0-16 Design B: Authenticity self-attestation is hardware-locked upon initial submission
    IF NEW.authenticity_confirmed IS DISTINCT FROM OLD.authenticity_confirmed THEN
        RAISE EXCEPTION 'ERR_IMMUTABLE_FIELD: authenticity_confirmed cannot be modified on survey_responses';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_survey_response_immutability() IS
    'Protects historical customer survey affirmations and authenticity self-attestation while permitting generation state transitions and privacy purges.';

REVOKE ALL ON FUNCTION private.enforce_survey_response_immutability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_survey_response_immutability() TO authenticated, service_role;

-- Reattach trigger to ensure updated definition is active
DROP TRIGGER IF EXISTS trig_survey_responses_immutable ON public.survey_responses;
CREATE TRIGGER trig_survey_responses_immutable
    BEFORE UPDATE ON public.survey_responses
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_survey_response_immutability();

